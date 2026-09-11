'use strict';

/* ¿Este valor cambiaría algo si se guardara?
 *
 * ── Para qué hace falta ──────────────────────────────────────────────────
 *
 * Al guardar un evento, la ruta descarta los campos que tu rol no puede tocar
 * y responde 200. O sea que quien cambiaba la portada junto al título veía
 * «Guardado», el título cambiaba, y la portada se quedaba igual. Sin error.
 *
 * Lo obvio sería rechazar cualquier campo no permitido. No se puede: hay diez
 * pantallas que mandan el evento ENTERO para tocar una cosa —el plano, los
 * stands, la acreditación—, así que rechazar por mandarlo las rompería todas.
 * Hoy funcionan porque lo que no pueden tocar llega con el mismo valor que ya
 * estaba guardado.
 *
 * Así que la pregunta no es «¿puedes mandar esto?» sino «¿esto cambiaría algo?».
 * Sólo si cambia algo Y no puedes, se dice que no.
 *
 * ── Por qué no vale `===` ni `JSON.stringify` a secas ────────────────────
 *
 * Porque un falso «sí cambió» convierte un guardado que hoy funciona en un 403.
 * Los tres casos que lo provocarían:
 *
 *   · `null` y `''` — la base guarda null y los formularios mandan '' cuando el
 *     campo está vacío. Son lo mismo.
 *   · `120` y `'120'` — un `<input type="number">` manda texto.
 *   · `{a:1,b:2}` y `{b:2,a:1}` — el mismo objeto con las claves en otro orden.
 *     `JSON.stringify` los ve distintos y no lo son.
 *
 * Las fechas se comparan como instante: `2026-09-18T10:00:00Z` y
 * `2026-09-18T10:00:00.000Z` son la misma hora escrita de dos maneras.
 */

/* Vacío es vacío: null, undefined y '' son la misma ausencia de valor. */
const vacio = (v) => v === null || v === undefined || v === '';

/* JSON con las claves ordenadas, a cualquier profundidad. Los arrays NO se
   ordenan: en `links` y `gallery` el orden es el que se ve en pantalla, así
   que cambiarlo sí es un cambio. */
function canonico(v) {
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort()
      .map(k => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

const NUMERO = /^-?\d+(\.\d+)?$/;

/* Sólo se comparan como fecha las cadenas que EMPIEZAN por año-mes-día. Sin
   esto, `Date` acepta cosas como «5» o «marzo» y dos textos distintos pasarían
   por la misma fecha. */
const FECHA = /^\d{4}-\d{2}-\d{2}/;

function mismoValor(a, b) {
  if (vacio(a) && vacio(b)) return true;
  if (vacio(a) !== vacio(b)) return false;

  if (typeof a === 'object' || typeof b === 'object') return canonico(a) === canonico(b);

  const sa = String(a), sb = String(b);
  if (sa === sb) return true;

  if (typeof a === 'boolean' || typeof b === 'boolean') return false;

  if (NUMERO.test(sa) && NUMERO.test(sb)) return Number(sa) === Number(sb);

  if (FECHA.test(sa) && FECHA.test(sb)) {
    const ta = Date.parse(sa), tb = Date.parse(sb);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta === tb;
  }

  return false;
}

/* De los campos que se mandan y no se pueden tocar, cuáles cambiarían algo.
   Devuelve los nombres, para poder decirlos. */
function loQueDeVerdadCambia(campos, entrante, guardado) {
  return campos.filter(k => !mismoValor(guardado?.[k], entrante?.[k]));
}

module.exports = { mismoValor, loQueDeVerdadCambia, canonico };
