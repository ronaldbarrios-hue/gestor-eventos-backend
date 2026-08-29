/* Tests del padrón de eventos anteriores.

   Lo que se protege aquí es sobre todo la privacidad, que es lo que hace
   delicada esta función: responde con datos personales a partir de un número
   de cédula.

   Correr: npm test */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarDocumento, hashDocumento, salDelEvento,
  emparejar, columnasSinPregunta,
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

test('columnasSinPregunta dice qué trae el archivo que nadie recoge', () => {
  /* Es la mitad útil del aviso al organizador: «para aprovechar esta columna
     te falta esta pregunta». */
  const sobran = columnasSinPregunta(['Nombre', 'Empresa', 'Cargo'], [{ etiqueta: 'nombre' }]);
  assert.deepEqual(sobran, ['Empresa', 'Cargo']);
});
