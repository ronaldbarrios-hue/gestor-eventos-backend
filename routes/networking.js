const express = require('express');
const { exige, sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const {
  COLS_TARJETA, COLS_COMPLETAS, CAMPOS_EDITABLES_ORGANIZADOR,
} = require('../lib/expositores.js');
const { zonasDelEvento } = require('../lib/aforoZonas.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Categorías donde tiene sentido ofrecer Rueda de Negocios. Los slugs deben
   coincidir con los que ya existen en la tabla `categorias`. */
const CATEGORIAS_PERMITIDAS = ['negocios', 'marketing', 'tecnologia'];

/* `gestionar_expositores` es el permiso fino (stands y rueda de negocios);
   `editar_evento` sigue valiendo para no romper a quien ya lo tenía.

   La lista es UNA: la declara la ruta con `exige()` y la vuelve a comprobar el
   helper dentro. Escrita dos veces acabarían separándose, y entonces la ruta
   diría que pide un permiso y el handler exigiría otro. */
const PERMS_EXPOSITORES = ['gestionar_expositores', 'editar_evento'];

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, PERMS_EXPOSITORES, 'id, owner_id');
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
router.get('/:eventoId/networking/expositores', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. La comprobación es «esta persona va al evento».'), async (req, res) => {
  const { eventoId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const { data: expositores, error: e1 } = await supabase
    .from('networking_expositores')
    .select(`${COLS_TARJETA}, descripcion`)
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
router.get('/:eventoId/networking/mis-citas', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. La comprobación es «esta persona va al evento».'), async (req, res) => {
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
router.post('/:eventoId/networking/horarios/:horarioId/reservar', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. La comprobación es «esta persona va al evento».'), async (req, res) => {
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

  /* Correo de cita confirmada. La plantilla `cita` existe desde que se unificó
     el motor de correo y nadie la llamaba: se reservaba una cita y no llegaba
     nada, así que la persona no tenía dónde consultar a qué hora era.

     Va best-effort y después de responder: la cita ya está guardada, y un fallo
     de SMTP no debe convertirse en un error de reserva. */
  (async () => {
    try {
      const { data: h } = await supabase
        .from('networking_horarios')
        .select('inicio, fin, expositor:networking_expositores!expositor_id(nombre, stand)')
        .eq('id', horarioId).maybeSingle();

      const { data: perfil } = await supabase
        .from('profiles').select('nombre, email').eq('id', req.user.id).maybeSingle();

      const destino = perfil?.email || req.user.email;
      if (!destino) return;

      const { data: ev } = await supabase
        .from('eventos').select('timezone').eq('id', eventoId).maybeSingle();
      const tz = ev?.timezone || 'America/Bogota';

      let cuando = '';
      if (h?.inicio) {
        const d = new Date(h.inicio);
        if (!Number.isNaN(d.getTime())) {
          cuando = d.toLocaleString('es-CO', {
            weekday: 'long', day: 'numeric', month: 'long',
            hour: 'numeric', minute: '2-digit', timeZone: tz,
          });
        }
      }

      await enviarEmailEvento({
        evento: eventoId,
        tipo: 'cita',
        to: destino,
        ctx: {
          nombre: perfil?.nombre || '',
          hora: cuando,
          /* El "lugar" útil aquí es el stand del expositor, no la sede: es a
             donde tiene que ir esa persona. */
          lugar: h?.expositor?.stand ? `Stand ${h.expositor.stand}` : '',
          tipo_boleta: h?.expositor?.nombre || '',
        },
      });
    } catch (e) {
      console.warn('[networking] no se pudo avisar de la cita:', e.message);
    }
  })();

  res.status(201).json({ ok: true, cita_id: cita.id });
});

/* DELETE /eventos/:eventoId/networking/citas/:citaId — cancelar mi propia cita.
   Se filtra por user_id, así que ya está implícitamente protegido. */
router.delete('/:eventoId/networking/citas/:citaId', sesion('Su propia cita: el borrado filtra por user_id, así que nadie puede tocar la de otro.'), async (req, res) => {
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

/* Todo lo que se puede guardar de un stand, para poder leerlo también.

   El select de antes devolvía nueve campos de los que CAMPOS_STAND acepta al
   guardar: contacto_nombre, contacto_email, contacto_telefono, tipo_persona y
   redes se escribían bien y no se volvían a ver nunca. En el panel parecía que
   la ficha no tuviera contacto ni redes, y de ahí salió la idea de que hacía
   falta "ampliarla" — lo que hacía falta era devolverla.

   Ahora la lista vive en `lib/expositores.js`, con las otras dos y con las de
   escritura: era la misma lección repetida en diez copias, y `zona_id` (0088)
   iba camino de repetirla otra vez. */
const COLS_STAND = COLS_COMPLETAS;

/* GET /eventos/:eventoId/expositores — expositores para el MAPA y el directorio
   (staff). Sin gate de categoría.

   Con `?todos=1` vienen también los desactivados: el panel los necesita para
   reactivarlos, y antes quedaban invisibles pese a que el comentario prometía
   "incluye borradores". */
router.get('/:eventoId/expositores', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  try {
    await assertOwner(eventoId, req.user.id);
    let q = supabase
      .from('networking_expositores')
      .select(COLS_STAND)
      .eq('evento_id', eventoId);
    if (!todos) q = q.eq('activo', true);

    const { data, error } = await q
      .order('orden', { ascending: true }).order('nombre', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    /* Cuánto ha repartido cada stand y cuánto le queda. Sale de
       v_consumo_puntos_stand (0057), que lo suma de ticket_interacciones — la
       única fuente de verdad de lo otorgado. Si la migración no está, se sigue
       sin los números en vez de fallar. */
    const consumo = {};
    const { data: filas } = await supabase
      .from('v_consumo_puntos_stand')
      .select('expositor_id, otorgados, veces, asistentes_distintos, disponibles')
      .eq('evento_id', eventoId);
    for (const f of (filas || [])) consumo[f.expositor_id] = f;

    /* Motivos y premios propios: es lo que dice si el stand puede operar o es
       una tarjeta vacía. */
    const ids = (data || []).map(x => x.id);
    const conMotivos = new Set();
    const conPremios = new Set();
    if (ids.length) {
      const [mots, recs] = await Promise.all([
        supabase.from('evento_motivos').select('expositor_id').in('expositor_id', ids),
        supabase.from('recompensas').select('expositor_id').in('expositor_id', ids),
      ]);
      for (const m of (mots.data || [])) conMotivos.add(m.expositor_id);
      for (const r of (recs.data || [])) conPremios.add(r.expositor_id);
    }

    /* El código de la boleta-stand: es con lo que el expositor entra a su portal
       (/expositor/:codigo). Estaba en tickets y el panel no lo tenía, así que
       había que armar ese enlace a mano mirando la base. */
    const codigos = {};
    const ticketIds = (data || []).map(x => x.ticket_id).filter(Boolean);
    if (ticketIds.length) {
      const { data: tks } = await supabase
        .from('tickets').select('id, codigo').in('id', ticketIds);
      for (const tk of (tks || [])) codigos[tk.id] = tk.codigo;
    }

    const expositores = (data || []).map(x => ({
      ...x,
      puntos: consumo[x.id] || { otorgados: 0, veces: 0, asistentes_distintos: 0, disponibles: null },
      tiene_motivos: conMotivos.has(x.id),
      tiene_premios: conPremios.has(x.id),
      /* El vínculo con la boleta-stand que lo creó estaba en ticket_id y no se
         mostraba en ningún sitio. */
      creado_por_boleta: Boolean(x.ticket_id),
      codigo_boleta: x.ticket_id ? (codigos[x.ticket_id] || null) : null,
      listo: conMotivos.has(x.id) && x.estado_ficha === 'completa',
    }));

    res.json({ expositores, consumo_disponible: Boolean(filas) });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ── Bolsa de puntos del evento ───────────────────────────────────────
   El organizador define un total y reparte cuota por stand. El tope lo aplica
   además un trigger de la 0057: si mañana aparece otro camino para otorgar
   puntos, sigue valiendo. Comprobarlo solo aquí sería confiar en que nadie
   escriba una segunda ruta. */

router.get('/:eventoId/expositores/bolsa', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const [bolsa, reparto] = await Promise.all([
      supabase.from('v_bolsa_evento').select('*').eq('evento_id', eventoId).maybeSingle(),
      supabase.from('v_consumo_puntos_stand')
        .select('expositor_id, nombre, stand, cuota_puntos, otorgados, veces, asistentes_distintos, disponibles')
        .eq('evento_id', eventoId).order('nombre', { ascending: true }),
    ]);
    /* Sin la 0057 no existen las vistas: se avisa en vez de reventar. */
    if (bolsa.error || reparto.error) {
      return res.json({ bolsa: null, reparto: [], almacenamiento_listo: false });
    }
    res.json({ bolsa: bolsa.data || null, reparto: reparto.data || [], almacenamiento_listo: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.put('/:eventoId/expositores/bolsa', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const aEntero = (v) => (v === null || v === '' || v === undefined)
    ? null
    : Math.max(0, Math.trunc(Number(v)));
  try {
    await assertOwner(eventoId, req.user.id);
    const total = aEntero(req.body?.total);
    const cuotaDefecto = aEntero(req.body?.cuota_defecto);
    if (total !== null && !Number.isFinite(total)) {
      return res.status(400).json({ error: 'El total debe ser un número.' });
    }

    const { data, error } = await supabase
      .from('evento_bolsa_puntos')
      .upsert({
        evento_id: eventoId, total, cuota_defecto: cuotaDefecto,
        nota: req.body?.nota ? String(req.body.nota).slice(0, 300) : null,
        updated_by: req.user.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'evento_id' })
      .select('*').single();
    if (error) return res.status(503).json({ error: 'Falta aplicar la migración 0057.', detalle: error.message });
    res.json({ bolsa: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Reparto: { cuotas: { <expositor_id>: numero|null } }.
   La suma se valida ANTES de guardar nada: repartir de más y descubrirlo stand
   por stand es peor que no dejar guardar. */
router.put('/:eventoId/expositores/cuotas', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const cuotas = req.body?.cuotas && typeof req.body.cuotas === 'object' ? req.body.cuotas : null;
  if (!cuotas) return res.status(400).json({ error: 'Manda { cuotas: { id: puntos } }.' });

  try {
    await assertOwner(eventoId, req.user.id);

    const { data: mios } = await supabase
      .from('networking_expositores').select('id, cuota_puntos').eq('evento_id', eventoId);
    const validos = new Map((mios || []).map(x => [x.id, x.cuota_puntos]));

    const limpias = {};
    for (const [id, v] of Object.entries(cuotas)) {
      if (!validos.has(id)) return res.status(400).json({ error: 'Un stand de la lista no es de este evento.' });
      const n = (v === null || v === '' || v === undefined) ? null : Math.max(0, Math.trunc(Number(v)));
      if (n !== null && !Number.isFinite(n)) {
        return res.status(400).json({ error: 'Las cuotas deben ser números.' });
      }
      limpias[id] = n;
    }

    const { data: bolsa } = await supabase
      .from('evento_bolsa_puntos').select('total').eq('evento_id', eventoId).maybeSingle();

    if (bolsa?.total != null) {
      /* Se suma lo que va a quedar: las cuotas que llegan más las que esta
         petición no toca. */
      let suma = 0;
      for (const [id, actual] of validos) {
        const futura = (id in limpias) ? limpias[id] : actual;
        suma += futura || 0;
      }
      if (suma > bolsa.total) {
        return res.status(400).json({
          error: `El reparto suma ${suma} y la bolsa del evento son ${bolsa.total}. Sobran ${suma - bolsa.total}.`,
        });
      }
    }

    /* Nadie puede quedar con cuota por debajo de lo que ya repartió: sería
       dejarle el contador en rojo sin explicación. */
    const { data: consumo } = await supabase
      .from('v_consumo_puntos_stand').select('expositor_id, nombre, otorgados').eq('evento_id', eventoId);
    for (const c of (consumo || [])) {
      if (!(c.expositor_id in limpias)) continue;
      const nueva = limpias[c.expositor_id];
      if (nueva !== null && nueva < Number(c.otorgados || 0)) {
        return res.status(400).json({
          error: `"${c.nombre}" ya repartió ${c.otorgados} puntos: su cuota no puede quedar en ${nueva}.`,
        });
      }
    }

    for (const [id, cuota] of Object.entries(limpias)) {
      const { error } = await supabase
        .from('networking_expositores')
        .update({ cuota_puntos: cuota }).eq('id', id).eq('evento_id', eventoId);
      if (error) return res.status(500).json({ error: error.message });
    }

    const { data: reparto } = await supabase
      .from('v_consumo_puntos_stand')
      .select('expositor_id, nombre, stand, cuota_puntos, otorgados, disponibles')
      .eq('evento_id', eventoId).order('nombre', { ascending: true });

    res.json({ reparto: reparto || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ── Gestión de STANDS (expositores) desde el panel del organizador ──
   A diferencia de la Rueda de Negocios (gateada por categoría), los stands
   funcionan para CUALQUIER evento: se crean solos al comprar una boleta-stand
   y también se pueden agregar A MANO aquí (ticket_id = null). */
const CAMPOS_STAND = CAMPOS_EDITABLES_ORGANIZADOR;

/* La zona tiene que ser una de las declaradas en el plano del evento.
 *
 * Las zonas viven dentro de `page_json.zonas`, así que la base no puede
 * comprobarlo con una clave foránea: si nadie mira, un `zona_id` inventado se
 * guarda igual y el stand queda ubicado en ninguna parte. Quien lee aguanta
 * eso —itera sobre las zonas declaradas, y una referencia huérfana
 * simplemente no aparece—, pero aguantarlo no es lo mismo que provocarlo.
 *
 * La 0079 y la 0080 no lo validan y por eso acumulan huérfanos cuando alguien
 * borra una zona. Aquí, al menos, no se crean nuevos por escribir mal.
 * Vaciar la zona ('' → null) sigue siendo válido: es "todavía sin ubicar". */
async function zonaInvalida(eventoId, zonaId) {
  if (zonaId === undefined || zonaId === null) return null;
  const zonas = await zonasDelEvento(eventoId).catch(() => []);
  if (zonas.some(z => z.id === zonaId)) return null;
  return zonas.length
    ? `Esa zona no existe en el plano del evento. Las que hay: ${zonas.map(z => z.nombre).join(', ')}.`
    : 'El evento todavía no tiene zonas en su plano, así que no se puede ubicar el stand.';
}

/* POST /eventos/:eventoId/expositores — crear un stand a mano. */
router.post('/:eventoId/expositores', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const nombre = (req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del stand es requerido.' });
  try {
    await assertOwner(eventoId, req.user.id);
    const fila = { evento_id: eventoId, nombre, ticket_id: null, activo: true, estado_ficha: 'completa', tipo_persona: 'empresa' };
    for (const k of CAMPOS_STAND) {
      if (k === 'nombre') continue;
      if (req.body?.[k] !== undefined) fila[k] = req.body[k] === '' ? null : req.body[k];
    }
    const malaZona = await zonaInvalida(eventoId, fila.zona_id);
    if (malaZona) return res.status(400).json({ error: malaZona });
    const { data, error } = await supabase.from('networking_expositores').insert(fila).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ expositor: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/expositores/:id — editar un stand. */
router.patch('/:eventoId/expositores/:id', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const patch = {};
    for (const k of CAMPOS_STAND) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k] === '' ? null : req.body[k];
    }
    if (patch.nombre !== undefined) {
      const n = (patch.nombre || '').trim();
      if (!n) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
      patch.nombre = n;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });
    const malaZona = await zonaInvalida(eventoId, patch.zona_id);
    if (malaZona) return res.status(400).json({ error: malaZona });
    const { data, error } = await supabase.from('networking_expositores')
      .update(patch).eq('id', id).eq('evento_id', eventoId).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Stand no encontrado.' });
    res.json({ expositor: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/expositores/:id — borrar un stand (scoped al evento). */
router.delete('/:eventoId/expositores/:id', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { error } = await supabase.from('networking_expositores').delete().eq('id', id).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/networking/admin — expositores + horarios + quién reservó cada uno */
router.get('/:eventoId/networking/admin', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    const { data: expositores } = await supabase
      .from('networking_expositores')
      .select(`${COLS_TARJETA}, descripcion`)
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
router.post('/:eventoId/networking/expositores', exige(PERMS_EXPOSITORES), async (req, res) => {
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
router.delete('/:eventoId/networking/expositores/:id', exige(PERMS_EXPOSITORES), async (req, res) => {
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
router.post('/:eventoId/networking/expositores/:id/horarios', exige(PERMS_EXPOSITORES), async (req, res) => {
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
router.delete('/:eventoId/networking/horarios/:id', exige(PERMS_EXPOSITORES), async (req, res) => {
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
