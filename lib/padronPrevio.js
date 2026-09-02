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

/* Nombres con los que un organizador llama a la columna del documento. En
   ese orden de prioridad si el archivo trae más de uno. Comparados por
   `clave()`, así que "NIT", "Nº Documento" o "id_number" (bases en inglés)
   entran igual que "documento". */
const ALIAS_DOCUMENTO = [
  'documento', 'cedula', 'identificacion', 'nit', 'dni',
  'numero documento', 'no documento', 'id number',
].map(clave);

/* La fila viene tal cual la subió el organizador: sus llaves no están
   normalizadas. Comparar por `clave()` es lo que permite que "Documento",
   "NIT" en mayúscula o "id_number" se reconozcan igual que "documento". */
function extraerDocumento(fila) {
  const porClave = new Map(Object.entries(fila || {}).map(([k, v]) => [clave(k), v]));
  for (const alias of ALIAS_DOCUMENTO) {
    if (porClave.has(alias)) return porClave.get(alias);
  }
  return undefined;
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
function emparejar(datosPadron, campos, mapeo = null) {
  const porClave = new Map(
    Object.entries(datosPadron || {}).map(([k, v]) => [clave(k), v]),
  );
  /* Las columnas también por su nombre EXACTO, para que el mapeo pueda apuntar
     a «Zona de residencia» sin depender de cómo la normalizaríamos. */
  const porNombre = new Map(Object.entries(datosPadron || {}));

  const respuestas = {};
  const faltan = [];
  for (const c of campos || []) {
    /* Hay que distinguir tres cosas, y confundir dos de ellas rompe el
       prellenado de todos los eventos que hoy funcionan:

         · esta pregunta NO está en el mapeo  -> cruce por nombre, el de siempre
         · el mapeo la deja en blanco ('')    -> DECISIÓN: el archivo no la trae
         · el mapeo apunta a una columna      -> se lee de ahí y no se adivina

       La primera versión de esto usaba `mapeo && mapeo[c.id]`, que devuelve
       `null` cuando no hay mapeo ninguno, y trataba ese `null` como la
       segunda: sin mapeo, ninguna pregunta se llenaba. Lo cazó la prueba. */
    const mapeada = mapeo && Object.prototype.hasOwnProperty.call(mapeo, c.id);
    let v;
    if (mapeada) {
      const col = mapeo[c.id];
      if (col === '' || col === null) v = undefined;
      else v = porNombre.has(col) ? porNombre.get(col) : porClave.get(clave(col));
    } else {
      v = porClave.get(clave(c.etiqueta));
    }

    if (v === undefined || v === null || v === '') faltan.push({ id: c.id, etiqueta: c.etiqueta });
    else respuestas[c.id] = v;
  }
  return { respuestas, faltan };
}

/* El mapeo, limpio: sólo preguntas que existen y columnas que el archivo trae.
 *
 * Se guarda por **id de pregunta**, no por su etiqueta. Es la diferencia que
 * importa: el cruce viejo iba contra el texto del enunciado, así que
 * renombrar una pregunta rompía el padrón EN SILENCIO — nadie relaciona
 * «cambié el título de la pregunta» con «el prellenado dejó de funcionar».
 * Con el id, renombrarla no lo toca. */
function limpiarMapeo(mapeo, campos, columnas) {
  const idsValidos = new Set((campos || []).map(c => c.id));
  const colsValidas = new Set(columnas || []);
  const limpio = {};
  for (const [idCampo, col] of Object.entries(mapeo || {})) {
    if (!idsValidos.has(idCampo)) continue;
    /* Cadena vacía = «esta pregunta no la trae el archivo», y se conserva:
       distingue lo decidido de lo que nadie miró todavía. */
    if (col === '' || col === null) { limpio[idCampo] = ''; continue; }
    if (typeof col !== 'string') continue;
    if (colsValidas.size && !colsValidas.has(col)) continue;
    limpio[idCampo] = col;
  }
  return limpio;
}

/* Lo que el cruce daría HOY, sin que nadie mapee nada: la columna cuyo nombre
   coincide con el enunciado de cada pregunta. Es el punto de partida que se le
   ofrece al organizador para que corrija en vez de empezar de cero. */
function mapeoSugerido(campos, columnas) {
  const porClave = new Map((columnas || []).map(col => [clave(col), col]));
  const sug = {};
  for (const c of campos || []) {
    const col = porClave.get(clave(c.etiqueta));
    if (col) sug[c.id] = col;
  }
  return sug;
}

/* Cuántas de las filas guardadas no llenarían NI UNA pregunta.
 *
 * Es el número que faltaba: la subida decía cuántas filas guardó y cuántas no
 * traían documento, y con eso un padrón inútil se ve igual que uno bueno. En
 * el caso que lo destapó, 3.624 de 4.124 filas traían sólo nombre y apellidos
 * —nada que el formulario preguntara— y la subida informaba «4.124 personas en
 * el padrón» sin más. */
function filasSinCruce(filasDatos, campos, mapeo = null) {
  let sinCruce = 0;
  for (const datos of filasDatos || []) {
    const { respuestas } = emparejar(datos, campos, mapeo);
    if (Object.keys(respuestas).length === 0) sinCruce++;
  }
  return sinCruce;
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
  limpiarMapeo,
  mapeoSugerido,
  filasSinCruce,
  hashDocumento,
  salDelEvento,
  clave,
  ALIAS_DOCUMENTO,
  extraerDocumento,
  emparejar,
  columnasSinPregunta,
};
