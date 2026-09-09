/* «¿Esta boleta es real?» — lo único que GESTEK garantiza en una reventa.
 *
 * La decisión de producto: la reventa se hace en la página, pero el dinero es
 * ajeno a la plataforma. GESTEK no cobra, no retiene, no arbitra. Se queda con
 * lo único que de verdad falla: que la entrada sea falsa, esté anulada, ya se
 * haya usado, o se la hayan vendido a tres personas a la vez.
 *
 * Y de ahí sale la prueba que más importa de este archivo: esta superficie NO
 * puede entregar la boleta. El código ES la credencial —`/ticket/:codigo`
 * devuelve el `qr_token`— así que mandar ahí a quien va a comprar sería
 * regalársela. Lo que se mide abajo es sobre todo lo que NO sale.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const v = require('../lib/verificarBoleta.js');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');

const boleta = (extra = {}) => ({
  id: 'no-debe-salir', codigo: 'ABC12345', estado: 'pagado',
  guest_nombre: 'Juan Medina', guest_email: 'juan@correo.com',
  qr_token: 'firmado.no-debe-salir', respuestas: { documento: '1000123456' },
  ...extra,
});
const evento = { titulo: 'Juice WRLD', fecha_inicio: '2026-11-20T21:00:00Z', location_nombre: 'Movistar Arena', estado: 'publicado' };

/* ── Lo que no sale ────────────────────────────────────────────────────── */

test('la respuesta no lleva nada que sirva para entrar ni para identificar', () => {
  const r = v.respuestaPublica({ ticket: boleta(), evento, tipo: { nombre: 'Platea' }, espacio: { nombre: 'Fila C-14' } });
  const plano = JSON.stringify(r);
  for (const filtrado of ['qr_token', 'firmado.no-debe-salir', 'guest_email', 'juan@correo.com',
                          'respuestas', '1000123456', 'no-debe-salir']) {
    assert.equal(plano.includes(filtrado), false, `se escapó «${filtrado}»`);
  }
});

test('el nombre va tapado, y sigue sirviendo para cotejar con una cédula', () => {
  assert.equal(v.taparNombre('Juan Medina'), 'J*** M***');
  assert.equal(v.taparNombre('  ana   maría  lópez '), 'A*** M*** L***');
  assert.equal(v.taparNombre(''), null);
  assert.equal(v.taparNombre(null), null);
});

/* ── Lo que sí sale, porque es lo que hace falta para confiar ──────────── */

test('sale el evento, el tipo y el sitio: es lo que se coteja con el vendedor', () => {
  const r = v.respuestaPublica({ ticket: boleta(), evento, tipo: { nombre: 'Platea' }, espacio: { nombre: 'Fila C-14' } });
  assert.equal(r.ok, true);
  assert.equal(r.codigo, 'ABC12345');
  assert.equal(r.evento.titulo, 'Juice WRLD');
  assert.equal(r.evento.lugar, 'Movistar Arena');
  assert.equal(r.boleta.tipo, 'Platea');
  assert.equal(r.boleta.sitio, 'Fila C-14');
  assert.equal(r.boleta.a_nombre_de, 'J*** M***');
});

test('un evento cancelado se avisa aunque la boleta esté impecable', () => {
  const r = v.respuestaPublica({ ticket: boleta(), evento: { ...evento, estado: 'cancelado' }, tipo: {} });
  assert.equal(r.evento.cancelado, true);
});

/* ── Los veredictos ───────────────────────────────────────────────────── */

test('cada estado da un veredicto, y sólo uno dice que sí', () => {
  const veredicto = (estado, esGratis) => v.veredictoDe({ ticket: { estado }, esGratis });
  assert.equal(veredicto('pagado').titulo, v.VEREDICTOS.valida.titulo);
  assert.equal(veredicto('usado').ok, false);
  assert.equal(veredicto('reembolsado').titulo, v.VEREDICTOS.anulada.titulo);
  assert.equal(veredicto('invalido').titulo, v.VEREDICTOS.anulada.titulo);
  assert.equal(v.veredictoDe({ ticket: null }).titulo, v.VEREDICTOS.no_existe.titulo);
});

test('«emitido» es sospechoso si se pagó, y normal si la boleta era gratis', () => {
  /* Una boleta de pago en `emitido` es «empezó a comprar y no terminó»: hoy no
     abre la puerta y quien va a pagar por ella tiene que saberlo. Una gratuita
     no tiene ese estado a medias, y asustar ahí sin motivo mata una reventa
     legítima. */
  assert.equal(v.veredictoDe({ ticket: { estado: 'emitido' }, esGratis: false }).ok, false);
  assert.equal(v.veredictoDe({ ticket: { estado: 'emitido' }, esGratis: true }).ok, true);
});

test('todo veredicto tiene título y detalle: quien mira está a punto de pagar', () => {
  for (const [nombre, ver] of Object.entries(v.VEREDICTOS)) {
    assert.equal(typeof ver.ok, 'boolean', nombre);
    assert.ok(ver.titulo && ver.detalle, `${nombre} sin frase`);
  }
});

/* ── La ruta ──────────────────────────────────────────────────────────── */

const RUTA = leer('routes/eventos.publicos.js');
const TROZO = RUTA.slice(RUTA.indexOf("router.get('/verificar/:codigo'"));
const CUERPO = TROZO.slice(0, TROZO.indexOf("\nrouter."));

test('la ruta está limitada: contesta si un código existe y probar es barato', () => {
  assert.match(CUERPO, /authLimiter/);
});

test('la ruta busca el sitio por una llave que sí pidió', () => {
  /* Se usó `ticket.id` sin pedirlo en el select: `undefined`, y el sitio no
     aparecía nunca. Es el modo de fallo de este proyecto —falta algo y no hay
     error— visto una vez más. */
  const usadas = [...CUERPO.matchAll(/ticket\.([a-z_]+)/g)].map(m => m[1]);
  const select = CUERPO.slice(CUERPO.indexOf('.select('), CUERPO.indexOf('.eq('));
  for (const col of new Set(usadas)) {
    if (['evento', 'tipo'].includes(col)) continue;
    assert.ok(select.includes(col), `usa ticket.${col} y no lo pide en el select`);
  }
});

test('la ruta no devuelve el ticket crudo: pasa por respuestaPublica', () => {
  assert.match(CUERPO, /respuestaPublica/);
  assert.equal(/res\.json\(\s*ticket/.test(CUERPO), false);
});

test('un error de base no se contesta como «no existe»', () => {
  /* Decirle «no encontramos esta boleta» a alguien que tiene una válida, por un
     fallo nuestro, le hace echarse atrás de una compra buena. */
  assert.match(CUERPO, /if \(error\) return res\.status\(500\)/);
});
