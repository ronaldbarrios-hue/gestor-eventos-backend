/* GESTEK — Lo que la persona ya contestó, para no volvérselo a preguntar.
 *
 * ── El mapa de lo que se hereda hoy ──────────────────────────────────────
 *
 * Una persona da sus datos una vez y el evento se los pide varias. Medido:
 *
 *   Boleta → inscripción a un sub-evento   identidad SÍ · respuestas NO
 *   Boleta → ficha de expositor (trigger)  nombre y correo SÍ · respuestas NO
 *   Boleta → equipo del torneo (trigger)   nombre y correo SÍ · respuestas NO
 *
 * O sea: la identidad viaja a todas partes y **las respuestas no viajan a
 * ninguna**. Si el formulario general pregunta «empresa» y el taller vuelve a
 * preguntar «empresa», la escribe dos veces — y las dos respuestas quedan en
 * cajas distintas, así que después ni siquiera cuadran.
 *
 * ── Por qué se cruza por ETIQUETA y no por id ────────────────────────────
 *
 * Son campos distintos en filas distintas: el «Empresa» del evento y el
 * «Empresa» del taller no comparten id ni lo pueden compartir. Lo único que
 * los une es lo que la persona lee, que es la etiqueta. Se normaliza —tildes,
 * mayúsculas, espacios de más, dos puntos finales— porque quien escribió los
 * dos formularios es la misma persona en dos momentos distintos, y «Empresa:»
 * y «empresa» son el mismo campo para todo el mundo menos para un `===`.
 *
 * ── Lo que NO se hereda, a propósito ─────────────────────────────────────
 *
 * · Las casillas de aceptar términos. Un consentimiento se da para algo
 *   concreto; arrastrarlo a otra inscripción es firmar por alguien.
 * · Lo que ya venía escrito. Si quien rellena el formulario cambió algo, manda
 *   lo suyo: esto rellena huecos, no corrige a nadie.
 * · Los tipos que no se pueden prellenar sin equivocarse — un archivo subido no
 *   es un valor que se copie.
 */

'use strict';

/* Tipos que no viajan. `checkbox` cubre la aceptación de términos, que es el
   caso que importa; `archivo` porque un adjunto no es un texto que se copie. */
const TIPOS_QUE_NO_SE_HEREDAN = new Set(['checkbox', 'archivo', 'file']);

/* La etiqueta, reducida a lo que de verdad la identifica. */
function claveDeEtiqueta(etiqueta) {
  return String(etiqueta || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin tildes
    .toLowerCase()
    .replace(/[*:¿?¡!().]/g, ' ')                        // «Empresa:» = «Empresa»
    .replace(/\s+/g, ' ')
    .trim();
}

/* Un valor que de verdad se puede heredar. `false` y `0` son respuestas dadas
   y tienen que sobrevivir; `''`, `null` y una lista vacía son huecos. */
function tieneValor(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/* Lo ya contestado, indexado por etiqueta.
 *
 * `campos` son los campos del formulario DONDE se contestó (para saber cómo se
 * llamaba cada id) y `respuestas` es el `{ id: valor }` guardado. */
function porEtiqueta(campos = [], respuestas = {}) {
  const m = new Map();
  for (const c of campos) {
    if (TIPOS_QUE_NO_SE_HEREDAN.has(c?.tipo)) continue;
    const v = respuestas?.[c?.id];
    if (!tieneValor(v)) continue;
    const k = claveDeEtiqueta(c.etiqueta);
    /* La primera gana: si un formulario repite una etiqueta, la de arriba es la
       que la persona leyó primero. */
    if (k && !m.has(k)) m.set(k, v);
  }
  return m;
}

/* Qué se puede prellenar en ESTE formulario.
 *
 * Devuelve sólo `{ id: valor }` de los campos que este formulario pregunta —
 * igual que el prellenado por documento: lo que se sepa de más no sale nunca.
 *
 * `yaEscrito` es lo que quien rellena ya puso a mano; esas claves no se tocan.
 */
function prellenar({ camposDestino = [], sabido = new Map(), yaEscrito = {} } = {}) {
  const out = {};
  for (const c of camposDestino) {
    if (!c?.id) continue;
    if (TIPOS_QUE_NO_SE_HEREDAN.has(c.tipo)) continue;
    if (tieneValor(yaEscrito[c.id])) continue;          // manda lo escrito
    const v = sabido.get(claveDeEtiqueta(c.etiqueta));
    if (tieneValor(v)) out[c.id] = v;
  }
  return out;
}

/* Un valor heredado tiene que seguir siendo válido en el destino: una lista de
   opciones puede haber cambiado entre un formulario y otro, y meter un valor
   que ya no está entre las opciones deja un campo que parece contestado y el
   servidor rechaza al enviar. */
function cabeEnElCampo(campo, valor) {
  const ops = Array.isArray(campo?.opciones) ? campo.opciones : null;
  if (!ops || ops.length === 0) return true;
  const lista = ops.map(o => (typeof o === 'string' ? o : o?.valor ?? o?.label));
  if (Array.isArray(valor)) return valor.every(v => lista.includes(v));
  return lista.includes(valor);
}

/* Lo mismo que `prellenar`, descartando lo que no cabe en el destino. */
function prellenarValidando(args) {
  const bruto = prellenar(args);
  const porId = new Map((args?.camposDestino || []).map(c => [c.id, c]));
  const out = {};
  for (const [id, v] of Object.entries(bruto)) {
    if (cabeEnElCampo(porId.get(id), v)) out[id] = v;
  }
  return out;
}

module.exports = {
  TIPOS_QUE_NO_SE_HEREDAN, claveDeEtiqueta, tieneValor,
  porEtiqueta, prellenar, cabeEnElCampo, prellenarValidando,
};
