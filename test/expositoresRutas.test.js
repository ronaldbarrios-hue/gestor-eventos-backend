/* Que el alta de expositor siga siendo UNA sola.

   Había dos, contra la misma tabla: la de Stands, que aceptaba los diecisiete
   campos de `CAMPOS_EDITABLES_ORGANIZADOR`, y la de la Rueda de Negocios, que
   aceptaba cuatro. Y la de la Rueda no tenía PATCH, así que un expositor
   creado desde esa pantalla no se podía editar desde ninguna parte: ni
   corregir el nombre, ni ponerle zona, ni arreglar el contacto. Se veía en el
   panel y no había forma de tocarlo.

   Dos pantallas contra una tabla se separan solas: alguien añade un campo en
   una y la otra se queda vieja, sin que nada avise. Estas pruebas no
   comprueban que funcione —eso lo dicen las de la ficha— sino que no se haya
   vuelto a partir en dos.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FUENTE = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'networking.js'), 'utf8',
);

/* Las rutas declaradas de una sola línea: `router.<verbo>('<ruta>', ..., <manejador>)`. */
function rutas() {
  const re = /router\.(post|patch|delete|get|put)\(\s*'([^']+)'([^\n]*)/g;
  const out = [];
  let m;
  while ((m = re.exec(FUENTE))) out.push({ verbo: m[1], ruta: m[2], resto: m[3] });
  return out;
}

const DE_EXPOSITOR = [
  { verbo: 'post', ruta: '/:eventoId/expositores' },
  { verbo: 'patch', ruta: '/:eventoId/expositores/:id' },
  { verbo: 'delete', ruta: '/:eventoId/expositores/:id' },
  { verbo: 'post', ruta: '/:eventoId/networking/expositores' },
  { verbo: 'patch', ruta: '/:eventoId/networking/expositores/:id' },
  { verbo: 'delete', ruta: '/:eventoId/networking/expositores/:id' },
];

test('las dos pantallas pueden crear, editar y borrar un expositor', () => {
  /* Éste es EL test: el PATCH de la Rueda de Negocios es el que faltaba, y su
     ausencia dejaba fichas que sólo se podían borrar y volver a crear. */
  const hay = rutas();
  for (const q of DE_EXPOSITOR) {
    assert.ok(
      hay.some(r => r.verbo === q.verbo && r.ruta === q.ruta),
      `falta ${q.verbo.toUpperCase()} ${q.ruta}`,
    );
  }
});

test('las seis rutas comparten los mismos tres manejadores', () => {
  /* Si alguien vuelve a escribir la lógica en línea, esto lo caza: lo que se
     separó la primera vez fue tener dos cuerpos, no dos URL. */
  const esperado = { post: 'crearExpositor', patch: 'editarExpositor', delete: 'borrarExpositor' };
  for (const q of DE_EXPOSITOR) {
    const r = rutas().find(x => x.verbo === q.verbo && x.ruta === q.ruta);
    assert.ok(
      r.resto.includes(esperado[q.verbo]),
      `${q.verbo.toUpperCase()} ${q.ruta} no usa ${esperado[q.verbo]}`,
    );
  }
});

test('sólo hay un alta: un único insert de expositor en todo el archivo', () => {
  const inserts = FUENTE.match(/from\('networking_expositores'\)\s*\.?\s*\n?\s*\.insert/g) || [];
  assert.equal(inserts.length, 1, `hay ${inserts.length} altas de expositor, tiene que haber una`);
});

test('el borrado de expositor filtra por evento', () => {
  /* `assertOwner` comprueba que esta persona manda en ESTE evento, no que el
     expositor sea de este evento. La versión de la Rueda de Negocios borraba
     por `id` a secas, así que quien organizara un evento cualquiera podía
     borrar la ficha de otro evento ajeno pasando su id. */
  const cuerpo = FUENTE.slice(
    FUENTE.indexOf('async function borrarExpositor'),
    FUENTE.indexOf('async function soloCategoriaNetworking'),
  );
  assert.ok(cuerpo.includes('.delete()'), 'no encuentro el borrado: revisa la prueba');
  assert.ok(
    cuerpo.includes(".eq('evento_id', eventoId)"),
    'el borrado de expositor no filtra por evento_id',
  );
});

test('el gate de categoría lo llevan las rutas de la Rueda, y sólo ellas', () => {
  /* La Rueda de Negocios sólo existe para ciertas categorías; los stands
     funcionan para cualquier evento. Ponerle el gate a los stands rompería el
     alta a mano de la mitad de los eventos. */
  for (const q of DE_EXPOSITOR) {
    const r = rutas().find(x => x.verbo === q.verbo && x.ruta === q.ruta);
    const esRueda = q.ruta.includes('/networking/');
    assert.equal(
      r.resto.includes('soloCategoriaNetworking'), esRueda,
      `${q.verbo.toUpperCase()} ${q.ruta} ${esRueda ? 'debería llevar' : 'no debería llevar'} el gate de categoría`,
    );
  }
});
