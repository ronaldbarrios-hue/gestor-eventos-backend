/* Tests del padrón de eventos anteriores.

   Lo que se protege aquí es sobre todo la privacidad, que es lo que hace
   delicada esta función: responde con datos personales a partir de un número
   de cédula.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarDocumento, hashDocumento, salDelEvento,
  emparejar, columnasSinPregunta, extraerDocumento,
  limpiarMapeo, mapeoSugerido, filasSinCruce,
} = require('../lib/padronPrevio.js');

const EV_A = '11111111-1111-1111-1111-111111111111';
const EV_B = '22222222-2222-2222-2222-222222222222';

test('el documento se normaliza: puntos, espacios y ceros a la izquierda', () => {
  /* La gente lo escribe de todas las formas. Sin normalizar, "1.020.304" y
     "1020304" serían dos personas y el prellenado no encontraría a nadie. */
  const esperado = '1020304';
  for (const escrito of ['1.020.304', '1 020 304', '01020304', '1020304']) {
    assert.equal(normalizarDocumento(escrito), esperado, `falla con "${escrito}"`);
  }
});

test('el mismo documento da el mismo hash dentro del mismo evento', () => {
  assert.equal(hashDocumento(EV_A, '1.020.304'), hashDocumento(EV_A, '1020304'));
});

test('el mismo documento da hashes DISTINTOS en eventos distintos', () => {
  /* Es lo que impide que el padrón de un evento sirva para consultar otro, y
     lo que obliga a rehacer un diccionario de cédulas por cada evento. */
  assert.notEqual(hashDocumento(EV_A, '1020304'), hashDocumento(EV_B, '1020304'));
});

test('la sal depende del evento', () => {
  assert.notEqual(salDelEvento(EV_A), salDelEvento(EV_B));
});

test('un documento vacío no produce hash', () => {
  /* Si diera uno, todas las filas sin documento colisionarían en la misma
     clave y se pisarían entre ellas. */
  for (const v of ['', null, undefined, '   ', '...']) {
    assert.equal(hashDocumento(EV_A, v), null, `falla con ${JSON.stringify(v)}`);
  }
});

test('emparejar sólo devuelve los campos que ESTE formulario pregunta', () => {
  /* Lo que el organizador subió de más no puede salir: la ruta es pública y
     devolver todo lo guardado la convertiría en un directorio por cédula. */
  const padron = { 'Nombre': 'Ana', 'Empresa': 'Acme', 'Salario': '9000000' };
  const campos = [{ id: 'c1', etiqueta: 'Nombre' }, { id: 'c2', etiqueta: 'Empresa' }];
  const { respuestas } = emparejar(padron, campos);
  assert.deepEqual(respuestas, { c1: 'Ana', c2: 'Acme' });
  assert.ok(!JSON.stringify(respuestas).includes('9000000'), 'el salario no puede salir');
});

test('emparejar ignora tildes, mayúsculas y espacios al cruzar columnas', () => {
  /* El archivo viene de fuera: sus encabezados no coinciden letra por letra. */
  const { respuestas } = emparejar(
    { '  NÚMERO  DE   Teléfono ': '300' },
    [{ id: 'c1', etiqueta: 'Numero de telefono' }],
  );
  assert.equal(respuestas.c1, '300');
});

test('emparejar dice qué preguntas quedan sin respuesta', () => {
  const { faltan } = emparejar({ 'Nombre': 'Ana' },
    [{ id: 'c1', etiqueta: 'Nombre' }, { id: 'c2', etiqueta: 'Ciudad' }]);
  assert.deepEqual(faltan.map(f => f.id), ['c2']);
});

test('un valor vacío cuenta como que falta, no como respondido', () => {
  const { respuestas, faltan } = emparejar({ 'Ciudad': '' }, [{ id: 'c1', etiqueta: 'Ciudad' }]);
  assert.deepEqual(respuestas, {});
  assert.equal(faltan.length, 1);
});

test('extraerDocumento reconoce la columna aunque venga en mayúscula o con tilde', () => {
  /* "Documento", "NIT" en mayúscula o "Cédula" no se reconocían por
     comparación exacta en minúscula: la fila se descartaba sin explicación. */
  assert.equal(extraerDocumento({ Documento: '123' }), '123');
  assert.equal(extraerDocumento({ NIT: '456' }), '456');
  assert.equal(extraerDocumento({ 'Cédula': '789' }), '789');
});

test('extraerDocumento reconoce alias en inglés o snake_case', () => {
  /* Común en bases humanitarias o exportadas de sistemas en inglés. */
  assert.equal(extraerDocumento({ id_number: '321' }), '321');
  assert.equal(extraerDocumento({ 'numero_documento': '654' }), '654');
});

test('extraerDocumento respeta la prioridad cuando hay más de un alias', () => {
  assert.equal(extraerDocumento({ nit: '111', documento: '222' }), '222');
});

test('extraerDocumento no encuentra nada si ninguna columna es reconocible', () => {
  assert.equal(extraerDocumento({ Nombre: 'Ana', Empresa: 'Acme' }), undefined);
});

test('columnasSinPregunta dice qué trae el archivo que nadie recoge', () => {
  /* Es la mitad útil del aviso al organizador: «para aprovechar esta columna
     te falta esta pregunta». */
  const sobran = columnasSinPregunta(['Nombre', 'Empresa', 'Cargo'], [{ etiqueta: 'nombre' }]);
  assert.deepEqual(sobran, ['Empresa', 'Cargo']);
});

/* ── El mapeo de columnas ──────────────────────────────────────────────────
 *
 * De dónde viene: un organizador subió 4.124 personas y el prellenado no
 * reconoció a nadie. La causa no era el tamaño — era que el cruce va por el
 * TEXTO del encabezado contra el enunciado de la pregunta, y sus encabezados
 * eran los nombres internos del sistema de origen: `ciudad` no es «Ciudad de
 * residencia» y `barrio_vereda` no es «Barrio o vereda». De cinco preguntas
 * cruzaba una.
 *
 * El mapeo lo arregla sin obligar a nadie a renombrar su archivo. Lo que se
 * prueba aquí es sobre todo que NO rompa el cruce por nombre, que es lo que
 * usan los eventos que hoy funcionan. */

const CAMPOS_REALES = [
  { id: 'f_edad',   etiqueta: 'Edad' },
  { id: 'f_ciudad', etiqueta: 'Ciudad de residencia' },
  { id: 'f_barrio', etiqueta: 'Barrio o vereda' },
  { id: 'f_comuna', etiqueta: 'Comuna' },
];
/* Los encabezados tal cual venían en el archivo que destapó el problema. */
const FILA_REAL = {
  ciudad: 'Ibagué', barrio_vereda: 'El Salado', comuna: '10',
  fecha_nacimiento: '2004-05-01', 'nombre completo': 'Ana',
};
const COLUMNAS_REALES = Object.keys(FILA_REAL);

test('sin mapeo se conserva el cruce por nombre — y sólo cruza lo que coincide', () => {
  /* Ésta es la prueba que importa: la primera versión del mapeo usaba
     `mapeo && mapeo[id]`, que da `null` cuando no hay mapeo, y trataba ese
     `null` como «el archivo no trae esta pregunta». Resultado: sin mapeo no se
     llenaba NADA, o sea que habría desactivado en silencio el prellenado de
     todos los eventos que ya funcionaban. */
  const { respuestas, faltan } = emparejar(FILA_REAL, CAMPOS_REALES);
  assert.deepEqual(Object.keys(respuestas), ['f_comuna'],
    'sólo «Comuna» coincide letra por letra con una columna');
  assert.equal(faltan.length, 3);
});

test('con mapeo se llenan las preguntas cuyo encabezado NO coincidía', () => {
  const mapeo = { f_ciudad: 'ciudad', f_barrio: 'barrio_vereda', f_comuna: 'comuna', f_edad: '' };
  const { respuestas, faltan } = emparejar(FILA_REAL, CAMPOS_REALES, mapeo);
  assert.deepEqual(respuestas, { f_ciudad: 'Ibagué', f_barrio: 'El Salado', f_comuna: '10' });
  /* «Edad» sigue faltando, y debe: el archivo trae fecha de nacimiento, que es
     otro dato. Dejarla en blanco es la respuesta correcta, no un olvido. */
  assert.deepEqual(faltan.map(f => f.etiqueta), ['Edad']);
});

test('una pregunta en blanco en el mapeo es una DECISIÓN, no un olvido', () => {
  /* Si el organizador dice «esta pregunta no la trae mi archivo», no se debe
     volver a adivinar por nombre a sus espaldas. */
  const { respuestas } = emparejar(FILA_REAL, CAMPOS_REALES, { f_comuna: '' });
  assert.equal(respuestas.f_comuna, undefined,
    'estaba en blanco a propósito: no se cae al cruce por nombre');
});

test('el mapeo apunta a la columna por su nombre exacto, con espacios y acentos', () => {
  const campos = [{ id: 'f_nom', etiqueta: 'Cómo te llamas' }];
  const { respuestas } = emparejar(FILA_REAL, campos, { f_nom: 'nombre completo' });
  assert.equal(respuestas.f_nom, 'Ana');
});

test('mapeoSugerido ofrece de partida lo que el cruce por nombre ya daría', () => {
  assert.deepEqual(mapeoSugerido(CAMPOS_REALES, COLUMNAS_REALES), { f_comuna: 'comuna' });
});

test('limpiarMapeo descarta preguntas y columnas que no existen', () => {
  const sucio = {
    f_ciudad: 'ciudad',                 // válido
    f_inventado: 'ciudad',              // la pregunta no existe
    f_barrio: 'columna_que_no_existe',  // la columna no existe
    f_edad: '',                         // en blanco: se conserva
    f_comuna: { raro: true },           // ni siquiera es texto
  };
  assert.deepEqual(limpiarMapeo(sucio, CAMPOS_REALES, COLUMNAS_REALES),
    { f_ciudad: 'ciudad', f_edad: '' });
});

test('filasSinCruce cuenta las filas que no llenarían ni una pregunta', () => {
  /* El número que faltaba en la subida. En el caso real, 3.624 de 4.124 filas
     traían sólo nombre y apellidos: la subida decía «4.124 personas en el
     padrón» y un padrón inútil se veía igual que uno bueno. */
  const soloNombre = { apellidos: 'Pérez', 'nombre completo': 'Ana' };
  const mapeo = { f_ciudad: 'ciudad', f_barrio: 'barrio_vereda', f_comuna: 'comuna' };
  assert.equal(filasSinCruce([FILA_REAL, FILA_REAL, soloNombre, soloNombre], CAMPOS_REALES, mapeo), 2);
  assert.equal(filasSinCruce([soloNombre], CAMPOS_REALES, mapeo), 1);
  assert.equal(filasSinCruce([FILA_REAL], CAMPOS_REALES, mapeo), 0);
});
