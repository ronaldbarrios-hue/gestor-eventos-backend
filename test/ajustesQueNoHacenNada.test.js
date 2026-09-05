/* Ajustes que se pueden guardar y no cambian nada.
 *
 * ── El caso que lo trajo ─────────────────────────────────────────────────
 *
 * `ticket_types.zonas_acceso` era un interruptor muerto de tres caras: se podía
 * escribir por la API, viajaba en la página pública del evento, y **no lo
 * comprobaba nadie**. Quien lo pusiera se quedaba creyendo que su boleta VIP
 * abre la zona VIP, y en la puerta no cambiaba nada.
 *
 * Quien manda de verdad es la PUERTA: `zonas.reglas.tipos` dice qué tipos
 * admite, y eso sí se mira al escanear. Tenerlo también del lado de la boleta
 * eran dos fuentes para la misma regla — que es como se acaban contradiciendo.
 *
 * ── Qué vigila esta prueba ───────────────────────────────────────────────
 *
 * Que no vuelva. Un campo que se acepta al guardar tiene que leerlo alguien
 * para decidir algo; si no, la API está diciendo que sí a un ajuste que
 * ignora, y eso es peor que decir que no.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

test('`zonas_acceso` no vuelve a ofrecerse mientras no lo comprueba nadie', () => {
  const tickets = leer('routes/tickets.js');
  const i = tickets.indexOf('const CAMPOS_EDITABLES');
  const lista = tickets.slice(i, tickets.indexOf('];', i));
  assert.ok(!/'zonas_acceso'/.test(lista),
    'volvió a la lista de campos editables: se puede guardar y sigue sin cambiar quién entra');

  const publico = leer('routes/eventos.publicos.js');
  assert.ok(!/zonas_acceso/.test(publico),
    'vuelve a viajar en la página pública: invita a construir encima de algo que no funciona');
});

test('la regla de acceso vive en la puerta, y se comprueba', () => {
  /* Si esto desaparece, `zonas_acceso` deja de ser redundante y pasa a ser lo
     único que hay — y entonces hay que hacerlo funcionar, no borrarlo. */
  const clientes = leer('routes/clientes.js');
  assert.match(clientes, /puerta\.tipos\.includes\(ticket\.ticket_type_id\)/,
    'la puerta dejó de comprobar qué tipos de boleta admite: ahora no queda ninguna regla de acceso viva');
});
