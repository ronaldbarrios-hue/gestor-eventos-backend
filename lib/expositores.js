'use strict';

/* GESTEK — La ficha de un stand, en un solo sitio.
 *
 * ── Por qué existe este archivo ────────────────────────────────────────────
 *
 * La lista de columnas de `networking_expositores` estaba copiada a mano en
 * diez sitios: el panel del organizador, el directorio público de la landing,
 * la rueda de negocios, el pasaporte, el ranking, `/me/expositor` y la
 * herramienta MCP. Cada copia decidía por su cuenta qué campos existen.
 *
 * Ya se pagó una vez. La cabecera de `routes/networking.js` cuenta la autopsia:
 * nueve campos —contacto, redes, tipo de persona— se guardaban bien y no se
 * volvían a ver nunca, porque el SELECT del panel no los devolvía. En el panel
 * parecía que la ficha no tuviera contacto, y de ahí salió la idea de que
 * había que "ampliarla"; lo que hacía falta era devolverla.
 *
 * `zona_id` (0088) reproducía el mismo patrón, ahora en diez copias a la vez:
 * bastaba olvidar una para que un stand tuviera zona en una pantalla y no en
 * otra. Así que las listas viven aquí y se importan. La próxima columna que se
 * añada a la ficha se ve en todas partes por defecto.
 *
 * Vive en `lib/` y no en `routes/networking.js` porque lo necesitan también
 * `eventos.publicos.js`, `me.js`, `interacciones.js` y `agente.js`, y las
 * rutas no se importan entre sí. Mismo criterio que `aforoZonas.js`.
 */

/* ── Lectura ───────────────────────────────────────────────────────────────
   Tres alcances, del más pequeño al más grande. Se eligen por lo que la
   pantalla enseña, no por quién la mira: el gate de permisos es cosa de la
   ruta. */

/* La tarjeta mínima: quién es y dónde está. Es lo que necesitan el pasaporte,
   los rankings y la lista de la rueda de negocios. */
const COLS_TARJETA = 'id, nombre, logo_url, stand, zona_id';

/* El directorio público de la landing: la tarjeta más lo que el visitante usa
   para decidir a qué stand acercarse. Nada de contacto ni de cuotas: eso es
   del organizador, no del público. */
const COLS_DIRECTORIO = `id, nombre, descripcion, logo_url, galeria, stand, zona_id,
  tipo_persona, sitio_web, redes, categoria_negocio, orden`;

/* Todo lo que se puede guardar, para poder leerlo también. Es el select del
   panel del organizador, y la regla que lo mantiene honesto es que tiene que
   cubrir `CAMPOS_EDITABLES_ORGANIZADOR` entero. */
const COLS_COMPLETAS = `id, nombre, descripcion, logo_url, stand, zona_id, sitio_web,
  categoria_negocio, contacto_nombre, contacto_email, contacto_telefono,
  tipo_persona, redes, galeria, cuota_puntos, activo, estado_ficha, ticket_id, orden`;

/* ── Escritura ─────────────────────────────────────────────────────────────
   Las dos listas son distintas A PROPÓSITO, y por eso están juntas: separadas
   en dos archivos, nadie las compara y la asimetría se pierde. */

/* Lo que puede tocar el organizador desde el panel. */
const CAMPOS_EDITABLES_ORGANIZADOR = ['nombre', 'descripcion', 'logo_url', 'stand',
  'zona_id', 'sitio_web', 'categoria_negocio', 'contacto_nombre', 'contacto_email',
  'contacto_telefono', 'tipo_persona', 'redes', 'galeria', 'activo', 'estado_ficha', 'orden'];

/* Lo que puede tocar la EMPRESA en su propia ficha, desde el enlace público
   con el código de su boleta.
   `zona_id` NO está, y no es un olvido: dónde se monta cada stand es una
   decisión del plano del evento, que toma quien lo organiza. Un expositor
   pudiendo cambiar su zona se movería de sitio en el mapa del visitante.
   Misma razón por la que tampoco puede tocar `activo` ni `estado_ficha`. */
const CAMPOS_EDITABLES_EXPOSITOR = ['nombre', 'descripcion', 'logo_url', 'stand',
  'tipo_persona', 'contacto_nombre', 'contacto_email', 'contacto_telefono',
  'sitio_web', 'redes', 'categoria_negocio', 'galeria'];

/* ── La zona, resuelta ─────────────────────────────────────────────────────

   Añade `zona_nombre` a cada ficha a partir de las zonas declaradas del evento
   (las que devuelve `zonasDelEvento`). Gemelo de `agendaPorZona`.

   Una ficha cuya zona ya no existe —el organizador la borró del plano— sale
   con `zona_nombre: null` y NO se descarta: la ficha existe y el stand existe,
   lo único inservible es su ubicación. Filtrarla haría desaparecer del
   directorio a un expositor de verdad por un dato de más que se quedó viejo. */
function conZona(fichas, zonas) {
  const porId = new Map((Array.isArray(zonas) ? zonas : []).map(z => [z.id, z]));
  return (Array.isArray(fichas) ? fichas : []).map(f => ({
    ...f,
    zona_nombre: (f && f.zona_id && porId.get(f.zona_id)?.nombre) || null,
  }));
}

/* Los stands de cada zona, indexados por zona. Es lo que le falta al mapa en
   vivo para contestar "qué hay AHORA aquí" entero: `agendaPorZona` ya pone lo
   que ocurre, esto pone quién está montado.

   Sólo se devuelven las zonas pedidas: un stand con `zona_id` huérfano no
   aparece en ninguna, que es el mismo contrato que sigue el resto del mapa. */
function standsPorZona(fichas, zonas) {
  const salida = {};
  for (const z of (Array.isArray(zonas) ? zonas : [])) salida[z.id] = [];
  for (const f of (Array.isArray(fichas) ? fichas : [])) {
    if (f && f.zona_id && salida[f.zona_id]) salida[f.zona_id].push(f);
  }
  return salida;
}

module.exports = {
  COLS_TARJETA,
  COLS_DIRECTORIO,
  COLS_COMPLETAS,
  CAMPOS_EDITABLES_ORGANIZADOR,
  CAMPOS_EDITABLES_EXPOSITOR,
  conZona,
  standsPorZona,
};
