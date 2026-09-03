/* Que lo que la tabla puede relacionar, la ruta lo deje escribir.
 *
 * ── El patrón que esto caza ───────────────────────────────────────────────
 *
 * `agenda_sessions` es la tabla de unión de casi todo el evento: tiene
 * `zona_id`, `torneo_id`, `speaker_id`, `expositor_id` y `ticket_type_id`. Pero
 * una columna que existe y que la ruta no acepta **se puede leer y no
 * escribir**, así que la relación queda muerta sin que nada falle.
 *
 * Ya pasó dos veces en este mismo archivo:
 *   · `formulario_modo` estaba en la tabla y en el render público desde la
 *     0059, y no en la lista `allowed`: había un selector en el panel que no
 *     guardaba nada. Su comentario sigue ahí.
 *   · `expositor_id` y `ticket_type_id` llevaban lo mismo hasta hoy — medido
 *     en producción, 0 de 11 sesiones tenían una u otra.
 *
 * No comprueba que las relaciones se usen (eso lo dicen los datos), sino que
 * **se puedan** usar: que ninguna columna de relación se quede fuera de la
 * lista blanca ni del alta.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FUENTE = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'agenda.js'), 'utf8',
);

/* Las relaciones de un sub-evento, y lo que significan. Si mañana la tabla gana
   otra, se añade aquí y la prueba dice dónde falta enchufarla. */
const RELACIONES = [
  ['zona_id', 'en qué zona del plano ocurre'],
  ['torneo_id', 'a qué llaves apunta'],
  ['speaker_id', 'quién habla'],
  ['expositor_id', 'qué expositor la da'],
  ['ticket_type_id', 'con qué boleta se entra'],
];

function listaBlanca() {
  /* Anclado al PATCH de sesiones: el archivo tiene otra lista `allowed` antes,
     la de speakers, y coger la primera hacía que la prueba mirase la tabla
     equivocada — fallaba diciendo que faltaba `zona_id` cuando sí estaba. */
  const desde = FUENTE.indexOf("router.patch('/:eventoId/sessions");
  assert.ok(desde > 0, 'ya no encuentro el PATCH de sesiones: revisa la prueba');
  const m = FUENTE.slice(desde).match(/const allowed = \[([\s\S]*?)\];/);
  assert.ok(m, 'ya no encuentro la lista `allowed` de sesiones: revisa la prueba');
  return new Set([...m[1].matchAll(/'([\w_]+)'/g)].map(x => x[1]));
}

test('toda relación se puede EDITAR', () => {
  const permitidos = listaBlanca();
  const fuera = RELACIONES.filter(([c]) => !permitidos.has(c));
  assert.deepEqual(
    fuera.map(([c, q]) => `${c} (${q})`), [],
    'estas columnas existen en la tabla y el PATCH no las acepta: se leen y no se escriben',
  );
});

test('toda relación se puede poner AL CREAR', () => {
  /* Si sólo se puede al editar, nadie la pone: hay que crear la actividad,
     guardar, volver a abrirla y editarla. Ahí es donde se pierde. */
  const cuerpo = FUENTE.slice(
    FUENTE.indexOf("router.post('/:eventoId/sessions'"),
    FUENTE.indexOf("router.patch('/:eventoId/sessions"),
  );
  assert.ok(cuerpo.length > 200, 'no reconozco el alta de sesiones: revisa la prueba');

  const fuera = RELACIONES.filter(([c]) => !new RegExp(`${c}\\s*:`).test(cuerpo));
  assert.deepEqual(
    fuera.map(([c, q]) => `${c} (${q})`), [],
    'estas relaciones no se pueden poner al crear la actividad',
  );
});

test('lo que apunta a otra tabla se comprueba que sea de este evento', () => {
  /* `assertOwner` dice que mandas en ESTE evento, no que ese expositor sea
     suyo. Es el mismo agujero que tenía el borrado de expositores antes de
     filtrar por `evento_id`: sin esto se puede colgar de tu agenda un
     expositor o un tipo de boleta de un evento ajeno pasando su id. */
  for (const tabla of ['networking_expositores', 'ticket_types']) {
    assert.ok(
      FUENTE.includes(`ajeno('${tabla}'`),
      `no se comprueba que el id de ${tabla} sea de este evento`,
    );
  }
  const ini = FUENTE.indexOf('async function ajeno');
  /* Desde la declaración hasta el `router.post` QUE VIENE DESPUÉS: el
     archivo tiene otros antes (speakers), y buscar el primero devolvía un
     trozo vacío. */
  const fn = FUENTE.slice(ini, FUENTE.indexOf('router.post', ini));
  assert.match(fn, /\.eq\('evento_id', eventoId\)/, 'la comprobación no filtra por evento');
});
