'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  AVISOS, ventana, pendientesDeCorreo, generarAvisosEnApp,
} = require('../modules/recordatorios/index.js');

/* Una base simulada que apunta el SQL que se emite. Igual que en
   test/contadores.test.js: lo que hay que comprobar de un modulo que todavia
   no tiene base debajo es la consulta, no el resultado. */
function baseFalsa({ filas = [], registro = [] } = {}) {
  const cx = {
    consultar: async (sql, params) => {
      registro.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return filas.length && registro.length === 1 ? filas : [];
    },
  };
  return () => ({
    consultar: cx.consultar,
    unaFila: async () => null,
    transaccion: async fn => fn(cx),
  });
}

/* ── Las ventanas ────────────────────────────────────────────────────────── */

test('los tres avisos son t7d, t1d y t1h', () => {
  assert.deepEqual(AVISOS.map(a => a.tipo), ['t7d', 't1d', 't1h']);
});

test('la ventana se centra en el momento que falta y usa su propio margen', () => {
  const ahora = new Date('2026-01-01T00:00:00Z');
  const [ini, fin] = ventana(AVISOS[1], ahora, 'correo'); // t1d, margen 30 min
  assert.equal(ini.toISOString(), '2026-01-01T23:30:00.000Z');
  assert.equal(fin.toISOString(), '2026-01-02T00:30:00.000Z');
});

test('el margen del correo y el de dentro de la app son distintos, a proposito', () => {
  const ahora = new Date('2026-01-01T00:00:00Z');
  const [ic] = ventana(AVISOS[0], ahora, 'correo');
  const [ia] = ventana(AVISOS[0], ahora, 'inapp');
  assert.notEqual(ic.getTime(), ia.getTime());
});

test('la ventana de t1h no se solapa con la de t1d', () => {
  const ahora = new Date('2026-01-01T00:00:00Z');
  const [, finH] = ventana(AVISOS[2], ahora, 'inapp');
  const [iniD]   = ventana(AVISOS[1], ahora, 'inapp');
  assert.ok(finH < iniD, 'dos avisos a la vez para el mismo evento seria duplicar');
});

/* ── El de correo ────────────────────────────────────────────────────────── */

test('solo mira boletas pagadas de eventos publicados y con recordatorios', async () => {
  const reg = [];
  await pendientesDeCorreo(baseFalsa({ registro: reg }), { ahora: new Date('2026-01-01T00:00:00Z') });
  const { sql } = reg[0];
  assert.match(sql, /t\.estado = 'pagado'/);
  assert.match(sql, /e\.estado = 'publicado'/);
  assert.match(sql, /e\.email_reminders = 1/);
  assert.match(sql, /e\.deleted_at IS NULL/);
});

test('no repite un aviso ya anotado en email_log', async () => {
  const reg = [];
  await pendientesDeCorreo(baseFalsa({ registro: reg }));
  assert.match(reg[0].sql, /NOT EXISTS \( SELECT 1 FROM email_log/);
});

test('el limite llega como parametro y va el ultimo', async () => {
  const reg = [];
  await pendientesDeCorreo(baseFalsa({ registro: reg }), { limite: 50 });
  assert.match(reg[0].sql, /LIMIT \?$/);
  assert.equal(reg[0].params.at(-1), 50);
});

test('las tres apariciones del CASE llevan sus seis fechas cada una', async () => {
  const reg = [];
  await pendientesDeCorreo(baseFalsa({ registro: reg }));
  /* 3 avisos x 2 fechas = 6, tres veces, mas el limite */
  assert.equal(reg[0].params.length, 6 * 3 + 1);
});

/* ── El de dentro de la aplicacion ───────────────────────────────────────── */

test('reune al dueno, al equipo activo y a los asistentes con cuenta', async () => {
  const reg = [];
  await generarAvisosEnApp(baseFalsa({ registro: reg }));
  const { sql } = reg[0];
  assert.match(sql, /e\.owner_id AS user_id/);
  assert.match(sql, /event_members m .* m\.status='active'/);
  assert.match(sql, /t\.estado IN \('pagado','usado'\)/);
});

test('usa UNION y DISTINCT: quien es las tres cosas recibe un aviso, no tres', async () => {
  const reg = [];
  await generarAvisosEnApp(baseFalsa({ registro: reg }));
  assert.match(reg[0].sql, /SELECT DISTINCT/);
  assert.ok(!/UNION ALL/.test(reg[0].sql));
});

test('sin candidatos no abre transaccion ni escribe', async () => {
  const reg = [];
  const n = await generarAvisosEnApp(baseFalsa({ registro: reg }));
  assert.equal(n, 0);
  assert.equal(reg.length, 1, 'solo la consulta de lectura');
});

/* El fallo que hacia que esto no funcionara NUNCA: el original insertaba una
   columna `link` que `notificaciones` no tiene. */
test('el INSERT de la notificacion NO escribe link', async () => {
  const reg = [];
  const filas = [{ evento_id: 'e1', titulo: 'Feria', slug: 'feria', tipo: 't1d', user_id: 'u1' }];
  await generarAvisosEnApp(baseFalsa({ filas, registro: reg }));
  const ins = reg.find(r => /INSERT INTO notificaciones/.test(r.sql));
  assert.ok(ins, 'tiene que insertar la notificacion');
  assert.ok(!/\blink\b/.test(ins.sql), 'esa columna no existe en la tabla');
  assert.match(ins.sql, /\(user_id, tipo, titulo, cuerpo, evento_id\)/);
});

test('cada aviso escribe tambien su fila de log, para no repetirse', async () => {
  const reg = [];
  const filas = [{ evento_id: 'e1', titulo: 'Feria', slug: 'feria', tipo: 't1d', user_id: 'u1' }];
  const n = await generarAvisosEnApp(baseFalsa({ filas, registro: reg }));
  assert.equal(n, 1);
  assert.ok(reg.some(r => /INSERT INTO recordatorio_inapp_log/.test(r.sql)));
});

test('la notificacion y su log van en la MISMA transaccion', async () => {
  const reg = [];
  let dentro = 0;
  const bd = () => ({
    consultar: async (sql, params) => {
      reg.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return reg.length === 1
        ? [{ evento_id: 'e1', titulo: 'F', slug: 'f', tipo: 't1h', user_id: 'u1' }]
        : [];
    },
    unaFila: async () => null,
    transaccion: async fn => {
      const antes = reg.length;
      await fn({ consultar: async (s, p) => { reg.push({ sql: s.replace(/\s+/g, ' ').trim(), params: p }); } });
      dentro = reg.length - antes;
    },
  });
  await generarAvisosEnApp(bd);
  assert.equal(dentro, 2, 'las dos escrituras caen dentro de la transaccion');
});

test('el texto del aviso usa la etiqueta del tipo', async () => {
  const reg = [];
  const filas = [{ evento_id: 'e1', titulo: 'Feria', slug: 'f', tipo: 't1h', user_id: 'u1' }];
  await generarAvisosEnApp(baseFalsa({ filas, registro: reg }));
  const ins = reg.find(r => /INSERT INTO notificaciones/.test(r.sql));
  assert.equal(ins.params[1], 'Recordatorio: Feria');
  assert.equal(ins.params[2], 'El evento empieza en 1 hora.');
});

test('un tipo que no conocemos no rompe el texto', async () => {
  const reg = [];
  const filas = [{ evento_id: 'e1', titulo: 'F', slug: 'f', tipo: 'raro', user_id: 'u1' }];
  await generarAvisosEnApp(baseFalsa({ filas, registro: reg }));
  const ins = reg.find(r => /INSERT INTO notificaciones/.test(r.sql));
  assert.equal(ins.params[2], 'El evento empieza pronto.');
});
