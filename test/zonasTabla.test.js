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

/* Cada función, sólo su cuerpo.

   Antes esto cortaba «desde `sincronizarZonas` hasta el final del archivo», y
   el día que apareció `sincronizarPuertas` debajo la prueba empezó a leer las
   dos como una: un `throw` de la segunda —capturado por su propio `try`— se
   contaba como que la primera lanzaba. Una prueba que se equivoca de trozo
   acusa a quien no fue. */
function cuerpo(nombre) {
  const desde = TABLA.indexOf(`async function ${nombre}`);
  const resto = TABLA.slice(desde + 1);
  const siguiente = resto.indexOf('\nasync function ');
  return siguiente === -1 ? TABLA.slice(desde) : resto.slice(0, siguiente);
}

test('sincronizar NO borra todo para volver a insertar', () => {
  /* Ésta es la trampa. Las claves foráneas de la 0091 son `on delete set
     null`: un `delete` de todas las zonas del evento dejaría sin zona a las
     charlas y los stands que sí la tenían, aunque se reinsertaran un
     milisegundo después. El síntoma sería un plano que se vacía solo al
     guardar cualquier cosa, y nada en el log. */
  const fn = cuerpo('sincronizarZonas');
  assert.match(fn, /\.upsert\(/, 'ya no se actualiza por upsert');
  assert.match(fn, /\.not\('id', 'in'/, 'el borrado ya no excluye a las zonas que siguen vivas');
});

test('sincronizar no puede tumbar el guardado del evento', () => {
  /* Es una escritura de acompañamiento mientras `page_json` siga siendo la
     fuente para volver atrás. Si lanzara, perder el guardado entero de la
     landing por no poder escribir una tabla espejo sería cambiar un problema
     invisible por uno muy visible. */
  const fn = cuerpo('sincronizarZonas');
  assert.match(fn, /try\s*\{/, 'sincronizarZonas ya no se protege con try');
  assert.ok(!/throw/.test(fn), 'sincronizarZonas lanza');
});

test('espejar las puertas no se lleva por delante las demás zonas', () => {
  /* La misma trampa que apareció con los motivos de los stands: un borrado por
     ausencia contra una lista que no conoce al resto. `sincronizarPuertas`
     recibe SÓLO las puertas, así que sin el filtro por tipo su `delete`
     borraría todas las zonas del evento —y las charlas y los stands se
     quedarían sin sitio por el `on delete set null`—. */
  const fn = cuerpo('sincronizarPuertas');
  assert.match(fn, /\.eq\('tipo', 'ingreso'\)/,
    'el borrado de puertas ya no se limita a las zonas de tipo ingreso');
  assert.match(fn, /\.not\('id', 'in'/, 'el borrado no excluye a las puertas que siguen vivas');
  assert.match(fn, /try\s*\{/, 'sincronizarPuertas ya no se protege con try');
  assert.match(fn, /tipo: 'ingreso'/, 'la puerta ya no se guarda como zona de ingreso');
  /* Una puerta no declara aforo: no se llena, se cruza. */
  assert.match(fn, /aforo_max: null/, 'la puerta volvió a declarar aforo');
});

test('una puerta no cuenta como gente dentro', () => {
  /* Si contara, el número de gente en el recinto se sumaría dos veces: una al
     cruzar la puerta y otra en la zona a la que se entra. */
  const aforo = leer('lib/aforoZonas.js');
  assert.match(aforo, /z\.tipo !== 'ingreso'/,
    'ocupacion() ya no deja fuera las zonas de tipo ingreso');
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

test('el evento viaja con sus zonas dentro, aunque ya no vivan en page_json', () => {
  /* Esto es lo que la 0092 rompió y nadie vio venir: en el servidor la mudanza
     estaba hecha —el aforo lee de la tabla— pero el PANEL y la PÁGINA PÚBLICA
     leen `evento.page_json.zonas`, y ahí buscan la pantalla de Zonas, el
     selector de zona de un sub-evento, el escáner y el bloque de mapa.

     Cuatro pantallas en blanco a la vez, sin un solo error, en cuanto la
     migración corrió. La tabla es la fuente; esto es la traducción. */
  const tabla = leer('lib/zonasTabla.js');
  assert.match(tabla, /async function conZonas/, 'ya no existe la traducción tabla → page_json');

  const panel = leer('routes/eventos.js');
  assert.match(panel, /conSitio\(conTodo\)/, 'el evento del panel ya no lleva sus zonas dentro');

  const publico = leer('routes/eventos.publicos.js');
  assert.match(publico, /conZonas\(evento\)/, 'el evento público ya no lleva sus zonas dentro');
});
