/* El portal del capitán, comprobado donde importa: en los filtros.
 *
 * ── Por qué esta prueba lee el archivo ───────────────────────────────────
 *
 * Es la convención del repo para las rutas que dependen de un scope: lo que
 * hay que garantizar no es que devuelvan 200, es que NO puedan escribir en la
 * ficha de otro. Eso vive en un `.eq()`, y un `.eq()` se borra sin que ninguna
 * prueba de camino feliz se entere.
 *
 * Correr: node --test test/portalCapitan.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = readFileSync(join(__dirname, '..', 'routes', 'equipoTorneo.js'), 'utf8');

test('el equipo sale del código de la boleta, nunca del cuerpo', () => {
  /* El backend usa service key: aquí no hay RLS que salve nada. La única
     barrera es que el id del equipo se DERIVE del código. */
  assert.match(SRC, /\.eq\('ticket_id', ticket\.id\)/,
    'el equipo ya no se busca por la boleta del código');
  assert.match(SRC, /\.eq\('id', equipo\.id\)/,
    'la escritura ya no está atada al equipo derivado del código');
  assert.ok(!/req\.body\.(equipo_id|id|torneo_id)/.test(SRC),
    'la ruta está leyendo un id del cuerpo: eso deja escribir en otra ficha');
});

test('el capitán no toca lo que decide el torneo', () => {
  /* Ni el grupo ni la posición en el cuadro: eso es del sorteo. Si alguien los
     añade a `cambios`, un equipo podría colocarse solo en el bracket. */
  for (const campo of ['grupo', 'posicion_bracket', 'torneo_id']) {
    assert.ok(!new RegExp(`cambios\.${campo}\s*=`).test(SRC),
      `el capitán puede escribir \`${campo}\`, que lo decide el torneo`);
  }
});

test('el nombre se congela cuando el torneo ya empezó', () => {
  /* Un equipo que se renombra a mitad de competición deja los partidos ya
     jugados hablando de alguien que no existe. */
  assert.match(SRC, /torneo\.estado !== 'armando'/,
    'el nombre ya se puede cambiar con el torneo en marcha');
});

test('las respuestas se validan con el mismo código que el resto', () => {
  /* Un formulario que se puede saltar por otra puerta no es un formulario: si
     el torneo declara «rango» obligatorio, aquí también lo es. */
  assert.match(SRC, /validarFormulario\(campos/, 'las respuestas del capitán ya no se validan');
  assert.match(SRC, /normalizarRespuestas\(campos/, 'las respuestas se guardan sin normalizar');
});

test('sólo entra una inscripción pagada', () => {
  assert.match(SRC, /\['pagado', 'usado'\]\.includes\(ticket\.estado\)/,
    'una inscripción sin pagar abre el portal');
});
