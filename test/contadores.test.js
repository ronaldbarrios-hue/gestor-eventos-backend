/* Tests de los tres contadores que hoy mantiene la base con disparadores.

   Lo que se protege no es que la consulta esté bien escrita —eso lo dirá
   MySQL— sino las decisiones que hacen que esto siga siendo correcto al
   sacarlo de un disparador:

     · que se BLOQUEE la fila que se cuenta (FOR UPDATE), que es lo único que
       impide que dos escaneos simultáneos se pasen de la cuota;
     · que la comprobación y la escritura ocurran en la MISMA transacción;
     · que los inscritos se RECUENTEN en vez de incrementarse.

   Se corre sin base: `bd()` está simulado y lo que se comprueba es qué SQL se
   emitió y en qué orden. Es a propósito — una prueba que necesitara MySQL no
   se correría nunca aquí, y esto se quedaría justo sin red donde más falta
   hace.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

/* ── Doble de la capa de base ─────────────────────────────────────────── */

function baseSimulada(respuestas = {}) {
  const sql = [];               // todo lo que se ejecutó, en orden
  let transacciones = 0;
  let rollbacks = 0;

  const responder = (q) => {
    for (const [patron, valor] of Object.entries(respuestas)) {
      if (q.includes(patron)) return typeof valor === 'function' ? valor() : valor;
    }
    return null;
  };
  const anotar = (q) => { sql.push(q.replace(/\s+/g, ' ').trim()); };
  const cx = {
    consultar: async (q) => { anotar(q); return responder(q) ?? { insertId: 1 }; },
    unaFila  : async (q) => { anotar(q); return responder(q); },
  };
  const api = {
    consultar: cx.consultar,
    unaFila  : cx.unaFila,
    async transaccion(fn) {
      transacciones++;
      try { return await fn(cx); }
      catch (e) { rollbacks++; throw e; }
    },
  };
  return { bd: () => api, sql, stats: () => ({ transacciones, rollbacks }) };
}

/* Carga el módulo con `core/db/mysql.js` sustituido por el doble. */
function cargarContadores(simulada) {
  const rutaMod = path.resolve(__dirname, '../modules/contadores/index.js');
  delete require.cache[rutaMod];
  const originalLoad = Module._load;
  Module._load = function (pedido) {
    if (String(pedido).includes('core/db/mysql')) return { bd: simulada.bd };
    return originalLoad.apply(this, arguments);
  };
  try { return require(rutaMod); }
  finally { Module._load = originalLoad; }
}

/* ── 1 · La cuota de puntos de un stand ───────────────────────────────── */

test('la cuota del stand se comprueba con la fila BLOQUEADA', async () => {
  /* Sin FOR UPDATE, dos escaneos leen los mismos puntos y los dos pasan. Es
     exactamente el fallo que este módulo existe para no tener. */
  const sim = baseSimulada({
    'FROM networking_expositores': { id: 'e1', cuota_puntos: 500 },
    'AS otorgados': { otorgados: 100 },
  });
  const m = cargarContadores(sim);
  await m.registrarInteraccionConCuota({ expositor_id: 'e1', puntos: 10 });

  const bloqueo = sim.sql.find(q => q.includes('networking_expositores'));
  assert.ok(bloqueo.includes('FOR UPDATE'), `falta el bloqueo: ${bloqueo}`);
});

test('pasarse de la cuota lanza y NO inserta', async () => {
  const sim = baseSimulada({
    'FROM networking_expositores': { id: 'e1', cuota_puntos: 500 },
    'AS otorgados': { otorgados: 495 },
  });
  const m = cargarContadores(sim);
  await assert.rejects(
    () => m.registrarInteraccionConCuota({ expositor_id: 'e1', puntos: 10 }),
    (e) => e.code === 'CUOTA_STAND_AGOTADA' && e.restantes === 5,
  );
  assert.ok(!sim.sql.some(q => q.startsWith('INSERT INTO ticket_interacciones')),
    'no puede haber insertado');
  assert.equal(sim.stats().rollbacks, 1, 'la transacción tiene que deshacerse');
});

test('justo en el límite sí entra', async () => {
  const sim = baseSimulada({
    'FROM networking_expositores': { id: 'e1', cuota_puntos: 500 },
    'AS otorgados': { otorgados: 490 },
  });
  const m = cargarContadores(sim);
  const r = await m.registrarInteraccionConCuota({ expositor_id: 'e1', puntos: 10 });
  assert.deepEqual(r.cuota, { otorgados: 500, tope: 500 });
});

test('sin expositor o sin puntos no se abre transacción', async () => {
  /* Es la salida temprana del disparador. Abrir una transacción por cada
     escaneo que no gasta cuota es trabajo por nada en la hora punta. */
  const sim = baseSimulada();
  const m = cargarContadores(sim);
  await m.registrarInteraccionConCuota({ expositor_id: null, puntos: 10 });
  await m.registrarInteraccionConCuota({ expositor_id: 'e1', puntos: 0 });
  assert.equal(sim.stats().transacciones, 0);
});

test('cuota nula significa sin tope', async () => {
  const sim = baseSimulada({ 'FROM networking_expositores': { id: 'e1', cuota_puntos: null } });
  const m = cargarContadores(sim);
  const r = await m.registrarInteraccionConCuota({ expositor_id: 'e1', puntos: 9999 });
  assert.equal(r.cuota, null);
});

/* ── 2 · Los inscritos de un sub-evento ───────────────────────────────── */

test('los inscritos se RECUENTAN, no se incrementan', async () => {
  /* Un contador que se incrementa se desincroniza para siempre a la primera
     fila borrada por fuera, y nadie se entera hasta que el número miente. */
  const sim = baseSimulada({
    'FROM agenda_sessions': { id: 's1', cupo: 10, inscritos: 3 },
    'AS n': { n: 4 },
  });
  const m = cargarContadores(sim);
  const r = await m.inscribirEnSesion({ session_id: 's1' });
  assert.equal(r.inscritos, 4);
  const update = sim.sql.find(q => q.startsWith('UPDATE agenda_sessions'));
  assert.ok(update.includes('inscritos = ?') && !update.includes('inscritos + 1'),
    `tiene que asignar el recuento, no sumar: ${update}`);
});

test('el cupo se comprueba con la sesión bloqueada, y lleno rechaza', async () => {
  const sim = baseSimulada({
    'FROM agenda_sessions': { id: 's1', cupo: 5, inscritos: 5 },
    'AS n': { n: 5 },
  });
  const m = cargarContadores(sim);
  await assert.rejects(() => m.inscribirEnSesion({ session_id: 's1' }), (e) => e.code === 'CUPO_LLENO');
  const lock = sim.sql.find(q => q.includes('FROM agenda_sessions'));
  assert.ok(lock.includes('FOR UPDATE'), 'sin bloqueo, dos personas entran al último sitio');
  assert.ok(!sim.sql.some(q => q.startsWith('INSERT INTO sesion_inscripciones')));
});

test('cambiar el estado recalcula dentro de la misma transacción', async () => {
  const sim = baseSimulada({
    'FROM sesion_inscripciones WHERE id': { id: 'i1', session_id: 's1' },
    'AS n': { n: 2 },
  });
  const m = cargarContadores(sim);
  const r = await m.cambiarEstadoInscripcion('i1', 'cancelada');
  assert.equal(r.inscritos, 2);
  assert.equal(sim.stats().transacciones, 1);
  assert.ok(sim.sql.some(q => q.startsWith('UPDATE agenda_sessions')));
});

/* ── 3 · Canjear una recompensa ───────────────────────────────────────── */

test('canjear bloquea la recompensa Y el saldo', async () => {
  /* El original sólo bloqueaba la recompensa: dos canjes de recompensas
     DISTINTAS por la misma persona podían descontar los dos del mismo saldo. */
  const sim = baseSimulada({
    'FROM recompensas': { id: 'r1', activo: 1, stock: null, canjeados: 0, costo_puntos: 100, organizador_id: 'o1', audiencia: 'cliente', titulo: 'Gorra' },
    'FROM puntos_balance': { id: 'b1', puntos: 300 },
  });
  const m = cargarContadores(sim);
  const r = await m.canjearRecompensa('u1', 'r1');
  assert.equal(r.saldo_restante, 200);
  assert.ok(sim.sql.find(q => q.includes('FROM recompensas')).includes('FOR UPDATE'));
  assert.ok(sim.sql.find(q => q.includes('FROM puntos_balance')).includes('FOR UPDATE'),
    'el saldo también tiene que ir bloqueado');
});

test('sin puntos suficientes no descuenta ni crea el canje', async () => {
  const sim = baseSimulada({
    'FROM recompensas': { id: 'r1', activo: 1, stock: null, canjeados: 0, costo_puntos: 100, organizador_id: 'o1', audiencia: 'cliente', titulo: 'Gorra' },
    'FROM puntos_balance': { id: 'b1', puntos: 50 },
  });
  const m = cargarContadores(sim);
  await assert.rejects(() => m.canjearRecompensa('u1', 'r1'), (e) => e.code === 'PUNTOS_INSUFICIENTES');
  assert.ok(!sim.sql.some(q => q.startsWith('INSERT INTO canjes')));
  assert.ok(!sim.sql.some(q => q.startsWith('UPDATE puntos_balance')));
});

test('una recompensa agotada se rechaza antes de mirar el saldo', async () => {
  const sim = baseSimulada({
    'FROM recompensas': { id: 'r1', activo: 1, stock: 5, canjeados: 5, costo_puntos: 10, organizador_id: 'o1', audiencia: 'cliente' },
  });
  const m = cargarContadores(sim);
  await assert.rejects(() => m.canjearRecompensa('u1', 'r1'), /agotada/i);
  assert.ok(!sim.sql.some(q => q.includes('FROM puntos_balance')));
});

test('el código de canje no lleva caracteres que se confunden al dictarlos', async () => {
  const { codigoCanje } = cargarContadores(baseSimulada());
  for (let i = 0; i < 200; i++) {
    const c = codigoCanje();
    assert.equal(c.length, 10, 'diez, como los ya emitidos');
    assert.ok(!/[IO01]/.test(c), `«${c}» tiene caracteres ambiguos`);
  }
});
