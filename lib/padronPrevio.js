'use strict';

/* Padrón de eventos anteriores — buscar por documento y prellenar.
 *
 * Todo lo delicado de esta función vive aquí, en un solo sitio, para que no se
 * decida distinto en cada ruta. Ver la migración 0085 para el porqué de la
 * forma de la tabla.
 */

const crypto = require('crypto');

/* El documento se normaliza antes de hashear: la gente lo escribe con puntos,
   con espacios, o con un cero delante. Sin esto, "1.020.304" y "1020304" son
   dos personas distintas y el prellenado no encuentra a nadie. */
function normalizarDocumento(doc) {
  return String(doc ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^0+/, '');
}

/* La sal es del EVENTO y no global. Las cédulas colombianas son ocho a diez
   cifras: un diccionario completo se precalcula en un rato, así que un hash sin
   sal no protege nada. Con sal por evento, ese trabajo habría que rehacerlo
   para cada evento y sólo sirve contra ese.

   Se deriva del id del evento y del secreto del servidor: así no hay que
   guardar una sal por evento ni migrar nada si se añaden eventos. */
function salDelEvento(eventoId) {
  const secreto = process.env.PADRON_SECRET || process.env.JWT_SECRET || 'gestek-padron-dev';
  return crypto.createHmac('sha256', secreto).update(String(eventoId)).digest('hex');
}

function hashDocumento(eventoId, doc) {
  const norm = normalizarDocumento(doc);
  if (!norm) return null;
  return crypto.createHash('sha256').update(`${norm}:${salDelEvento(eventoId)}`).digest('hex');
}

/* Para emparejar las columnas del padrón con las preguntas de hoy: el archivo
   viene de fuera y sus encabezados no coinciden letra por letra. */
function clave(etiqueta) {
  return String(etiqueta ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Qué se le devuelve a quien está llenando el formulario.
 *
 * SÓLO los campos que este formulario pregunta. Lo que el organizador subió de
 * más —un teléfono, una dirección, lo que fuera— no sale nunca: la ruta es
 * pública y devolver todo lo guardado convertiría el padrón en un directorio
 * consultable por cédula.
 *
 * Devuelve además `faltan`: las preguntas de hoy para las que el padrón no
 * trae nada. Es lo que deja avisar a quien rellena de qué le queda, y al
 * organizador de qué preguntas le faltan para aprovechar lo que subió. */
function emparejar(datosPadron, campos) {
  const porClave = new Map(
    Object.entries(datosPadron || {}).map(([k, v]) => [clave(k), v]),
  );
  const respuestas = {};
  const faltan = [];
  for (const c of campos || []) {
    const v = porClave.get(clave(c.etiqueta));
    if (v === undefined || v === null || v === '') faltan.push({ id: c.id, etiqueta: c.etiqueta });
    else respuestas[c.id] = v;
  }
  return { respuestas, faltan };
}

/* Y al revés, para el organizador: qué trae el padrón que NADIE pregunta.
   Es la mitad útil del aviso «en tu formulario falta esta pregunta para poder
   sacar esta información». */
function columnasSinPregunta(columnasPadron, campos) {
  const preguntadas = new Set((campos || []).map(c => clave(c.etiqueta)));
  return (columnasPadron || []).filter(col => !preguntadas.has(clave(col)));
}

module.exports = {
  normalizarDocumento,
  hashDocumento,
  salDelEvento,
  clave,
  emparejar,
  columnasSinPregunta,
};
