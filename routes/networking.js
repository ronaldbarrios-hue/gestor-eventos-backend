const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Categorías donde tiene sentido ofrecer Rueda de Negocios. Los slugs deben
   coincidir con los que ya existen en la tabla `categorias`. */
const CATEGORIAS_PERMITIDAS = ['negocios', 'marketing', 'tecnologia'];

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['editar_evento'], 'id, owner_id');
}

/* Verifica que el evento tenga una categoría habilitada para este módulo. */
async function assertCategoriaPermitida(eventoId) {
  const { data: ev } = await supabase
    .from('eventos')
    .select('categoria:categorias(slug, nombre)')
    .eq('id', eventoId)
    .maybeSingle();
  const slug = ev?.categoria?.slug;
  if (!slug || !CATEGORIAS_PERMITIDAS.includes(slug)) {
    throw new Error('La Rueda de Negocios solo está disponible para eventos de categoría Negocios, Marketing o Tecnología.');
  }
}

/* El organizador siempre puede; cualquier otro usuario necesita tener al
   menos una boleta (en cualquier estado) para ese evento. Así, solo
   quienes efectivamente asisten al evento pueden agendar citas de
   networking — no cualquiera con cuenta en GESTEK. */
async function assertPuedeParticipar(eventoId, user) {
  const { data: ev } = await supabase.from('eventos').select('owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) throw new Error('Evento no encontrado.');
  if (ev.owner_id === user.id) return;

  const email = (user.email || '').toLowerCase();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id')
    .eq('evento_id', eventoId)
    .or(`user_id.eq.${user.id},guest_email.eq.${email}`)
    .limit(1)
    .maybeSingle();

  if (!ticket) throw new Error('Necesitas una boleta para este evento para participar en la Rueda de Negocios.');
}

/* GET /eventos/:eventoId/networking/expositores — lista pública (para
   asistentes con boleta u organizador) con sus horarios y si cada
   horario ya está reservado. */
router.get('/:eventoId/networking/expositores', async (req, res) => {
  const { eventoId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const { data: expositores, error: e1 } = await supabase
    .from('networking_expositores')
    .select('id, nombre, descripcion, logo_url, stand')
    .eq('evento_id', eventoId)
    .order('nombre', { ascending: true });
  if (e1) return res.status(500).json({ error: e1.message });

  const { data: horarios, error: e2 } = await supabase
    .from('networking_horarios')
    .select('id, expositor_id, inicio, fin')
    .in('expositor_id', (expositores || []).map(e => e.id).length ? expositores.map(e => e.id) : ['00000000-0000-0000-0000-000000000000'])
    .order('inicio', { ascending: true });
  if (e2) return res.status(500).json({ error: e2.message });

  const { data: citas, error: e3 } = await supabase
    .from('networking_citas')
    .select('id, horario_id, user_id, estado')
    .eq('evento_id', eventoId)
    .eq('estado', 'confirmada');
  if (e3) return res.status(500).json({ error: e3.message });

  const citaPorHorario = new Map((citas || []).map(c => [c.horario_id, c]));

  const resultado = (expositores || []).map(exp => ({
    ...exp,
    horarios: (horarios || [])
      .filter(h => h.expositor_id === exp.id)
      .map(h => {
        const cita = citaPorHorario.get(h.id);
        return {
          id: h.id,
          inicio: h.inicio,
          fin: h.fin,
          disponible: !cita,
          esMio: cita?.user_id === req.user.id,
        };
      }),
  }));

  res.json({ expositores: resultado });
});

/* GET /eventos/:eventoId/networking/mis-citas — agenda del usuario logueado */
router.get('/:eventoId/networking/mis-citas', async (req, res) => {
  const { eventoId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const { data, error } = await supabase
    .from('networking_citas')
    .select(`
      id, estado, created_at,
      horario:networking_horarios!horario_id(id, inicio, fin,
        expositor:networking_expositores!expositor_id(id, nombre, stand, logo_url))
    `)
    .eq('evento_id', eventoId)
    .eq('user_id', req.user.id)
    .eq('estado', 'confirmada');
  if (error) return res.status(500).json({ error: error.message });

  const citas = (data || []).sort((a, b) => new Date(a.horario?.inicio) - new Date(b.horario?.inicio));
  res.json({ citas });
});

/* POST /eventos/:eventoId/networking/horarios/:horarioId/reservar
   Confirmación automática — si el horario ya está tomado, falla con 409. */
router.post('/:eventoId/networking/horarios/:horarioId/reservar', async (req, res) => {
  const { eventoId, horarioId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const { data: horario, error: e1 } = await supabase
    .from('networking_horarios')
    .select('id, expositor_id, networking_expositores!expositor_id(evento_id)')
    .eq('id', horarioId)
    .maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!horario || horario.networking_expositores?.evento_id !== eventoId) {
    return res.status(404).json({ error: 'Horario no encontrado.' });
  }

  const { data: cita, error: e2 } = await supabase
    .from('networking_citas')
    .insert({ horario_id: horarioId, evento_id: eventoId, user_id: req.user.id, estado: 'confirmada' })
    .select('id')
    .single();

  if (e2) {
    if (e2.code === '23505') return res.status(409).json({ error: 'Ese horario ya fue reservado por alguien más.' });
    return res.status(500).json({ error: e2.message });
  }

  res.status(201).json({ ok: true, cita_id: cita.id });
});

/* DELETE /eventos/:eventoId/networking/citas/:citaId — cancelar mi propia cita.
   Se filtra por user_id, así que ya está implícitamente protegido. */
router.delete('/:eventoId/networking/citas/:citaId', async (req, res) => {
  const { citaId } = req.params;
  const { error } = await supabase
    .from('networking_citas')
    .delete()
    .eq('id', citaId)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ────────────── Gestión del organizador ────────────── */

/* GET /eventos/:eventoId/expositores — lista de expositores para el MAPA y el
   directorio (staff). Incluye borradores; sin gate de categoría. */
router.get('/:eventoId/expositores', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('networking_expositores')
      .select('id, nombre, logo_url, stand, activo, estado_ficha')
      .eq('evento_id', eventoId).eq('activo', true)
      .order('orden', { ascending: true }).order('nombre', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ expositores: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/networking/admin — expositores + horarios + quién reservó cada uno */
router.get('/:eventoId/networking/admin', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    const { data: expositores } = await supabase
      .from('networking_expositores')
      .select('id, nombre, descripcion, logo_url, stand')
      .eq('evento_id', eventoId)
      .order('nombre', { ascending: true });

    const ids = (expositores || []).map(e => e.id);
    const { data: horarios } = ids.length
      ? await supabase.from('networking_horarios').select('id, expositor_id, inicio, fin').in('expositor_id', ids).order('inicio', { ascending: true })
      : { data: [] };

    const { data: citas } = await supabase
      .from('networking_citas')
      .select('id, horario_id, estado, usuario:profiles!user_id(nombre, email)')
      .eq('evento_id', eventoId)
      .eq('estado', 'confirmada');

    const citaPorHorario = new Map((citas || []).map(c => [c.horario_id, c]));
    const resultado = (expositores || []).map(exp => ({
      ...exp,
      horarios: (horarios || []).filter(h => h.expositor_id === exp.id).map(h => ({
        ...h,
        cita: citaPorHorario.get(h.id) || null,
      })),
    }));

    res.json({ expositores: resultado });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/networking/expositores — crear expositor.
   Solo permitido si la categoría del evento admite este módulo. */
router.post('/:eventoId/networking/expositores', async (req, res) => {
  const { eventoId } = req.params;
  const { nombre, descripcion, logo_url, stand } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del expositor es requerido.' });

  try {
    await assertOwner(eventoId, req.user.id);
    await assertCategoriaPermitida(eventoId);

    const { data, error } = await supabase
      .from('networking_expositores')
      .insert({ evento_id: eventoId, nombre: nombre.trim(), descripcion: descripcion || null, logo_url: logo_url || null, stand: stand || null })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ expositor: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/networking/expositores/:id */
router.delete('/:eventoId/networking/expositores/:id', async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { error } = await supabase.from('networking_expositores').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/networking/expositores/:id/horarios
   Body: { inicio, fin, duracion_min } — genera bloques consecutivos de
   `duracion_min` minutos entre `inicio` y `fin`, todo en un solo llamado
   (así el organizador no crea horario por horario a mano). */
router.post('/:eventoId/networking/expositores/:id/horarios', async (req, res) => {
  const { eventoId, id } = req.params;
  const { inicio, fin, duracion_min = 15 } = req.body;
  if (!inicio || !fin) return res.status(400).json({ error: 'inicio y fin son requeridos.' });

  try {
    await assertOwner(eventoId, req.user.id);
    await assertCategoriaPermitida(eventoId);

    const { data: exp } = await supabase.from('networking_expositores').select('id').eq('id', id).eq('evento_id', eventoId).maybeSingle();
    if (!exp) return res.status(404).json({ error: 'Expositor no encontrado.' });

    const bloques = [];
    let cursor = new Date(inicio);
    const finDate = new Date(fin);
    const durMs = duracion_min * 60 * 1000;
    while (cursor.getTime() + durMs <= finDate.getTime()) {
      const bloqueInicio = new Date(cursor);
      const bloqueFin = new Date(cursor.getTime() + durMs);
      bloques.push({ expositor_id: id, inicio: bloqueInicio.toISOString(), fin: bloqueFin.toISOString() });
      cursor = bloqueFin;
    }
    if (bloques.length === 0) return res.status(400).json({ error: 'El rango de tiempo es muy corto para generar bloques.' });
    if (bloques.length > 100) return res.status(400).json({ error: 'Demasiados bloques (máximo 100 por generación).' });

    const { data, error } = await supabase.from('networking_horarios').insert(bloques).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ horarios: data, creados: data.length });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/networking/horarios/:id — borrar un bloque (solo si no tiene cita) */
router.delete('/:eventoId/networking/horarios/:id', async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data: cita } = await supabase.from('networking_citas').select('id').eq('horario_id', id).eq('estado', 'confirmada').maybeSingle();
    if (cita) return res.status(400).json({ error: 'Ese horario ya tiene una cita confirmada. Cancélala primero.' });
    const { error } = await supabase.from('networking_horarios').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
