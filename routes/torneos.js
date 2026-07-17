const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Solo eventos de categoría Deportes pueden tener torneos. */
const CATEGORIA_PERMITIDA = 'deportes';

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['editar_evento'], 'id, owner_id');
}

/* Miembro con permiso 'gestionar_torneo' (o el owner) puede administrar
   equipos/resultados, no solo el dueño del evento. */
function assertGestionaTorneo(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['gestionar_torneo', 'editar_evento'], 'id, owner_id');
}

async function assertCategoriaPermitida(eventoId) {
  const { data: ev } = await supabase
    .from('eventos')
    .select('categoria:categorias(slug)')
    .eq('id', eventoId)
    .maybeSingle();
  if (ev?.categoria?.slug !== CATEGORIA_PERMITIDA) {
    throw new Error('El módulo de Torneo solo está disponible para eventos de categoría Deportes.');
  }
}

/* ────────────── Torneo (uno por evento, por ahora) ────────────── */

/* GET /eventos/:eventoId/torneo — trae el torneo del evento (si existe), con equipos y partidos */
router.get('/:eventoId/torneo', async (req, res) => {
  const { eventoId } = req.params;

  const { data: torneo } = await supabase
    .from('torneos').select('*').eq('evento_id', eventoId).maybeSingle();
  if (!torneo) return res.json({ torneo: null });

  const { data: equipos } = await supabase
    .from('torneo_equipos').select('*').eq('torneo_id', torneo.id).order('created_at', { ascending: true });

  const { data: partidos } = await supabase
    .from('torneo_partidos').select('*').eq('torneo_id', torneo.id).order('ronda', { ascending: true }).order('orden', { ascending: true });

  res.json({ torneo, equipos: equipos || [], partidos: partidos || [] });
});

/* POST /eventos/:eventoId/torneo — crear el torneo del evento (uno solo).
   Body: { nombre, formato: 'eliminacion' | 'liga' } */
router.post('/:eventoId/torneo', async (req, res) => {
  const { eventoId } = req.params;
  const { nombre, formato } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del torneo es requerido.' });
  if (!['eliminacion', 'liga'].includes(formato)) return res.status(400).json({ error: 'Formato inválido.' });

  try {
    await assertOwner(eventoId, req.user.id);
    await assertCategoriaPermitida(eventoId);

    const { data: existente } = await supabase.from('torneos').select('id').eq('evento_id', eventoId).maybeSingle();
    if (existente) return res.status(400).json({ error: 'Este evento ya tiene un torneo creado.' });

    const { data, error } = await supabase
      .from('torneos')
      .insert({ evento_id: eventoId, nombre: nombre.trim(), formato })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ torneo: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/torneo/:torneoId — borrar el torneo completo (reinicia todo) */
router.delete('/:eventoId/torneo/:torneoId', async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { error } = await supabase.from('torneos').delete().eq('id', torneoId).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Equipos ────────────── */

/* POST /eventos/:eventoId/torneo/:torneoId/equipos — registrar un equipo */
router.post('/:eventoId/torneo/:torneoId/equipos', async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const { nombre, foto_url } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del equipo es requerido.' });

  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const { data: torneo } = await supabase.from('torneos').select('id, estado').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'No se pueden agregar equipos: el torneo ya inició.' });

    const { data, error } = await supabase
      .from('torneo_equipos')
      .insert({ torneo_id: torneoId, nombre: nombre.trim(), foto_url: foto_url || null })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ equipo: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/torneo/:torneoId/equipos/:id */
router.delete('/:eventoId/torneo/:torneoId/equipos/:id', async (req, res) => {
  const { eventoId, torneoId, id } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const { data: torneo } = await supabase.from('torneos').select('estado').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'No se pueden quitar equipos: el torneo ya inició.' });

    const { error } = await supabase.from('torneo_equipos').delete().eq('id', id).eq('torneo_id', torneoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Generar el fixture (arma los partidos según el formato) ────────────── */

function siguientePotenciaDe2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/* POST /eventos/:eventoId/torneo/:torneoId/generar — arma los partidos.
   Eliminación: crea el bracket completo (rondas), rellenando con "bye"
   (pase directo) si el número de equipos no es potencia de 2.
   Liga: crea todos los partidos posibles (todos contra todos, una vuelta). */
router.post('/:eventoId/torneo/:torneoId/generar', async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const { data: torneo } = await supabase.from('torneos').select('*').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'El fixture ya fue generado para este torneo.' });

    const { data: equipos } = await supabase.from('torneo_equipos').select('id').eq('torneo_id', torneoId).order('created_at', { ascending: true });
    if (!equipos || equipos.length < 2) return res.status(400).json({ error: 'Se necesitan al menos 2 equipos.' });

    if (torneo.formato === 'liga') {
      const partidos = [];
      for (let i = 0; i < equipos.length; i++) {
        for (let j = i + 1; j < equipos.length; j++) {
          partidos.push({
            torneo_id: torneoId, ronda: 1, orden: partidos.length,
            equipo_a_id: equipos[i].id, equipo_b_id: equipos[j].id, estado: 'pendiente',
          });
        }
      }
      const { error } = await supabase.from('torneo_partidos').insert(partidos);
      if (error) return res.status(500).json({ error: error.message });
    } else {
      /* Eliminación directa: arma un bracket de tamaño = siguiente potencia de 2.
         Los slots sobrantes quedan sin equipo (bye) — ese equipo avanza solo. */
      const size = siguientePotenciaDe2(equipos.length);
      const slots = [...equipos.map(e => e.id), ...Array(size - equipos.length).fill(null)];

      /* Mezclar el orden para que los byes no queden todos juntos (barajado simple) */
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }

      const totalRondas = Math.log2(size);
      const partidosPorRonda = {};
      let rondaActual = 1;
      let partidosRondaAnterior = null;

      /* Ronda 1: se llena directo con los equipos */
      const ronda1 = [];
      for (let i = 0; i < slots.length; i += 2) {
        ronda1.push({
          torneo_id: torneoId, ronda: 1, orden: ronda1.length,
          equipo_a_id: slots[i], equipo_b_id: slots[i + 1], estado: 'pendiente',
        });
      }
      const { data: ronda1Insertada, error: e1 } = await supabase.from('torneo_partidos').insert(ronda1).select();
      if (e1) return res.status(500).json({ error: e1.message });
      partidosPorRonda[1] = ronda1Insertada;

      /* Rondas siguientes: vacías, se van llenando a medida que se juegan resultados */
      for (rondaActual = 2; rondaActual <= totalRondas; rondaActual++) {
        const anterior = partidosPorRonda[rondaActual - 1];
        const actual = [];
        for (let i = 0; i < anterior.length; i += 2) {
          actual.push({ torneo_id: torneoId, ronda: rondaActual, orden: actual.length, estado: 'pendiente' });
        }
        const { data: insertada, error: eN } = await supabase.from('torneo_partidos').insert(actual).select();
        if (eN) return res.status(500).json({ error: eN.message });
        partidosPorRonda[rondaActual] = insertada;

        /* Vincular cada partido de la ronda anterior con su "siguiente_partido_id" */
        for (let i = 0; i < anterior.length; i++) {
          const destino = insertada[Math.floor(i / 2)];
          await supabase.from('torneo_partidos').update({ siguiente_partido_id: destino.id }).eq('id', anterior[i].id);
        }
      }

      /* Resolver byes automáticamente: si un partido de ronda 1 tiene un solo
         equipo (el otro es null), ese equipo avanza solo, sin necesidad de jugar. */
      for (const p of ronda1Insertada) {
        if (p.equipo_a_id && !p.equipo_b_id) await avanzarGanador(p.id, p.equipo_a_id);
        if (!p.equipo_a_id && p.equipo_b_id) await avanzarGanador(p.id, p.equipo_b_id);
      }
    }

    const { error: eUpd } = await supabase.from('torneos').update({ estado: 'en_curso' }).eq('id', torneoId);
    if (eUpd) return res.status(500).json({ error: eUpd.message });

    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Helper: marca un partido como jugado (bye o resultado normal) y, si tiene
   siguiente_partido_id, coloca al ganador en el slot libre correspondiente
   del partido de la siguiente ronda. */
async function avanzarGanador(partidoId, ganadorId) {
  const { data: partido } = await supabase.from('torneo_partidos').select('*').eq('id', partidoId).maybeSingle();
  await supabase.from('torneo_partidos').update({ estado: 'jugado' }).eq('id', partidoId);
  if (!partido?.siguiente_partido_id) return;

  const { data: siguiente } = await supabase.from('torneo_partidos').select('*').eq('id', partido.siguiente_partido_id).maybeSingle();
  if (!siguiente) return;

  if (!siguiente.equipo_a_id) {
    await supabase.from('torneo_partidos').update({ equipo_a_id: ganadorId }).eq('id', siguiente.id);
  } else if (!siguiente.equipo_b_id) {
    await supabase.from('torneo_partidos').update({ equipo_b_id: ganadorId }).eq('id', siguiente.id);
  }
}

/* ────────────── Resultados ────────────── */

/* PATCH /eventos/:eventoId/torneo/:torneoId/partidos/:id — registrar resultado.
   Body: { marcador_a, marcador_b, cancha?, fecha_hora? } */
router.patch('/:eventoId/torneo/:torneoId/partidos/:id', async (req, res) => {
  const { eventoId, torneoId, id } = req.params;
  const { marcador_a, marcador_b, cancha, fecha_hora } = req.body;

  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const { data: partido } = await supabase.from('torneo_partidos').select('*').eq('id', id).eq('torneo_id', torneoId).maybeSingle();
    if (!partido) return res.status(404).json({ error: 'Partido no encontrado.' });
    if (!partido.equipo_a_id || !partido.equipo_b_id) return res.status(400).json({ error: 'Este partido todavía no tiene ambos equipos definidos.' });

    const updates = {};
    if (cancha !== undefined) updates.cancha = cancha || null;
    if (fecha_hora !== undefined) updates.fecha_hora = fecha_hora || null;

    if (marcador_a != null && marcador_b != null) {
      if (marcador_a === marcador_b) {
        const { data: torneo } = await supabase.from('torneos').select('formato').eq('id', torneoId).maybeSingle();
        if (torneo?.formato === 'eliminacion') {
          return res.status(400).json({ error: 'En eliminación directa no puede haber empate. Define un ganador.' });
        }
      }
      updates.marcador_a = marcador_a;
      updates.marcador_b = marcador_b;
      updates.estado = 'jugado';
    }

    const { data: actualizado, error } = await supabase
      .from('torneo_partidos').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    /* Si se cargó resultado y es eliminación, avanzar al ganador */
    if (updates.estado === 'jugado' && partido.siguiente_partido_id) {
      const ganadorId = marcador_a > marcador_b ? partido.equipo_a_id : partido.equipo_b_id;
      await avanzarGanador(id, ganadorId);
    }

    res.json({ partido: actualizado });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/torneo/:torneoId/posiciones — tabla de posiciones (solo formato liga) */
router.get('/:eventoId/torneo/:torneoId/posiciones', async (req, res) => {
  const { torneoId } = req.params;

  const { data: equipos } = await supabase.from('torneo_equipos').select('id, nombre, foto_url').eq('torneo_id', torneoId);
  const { data: partidos } = await supabase.from('torneo_partidos').select('*').eq('torneo_id', torneoId).eq('estado', 'jugado');

  const tabla = new Map((equipos || []).map(e => [e.id, {
    ...e, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, puntos: 0,
  }]));

  for (const p of partidos || []) {
    const a = tabla.get(p.equipo_a_id);
    const b = tabla.get(p.equipo_b_id);
    if (!a || !b) continue;
    a.pj++; b.pj++;
    a.gf += p.marcador_a; a.gc += p.marcador_b;
    b.gf += p.marcador_b; b.gc += p.marcador_a;
    if (p.marcador_a > p.marcador_b) { a.pg++; a.puntos += 3; b.pp++; }
    else if (p.marcador_a < p.marcador_b) { b.pg++; b.puntos += 3; a.pp++; }
    else { a.pe++; b.pe++; a.puntos += 1; b.puntos += 1; }
  }

  const resultado = [...tabla.values()].sort((x, y) => y.puntos - x.puntos || (y.gf - y.gc) - (x.gf - x.gc));
  res.json({ posiciones: resultado });
});

module.exports = router;
