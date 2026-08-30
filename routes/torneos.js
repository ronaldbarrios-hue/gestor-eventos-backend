const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const { exige, sesion } = require('../core/permisos');

const router = express.Router();
router.use(verifySupabaseJWT);

const FORMATOS_VALIDOS = ['eliminacion', 'liga', 'grupos_eliminacion'];

/* Las mismas listas que ya comprobaban los helpers de abajo, ahora también
   declaradas en la ruta. `exige` las verifica antes del handler y el helper
   las vuelve a verificar dentro: es el patrón que ya usa emails.js, y la
   repetición es barata al lado de una ruta cuyo permiso no se ve. */
const PERMS_TORNEO_CONFIG = ['editar_evento'];
const PERMS_TORNEO        = ['gestionar_torneo', 'editar_evento'];

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['editar_evento'], 'id, owner_id');
}

function assertGestionaTorneo(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['gestionar_torneo', 'editar_evento'], 'id, owner_id');
}

/* ────────────── Torneos (VARIOS por evento) ──────────────
   Un evento puede tener varios torneos con distinta disciplina (Smash,
   Tekken, boxeo, fútbol…). El módulo ya no se limita a categoría Deportes:
   una convención de videojuegos también organiza torneos. */

/* GET /eventos/:eventoId/torneos — lista de torneos del evento (metadatos +
   cuántos equipos tiene cada uno, para el selector). */
router.get('/:eventoId/torneos', sesion('Las llaves y la tabla son públicas en la página del evento; aquí sólo se leen con sesión para el panel.'), async (req, res) => {
  const { eventoId } = req.params;
  const { data: torneos, error } = await supabase
    .from('torneos').select('*').eq('evento_id', eventoId)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const lista = torneos || [];
  if (lista.length) {
    const ids = lista.map(t => t.id);
    const { data: eqs } = await supabase.from('torneo_equipos').select('torneo_id').in('torneo_id', ids);
    const conteo = {};
    for (const e of (eqs || [])) conteo[e.torneo_id] = (conteo[e.torneo_id] || 0) + 1;
    for (const t of lista) t.equipos_count = conteo[t.id] || 0;
  }
  res.json({ torneos: lista });
});

/* Carga completa de un torneo (equipos + partidos). Reutilizado por el GET
   por-id y por el GET singular retrocompatible. */
async function cargarTorneo(torneo) {
  const { data: equipos } = await supabase
    .from('torneo_equipos').select('*').eq('torneo_id', torneo.id).order('created_at', { ascending: true });
  const { data: partidos } = await supabase
    .from('torneo_partidos').select('*').eq('torneo_id', torneo.id).order('ronda', { ascending: true }).order('orden', { ascending: true });
  return { torneo, equipos: equipos || [], partidos: partidos || [] };
}

/* GET /eventos/:eventoId/torneos/:torneoId — un torneo con equipos y partidos. */
router.get('/:eventoId/torneos/:torneoId', sesion('Las llaves y la tabla son públicas en la página del evento; aquí sólo se leen con sesión para el panel.'), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const { data: torneo } = await supabase
    .from('torneos').select('*').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
  if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
  res.json(await cargarTorneo(torneo));
});

/* ────────────── #48 · Categorías anidadas ──────────────
   Un árbol por evento: Torneos → deportes / juegos de mesa / gaming →
   contacto, pesca, caminata… → los torneos concretos. Profundidad libre.
   Ver la migración 0062 para por qué es por evento y no global. */

/* Cuánto puede bajar el árbol. No es una limitación técnica —`padre_id` no
   tiene tope— sino de sentido: pasados seis niveles nadie navega, se pierde.
   Y además corta en seco cualquier ciclo que se colara por otra vía. */
const PROFUNDIDAD_MAX = 6;

/* Un padre no puede ser descendiente de su propio hijo. Sin esto, mover
   "deportes" dentro de "deportes › contacto" crearía un anillo: las dos ramas
   desaparecerían del árbol (no cuelgan de ninguna raíz) y cualquier recorrido
   recursivo se quedaría dando vueltas. */
async function validarPadre(eventoId, categoriaId, padreId) {
  if (!padreId) return { ok: true, profundidad: 0 };
  if (categoriaId && String(padreId) === String(categoriaId)) {
    return { ok: false, error: 'Una categoría no puede colgar de sí misma.' };
  }

  const { data: todas } = await supabase
    .from('torneo_categorias').select('id, padre_id').eq('evento_id', eventoId);
  const porId = new Map((todas || []).map(c => [String(c.id), c]));

  /* Se sube desde el padre propuesto hasta la raíz. Si por el camino aparece
     la propia categoría, el movimiento cerraría el anillo. */
  let actual = porId.get(String(padreId));
  if (!actual) return { ok: false, error: 'La categoría padre no existe en este evento.' };
  let profundidad = 1;
  while (actual?.padre_id) {
    if (categoriaId && String(actual.padre_id) === String(categoriaId)) {
      return { ok: false, error: 'No puedes meter una categoría dentro de una de sus propias ramas.' };
    }
    actual = porId.get(String(actual.padre_id));
    profundidad++;
    if (profundidad > PROFUNDIDAD_MAX + 2) break;   // red de seguridad
  }
  if (profundidad >= PROFUNDIDAD_MAX) {
    return { ok: false, error: `El árbol no baja de ${PROFUNDIDAD_MAX} niveles.` };
  }
  return { ok: true, profundidad };
}

/* GET /eventos/:eventoId/torneo-categorias — el árbol plano.
   Se devuelve plano y no anidado a propósito: el panel y la página pública lo
   arman de formas distintas, y una lista con `padre_id` sirve para las dos. */
router.get('/:eventoId/torneo-categorias', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId } = req.params;
  const { data, error } = await supabase
    .from('torneo_categorias')
    .select('id, padre_id, nombre, orden')
    .eq('evento_id', eventoId)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ categorias: data || [] });
});

/* POST /eventos/:eventoId/torneo-categorias — crear una rama.
   Body: { nombre, padre_id? } */
router.post('/:eventoId/torneo-categorias', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId } = req.params;
  const nombre = String(req.body?.nombre || '').trim();
  const padre_id = req.body?.padre_id || null;
  if (!nombre) return res.status(400).json({ error: 'La categoría necesita un nombre.' });
  if (nombre.length > 80) return res.status(400).json({ error: 'El nombre es demasiado largo.' });

  try {
    await assertOwner(eventoId, req.user.id);

    const v = await validarPadre(eventoId, null, padre_id);
    if (!v.ok) return res.status(400).json({ error: v.error });

    /* Se coloca al final de SUS hermanas, no del árbol entero: el orden es
       relativo a cada nivel. */
    let q = supabase.from('torneo_categorias')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId);
    q = padre_id ? q.eq('padre_id', padre_id) : q.is('padre_id', null);
    const { count } = await q;

    const { data, error } = await supabase.from('torneo_categorias')
      .insert({ evento_id: eventoId, padre_id, nombre, orden: count || 0 })
      .select('id, padre_id, nombre, orden').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya hay una categoría con ese nombre en el mismo sitio.' });
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ categoria: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/torneo-categorias/:id — renombrar o mover. */
router.patch('/:eventoId/torneo-categorias/:id', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    const updates = {};
    if ('nombre' in req.body) {
      const n = String(req.body.nombre || '').trim();
      if (!n) return res.status(400).json({ error: 'La categoría necesita un nombre.' });
      updates.nombre = n.slice(0, 80);
    }
    if ('padre_id' in req.body) {
      const v = await validarPadre(eventoId, id, req.body.padre_id || null);
      if (!v.ok) return res.status(400).json({ error: v.error });
      updates.padre_id = req.body.padre_id || null;
    }
    if ('orden' in req.body) updates.orden = Math.max(0, Math.trunc(Number(req.body.orden) || 0));
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

    const { data, error } = await supabase.from('torneo_categorias')
      .update(updates).eq('id', id).eq('evento_id', eventoId)
      .select('id, padre_id, nombre, orden').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ya hay una categoría con ese nombre en el mismo sitio.' });
      return res.status(500).json({ error: error.message });
    }
    res.json({ categoria: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/torneo-categorias/:id
   Se lleva las ramas hijas (cascade en la migración), pero NINGÚN torneo: los
   que colgaban de aquí quedan sin clasificar y se siguen viendo sueltos. Se
   dice cuántos son para que el aviso del panel pueda ser concreto. */
router.delete('/:eventoId/torneo-categorias/:id', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    const { count: sueltos } = await supabase.from('torneos')
      .select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId).eq('categoria_id', id);

    const { error } = await supabase.from('torneo_categorias')
      .delete().eq('id', id).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, torneos_sin_clasificar: sueltos || 0 });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* GET /eventos/:eventoId/torneo — RETROCOMPAT: primer torneo del evento. */
router.get('/:eventoId/torneo', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId } = req.params;
  const { data: torneo } = await supabase
    .from('torneos').select('*').eq('evento_id', eventoId)
    .order('orden', { ascending: true }).order('created_at', { ascending: true })
    .limit(1).maybeSingle();
  if (!torneo) return res.json({ torneo: null, torneos: [] });
  res.json(await cargarTorneo(torneo));
});

/* POST /eventos/:eventoId/torneo — crear UN torneo (se pueden crear varios).
   Body: { nombre, formato, disciplina?, num_grupos?, avanzan_por_grupo? } */
router.post('/:eventoId/torneo', exige(PERMS_TORNEO_CONFIG), async (req, res) => {
  const { eventoId } = req.params;
  const { nombre, formato, disciplina, num_grupos, avanzan_por_grupo, categoria_id } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del torneo es requerido.' });
  if (!FORMATOS_VALIDOS.includes(formato)) return res.status(400).json({ error: 'Formato inválido.' });

  const insert = {
    nombre: nombre.trim(), formato, evento_id: eventoId,
    disciplina: disciplina?.trim() || null,
    /* Sin categoría el torneo existe igual y sale suelto (#48). */
    categoria_id: categoria_id || null,
  };
  if (formato === 'grupos_eliminacion') {
    const ng = Number(num_grupos);
    const apg = Number(avanzan_por_grupo);
    if (!Number.isInteger(ng) || ng < 2) return res.status(400).json({ error: 'Indica un número válido de grupos (mínimo 2).' });
    if (!Number.isInteger(apg) || apg < 1) return res.status(400).json({ error: 'Indica cuántos equipos avanzan por grupo (mínimo 1).' });
    insert.num_grupos = ng;
    insert.avanzan_por_grupo = apg;
    insert.fase_actual = 'unica'; // pasa a 'grupos' al generar el fixture
  }

  try {
    await assertOwner(eventoId, req.user.id);

    /* Orden = al final de los que ya existen. */
    const { count } = await supabase.from('torneos')
      .select('id', { count: 'exact', head: true }).eq('evento_id', eventoId);
    insert.orden = count || 0;

    const { data, error } = await supabase.from('torneos').insert(insert).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ torneo: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/torneo/:torneoId — retocar los metadatos.

   No existía: un torneo se creaba y se borraba, nada más. Con el árbol de
   categorías (#48) hace falta poder mover uno de rama sin perder equipos ni
   partidos, y ya de paso renombrarlo. El formato y los grupos NO se tocan
   aquí: cambiarlos con el fixture generado dejaría partidos que no
   corresponden a ningún formato. Para eso se borra y se rehace. */
router.patch('/:eventoId/torneo/:torneoId', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const updates = {};
    if ('nombre' in req.body) {
      const n = String(req.body.nombre || '').trim();
      if (!n) return res.status(400).json({ error: 'El nombre del torneo es requerido.' });
      updates.nombre = n;
    }
    if ('disciplina' in req.body) updates.disciplina = String(req.body.disciplina || '').trim() || null;
    if ('orden' in req.body) updates.orden = Math.max(0, Math.trunc(Number(req.body.orden) || 0));
    if ('categoria_id' in req.body) {
      const cat = req.body.categoria_id || null;
      if (cat) {
        /* La categoría tiene que ser de ESTE evento: sin comprobarlo se
           podría colgar un torneo del árbol de otro organizador pasando un
           id a mano. */
        const { data: c } = await supabase.from('torneo_categorias')
          .select('id').eq('id', cat).eq('evento_id', eventoId).maybeSingle();
        if (!c) return res.status(400).json({ error: 'Esa categoría no es de este evento.' });
      }
      updates.categoria_id = cat;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

    const { data, error } = await supabase.from('torneos')
      .update(updates).eq('id', torneoId).eq('evento_id', eventoId)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ torneo: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/torneo/:torneoId — borrar el torneo completo (reinicia todo) */
router.delete('/:eventoId/torneo/:torneoId', exige(PERMS_TORNEO), async (req, res) => {
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

router.get('/:eventoId/torneo/:torneoId/campos-disponibles', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);
    const { data: campos } = await supabase
      .from('event_form_fields')
      .select('id, tipo, etiqueta')
      .eq('evento_id', eventoId)
      .in('tipo', ['texto', 'foto'])
      .order('orden', { ascending: true });
    res.json({ campos: campos || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/torneo/:torneoId/importar-equipos
   Body: { campo_nombre_id, campo_foto_id? }
   Además de nombre/foto, guarda el contacto (email + user_id si tiene
   cuenta) de cada boleta como "capitán" del equipo — se usa después para
   avisarle automáticamente cuándo juega su equipo. */
router.post('/:eventoId/torneo/:torneoId/importar-equipos', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const { campo_nombre_id, campo_foto_id } = req.body;
  if (!campo_nombre_id) return res.status(400).json({ error: 'Selecciona qué campo usar como nombre del equipo.' });

  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const { data: torneo } = await supabase.from('torneos').select('id, estado').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'No se pueden importar equipos: el torneo ya inició.' });

    const { data: tickets, error: eT } = await supabase
      .from('tickets')
      .select('id, respuestas, guest_email, user_id')
      .eq('evento_id', eventoId)
      .not('respuestas', 'is', null);
    if (eT) return res.status(500).json({ error: eT.message });

    const { data: existentes } = await supabase.from('torneo_equipos').select('nombre').eq('torneo_id', torneoId);
    const nombresExistentes = new Set((existentes || []).map(e => e.nombre.toLowerCase().trim()));

    const nuevos = [];
    let omitidos = 0;

    for (const t of tickets || []) {
      const nombre = t.respuestas?.[campo_nombre_id];
      const foto = campo_foto_id ? t.respuestas?.[campo_foto_id] : null;
      if (!nombre || typeof nombre !== 'string' || !nombre.trim()) { omitidos++; continue; }
      const nombreLimpio = nombre.trim();
      if (nombresExistentes.has(nombreLimpio.toLowerCase())) { omitidos++; continue; }
      nombresExistentes.add(nombreLimpio.toLowerCase());
      nuevos.push({
        torneo_id: torneoId,
        nombre: nombreLimpio,
        foto_url: typeof foto === 'string' ? foto : null,
        contacto_email: t.guest_email || null,
        contacto_user_id: t.user_id || null,
      });
    }

    if (nuevos.length > 0) {
      const { error: eIns } = await supabase.from('torneo_equipos').insert(nuevos);
      if (eIns) return res.status(500).json({ error: eIns.message });
    }

    res.json({ importados: nuevos.length, omitidos, total_boletas_revisadas: (tickets || []).length });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/torneo/:torneoId/equipos — registrar un equipo manual */
router.post('/:eventoId/torneo/:torneoId/equipos', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  const { nombre, foto_url, contacto_email } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del equipo es requerido.' });

  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const { data: torneo } = await supabase.from('torneos').select('id, estado').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'armando') return res.status(400).json({ error: 'No se pueden agregar equipos: el torneo ya inició.' });

    const { data, error } = await supabase
      .from('torneo_equipos')
      .insert({
        torneo_id: torneoId,
        nombre: nombre.trim(),
        foto_url: foto_url || null,
        contacto_email: contacto_email?.trim() || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ equipo: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/torneo/:torneoId/equipos/:id */
router.delete('/:eventoId/torneo/:torneoId/equipos/:id', exige(PERMS_TORNEO), async (req, res) => {
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

/* ────────────── Generación de fixtures ────────────── */

function siguientePotenciaDe2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/* Baraja un array in-place (Fisher-Yates). */
function barajar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Genera un bracket de eliminación directa para una lista de equipoIds,
   insertando en torneo_partidos con la fase indicada. Reutilizable tanto
   para formato 'eliminacion' puro como para la fase final de
   'grupos_eliminacion'. Devuelve los partidos de la ronda 1 ya insertados. */
async function generarBracketEliminacion(torneoId, equipoIds, fase) {
  const size = siguientePotenciaDe2(equipoIds.length);
  const slots = [...equipoIds, ...Array(size - equipoIds.length).fill(null)];
  barajar(slots);

  const totalRondas = Math.log2(size);
  const partidosPorRonda = {};

  const ronda1 = [];
  for (let i = 0; i < slots.length; i += 2) {
    ronda1.push({
      torneo_id: torneoId, ronda: 1, orden: ronda1.length, fase,
      equipo_a_id: slots[i], equipo_b_id: slots[i + 1], estado: 'pendiente',
    });
  }
  const { data: ronda1Insertada, error: e1 } = await supabase.from('torneo_partidos').insert(ronda1).select();
  if (e1) throw new Error(e1.message);
  partidosPorRonda[1] = ronda1Insertada;

  for (let ronda = 2; ronda <= totalRondas; ronda++) {
    const anterior = partidosPorRonda[ronda - 1];
    const actual = [];
    for (let i = 0; i < anterior.length; i += 2) {
      actual.push({ torneo_id: torneoId, ronda, orden: actual.length, fase, estado: 'pendiente' });
    }
    const { data: insertada, error: eN } = await supabase.from('torneo_partidos').insert(actual).select();
    if (eN) throw new Error(eN.message);
    partidosPorRonda[ronda] = insertada;

    for (let i = 0; i < anterior.length; i++) {
      const destino = insertada[Math.floor(i / 2)];
      await supabase.from('torneo_partidos').update({ siguiente_partido_id: destino.id }).eq('id', anterior[i].id);
    }
  }

  for (const p of ronda1Insertada) {
    if (p.equipo_a_id && !p.equipo_b_id) await avanzarGanador(p.id, p.equipo_a_id);
    if (!p.equipo_a_id && p.equipo_b_id) await avanzarGanador(p.id, p.equipo_b_id);
  }
  return ronda1Insertada;
}

/* POST /eventos/:eventoId/torneo/:torneoId/generar — arma los partidos.
   - 'liga': todos contra todos (fase 'unica').
   - 'eliminacion': bracket completo directo (fase 'unica').
   - 'grupos_eliminacion': reparte equipos en N grupos y arma todos-contra-
     todos DENTRO de cada grupo (fase 'grupos'). La eliminación se genera
     después, con /cerrar-grupos, una vez jugados los partidos de grupo. */
router.post('/:eventoId/torneo/:torneoId/generar', exige(PERMS_TORNEO), async (req, res) => {
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
            torneo_id: torneoId, ronda: 1, orden: partidos.length, fase: 'unica',
            equipo_a_id: equipos[i].id, equipo_b_id: equipos[j].id, estado: 'pendiente',
          });
        }
      }
      const { error } = await supabase.from('torneo_partidos').insert(partidos);
      if (error) return res.status(500).json({ error: error.message });

    } else if (torneo.formato === 'eliminacion') {
      await generarBracketEliminacion(torneoId, equipos.map(e => e.id), 'unica');

    } else if (torneo.formato === 'grupos_eliminacion') {
      const ng = torneo.num_grupos;
      if (equipos.length < ng * 2) {
        return res.status(400).json({ error: `Necesitas al menos ${ng * 2} equipos para ${ng} grupos.` });
      }
      const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const idsBarajados = barajar(equipos.map(e => e.id));
      /* Reparte equipos en grupos lo más parejo posible (round-robin de asignación) */
      const grupos = Array.from({ length: ng }, () => []);
      idsBarajados.forEach((id, i) => grupos[i % ng].push(id));

      for (let g = 0; g < ng; g++) {
        const letra = letras[g];
        for (const equipoId of grupos[g]) {
          await supabase.from('torneo_equipos').update({ grupo: letra }).eq('id', equipoId);
        }
        const equiposGrupo = grupos[g];
        const partidos = [];
        for (let i = 0; i < equiposGrupo.length; i++) {
          for (let j = i + 1; j < equiposGrupo.length; j++) {
            partidos.push({
              torneo_id: torneoId, ronda: 1, orden: partidos.length, fase: 'grupos', grupo: letra,
              equipo_a_id: equiposGrupo[i], equipo_b_id: equiposGrupo[j], estado: 'pendiente',
            });
          }
        }
        if (partidos.length > 0) {
          const { error } = await supabase.from('torneo_partidos').insert(partidos);
          if (error) return res.status(500).json({ error: error.message });
        }
      }
      await supabase.from('torneos').update({ fase_actual: 'grupos' }).eq('id', torneoId);
    }

    await supabase.from('torneos').update({ estado: 'en_curso' }).eq('id', torneoId);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/torneo/:torneoId/cerrar-grupos — cierra la fase
   de grupos (solo formato grupos_eliminacion) y genera el bracket de
   eliminación con los clasificados de cada grupo. Requiere que todos los
   partidos de la fase de grupos ya estén jugados. */
router.post('/:eventoId/torneo/:torneoId/cerrar-grupos', exige(PERMS_TORNEO), async (req, res) => {
  const { eventoId, torneoId } = req.params;
  try {
    await assertGestionaTorneo(eventoId, req.user.id);

    const { data: torneo } = await supabase.from('torneos').select('*').eq('id', torneoId).eq('evento_id', eventoId).maybeSingle();
    if (!torneo) return res.status(404).json({ error: 'Torneo no encontrado.' });
    if (torneo.formato !== 'grupos_eliminacion') return res.status(400).json({ error: 'Este torneo no usa fase de grupos.' });
    if (torneo.fase_actual !== 'grupos') return res.status(400).json({ error: 'La fase de grupos ya se cerró.' });

    const { data: partidosGrupo } = await supabase
      .from('torneo_partidos').select('*').eq('torneo_id', torneoId).eq('fase', 'grupos');
    const pendientes = (partidosGrupo || []).filter(p => p.estado !== 'jugado');
    if (pendientes.length > 0) {
      return res.status(400).json({ error: `Faltan ${pendientes.length} partido(s) de la fase de grupos por jugar.` });
    }

    const { data: equipos } = await supabase.from('torneo_equipos').select('id, nombre, grupo').eq('torneo_id', torneoId);

    /* Calcular tabla por grupo (mismo criterio que /posiciones: 3 pts
       victoria, 1 empate, desempate por diferencia de gol). */
    const porGrupo = {};
    for (const eq of equipos || []) {
      porGrupo[eq.grupo] = porGrupo[eq.grupo] || [];
      porGrupo[eq.grupo].push({ ...eq, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, puntos: 0 });
    }
    for (const p of partidosGrupo || []) {
      const grupo = porGrupo[p.grupo];
      if (!grupo) continue;
      const a = grupo.find(e => e.id === p.equipo_a_id);
      const b = grupo.find(e => e.id === p.equipo_b_id);
      if (!a || !b) continue;
      a.pj++; b.pj++;
      a.gf += p.marcador_a; a.gc += p.marcador_b;
      b.gf += p.marcador_b; b.gc += p.marcador_a;
      if (p.marcador_a > p.marcador_b) { a.pg++; a.puntos += 3; b.pp++; }
      else if (p.marcador_a < p.marcador_b) { b.pg++; b.puntos += 3; a.pp++; }
      else { a.pe++; b.pe++; a.puntos += 1; b.puntos += 1; }
    }

    /* Clasificados: los N primeros de cada grupo, ordenados por posición
       (1°, 2°, ...) — se usa este orden para intentar evitar que en la
       primera ronda de eliminación se enfrenten equipos del mismo grupo. */
    const clasificadosPorPosicion = []; // [[1eros...], [2dos...], ...]
    for (let pos = 0; pos < torneo.avanzan_por_grupo; pos++) {
      const deEstaPos = [];
      for (const letra of Object.keys(porGrupo)) {
        const tabla = porGrupo[letra].sort((x, y) => y.puntos - x.puntos || (y.gf - y.gc) - (x.gf - x.gc));
        if (tabla[pos]) deEstaPos.push(tabla[pos].id);
      }
      barajar(deEstaPos);
      clasificadosPorPosicion.push(deEstaPos);
    }
    const clasificados = clasificadosPorPosicion.flat();
    if (clasificados.length < 2) {
      return res.status(400).json({ error: 'No hay suficientes equipos clasificados para armar la eliminación.' });
    }

    await generarBracketEliminacion(torneoId, clasificados, 'eliminacion');
    await supabase.from('torneos').update({ fase_actual: 'eliminacion' }).eq('id', torneoId);

    res.json({ ok: true, clasificados: clasificados.length });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Helper: marca un partido como jugado y, si tiene siguiente_partido_id,
   coloca al ganador en el slot libre del partido de la siguiente ronda. */
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

router.patch('/:eventoId/torneo/:torneoId/partidos/:id', exige(PERMS_TORNEO), async (req, res) => {
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
      if (marcador_a === marcador_b && partido.fase === 'eliminacion') {
        return res.status(400).json({ error: 'En eliminación directa no puede haber empate. Define un ganador.' });
      }
      updates.marcador_a = marcador_a;
      updates.marcador_b = marcador_b;
      updates.estado = 'jugado';
    }

    const { data: actualizado, error } = await supabase
      .from('torneo_partidos').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    if (updates.estado === 'jugado' && partido.siguiente_partido_id) {
      const ganadorId = marcador_a > marcador_b ? partido.equipo_a_id : partido.equipo_b_id;
      await avanzarGanador(id, ganadorId);
    }

    /* Notificar a los capitanes cuándo/dónde juega su equipo, si se fijó
       o cambió el horario de un partido pendiente. Best-effort (no rompe
       la respuesta si falla el envío). */
    if ((cancha !== undefined || fecha_hora !== undefined) && updates.fecha_hora) {
      notificarHorarioPartido(actualizado).catch(err => console.warn('[torneo] notificar horario falló:', err.message));
    }

    res.json({ partido: actualizado });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Avisa por push (si tiene cuenta vinculada) y por email al contacto de
   cada equipo de un partido, cuando se fija/cambia su horario. */
async function notificarHorarioPartido(partido) {
  const { notificar } = require('./../lib/notificar.js');
  const { sendMail } = require('./../lib/email.js');

  const { data: equipos } = await supabase
    .from('torneo_equipos')
    .select('id, nombre, contacto_email, contacto_user_id')
    .in('id', [partido.equipo_a_id, partido.equipo_b_id]);

  const { data: torneo } = await supabase.from('torneos').select('nombre, evento_id').eq('id', partido.torneo_id).maybeSingle();
  const { data: evento } = torneo ? await supabase.from('eventos').select('titulo').eq('id', torneo.evento_id).maybeSingle() : { data: null };

  const eqA = equipos?.find(e => e.id === partido.equipo_a_id);
  const eqB = equipos?.find(e => e.id === partido.equipo_b_id);
  const fechaTxt = new Date(partido.fecha_hora).toLocaleString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });

  for (const [equipo, rival] of [[eqA, eqB], [eqB, eqA]]) {
    if (!equipo) continue;
    const cuerpo = `Tu equipo "${equipo.nombre}" juega contra "${rival?.nombre || 'rival por definir'}" el ${fechaTxt}${partido.cancha ? ` en ${partido.cancha}` : ''}.`;

    if (equipo.contacto_user_id) {
      notificar({
        userId: equipo.contacto_user_id, tipo: 'torneo',
        titulo: `${torneo?.nombre || 'Torneo'}: hora de tu partido`,
        cuerpo, link: `/explorar`, eventoId: torneo?.evento_id,
      }).catch(() => {});
    }
    if (equipo.contacto_email) {
      sendMail({
        to: equipo.contacto_email,
        subject: `${evento?.titulo || 'Torneo'} — ${equipo.nombre} juega el ${fechaTxt}`,
        html: `<div style="font-family:system-ui,Arial,sans-serif;background:#0D1525;color:#F1F5F9;padding:24px;border-radius:12px">
          <h2 style="margin:0 0 12px;color:#A78BFA">${torneo?.nombre || 'Torneo'}</h2>
          <p style="font-size:15px;line-height:1.6;color:#CBD5E1">${cuerpo}</p>
        </div>`,
      }).catch(() => {});
    }
  }
}

/* GET /eventos/:eventoId/torneo/:torneoId/posiciones — tabla de posiciones.
   Para formato liga: una sola tabla. Para grupos_eliminacion en fase
   'grupos': una tabla POR GRUPO. */
router.get('/:eventoId/torneo/:torneoId/posiciones', sesion('Las llaves y la tabla son públicas en la página del evento; aquí sólo se leen con sesión para el panel.'), async (req, res) => {
  const { torneoId } = req.params;

  const { data: torneo } = await supabase.from('torneos').select('formato, fase_actual').eq('id', torneoId).maybeSingle();
  const { data: equipos } = await supabase.from('torneo_equipos').select('id, nombre, foto_url, grupo').eq('torneo_id', torneoId);
  const { data: partidos } = await supabase.from('torneo_partidos').select('*').eq('torneo_id', torneoId).eq('estado', 'jugado');

  function calcularTabla(listaEquipos, listaPartidos) {
    const tabla = new Map(listaEquipos.map(e => [e.id, { ...e, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, puntos: 0 }]));
    for (const p of listaPartidos) {
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
    return [...tabla.values()].sort((x, y) => y.puntos - x.puntos || (y.gf - y.gc) - (x.gf - x.gc));
  }

  if (torneo?.formato === 'grupos_eliminacion' && torneo.fase_actual === 'grupos') {
    const grupos = {};
    for (const eq of equipos || []) {
      grupos[eq.grupo] = grupos[eq.grupo] || [];
      grupos[eq.grupo].push(eq);
    }
    const partidosGrupos = (partidos || []).filter(p => p.fase === 'grupos');
    const resultado = Object.keys(grupos).sort().map(letra => ({
      grupo: letra,
      posiciones: calcularTabla(grupos[letra], partidosGrupos.filter(p => p.grupo === letra)),
    }));
    return res.json({ por_grupo: true, grupos: resultado });
  }

  res.json({ por_grupo: false, posiciones: calcularTabla(equipos || [], partidos || []) });
});

module.exports = router;
