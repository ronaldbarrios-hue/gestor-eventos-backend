/* Tests de la ficha de stand compartida.

   Existe por un fallo que este repo ya pagó una vez: nueve campos de la ficha
   se guardaban bien y no se volvían a ver nunca, porque el SELECT del panel
   tenía su propia copia de la lista de columnas. `zona_id` (0088) iba camino
   de repetirlo en diez copias a la vez.

   Lo que se protege aquí: que las listas de lectura cubran lo que las de
   escritura aceptan, que la zona la asigne el organizador y no el expositor, y
   que un stand cuya zona se borró siga apareciendo.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  COLS_TARJETA, COLS_DIRECTORIO, COLS_COMPLETAS,
  CAMPOS_EDITABLES_ORGANIZADOR, CAMPOS_EDITABLES_EXPOSITOR,
  conZona, standsPorZona,
} = require('../lib/expositores.js');

const columnas = (s) => s.split(',').map(c => c.trim()).filter(Boolean);

test('lo que el organizador puede guardar, se puede volver a leer', () => {
  /* Éste es EL test. El fallo original fue exactamente esto: aceptar al
     escribir lo que el select no devolvía. */
  const leibles = columnas(COLS_COMPLETAS);
  for (const campo of CAMPOS_EDITABLES_ORGANIZADOR) {
    assert.ok(leibles.includes(campo), `«${campo}» se guarda pero no se lee`);
  }
});

test('las tres listas de lectura llevan la zona', () => {
  /* Si una se queda fuera, el stand tiene zona en una pantalla y no en otra,
     que es justo el fallo que la 0088 venía a evitar. */
  for (const [nombre, cols] of Object.entries({ COLS_TARJETA, COLS_DIRECTORIO, COLS_COMPLETAS })) {
    assert.ok(columnas(cols).includes('zona_id'), `${nombre} no devuelve zona_id`);
  }
});

test('la tarjeta es un subconjunto del directorio, y el directorio de la ficha entera', () => {
  const tarjeta = columnas(COLS_TARJETA);
  const directorio = columnas(COLS_DIRECTORIO);
  const completas = columnas(COLS_COMPLETAS);
  for (const c of tarjeta) assert.ok(directorio.includes(c), `el directorio no trae «${c}»`);
  for (const c of directorio) assert.ok(completas.includes(c), `la ficha entera no trae «${c}»`);
});

test('el expositor NO puede mover su propio stand de zona', () => {
  /* Dónde se monta cada stand lo decide el plano del evento. Si el expositor
     pudiera cambiarlo, se movería de sitio en el mapa del visitante. */
  assert.ok(!CAMPOS_EDITABLES_EXPOSITOR.includes('zona_id'));
  assert.ok(CAMPOS_EDITABLES_ORGANIZADOR.includes('zona_id'));
});

test('el expositor tampoco puede tocar lo que decide el organizador', () => {
  for (const prohibido of ['activo', 'estado_ficha', 'orden', 'evento_id', 'ticket_id']) {
    assert.ok(!CAMPOS_EDITABLES_EXPOSITOR.includes(prohibido), `«${prohibido}» no es suyo`);
  }
});

/* ── La zona resuelta ──────────────────────────────────────────────────── */

const ZONAS = [{ id: 'z1', nombre: 'Zona Gamer' }, { id: 'z2', nombre: 'Food Court' }];

test('cada ficha sale con el nombre de su zona, no con el id', () => {
  const [a, b] = conZona([{ id: 'f1', zona_id: 'z1' }, { id: 'f2', zona_id: 'z2' }], ZONAS);
  assert.equal(a.zona_nombre, 'Zona Gamer');
  assert.equal(b.zona_nombre, 'Food Court');
});

test('un stand cuya zona se borró sigue apareciendo, sin nombre de zona', () => {
  /* La ficha existe y el stand existe; lo único que caducó es su ubicación.
     Descartarlo haría desaparecer del directorio a un expositor de verdad. */
  const fichas = conZona([{ id: 'f1', nombre: 'ACME', zona_id: 'borrada' }], ZONAS);
  assert.equal(fichas.length, 1, 'no se puede perder la ficha');
  assert.equal(fichas[0].nombre, 'ACME');
  assert.equal(fichas[0].zona_nombre, null);
});

test('un stand todavía sin ubicar no rompe nada', () => {
  const [f] = conZona([{ id: 'f1', zona_id: null }], ZONAS);
  assert.equal(f.zona_nombre, null);
});

test('los stands se agrupan por zona, y los huérfanos no se cuelan', () => {
  const porZona = standsPorZona([
    { id: 'f1', zona_id: 'z1' },
    { id: 'f2', zona_id: 'z1' },
    { id: 'f3', zona_id: 'borrada' },
    { id: 'f4', zona_id: null },
  ], ZONAS);
  assert.deepEqual(porZona.z1.map(f => f.id), ['f1', 'f2']);
  assert.deepEqual(porZona.z2, [], 'una zona sin stands sale vacía, no ausente');
  assert.ok(!('borrada' in porZona), 'una zona que no existe no se inventa');
});

test('sin zonas declaradas no se revienta', () => {
  assert.deepEqual(conZona([{ id: 'f1', zona_id: 'z1' }], []), [{ id: 'f1', zona_id: 'z1', zona_nombre: null }]);
  assert.deepEqual(standsPorZona([{ id: 'f1', zona_id: 'z1' }], []), {});
  assert.deepEqual(conZona(null, null), []);
});

/* ── Las dos altas de expositor deben coincidir en lo que decide si se VE ──
 *
 * Un expositor se puede crear desde dos pantallas y por dos rutas distintas
 * sobre la misma tabla: «Stands» (`POST /:eventoId/expositores`) y «Rueda de
 * negocios» (`POST /:eventoId/networking/expositores`). Esa duplicación está
 * anotada como deuda; mientras exista, lo que NO puede pasar es que las dos
 * guarden estados distintos.
 *
 * Y pasaba. `estado_ficha` nace en `'borrador'` y el directorio y el mapa
 * PÚBLICOS filtran por `'completa'` (`routes/eventos.publicos.js`), así que un
 * expositor creado desde Rueda de negocios se veía en el panel y el público no
 * lo veía nunca. Sin aviso, y sin forma de arreglarlo desde esa pantalla,
 * porque no tiene PATCH.
 *
 * Se comprueba sobre el fuente porque el fallo está en el INSERT, no en una
 * función que se pueda llamar. Mismo enfoque que `montaje.test.js`. */
const fs = require('node:fs');
const path = require('node:path');

test('el alta de expositor deja la ficha visible para el público', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8');

  /* Antes esto recorría los DOS manejadores de alta, porque había dos. Ahora
     hay uno solo, compartido por las dos pantallas, y quien vigila que siga
     siendo uno es `expositoresRutas.test.js`. Aquí queda lo que esa prueba no
     mira: que el alta deje la ficha en 'completa'.

     Se comprueba sobre el fuente porque el fallo está en el INSERT, no en una
     función que se pueda llamar. Mismo enfoque que `montaje.test.js`. */
  const desde = src.indexOf('async function crearExpositor');
  assert.ok(desde !== -1, 'ya no encuentro crearExpositor: revisa la prueba');
  const cuerpo = src.slice(desde, src.indexOf('async function editarExpositor'));

  assert.match(cuerpo, /estado_ficha\s*:\s*'completa'/,
    'el alta no deja la ficha en «completa». Un alta hecha por el organizador ' +
    'debe quedar completa: `borrador` es para las fichas que crea el trigger de ' +
    'una boleta-stand y completa el propio expositor. En `borrador`, el ' +
    'directorio y el mapa públicos no la muestran nunca.');
});
