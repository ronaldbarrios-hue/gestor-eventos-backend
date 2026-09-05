/* Cuánto se puede escribir en una pregunta de texto.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * Un formulario pide «tu propuesta en máximo 10 palabras» y hasta la 0107 eso
 * vivía sólo en el enunciado: llegaban párrafos, y el recorte lo acababa
 * haciendo una persona a mano al leerlas o al imprimirlas en un gafete.
 *
 * ── Lo que se vigila ─────────────────────────────────────────────────────
 *
 * Que el límite lo aplique el SERVIDOR. El navegador puede poner `maxLength` y
 * un contador, pero eso es comodidad: quien manda la petición a mano se los
 * salta. Y que un límite mal puesto —cero, texto, negativo— no se guarde: un
 * `0` en la base es una pregunta que nadie puede responder.
 *
 * Correr: npm test */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  contarPalabras, validarRespuesta, filaCampo, COLUMNAS_CAMPO, TIPOS_CON_LIMITE,
} = require('../lib/formularioCampos.js');

test('contar palabras no se despista con espacios ni saltos de línea', () => {
  /* Esta regla tiene que ser la misma en el navegador. Si contaran distinto, el
     contador diría 10 y el servidor 11: formulario imposible de enviar y sin
     decir por qué. */
  assert.equal(contarPalabras('uno dos tres'), 3);
  assert.equal(contarPalabras('  uno   dos  '), 2, 'los espacios de más cuentan como palabra');
  assert.equal(contarPalabras('uno\ndos\ttres'), 3, 'los saltos de línea y tabuladores no separan');
  assert.equal(contarPalabras(''), 0);
  assert.equal(contarPalabras('   '), 0, 'sólo espacios no es una palabra');
  assert.equal(contarPalabras(null), 0);
  assert.equal(contarPalabras('veinticuatro-siete'), 1, 'un guion no parte la palabra');
});

test('se rechaza pasarse, y se dice por cuánto', () => {
  /* «Te sobran 14» es accionable. «Demasiado largo» obliga a contar a ojo y
     borrar hasta que deje de quejarse. */
  const porPalabras = validarRespuesta(
    { tipo: 'texto', etiqueta: 'Propuesta', max_palabras: 3 }, 'una dos tres cuatro');
  assert.match(porPalabras, /máximo 3 palabras/);
  assert.match(porPalabras, /te sobran 1/);

  const porCaracteres = validarRespuesta(
    { tipo: 'parrafo', etiqueta: 'Resumen', max_caracteres: 5 }, 'abcdefgh');
  assert.match(porCaracteres, /máximo 5 caracteres/);
  assert.match(porCaracteres, /te sobran 3/);
});

test('justo en el límite se acepta', () => {
  /* El error clásico de esta comprobación es el `>=`: pedir «máximo 10» y
     rechazar diez. */
  assert.equal(validarRespuesta({ tipo: 'texto', etiqueta: 'X', max_palabras: 3 }, 'una dos tres'), null);
  assert.equal(validarRespuesta({ tipo: 'texto', etiqueta: 'X', max_caracteres: 5 }, 'abcde'), null);
});

test('sin límite, nada cambia', () => {
  /* Todo lo que ya existe tiene los dos en null. Si esto fallara, la 0107
     habría roto todos los formularios del mundo al aplicarse. */
  const largo = 'palabra '.repeat(500);
  assert.equal(validarRespuesta({ tipo: 'texto', etiqueta: 'X' }, largo), null);
  assert.equal(validarRespuesta({ tipo: 'parrafo', etiqueta: 'X', max_palabras: null }, largo), null);
});

test('el límite no se cuela en los tipos donde no significa nada', () => {
  /* En un correo el límite ya lo pone su verificación, y en una selección lo
     ponen las opciones. Aplicarlo ahí sería rechazar un correo largo pero
     válido. */
  assert.deepEqual([...TIPOS_CON_LIMITE].sort(), ['parrafo', 'texto']);
  assert.equal(
    validarRespuesta({ tipo: 'email', etiqueta: 'Correo', max_caracteres: 3 }, 'alguien@dominio.com'),
    null, 'un correo se está midiendo con un límite de texto');
});

test('un límite mal puesto no se guarda', () => {
  /* Cero, negativo o basura vuelven a null —sin límite—. Un 0 guardado sería
     una pregunta imposible de responder, y el síntoma no señalaría al ajuste. */
  const conValor = (v) => filaCampo({ tipo: 'texto', etiqueta: 'a', max_caracteres: v }, 1).max_caracteres;
  assert.equal(conValor(0), null);
  assert.equal(conValor(-5), null);
  assert.equal(conValor(''), null);
  assert.equal(conValor('diez'), null);
  assert.equal(conValor('100'), 100, 'un número que llega como texto —del <input>— se pierde');
  assert.equal(conValor(99999), 10000, 'sin tope, el CHECK de la 0107 rechazaría el guardado con el error crudo de Postgres');
});

test('cambiar el tipo se lleva el límite', () => {
  /* Un límite escondido en un campo que ya no es de texto vuelve a aplicarse el
     día que alguien lo devuelva a texto, sin que nadie lo haya pedido. */
  const fila = filaCampo({ tipo: 'seleccion', etiqueta: 'a', opciones: ['x'], max_caracteres: 100, max_palabras: 10 }, 1);
  assert.equal(fila.max_caracteres, null);
  assert.equal(fila.max_palabras, null);
});

test('las columnas viajan en todas las lecturas', () => {
  /* `COLUMNAS_CAMPO` lo usan las tres rutas que leen preguntas —evento,
     sub-evento y torneo—. Si el límite no está en la lista, el editor lo
     guarda y al recargar aparece vacío: el ajuste que no hace nada. */
  assert.match(COLUMNAS_CAMPO, /max_caracteres/);
  assert.match(COLUMNAS_CAMPO, /max_palabras/);
});

test('la migración existe y no destruye nada', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '0107_limite_de_texto_en_preguntas.sql'), 'utf8');
  assert.match(sql, /add column if not exists max_caracteres/i);
  assert.match(sql, /add column if not exists max_palabras/i);
  /* Nullable y sin default: lo que ya existe queda sin límite, que es como
     estaba. Un default numérico habría puesto un tope a todas las preguntas
     del sistema de golpe. */
  assert.doesNotMatch(sql, /max_caracteres\s+integer\s+not null/i);
  assert.doesNotMatch(sql, /default\s+\d/i);
  /* Y el CHECK, que es lo que impide que un 0 llegue a la base por otra vía
     —el importador, el conector de Claude, un script—. */
  assert.match(sql, /max_caracteres between 1 and 10000/i);
  assert.match(sql, /max_palabras between 1 and 2000/i);
});
