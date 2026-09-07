/* GESTEK — Lo que la persona ya contestó, para no volvérselo a preguntar.
 *
 * ── El mapa de lo que se hereda hoy ──────────────────────────────────────
 *
 * Una persona da sus datos una vez y el evento se los pedía varias. El mapa
 * medido antes de escribir esto, y lo que se hereda ahora:
 *
 *   Sesión abierta → formulario de compra   nada        → identidad
 *   Boleta → inscripción a un sub-evento    identidad   → + respuestas
 *   Boleta → equipo del torneo              nombre y correo → + respuestas
 *   Boleta → ficha de expositor             nombre y correo → + columnas
 *   Padrón por cédula → formulario          ya heredaba las dos cosas
 *
 * O sea: la identidad viajaba a casi todas partes y **las respuestas no
 * viajaban a ninguna**. Si el formulario general pregunta «empresa» y el taller
 * vuelve a preguntar «empresa», se escribía dos veces — y las dos respuestas
 * quedaban en cajas distintas, así que después ni siquiera cuadraban.
 *
 * ── Dónde se hereda: al LEER, no al crear ────────────────────────────────
 *
 * El equipo y la ficha del expositor los crea un disparador de la base en el
 * momento del pago, cuando los campos del torneo pueden no existir todavía.
 * Prellenar al leer el formulario vale también para todo lo creado ANTES —que
 * hoy es todo— y deja la regla en un solo sitio en vez de repartida entre dos
 * triggers en SQL y este módulo en JS.
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

/* ── El otro destino: una ficha con columnas, no con respuestas ──────────
 *
 * La ficha del expositor no guarda un `{campoId: valor}`: tiene columnas con
 * nombre —`contacto_telefono`, `sitio_web`, `categoria_negocio`—. Y quien la
 * abre acaba de contestar un formulario donde muy probablemente ya escribió el
 * teléfono y la página web de su empresa.
 *
 * Así que aquí el cruce es al revés: de la etiqueta que el organizador escribió
 * a la columna que significa. La lista de sinónimos es corta y explícita a
 * propósito — adivinar de más rellena la ficha pública de una empresa con el
 * dato equivocado, y eso lo ve todo el mundo.
 *
 * Sólo se ofrece para RELLENAR HUECOS: lo que la empresa ya escribió en su
 * ficha nunca se toca. Es su ficha.
 */
const COLUMNAS_DE_FICHA = {
  contacto_nombre: ['nombre del contacto', 'persona de contacto', 'contacto', 'representante'],
  contacto_telefono: ['telefono', 'telefono de contacto', 'celular', 'whatsapp', 'numero de contacto'],
  sitio_web: ['sitio web', 'pagina web', 'web', 'url', 'sitio'],
  categoria_negocio: ['sector', 'categoria', 'sector economico', 'categoria de negocio', 'rubro', 'industria'],
  descripcion: ['descripcion', 'a que se dedica', 'que hace tu empresa', 'descripcion de la empresa'],
};

/* Qué columnas de la ficha se pueden rellenar con lo ya contestado.
 *
 * `fichaActual` es la fila como está: lo que ya tenga valor no se propone. */
function prellenarFicha({ sabido = new Map(), fichaActual = {} } = {}) {
  const out = {};
  for (const [columna, sinonimos] of Object.entries(COLUMNAS_DE_FICHA)) {
    if (tieneValor(fichaActual[columna])) continue;       // lo suyo manda
    for (const etiqueta of sinonimos) {
      const v = sabido.get(claveDeEtiqueta(etiqueta));
      /* Sólo texto: una columna de la ficha es una cadena, y meterle una lista
         la guardaría como «[object Object]» a la vista de todo el mundo. */
      if (typeof v === 'string' && v.trim()) { out[columna] = v.trim(); break; }
    }
  }
  return out;
}

module.exports = {
  TIPOS_QUE_NO_SE_HEREDAN, claveDeEtiqueta, tieneValor,
  porEtiqueta, prellenar, cabeEnElCampo, prellenarValidando,
  COLUMNAS_DE_FICHA, prellenarFicha,
};
