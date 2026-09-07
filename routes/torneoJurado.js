const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const { exige, sesion } = require('../core/permisos');

/* routes/torneoJurado.js — el formato 'puntaje_jurado' (show de talento):
 * todos participan, nadie se enfrenta a nadie, califica un jurado con
 * puntos. Separado de torneos.js (que ya pasa de 900 líneas) y no al
 * revés: este archivo importa cosas de ningún otro módulo de torneo, así
 * que torneos.js puede importar sus dos helpers de arranque
 * (`crearBaseCalificacion`, `poblarPrimeraRonda`) sin ciclo.
 *
 * ── Las dos decisiones del organizador, y por qué no son un IF por caso ───
 *
 * `modo_calificacion`: 'rubrica' (varios criterios que suman) o
 * 'puntaje_unico' (un solo número). `modo_rondas`: 'una_ronda' (todos se
 * presentan una vez) o 'eliminatoria' (audición → semifinal → final).
 *
 * Puntaje único crea UN `torneo_criterios` ("Puntaje general"). Una ronda
 * crea UNA `torneo_rondas` ("Ronda única"). Así `torneo_calificaciones`
 * tiene SIEMPRE ronda_id y criterio_id — nunca NULL — sin importar qué
 * eligió el organizador: el caso "simple" es el mismo camino con una fila,
 * no una rama de código aparte que alguien puede olvidar mantener.
 *
 * ── Quién es jurado ────────────────────────────────────────────────────
 *
 * `torneo_jurados` apunta, por torneo, qué miembros del equipo del evento
 * califican. Estar ahí ES el permiso para calificar ESE torneo — no hay un
 * permiso nuevo en el catálogo de roles (core/permisos/catalogo.js): el
 * alcance de "un torneo concreto" ya es más estrecho que cualquier entrada
 * de ese catálogo, que concede sobre TODO el evento. Asignar o quitar
 * jurado sigue exigiendo `gestionar_torneo`, igual que el resto del
 * módulo — sólo calificar usa el camino nuevo (`assertEsJurado`).
 *
 * ── Rondas eliminatorias: quién compite en cada una ───────────────────
 *
 * `torneo_ronda_participantes` fija, ronda por ronda, quién compite —
 * mismo principio que `cerrar-grupos` en torneos.js: los clasificados se
 * fijan al cerrar, no se recalculan después. La ronda 1 se llena al
 * `/generar` (con TODOS los inscritos); las siguientes, al `/cerrar-ronda`
 * de la anterior, con los que más puntaje sacaron.
 */

const router = express.Router();
router.use(verifySupabaseJWT);

const PERMS_TORNEO_CONFIG = ['editar_evento'];
const PERMS_TORNEO        = ['gestionar_torneo', 'editar_evento'];

function assertGestionaTorneo(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['gestionar_torneo', 'editar_evento'], 'id, owner_id');
}

/* "Es miembro de este evento" sin exigir NINGÚN permiso de catálogo — a
   propósito: la autorización de un jurado la da `torneo_jurados`, no un rol.
   Un miembro sin ningún permiso especial puede, aun así, ser jurado de un
   torneo concreto si alguien con `gestionar_torneo` lo puso ahí. */
async function assertMiembroEvento(eventoId, userId) {
  const { data: ev, error } = await supabase.from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ev) throw new Error('Evento no encontrado.');
  if (String(ev.owner_id) === String(userId)) return ev;

  const { data: m } = await supabase.from('event_members')
    .select('id').eq('evento_id', eventoId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (!m) throw new Error('No autorizado.');
  return ev;
}

async function assertEsJurado(eventoId, torneoId, userId) {
  await assertMiembroEvento(eventoId, userId);
  const { data: j } = await supabase.from('torneo_jurados')
    .select('torneo_id').eq('torneo_id', torneoId).eq('user_id', userId).maybeSingle();
  if (!j) throw new Error('No autorizado.');
}

/* ────────────── Validación de criterios y rondas ──────────────
   Un solo lugar para las reglas, usado tanto al crear el torneo
   (routes/torneos.js) como al editarlos aquí antes de /generar. */

function validarCriterios(modo_calificacion, criterios) {
  if (modo_calificacion === 'puntaje_unico') {
    const maximo = Number(criterios?.[0]?.puntaje_maximo);
    return { criterios: [{ nombre: 'Puntaje general', puntaje_maximo: Number.isFinite(maximo) && maximo > 0 ? maximo : 10 }] };
  }
  const lista = Array.isArray(criterios) ? criterios : [];
  if (lista.length < 1) return { error: 'La rúbrica necesita al menos un criterio.' };
  const limpios = [];
  for (const c of lista) {
    const nombre = String(c?.nombre || '').trim();
    if (!nombre) return { error: 'Cada criterio necesita un nombre.' };
    const maximo = Number(c?.puntaje_maximo);
    if (!Number.isFinite(maximo) || maximo <= 0) return { error: `"${nombre}": indica un puntaje máximo válido.` };
    limpios.push({ nombre, puntaje_maximo: maximo });
  }
  return { criterios: limpios };
}

function validarRondas(modo_rondas, rondas) {
  if (modo_rondas === 'una_ronda') {
    return { rondas: [{ nombre: 'Ronda única', avanzan: null }] };
  }
  const lista = Array.isArray(rondas) ? rondas : [];
  if (lista.length < 2) return { error: 'Una competencia eliminatoria necesita al menos 2 rondas (p.ej. semifinal y final).' };
  const limpias = [];
  for (let i = 0; i < lista.length; i++) {
    const nombre = String(lista[i]?.nombre || '').trim();
    if (!nombre) return { error: `La ronda ${i + 1} necesita un nombre.` };
    const esUltima = i === lista.length - 1;
    if (esUltima) {
      limpias.push({ nombre, avanzan: null });
      continue;
    }
    const avanzan = Number(lista[i]?.avanzan);
    if (!Number.isInteger(avanzan) || avanzan < 1) {
      return { error: `"${nombre}": indica cuántos avanzan a la siguiente ronda (mínimo 1).` };
    }
    limpias.push({ nombre, avanzan });
  }
  return { rondas: limpias };
}

/* Crea las filas base de un torneo 'puntaje_jurado' recién insertado. Se
   asume que el body ya pasó por validarCriterios/validarRondas — se llama
   así desde POST /torneo en routes/torneos.js. */
async function crearBaseCalificacion(torneoId, { criterios, rondas }) {
  const filasCriterios = criterios.map((c, i) => ({ torneo_id: torneoId, orden: i, ...c }));
  const { error: e1 } = await supabase.from('torneo_criterios').insert(filasCriterios);
  if (e1) throw new Error(e1.message);

  const filasRondas = rondas.map((r, i) => ({
    torneo_id: torneoId, orden: i, estado: i === 0 ? 'abierta' : 'pendiente', ...r,
  }));
  const { error: e2 } = await supabase.from('torneo_rondas').insert(filasRondas);
  if (e2) throw new Error(e2.message);
}

/* Se llama desde POST /generar (routes/torneos.js) cuando formato es
   'puntaje_jurado': mete a TODOS los inscritos en la ronda 1. No hay
   partidos que armar — por eso este formato no toca torneo_partidos. */
async function poblarPrimeraRonda(torneoId) {
  const { data: ronda0 } = await supabase.from('torneo_rondas')
    .select('id').eq('torneo_id', torneoId).eq('orden', 0).maybeSingle();
  if (!ronda0) return;
  const { data: equipos } = await supabase.from('torneo_equipos').select('id').eq('torneo_id', torneoId);
  const filas = (equipos || []).map(e => ({ ronda_id: ronda0.id, equipo_id: e.id }));
  if (filas.length) {
    const { error } = await supabase.from('torneo_ronda_participantes').insert(filas);
    if (error) throw new Error(error.message);
  }
}

async function cargarTorneoJurado(eventoId, torneoId) {
  const { data: torneo } = await supabase.from('torneos').select('*').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
  if (!torneo || torneo.formato !== 'puntaje_jurado') return null;
  return torneo;
}

/* ────────────── Criterios ────────────── */

router.get('/:eventoId/torneo/:torneoId/criterios', sesion('Las notas y la rúbrica son del panel del evento; se leen con sesión.'), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const torneo = await cargarTorneoJurado(eventoId, torneoId);
  if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
  const { data: criterios, error } = await supabase.from('torneo_criterios')
    .select('*').eq('torneo_id', torneoId).order('orden', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ modo_calificacion: torneo.modo_calificacion, criterios: criterios || [] });
});

/* PATCH — reemplaza la lista completa de criterios. Sólo mientras el
   torneo está 'armando': una vez generado, calificar contra un criterio que
   desaparece dejaría notas huérfanas (igual que el formato o los grupos, que
   tampoco se tocan después de /generar). */
router.patch('/:eventoId/torneo/:torneoId/criterios', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const torneo = await cargarTorneoJurado(eventoId, torneoId);
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'Ya se generó este torneo: los criterios no se pueden cambiar.' });

    const { criterios, error } = validarCriterios(torneo.modo_calificacion, req.body.criterios);
    if (error) return res.status(400).json({ error });

    const { error: eDel } = await supabase.from('torneo_criterios').delete().eq('torneo_id', torneoId);
    if (eDel) return res.status(500).json({ error: eDel.message });
    const { error: eIns } = await supabase.from('torneo_criterios')
      .insert(criterios.map((c, i) => ({ torneo_id: torneoId, orden: i, ...c })));
    if (eIns) return res.status(500).json({ error: eIns.message });

    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Rondas ────────────── */

router.get('/:eventoId/torneo/:torneoId/rondas', sesion('Las rondas son del panel del evento; se leen con sesión.'), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const torneo = await cargarTorneoJurado(eventoId, torneoId);
  if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
  const { data: rondas, error } = await supabase.from('torneo_rondas')
    .select('*').eq('torneo_id', torneoId).order('orden', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const ids = (rondas || []).map(r => r.id);
  let conteos = {};
  if (ids.length) {
    const { data: participantes } = await supabase.from('torneo_ronda_participantes')
      .select('ronda_id').in('ronda_id', ids);
    for (const p of (participantes || [])) conteos[p.ronda_id] = (conteos[p.ronda_id] || 0) + 1;
  }
  res.json({
    modo_rondas: torneo.modo_rondas,
    rondas: (rondas || []).map(r => ({ ...r, participantes: conteos[r.id] || 0 })),
  });
});

/* PATCH — reemplaza la lista completa de rondas. Mismo candado que
   criterios: sólo mientras 'armando'. */
router.patch('/:eventoId/torneo/:torneoId/rondas', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const torneo = await cargarTorneoJurado(eventoId, torneoId);
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'Ya se generó este torneo: las rondas no se pueden cambiar.' });
    if (torneo.modo_rondas !== 'eliminatoria') return res.status(400).json({ error: 'Este torneo es de una sola ronda.' });

    const { rondas, error } = validarRondas(torneo.modo_rondas, req.body.rondas);
    if (error) return res.status(400).json({ error });

    const { error: eDel } = await supabase.from('torneo_rondas').delete().eq('torneo_id', torneoId);
    if (eDel) return res.status(500).json({ error: eDel.message });
    const { error: eIns } = await supabase.from('torneo_rondas')
      .insert(rondas.map((r, i) => ({ torneo_id: torneoId, orden: i, estado: i === 0 ? 'abierta' : 'pendiente', ...r })));
    if (eIns) return res.status(500).json({ error: eIns.message });

    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Jurados ────────────── */

router.get('/:eventoId/torneo/:torneoId/jurados', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const torneo = await cargarTorneoJurado(eventoId, torneoId);
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

    const { data: jurados, error } = await supabase.from('torneo_jurados')
      .select('user_id, created_at, profile:profiles!user_id(id, nombre, avatar_url, email)')
      .eq('torneo_id', torneoId);
    if (error) return res.status(500).json({ error: error.message });

    /* Elegibles: miembros activos del evento que todavía no son jurado de
       ESTE torneo (pueden serlo de otro). */
    const { data: miembros } = await supabase.from('event_members')
      .select('user_id, profile:profiles!user_id(id, nombre, avatar_url, email)')
      .eq('evento_id', eventoId).eq('status', 'active');
    const yaJurado = new Set((jurados || []).map(j => j.user_id));
    const elegibles = (miembros || []).filter(m => m.user_id && !yaJurado.has(m.user_id));

    res.json({ jurados: jurados || [], elegibles });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.post('/:eventoId/torneo/:torneoId/jurados', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ error: 'Falta user_id.' });
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const torneo = await cargarTorneoJurado(eventoId, torneoId);
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

    /* Sólo miembros activos del evento (o su dueño): ser jurado no puede ser
       la puerta de entrada de alguien que no tenía por qué estar en el
       panel del evento para empezar. */
    const { data: evento } = await supabase.from('eventos').select('owner_id').eq('id', eventoId).maybeSingle();
    const esOwner = evento && String(evento.owner_id) === String(userId);
    if (!esOwner) {
      const { data: miembro } = await supabase.from('event_members')
        .select('id').eq('evento_id', eventoId).eq('user_id', userId).eq('status', 'active').maybeSingle();
      if (!miembro) return res.status(400).json({ error: 'Ese usuario no es miembro activo de este evento.' });
    }

    const { error } = await supabase.from('torneo_jurados')
      .upsert({ torneo_id: torneoId, user_id: userId }, { onConflict: 'torneo_id,user_id' });
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.delete('/:eventoId/torneo/:torneoId/jurados/:userId', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId, userId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const { error } = await supabase.from('torneo_jurados')
      .delete().eq('torneo_id', torneoId).eq('user_id', userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Calificar ──────────────
   Lo que ve y manda el jurado. Nada aquí exige `gestionar_torneo`: exige
   `assertEsJurado`, que es más estrecho (un torneo concreto) y no depende
   del catálogo de roles. */

router.get('/:eventoId/torneo/:torneoId/calificar', sesion('La hoja de calificación es del jurado asignado; el acceso se decide dentro (assertEsJurado), no por permiso de catálogo.'), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertEsJurado(eventoId, torneoId, req.user.id);

    const { data: ronda } = await supabase.from('torneo_rondas')
      .select('*').eq('torneo_id', torneoId).eq('estado', 'abierta')
      .order('orden', { ascending: true }).limit(1).maybeSingle();
    if (!ronda) return res.json({ ronda: null, participantes: [], criterios: [], mis_calificaciones: [] });

    const [{ data: participantes }, { data: criterios }, { data: mias }] = await Promise.all([
      supabase.from('torneo_ronda_participantes')
        .select('equipo:torneo_equipos!equipo_id(id, nombre, foto_url)').eq('ronda_id', ronda.id),
      supabase.from('torneo_criterios')
        .select('id, nombre, puntaje_maximo, orden').eq('torneo_id', torneoId).order('orden', { ascending: true }),
      supabase.from('torneo_calificaciones')
        .select('equipo_id, criterio_id, puntaje, comentario')
        .eq('ronda_id', ronda.id).eq('jurado_id', req.user.id),
    ]);

    res.json({
      ronda,
      participantes: (participantes || []).map(p => p.equipo).filter(Boolean),
      criterios: criterios || [],
      mis_calificaciones: mias || [],
    });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PUT — sube (o corrige) las notas de UN participante, en UNA ronda, para
   todos los criterios que traiga. El UNIQUE de la tabla es lo que convierte
   "calificar de nuevo" en "corregir mi nota". */
router.put('/:eventoId/torneo/:torneoId/calificar', sesion('El acceso se decide dentro (assertEsJurado).'), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const { ronda_id, equipo_id, notas } = req.body || {};
  if (!ronda_id || !equipo_id) return res.status(400).json({ error: 'Faltan ronda_id y equipo_id.' });
  if (!Array.isArray(notas) || !notas.length) return res.status(400).json({ error: 'Faltan notas.' });

  try {
    await assertEsJurado(eventoId, torneoId, req.user.id);

    const { data: ronda } = await supabase.from('torneo_rondas')
      .select('id, estado').eq('id', ronda_id).eq('torneo_id', torneoId).maybeSingle();
    if (!ronda) return res.status(404).json({ error: 'Ronda no encontrada.' });
    if (ronda.estado !== 'abierta') return res.status(400).json({ error: 'Esta ronda no está abierta para calificar.' });

    const { data: participa } = await supabase.from('torneo_ronda_participantes')
      .select('equipo_id').eq('ronda_id', ronda_id).eq('equipo_id', equipo_id).maybeSingle();
    if (!participa) return res.status(400).json({ error: 'Este participante no está en esta ronda.' });

    const { data: criterios } = await supabase.from('torneo_criterios').select('id, puntaje_maximo').eq('torneo_id', torneoId);
    const porId = new Map((criterios || []).map(c => [c.id, c]));

    const ahora = new Date().toISOString();
    const filas = [];
    for (const n of notas) {
      const crit = porId.get(n?.criterio_id);
      if (!crit) return res.status(400).json({ error: 'Criterio inválido para este torneo.' });
      const puntaje = Number(n.puntaje);
      if (!Number.isFinite(puntaje) || puntaje < 0 || puntaje > Number(crit.puntaje_maximo)) {
        return res.status(400).json({ error: `El puntaje debe estar entre 0 y ${crit.puntaje_maximo}.` });
      }
      filas.push({
        ronda_id, criterio_id: n.criterio_id, equipo_id, jurado_id: req.user.id,
        puntaje, comentario: n.comentario?.trim() || null, updated_at: ahora,
      });
    }

    const { error } = await supabase.from('torneo_calificaciones')
      .upsert(filas, { onConflict: 'ronda_id,criterio_id,equipo_id,jurado_id' });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Cerrar ronda (sólo modo_rondas = 'eliminatoria') ────────────── */

router.post('/:eventoId/torneo/:torneoId/cerrar-ronda', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const torneo = await cargarTorneoJurado(eventoId, torneoId);
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.modo_rondas !== 'eliminatoria') return res.status(400).json({ error: 'Este torneo no usa rondas eliminatorias.' });

    const { data: ronda } = await supabase.from('torneo_rondas')
      .select('*').eq('torneo_id', torneoId).eq('estado', 'abierta')
      .order('orden', { ascending: true }).limit(1).maybeSingle();
    if (!ronda) return res.status(400).json({ error: 'No hay ninguna ronda abierta.' });

    const { data: participantes } = await supabase.from('torneo_ronda_participantes')
      .select('equipo_id').eq('ronda_id', ronda.id);
    const equipoIds = (participantes || []).map(p => p.equipo_id);
    if (!equipoIds.length) return res.status(400).json({ error: 'Esta ronda no tiene participantes.' });

    const [{ data: jurados }, { data: criterios }, { data: calis }] = await Promise.all([
      supabase.from('torneo_jurados').select('user_id').eq('torneo_id', torneoId),
      supabase.from('torneo_criterios').select('id').eq('torneo_id', torneoId),
      supabase.from('torneo_calificaciones')
        .select('equipo_id, jurado_id, puntaje').eq('ronda_id', ronda.id),
    ]);
    const numJurados = (jurados || []).length;
    const numCriterios = (criterios || []).length;
    const esperadas = equipoIds.length * numJurados * numCriterios;

    if (numJurados === 0) return res.status(400).json({ error: 'Este torneo todavía no tiene jurado asignado.' });
    if ((calis || []).length < esperadas) {
      return res.status(400).json({ error: `Faltan calificaciones: ${(calis || []).length} de ${esperadas} esperadas.` });
    }

    const porEquipoJurado = new Map();
    for (const c of (calis || [])) {
      if (!porEquipoJurado.has(c.equipo_id)) porEquipoJurado.set(c.equipo_id, new Map());
      const m = porEquipoJurado.get(c.equipo_id);
      m.set(c.jurado_id, (m.get(c.jurado_id) || 0) + Number(c.puntaje));
    }
    const ranking = equipoIds.map(id => {
      const m = porEquipoJurado.get(id) || new Map();
      const totales = [...m.values()];
      const puntaje = totales.length ? totales.reduce((a, b) => a + b, 0) / totales.length : 0;
      return { equipo_id: id, puntaje };
    }).sort((a, b) => b.puntaje - a.puntaje);

    if (ronda.avanzan == null) {
      await supabase.from('torneo_rondas').update({ estado: 'cerrada' }).eq('id', ronda.id);
      await supabase.from('torneos').update({ estado: 'finalizado' }).eq('id', torneoId);
      return res.json({ ok: true, final: true, ranking });
    }

    const { data: siguiente } = await supabase.from('torneo_rondas')
      .select('id').eq('torneo_id', torneoId).eq('orden', ronda.orden + 1).maybeSingle();
    if (!siguiente) return res.status(500).json({ error: 'No se encontró la siguiente ronda.' });

    const clasificados = ranking.slice(0, ronda.avanzan).map(r => r.equipo_id);
    const { error: eIns } = await supabase.from('torneo_ronda_participantes')
      .insert(clasificados.map(equipo_id => ({ ronda_id: siguiente.id, equipo_id })));
    if (eIns) return res.status(500).json({ error: eIns.message });

    await supabase.from('torneo_rondas').update({ estado: 'cerrada' }).eq('id', ronda.id);
    await supabase.from('torneo_rondas').update({ estado: 'abierta' }).eq('id', siguiente.id);

    res.json({ ok: true, final: false, clasificados: clasificados.length, ranking });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ────────────── Tabla de posiciones ──────────────
   Igual de "pública para el panel" que /posiciones en torneos.js: sesión,
   sin exigir membresía del evento (misma nota, copiada a propósito). */

router.get('/:eventoId/torneo/:torneoId/tabla-jurado', sesion('Las llaves y la tabla son públicas en la página del evento; aquí sólo se leen con sesión para el panel.'), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const torneo = await cargarTorneoJurado(eventoId, torneoId);
  if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });

  let ronda = null;
  if (req.query.ronda_id) {
    ({ data: ronda } = await supabase.from('torneo_rondas').select('*').eq('id', req.query.ronda_id).eq('torneo_id', torneoId).maybeSingle());
  } else {
    const { data: abierta } = await supabase.from('torneo_rondas')
      .select('*').eq('torneo_id', torneoId).eq('estado', 'abierta').order('orden', { ascending: true }).limit(1).maybeSingle();
    ronda = abierta;
    if (!ronda) {
      const { data: ultima } = await supabase.from('torneo_rondas')
        .select('*').eq('torneo_id', torneoId).order('orden', { ascending: false }).limit(1).maybeSingle();
      ronda = ultima;
    }
  }
  if (!ronda) return res.json({ ronda: null, tabla: [] });

  const [{ data: participantes }, { data: criterios }, { data: calis }, { data: jurados }] = await Promise.all([
    supabase.from('torneo_ronda_participantes')
      .select('equipo:torneo_equipos!equipo_id(id, nombre, foto_url)').eq('ronda_id', ronda.id),
    supabase.from('torneo_criterios').select('id, nombre, puntaje_maximo').eq('torneo_id', torneoId).order('orden', { ascending: true }),
    supabase.from('torneo_calificaciones').select('equipo_id, jurado_id, criterio_id, puntaje').eq('ronda_id', ronda.id),
    supabase.from('torneo_jurados').select('user_id').eq('torneo_id', torneoId),
  ]);
  const numJurados = (jurados || []).length;

  const tabla = (participantes || []).map(p => p.equipo).filter(Boolean).map(eq => {
    const propias = (calis || []).filter(c => c.equipo_id === eq.id);
    const porJurado = new Map();
    for (const c of propias) porJurado.set(c.jurado_id, (porJurado.get(c.jurado_id) || 0) + Number(c.puntaje));
    const totales = [...porJurado.values()];
    const puntaje = totales.length ? totales.reduce((a, b) => a + b, 0) / totales.length : 0;

    const por_criterio = (criterios || []).map(cr => {
      const notas = propias.filter(c => c.criterio_id === cr.id).map(c => Number(c.puntaje));
      return {
        criterio_id: cr.id, nombre: cr.nombre,
        promedio: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null,
      };
    });

    return { equipo: eq, puntaje, jurados_calificaron: porJurado.size, jurados_total: numJurados, por_criterio };
  }).sort((a, b) => b.puntaje - a.puntaje);

  res.json({ ronda, tabla });
});

module.exports = router;
module.exports.PERMS_TORNEO_CONFIG = PERMS_TORNEO_CONFIG;
module.exports.validarCriterios = validarCriterios;
module.exports.validarRondas = validarRondas;
module.exports.crearBaseCalificacion = crearBaseCalificacion;
module.exports.poblarPrimeraRonda = poblarPrimeraRonda;
