/* El aforo cuenta personas, no boletas.
 *
 * ── El fallo ─────────────────────────────────────────────────────────────
 *
 * Desde la 0117 una unidad vendible puede admitir más de una persona: una mesa
 * de ringside son cuatro, un palco son ocho. Se vende UNA boleta y entran ocho.
 *
 * El aforo se sumaba de uno en uno en CINCO sitios distintos, así que doce
 * mesas vendidas dejaban `aforo_vendido: 12` con 48 personas entrando. En un
 * recinto con aforo legal eso no es un número mal puesto: es el organizador
 * creyendo que le quedan 36 sitios que no existen.
 *
 * Quedó anotado como pendiente en la propia migración —«hay que resolverlo
 * antes de vender palcos en un recinto con aforo legal»— y esto es eso.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r/g, '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* Los cinco sitios donde se movía el aforo. Ninguno pasa por los otros. */
const DONDE = [
  ['routes/eventos.publicos.js', 'la reserva gratuita'],
  ['lib/confirmarTicket.js', 'el webhook de Wompi y MP'],
  ['routes/pagos.js', 'el webhook de MP y el reembolso'],
  ['routes/clientes.js', 'el panel: anular y reembolsar'],
];

test('ya no queda ninguna suma de uno en uno', () => {
  /* Es la comprobación que resume todo: si vuelve a aparecer un `+ 1` sobre
     `aforo_vendido`, vuelve el fallo. */
  for (const [f, quien] of DONDE) {
    const s = sinComentarios(leer(f));
    assert.doesNotMatch(s, /aforo_vendido[^;]{0,80}\+ 1\b/, `${f} (${quien}) suma de uno en uno`);
    assert.doesNotMatch(s, /aforo_vendido - 1\b/, `${f} (${quien}) resta de uno en uno`);
  }
});

test('y los cuatro caminos preguntan cuánta gente entra', () => {
  for (const [f, quien] of DONDE) {
    assert.match(sinComentarios(leer(f)), /personasDe(Ticket|Espacio)\(/,
      `${f} (${quien}) no cuenta personas`);
  }
});

test('«vendidos» y «aforo_vendido» siguen siendo números distintos', () => {
  /* El cupo de un tipo de boleta se agota por UNIDADES —«quedan 3 mesas»— y el
     aforo del recinto se llena por PERSONAS. Confundirlos rompe una de las dos
     cuentas. */
  const c = leer('routes/clientes.js');
  const fn = c.slice(c.indexOf('async function ajustarAforo'), c.indexOf('\n}\n', c.indexOf('async function ajustarAforo')));
  /* `vendidos` se mueve por delta a secas: una mesa vendida es una unidad. */
  assert.match(fn, /vendidos: Math\.max\(0, \(tt\.vendidos \|\| 0\) \+ delta\)/);
  /* El aforo, multiplicado por las personas. */
  assert.match(fn, /aforo_vendido: Math\.max\(0, \(ev\.aforo_vendido \|\| 0\) \+ delta \* Math\.max\(1, personas\)\)/);
});

test('se pregunta la capacidad ANTES de soltar la silla', () => {
  /* Después ya no hay nada que consultar: la reserva pasó a «liberado» y el
     enlace con el espacio se pierde. Restar 1 de un palco de ocho dejaría el
     aforo siete plazas por encima para siempre, y la diferencia sólo se vería
     el día del evento contando cabezas. */
  const c = sinComentarios(leer('routes/clientes.js'));
  const i = c.indexOf('personasDeTicket(ticketId)');
  const j = c.indexOf('liberarPorTicket(ticketId)');
  assert.ok(i > 0 && j > 0 && i < j, 'se libera la silla antes de contar sus personas');
});

test('no poder contar no puede tumbar una venta', () => {
  /* Esto se llama en mitad de una compra. Un aforo que se queda corto se
     corrige; una venta perdida, no. */
  const m = leer('lib/cuantasPersonas.js');
  assert.doesNotMatch(m, /throw/);
  assert.match(m, /return 1;/);
  assert.match(m, /console\.error/);
});

test('una boleta sin sitio sigue contando una persona', () => {
  /* Que es la inmensa mayoría de las boletas de la plataforma. */
  const m = leer('lib/cuantasPersonas.js');
  assert.match(m, /if \(!ticketId\) return 1;/);
  assert.match(m, /Number\.isInteger\(n\) && n > 0 \? n : 1/);
});

test('la migración ya no lo lista como pendiente', () => {
  /* La 0117 decía: «hay que resolverlo antes de vender palcos en un recinto con
     aforo legal». Si el aviso se queda después de resolverlo, el siguiente que
     lo lea buscará un fallo que ya no existe. */
  const sql = leer('db/migrations/0117_la_silla_que_se_compra.sql');
  assert.doesNotMatch(sql, /un palco de 8 cuenta 1 en el aforo/);
});
