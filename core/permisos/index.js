'use strict';

/* core/permisos/ — lo que sustituye a RLS.
 *
 * ── Por qué esto tiene que existir ANTES de apagar RLS ────────────────────
 *
 * Hoy hay dos guardias sobre los mismos datos: las 76 políticas de Supabase, y
 * las comprobaciones que cada ruta hace a mano. Cuando la base sea MySQL, el
 * primero desaparece y sólo queda el segundo. Con 38 archivos de rutas, 279
 * rutas registradas y 312 usos de `req.user`, la probabilidad de que alguna se
 * quede sin comprobar no es teórica: es aritmética.
 *
 * Contra eso no sirve revisar con cuidado. Sirve que la aplicación no se pueda
 * arrancar con una ruta sin declarar, y eso es lo que hacen estas tres piezas:
 *
 *   `puede(usuario, accion, recurso)`  decide. Función pura: sin base, sin red.
 *   `exige('accion')`                  guardia de una ruta, y la MARCA.
 *   `publica('motivo')`                marca la que es pública a propósito.
 *
 * La marca es la mitad importante. `test/permisos.test.js` recorre las rutas
 * que Express tiene registradas de verdad y falla si aparece una que no lleva
 * ninguna de las dos. Una ruta nueva sin declarar rompe el suite el mismo día,
 * no el día del evento.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────
 *
 * No sustituye a `lib/acceso.js`, que es quien sabe leer el evento y su
 * equipo: lo envuelve. Cuando esa lectura pase a MySQL, se cambia el cargador
 * de abajo y nada más.
 */

/* Marcas. Se cuelgan de la función del middleware para que el censo las vea
   recorriendo la pila de Express, sin tener que leer el código fuente. */
const MARCA = Symbol.for('gestek.permisos');

/* ── La decisión, en una función pura ──────────────────────────────────────
 *
 * `usuario`: { id }
 * `accion` : 'evento:editar', 'boletas:emitir', … o una lista
 * `recurso`: { ownerId, permisos } — `permisos` es lo que el equipo concede
 *
 * Tres reglas, en orden:
 *   1. Sin usuario, no. (Lo público no llega hasta aquí: lleva `publica()`.)
 *   2. El dueño del recurso puede todo sobre él.
 *   3. Un miembro puede si su rol o sus permisos sueltos incluyen AL MENOS UNA
 *      de las acciones pedidas.
 *
 * Que sea pura es lo que la hace comprobable: las pruebas de esto no montan
 * base, ni servidor, ni sesión.
 */
function puede(usuario, accion, recurso) {
  if (!usuario?.id) return false;
  if (!recurso) return false;

  if (recurso.ownerId && String(recurso.ownerId) === String(usuario.id)) return true;

  const pedidas = Array.isArray(accion) ? accion : [accion];
  if (pedidas.length === 0) return false;

  const tiene = recurso.permisos instanceof Set
    ? recurso.permisos
    : new Set(recurso.permisos || []);

  /* `*` es el comodín del rol de administración del evento. Se comprueba
     aparte para que nadie tenga que enumerar 40 acciones en una fila. */
  if (tiene.has('*')) return true;

  return pedidas.some(p => tiene.has(p));
}

/* ── El guardia de una ruta ────────────────────────────────────────────────
 *
 * Uso:
 *   router.patch('/eventos/:id', auth, exige('evento:editar'), handler)
 *
 * De dónde sale el evento: de `req.params.id`, `:eventoId` o `:evento_id`, que
 * son los tres nombres que usan las rutas de hoy. Si hiciera falta otro, se
 * pasa `{ eventoDe: req => … }`.
 */
function exige(acciones, { eventoDe, cargador } = {}) {
  const pedidas = Array.isArray(acciones) ? acciones : [acciones];

  const guardia = async function guardiaDePermisos(req, res, next) {
    try {
      if (!req.user?.id) return res.status(401).json({ error: 'Token requerido.' });

      const eventoId = eventoDe
        ? eventoDe(req)
        : (req.params.eventoId || req.params.evento_id || req.params.id);

      if (!eventoId) {
        /* Una acción que no cuelga de un evento (por ejemplo el perfil propio)
           no debería usar `exige`: su comprobación es «es suyo», y eso lo hace
           la ruta. Mejor un error claro aquí que un permiso que no se evalúa. */
        return res.status(500).json({ error: 'La ruta exige un permiso de evento pero no dice de qué evento.' });
      }

      const recurso = await (cargador || cargarEvento)(eventoId, req.user.id);
      if (!recurso) return res.status(404).json({ error: 'Evento no encontrado.' });

      if (!puede(req.user, pedidas, recurso)) {
        return res.status(403).json({ error: 'No autorizado.' });
      }

      /* Se deja a mano para que el handler no vuelva a leerlo. */
      req.evento = recurso.evento || null;
      next();
    } catch (e) { next(e); }
  };

  guardia[MARCA] = { tipo: 'exige', acciones: pedidas };
  return guardia;
}

/* ── La declaración de «esto es tuyo» ──────────────────────────────────────
 *
 * Hay rutas que no son públicas y tampoco cuelgan de un permiso de evento: el
 * perfil propio, las integraciones de la cuenta, las conexiones del conector.
 * Ahí la comprobación no es «¿qué permisos tiene en este evento?» sino «¿esta
 * fila es suya?», y eso lo hace el handler filtrando por `req.user.id`.
 *
 * Sin esta tercera forma, esas rutas no se podrían declarar nunca y el censo
 * las contaría como olvidadas para siempre — que es la manera más rápida de
 * que un contador deje de significar algo y nadie lo mire.
 *
 * No hace nada en tiempo de ejecución: la sesión ya la exige el middleware del
 * router. Es una declaración, y por eso pide el motivo. */
function sesion(motivo) {
  if (!motivo) throw new Error('sesion() necesita un motivo: se lee dentro de un año.');
  const paso = function rutaDeSesion(_req, _res, next) { next(); };
  paso[MARCA] = { tipo: 'sesion', motivo };
  return paso;
}

/* ── La declaración de que algo es público ─────────────────────────────────
 *
 * No hace nada en tiempo de ejecución, y ése es el punto: existe para que el
 * censo pueda distinguir «pública a propósito» de «se olvidaron». El motivo es
 * obligatorio porque es lo que se lee dentro de un año, cuando nadie se acuerde
 * de por qué la página de compra no pide sesión.
 */
function publica(motivo) {
  if (!motivo) throw new Error('publica() necesita un motivo: se lee dentro de un año.');
  const paso = function rutaPublica(_req, _res, next) { next(); };
  paso[MARCA] = { tipo: 'publica', motivo };
  return paso;
}

/* ── El cargador, que es lo único que sabe dónde viven los datos ───────────
 *
 * Hoy lee de Supabase reutilizando `lib/acceso.js`. El día que los eventos y
 * el equipo estén en MySQL, se reescribe esta función y ni las rutas ni
 * `puede()` se enteran.
 */
/* De qué se compone lo que puede un miembro.
 *
 * Son DOS fuentes: los permisos de su rol y los sueltos que se le añadieron a
 * él en concreto (`custom_permissions`). Esta unión estaba escrita tres veces
 * —aquí, y dos veces en `routes/eventos.js`— con la misma forma. Tres copias de
 * una regla de acceso son tres sitios donde alguien puede olvidarse de sumar
 * `custom_permissions`, y el síntoma sería que a una persona le funcionan sus
 * permisos extra en unas pantallas y en otras no, sin ningún error.
 *
 * Es el mismo patrón que ya costó caro en este repo: el alta de expositores
 * duplicada, el marcador del mapa, el filtro de zonas. Lo duplicado no se
 * separa sólo en lo que hace, se separa en lo que protege. */
const SELECT_PERMISOS = 'custom_permissions, rol_detail:event_roles!rol_id(permissions)';

function permisosDeMiembro(m) {
  return new Set([
    ...(m?.rol_detail?.permissions || []),
    ...(m?.custom_permissions || []),
  ]);
}

async function cargarEvento(eventoId, usuarioId) {
  const supabase = require('../../lib/supabase.js');

  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) return null;

  if (String(ev.owner_id) === String(usuarioId)) {
    return { ownerId: ev.owner_id, permisos: new Set(['*']), evento: ev };
  }

  const { data: m } = await supabase
    .from('event_members')
    .select(SELECT_PERMISOS)
    .eq('evento_id', eventoId).eq('user_id', usuarioId).eq('status', 'active')
    .maybeSingle();

  return { ownerId: ev.owner_id, permisos: permisosDeMiembro(m), evento: ev };
}

/* Lee la marca de un middleware. La usa el censo. */
const marcaDe = (fn) => (typeof fn === 'function' ? fn[MARCA] || null : null);

module.exports = {
  puede, exige, publica, sesion, cargarEvento, marcaDe, MARCA,
  permisosDeMiembro, SELECT_PERMISOS,
};
