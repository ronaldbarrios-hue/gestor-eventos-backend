/* La mudanza de las zonas de `page_json` a tabla, paso 2.
 *
 * Lo que se protege aquí no es que funcione —eso lo dice la base— sino las
 * tres decisiones que, si alguien las deshace sin darse cuenta, vacían el plano
 * de un evento en marcha y no dan ningún error.
 *
 * Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

const TABLA = leer('lib/zonasTabla.js');
const AFORO = leer('lib/aforoZonas.js');

test('todo el mundo lee las zonas por el mismo sitio', () => {
  /* `zonasDelEvento` es la única puerta: nueve llamadas en cinco archivos
     dependen de ella. Si alguien vuelve a leer `page_json.zonas` por su cuenta,
     tendremos otra vez dos verdades — que es de lo que veníamos. */
  assert.match(AFORO, /leerZonas\(eventoId\)/, 'zonasDelEvento ya no delega en leerZonas');
  /* Sin los comentarios: el archivo EXPLICA de dónde salían las zonas antes, y
     mirar el texto crudo daba un falso positivo por su propia documentación. */
  const codigo = AFORO
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(
    !/page_json/.test(codigo),
    'aforoZonas vuelve a leer page_json por su cuenta',
  );
});

test('la lectura conserva la vuelta atrás al JSON', () => {
  /* La 0091 copió lo que existía ese día. Un evento restaurado de una copia, o
     creado antes de que esto se despliegue, puede tener zonas en el JSON y
     ninguna fila. Devolver una lista vacía haría desaparecer el plano en
     silencio, que es el peor fallo posible aquí. */
  const fn = TABLA.slice(TABLA.indexOf('async function leerZonas'), TABLA.indexOf('async function sincronizarZonas'));
  assert.match(fn, /from\('zonas'\)/, 'leerZonas no consulta la tabla');
  assert.match(fn, /page_json/, 'leerZonas perdió la vuelta atrás a page_json');
  assert.match(fn, /if \(filas && filas\.length\) return/, 'la vuelta atrás ya no es «tabla vacía → JSON»');
});

test('sincronizar NO borra todo para volver a insertar', () => {
  /* Ésta es la trampa. Las claves foráneas de la 0091 son `on delete set
     null`: un `delete` de todas las zonas del evento dejaría sin zona a las
     charlas y los stands que sí la tenían, aunque se reinsertaran un
     milisegundo después. El síntoma sería un plano que se vacía solo al
     guardar cualquier cosa, y nada en el log. */
  const fn = TABLA.slice(TABLA.indexOf('async function sincronizarZonas'));
  assert.match(fn, /\.upsert\(/, 'ya no se actualiza por upsert');
  assert.match(fn, /\.not\('id', 'in'/, 'el borrado ya no excluye a las zonas que siguen vivas');
});

test('sincronizar no puede tumbar el guardado del evento', () => {
  /* Es una escritura de acompañamiento mientras `page_json` siga siendo la
     fuente para volver atrás. Si lanzara, perder el guardado entero de la
     landing por no poder escribir una tabla espejo sería cambiar un problema
     invisible por uno muy visible. */
  const fn = TABLA.slice(TABLA.indexOf('async function sincronizarZonas'));
  assert.match(fn, /try\s*\{/, 'sincronizarZonas ya no se protege con try');
  assert.ok(!/throw/.test(fn), 'sincronizarZonas lanza');
});

test('sólo se sincroniza cuando la petición trae zonas', () => {
  /* El PATCH mezcla `page_json` por clave (0064). Sincronizar siempre haría que
     guardar el SEO borrase el plano, porque la petición no trae `zonas` y la
     lista llegaría vacía. */
  const ev = leer('routes/eventos.js');
  assert.match(
    ev, /'zonas' in updatesFinales\.page_json/,
    'el PATCH sincroniza las zonas sin comprobar que la petición las traiga',
  );
});
