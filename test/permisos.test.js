'use strict';

/* La pieza que sustituye a RLS, y la prueba que impide que se quede a medias.
 *
 * Hoy los datos los guardan dos guardias: las 76 políticas de Supabase y las
 * comprobaciones que cada ruta hace a mano. Al pasar a MySQL desaparece el
 * primero. Con 279 rutas registradas, revisar «con cuidado» no es un plan.
 *
 * Estas pruebas son el plan: `puede()` decide y se puede comprobar sin montar
 * nada, y el censo obliga a que cada ruta diga qué exige — o que es pública y
 * por qué. Una ruta nueva sin declarar pone el suite en rojo el mismo día en
 * que se escribe. */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://ficticio.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'falsa';
process.env.JWT_SECRET = 'secreto-de-prueba-que-no-es-el-de-produccion';

const test = require('node:test');
const assert = require('node:assert');

const { puede, exige, publica, marcaDe } = require('../core/permisos');
const { comparar, leerInventario } = require('../core/permisos/censo.js');

const ANA  = { id: 'ana' };
const BETO = { id: 'beto' };

const evento = (extra = {}) => ({ ownerId: 'ana', permisos: new Set(), ...extra });

/* ── puede(): la decisión, sin base ni servidor ────────────────────────── */

test('el dueño del evento puede todo sobre él', () => {
  assert.equal(puede(ANA, 'evento:editar', evento()), true);
  assert.equal(puede(ANA, 'boletas:emitir', evento()), true);
});

test('quien no es dueño ni miembro no puede nada', () => {
  assert.equal(puede(BETO, 'evento:editar', evento()), false);
});

test('un miembro puede lo que su rol le concede, y sólo eso', () => {
  const conPermisos = evento({ permisos: new Set(['asistentes:ver', 'accesos:escanear']) });

  assert.equal(puede(BETO, 'asistentes:ver', conPermisos), true);
  assert.equal(puede(BETO, 'evento:borrar', conPermisos), false);
});

test('basta con UNA de las acciones pedidas', () => {
  /* Las rutas piden listas: «para esto vale editar el evento o gestionar
     boletas». Exigir todas convertiría cada rol en el rol del dueño. */
  const conPermisos = evento({ permisos: new Set(['boletas:gestionar']) });
  assert.equal(puede(BETO, ['evento:editar', 'boletas:gestionar'], conPermisos), true);
});

test('el comodín vale para todo, y es lo que tiene el dueño', () => {
  assert.equal(puede(BETO, 'lo:que:sea', evento({ permisos: new Set(['*']) })), true);
});

test('sin usuario no se puede nada, aunque el recurso sea de nadie', () => {
  /* Lo público no llega hasta aquí: lleva su propia marca. Si algo público
     acabara pasando por `puede()`, tiene que salir «no». */
  assert.equal(puede(null, 'evento:ver', evento()), false);
  assert.equal(puede({}, 'evento:ver', evento()), false);
  assert.equal(puede(ANA, 'evento:ver', null), false);
});

test('una lista de acciones vacía no concede nada', () => {
  /* `exige()` sin argumentos sería una puerta abierta con aspecto de puerta
     cerrada, que es peor que no tener puerta. */
  assert.equal(puede(BETO, [], evento({ permisos: new Set(['todo']) })), false);
});

test('los permisos valen como Set o como lista', () => {
  assert.equal(puede(BETO, 'x', evento({ permisos: ['x'] })), true);
  assert.equal(puede(BETO, 'x', evento({ permisos: new Set(['x']) })), true);
});

test('el id se compara como texto', () => {
  /* Los UUID llegan como cadena de un sitio y a veces como otra cosa de otro.
     Un `===` entre tipos distintos convierte al dueño en un extraño. */
  assert.equal(puede({ id: 7 }, 'x', { ownerId: '7', permisos: new Set() }), true);
});

/* ── exige(): el guardia de una ruta ───────────────────────────────────── */

function pedir(user) { return { user, params: { id: 'evt-1' } }; }
function responder() {
  const r = { codigo: null, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
async function pasar(middleware, req) {
  const res = responder();
  let siguio = false;
  await middleware(req, res, (e) => { if (e) throw e; siguio = true; });
  return { res, siguio };
}

const cargadorFalso = (recurso) => async () => recurso;

test('sin sesión, el guardia contesta 401', async () => {
  const guardia = exige('evento:editar', { cargador: cargadorFalso(evento()) });
  const { res, siguio } = await pasar(guardia, pedir(null));

  assert.equal(siguio, false);
  assert.equal(res.codigo, 401);
});

test('con sesión pero sin permiso, 403', async () => {
  const guardia = exige('evento:editar', { cargador: cargadorFalso(evento()) });
  const { res, siguio } = await pasar(guardia, pedir(BETO));

  assert.equal(siguio, false);
  assert.equal(res.codigo, 403);
});

test('el dueño pasa, y el evento queda a mano para el handler', async () => {
  const guardia = exige('evento:editar', {
    cargador: cargadorFalso({ ...evento(), evento: { id: 'evt-1', owner_id: 'ana' } }),
  });
  const req = pedir(ANA);
  const { siguio } = await pasar(guardia, req);

  assert.equal(siguio, true);
  assert.equal(req.evento.id, 'evt-1');
});

test('un evento que no existe da 404, no 403', async () => {
  /* Distinguirlos importa: 403 sobre algo inexistente le dice a quien prueba
     que ese id existe pero no es suyo. */
  const guardia = exige('evento:editar', { cargador: cargadorFalso(null) });
  const { res } = await pasar(guardia, pedir(ANA));

  assert.equal(res.codigo, 404);
});

test('una ruta que exige permiso de evento pero no dice de cuál, falla ruidosamente', async () => {
  /* El fallo silencioso sería no evaluar el permiso y dejar pasar. Mejor un
     500 en la primera petición, que se ve, que una puerta abierta que no. */
  const guardia = exige('evento:editar', { cargador: cargadorFalso(evento()) });
  const { res, siguio } = await pasar(guardia, { user: ANA, params: {} });

  assert.equal(siguio, false);
  assert.equal(res.codigo, 500);
});

test('el guardia acepta los tres nombres de parámetro que usan las rutas de hoy', async () => {
  const vistos = [];
  const guardia = exige('x', { cargador: async (id) => { vistos.push(id); return evento({ permisos: new Set(['x']) }); } });

  for (const params of [{ id: 'a' }, { eventoId: 'b' }, { evento_id: 'c' }]) {
    await pasar(guardia, { user: BETO, params });
  }
  assert.deepEqual(vistos, ['a', 'b', 'c']);
});

/* ── Las marcas ────────────────────────────────────────────────────────── */

test('exige() y publica() dejan marca legible para el censo', () => {
  assert.deepEqual(marcaDe(exige(['a', 'b'])), { tipo: 'exige', acciones: ['a', 'b'] });
  assert.equal(marcaDe(publica('porque sí')).tipo, 'publica');
  assert.equal(marcaDe(() => {}), null);
});

test('publica() sin motivo no se puede escribir', () => {
  /* El motivo es lo que se lee dentro de un año, cuando nadie recuerde por qué
     la página de compra no pide sesión. */
  assert.throws(() => publica());
  assert.throws(() => publica(''));
});

/* ── El censo: la prueba que impide que esto se quede a medias ─────────── */

test('ninguna ruta nueva se queda sin declarar', () => {
  const app = require('../index.js');
  const inventario = leerInventario();
  assert.ok(inventario, 'falta core/permisos/inventario.json: correr scripts/censar-rutas.js --guardar');

  const r = comparar(app, inventario);

  assert.deepEqual(
    r.nuevasSinDeclarar.map(x => x.id), [],
    'Hay rutas nuevas que no declaran qué permiso exigen. Ponéles exige(...) o ' +
    'publica("motivo"), y después corré: node scripts/censar-rutas.js --guardar'
  );
});

test('el número de rutas sin declarar no crece', () => {
  /* El trinquete. No obliga a declarar las 249 que vienen de antes, pero
     impide que sean 250. Y como el tope sólo baja al guardar, cada semana se
     puede mirar si el número se movió. */
  const app = require('../index.js');
  const inventario = leerInventario();
  const r = comparar(app, inventario);

  assert.ok(
    r.pendientes.length <= r.tope,
    `Hay ${r.pendientes.length} rutas sin declarar y el tope anotado es ${r.tope}. ` +
    'Declaralas antes de subir esto.'
  );
});

test('el censo ve de verdad las rutas públicas ya declaradas', () => {
  /* Si el censo dejara de reconocer las marcas —por un cambio en Express, o
     por una marca puesta donde no toca— las dos pruebas de arriba pasarían
     siempre y no comprobarían nada. Esto las protege. */
  const app = require('../index.js');
  const r = comparar(app, leerInventario());
  const publicas = r.actuales.filter(x => x.estado === 'publica');

  assert.ok(publicas.length >= 20, `el censo sólo reconoce ${publicas.length} rutas públicas`);
  assert.ok(publicas.every(x => x.motivo), 'hay rutas públicas sin motivo escrito');
  assert.ok(
    r.actuales.some(x => x.ruta.startsWith('/categorias')),
    'el censo ya no encuentra /categorias: revisá cómo lee los prefijos de montaje'
  );
});
