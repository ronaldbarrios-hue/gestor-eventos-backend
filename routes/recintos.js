'use strict';

/* Los recintos guardados: dibujar el edificio una vez.
 *
 * ── Por qué estas rutas viven aparte de `espacios` ───────────────────────
 *
 * `routes/espacios.js` cuelga de un evento y todo lo que hace comprueba el
 * permiso sobre ESE evento. Un recinto no es de un evento: es de la cuenta, y
 * se usa desde eventos que todavía no existen —de hecho, ése es el caso
 * principal: «monta el concierto del sábado en el arena de siempre».
 *
 * ── Y la copia, que es lo único delicado ─────────────────────────────────
 *
 * Aplicar un recinto INSERTA espacios en un evento. Sobre un evento que ya
 * tiene plano, eso sería soltar doscientos bloques encima de lo que hay —o
 * encima de sillas vendidas—, así que se niega. Vaciar primero es una decisión
 * de quien organiza, tomada mirando lo que va a perder, no un efecto colateral.
 */

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { auditar } = require('../lib/auditar.js');
const { assertPermiso } = require('../lib/acceso.js');
const { exige, sesion } = require('../core/permisos');
const { filaEspacio, COLUMNAS } = require('../lib/espacios.js');
const recintos = require('../lib/recintosGuardados.js');

/* EXACTAMENTE el mismo permiso que el plano de venta —`routes/espacios.js`—, y
   por la misma razón: guardar el recinto o montarlo desde uno guardado es
   dibujar el plano de un evento. Añadir aquí un permiso de más dejaría entrar
   por esta puerta a quien no puede entrar por la otra. */
const PERMS = ['gestionar_tickets'];
const puedo = (eventoId, userId) => assertPermiso(eventoId, userId, PERMS, 'id, owner_id');

/* Las rutas que NO cuelgan de un evento no piden un permiso de evento: piden
   una sesión, y el dueño se comprueba contra la fila. Se declara igualmente
   porque el censo distingue «pensado» de «se olvidaron», y una ruta sin marca
   es indistinguible de un descuido. */
const MIO = () => sesion('Un recinto es de la cuenta que lo dibujó, no de un evento: el dueño se comprueba contra la fila.');

const router = express.Router();
router.use(verifySupabaseJWT);

const fallo = (res, e) => res.status(e.status || 500).json({ error: e.message || 'Error inesperado.' });

/* El recinto es de quien lo dibujó. Se comprueba contra la base y no contra lo
   que dice quien llama: `owner_id` en el cuerpo sería una invitación. */
async function mio(id, userId) {
  const { data } = await supabase.from('recintos').select('*').eq('id', id).maybeSingle();
  if (!data || data.owner_id !== userId) {
    const e = new Error('Ese recinto no existe o no es tuyo.');
    e.status = 404;
    throw e;
  }
  return data;
}

/* ── GET /recintos — la lista ───────────────────────────────────────────
 *
 * Sin el plano dentro: veinte recintos de dos mil espacios cada uno son megas
 * por una pantalla que sólo necesita nombres.
 */
router.get('/recintos', MIO(), async (req, res) => {
  try {
    const { data, error } = await supabase.from('recintos')
      .select('id, nombre, ciudad, aforo_legal, plano, updated_at, created_at')
      .eq('owner_id', req.user.id).order('nombre', { ascending: true });
    /* El error se mira: un `|| []` sobre una consulta fallida diría «no tienes
       recintos» a quien tiene veinte, y volvería a dibujar uno desde cero. */
    if (error) return res.status(500).json({ error: error.message });
    res.json({ recintos: (data || []).map(recintos.resumen) });
  } catch (e) { fallo(res, e); }
});

/* ── GET /recintos/:id — uno entero, con su plano ──────────────────────── */
router.get('/recintos/:id', MIO(), async (req, res) => {
  try {
    const r = await mio(req.params.id, req.user.id);
    res.json({ recinto: r });
  } catch (e) { fallo(res, e); }
});

/* ── POST /recintos — guardar el plano de un evento como recinto ─────────
 *
 * Es el camino natural: se dibuja montando un concierto, y cuando queda bien se
 * guarda para la próxima. Pedir que se dibuje «un recinto» en abstracto, en una
 * pantalla aparte, es pedir que alguien haga el trabajo dos veces.
 */
router.post('/recintos', MIO(), async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'Ponle un nombre al recinto.' });

    const eventoId = req.body?.evento_id;
    if (!eventoId) return res.status(400).json({ error: 'Dime de qué evento se guarda el plano.' });
    /* El plano sale del evento, no del cuerpo de la petición: así lo que se
       guarda es lo que de verdad hay dibujado y no lo que diga el navegador. */
    await puedo(eventoId, req.user.id);

    const { data: espacios, error } = await supabase.from('espacios')
      .select(COLUMNAS).eq('evento_id', eventoId).order('orden', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const plano = recintos.aPlantilla(espacios || []);
    const malo = recintos.validarPlano(plano);
    if (malo) return res.status(400).json({ error: malo });

    const { data, error: eIns } = await supabase.from('recintos').insert({
      owner_id: req.user.id,
      nombre,
      ciudad: req.body?.ciudad || null,
      direccion: req.body?.direccion || null,
      aforo_legal: Number(req.body?.aforo_legal) || null,
      plano,
      fondo: req.body?.fondo || null,
    }).select('id, nombre').single();

    if (eIns) {
      /* Dos recintos con el mismo nombre no se distinguen en una lista, y el
         índice único lo impide. Se dice qué pasa en vez de devolver el error
         de Postgres. */
      if (String(eIns.message).includes('recintos_nombre_unico')) {
        return res.status(409).json({ error: `Ya tienes un recinto llamado «${nombre}».` });
      }
      return res.status(500).json({ error: eIns.message });
    }

    auditar(req, eventoId, 'recinto.guardar', {
      entidad: 'recinto', entidadId: data.id,
      detalle: { nombre, espacios: plano.length },
    });
    res.status(201).json({ recinto: data, espacios: plano.length });
  } catch (e) { fallo(res, e); }
});

/* ── DELETE /recintos/:id ───────────────────────────────────────────────
 *
 * Borrar un recinto NO toca los eventos montados con él: son copias, y ésa es
 * justo la razón de que sean copias.
 */
router.delete('/recintos/:id', MIO(), async (req, res) => {
  try {
    const r = await mio(req.params.id, req.user.id);
    const { error } = await supabase.from('recintos').delete().eq('id', r.id).eq('owner_id', req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) { fallo(res, e); }
});

/* ── POST /eventos/:eventoId/espacios/desde-recinto ─────────────────────
 *
 * Montar el plano de un evento a partir de un recinto guardado.
 */
router.post('/eventos/:eventoId/espacios/desde-recinto', exige(PERMS), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await puedo(eventoId, req.user.id);
    const r = await mio(req.body?.recinto_id, req.user.id);

    /* Sobre un evento que ya tiene plano, no. Vaciar primero es una decisión de
       quien organiza, mirando lo que va a perder. */
    const { count } = await supabase
      .from('espacios').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId);
    if (count) {
      return res.status(409).json({
        error: 'Este evento ya tiene plano. Bórralo antes de montar otro recinto.',
      });
    }

    const niveles = recintos.porNiveles(r.plano);
    if (!niveles.length) return res.status(400).json({ error: 'Ese recinto está vacío.' });

    /* Dos pasadas y no una: los padres primero, y los hijos con el `parent_id`
       que la base acaba de dar. En una sola no hay forma de conocer el id del
       padre antes de escribirlo. */
    const idPorIndice = new Map();
    let creados = 0;

    for (const nivel of niveles) {
      const filas = nivel.map(({ espacio }) => ({
        ...filaEspacio(espacio, eventoId),
        parent_id: espacio.padre != null ? idPorIndice.get(espacio.padre) || null : null,
      }));
      const { data, error } = await supabase.from('espacios').insert(filas).select('id');
      if (error) return res.status(500).json({ error: error.message });
      nivel.forEach(({ indice }, i) => idPorIndice.set(indice, data[i].id));
      creados += data.length;
    }

    auditar(req, eventoId, 'espacio.desde_recinto', {
      entidad: 'recinto', entidadId: r.id,
      detalle: { recinto: r.nombre, creados },
    });
    /* El fondo viaja con el recinto para poder seguir calcando en la copia: es
       del edificio, no del concierto. Quien llama decide si lo aplica. */
    res.status(201).json({ creados, fondo: r.fondo || null });
  } catch (e) { fallo(res, e); }
});

module.exports = router;
