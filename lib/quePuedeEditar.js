'use strict';

/* Qué parte del evento puede tocar cada permiso.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * De capacitar a quien lleva la logística de un evento real: hubo que darle
 * permisos **muy altos** para que pudiera operar. La razón está medida:
 * `editar_evento` aparece en once archivos de rutas, y en cinco sitios es el
 * ÚNICO permiso que abre la puerta. O sea que para dejar que alguien suba un
 * documento, diseñe una escarapela o cargue el padrón de invitados, hay que
 * darle además: editar el evento entero, su formulario de compra, las vacantes,
 * la configuración del SMTP y la del torneo.
 *
 * Eso no es un permiso, es una llave maestra con otro nombre.
 *
 * ── El mecanismo, que ya existía a medias ───────────────────────────────
 *
 * `PUT /eventos/:id` guarda columnas sueltas y además `page_json`, que es un
 * cajón donde vive media plataforma: la landing, las puertas, los documentos,
 * el diseño de las escarapelas, el proceso de compra. Abrir `page_json` entero
 * a quien sólo tiene que subir un PDF le deja reescribir la landing.
 *
 * Ya había un recorte para eso —`gestionar_accesos` abría `page_json` y luego
 * se le dejaba sólo la clave `accesos`— pero estaba escrito como una
 * adivinanza: «tiene page_json y no tiene branding, luego es accesos». Con un
 * segundo permiso estrecho esa adivinanza falla en silencio y el nuevo permiso
 * acaba escribiendo en `accesos`.
 *
 * Aquí cada permiso estrecho DICE qué claves abre. Añadir uno es añadir una
 * línea, no reinterpretar una condición.
 */

/* Los permisos que abren `page_json` sólo por una rendija, y cuál.
 *
 * La regla para entrar en esta tabla: la pantalla guarda en `page_json` pero lo
 * que hace NO es editar el evento. Subir un contrato no es editar el evento;
 * diseñar la escarapela con la que se entra, tampoco. */
const LLAVES_ESTRECHAS = {
  /* Las puertas del evento. Configurarlas es logística, no la página pública. */
  gestionar_accesos: ['accesos'],
  /* Contratos, riders, planos. La pestaña se abre con `ver_documentos` —que
     todos los roles tienen— y hasta hoy subir uno pedía `editar_evento`. */
  gestionar_documentos: ['documentos'],
  /* El diseño de la escarapela y del carné, que viven en `wallet`. `puntos`
     va con ellos porque la pantalla del carné los guarda en el mismo gesto. */
  gestionar_acreditacion: ['wallet', 'puntos', 'credenciales'],
};

/* Los permisos que abren `page_json` ENTERO. Los dos son amplios a propósito:
   uno es «esta es tu página» y el otro «este es tu evento». */
const LLAVES_TODAS = ['editar_pagina_publica', 'editar_evento'];

/* Qué claves de `page_json` puede escribir este conjunto de permisos.
 *
 * `null` significa «todas»: es lo que devuelve para el dueño y para quien tiene
 * uno de los dos permisos amplios. Un `Set` vacío significa que no puede tocar
 * `page_json` en absoluto — que no es lo mismo, y confundirlos es la diferencia
 * entre no dejar pasar a nadie y dejar pasar a todo el mundo. */
function llavesDePageJson(perms) {
  if (!perms || perms.has('*')) return null;
  if (LLAVES_TODAS.some(p => perms.has(p))) return null;

  const llaves = new Set();
  for (const [permiso, suyas] of Object.entries(LLAVES_ESTRECHAS)) {
    if (perms.has(permiso)) for (const k of suyas) llaves.add(k);
  }
  return llaves;
}

/* Recorta lo que se va a guardar a las claves permitidas.
 *
 * Devuelve `{ page_json }` con lo que sobrevive, o `{ error }` si no queda
 * nada: guardar en silencio un objeto vacío le diría a quien lo intentó que su
 * cambio se guardó. */
function recortarPageJson(entrante, llaves) {
  if (llaves === null) return { page_json: entrante };
  if (!entrante || typeof entrante !== 'object') return { page_json: entrante };

  const recortado = {};
  for (const k of Object.keys(entrante)) {
    if (llaves.has(k)) recortado[k] = entrante[k];
  }
  if (!Object.keys(recortado).length) {
    const lista = [...llaves];
    return {
      error: lista.length
        ? `Tu rol sólo puede cambiar ${lista.join(', ')} de este evento.`
        : 'Tu rol no puede cambiar la configuración de este evento.',
    };
  }
  return { page_json: recortado };
}

module.exports = { LLAVES_ESTRECHAS, LLAVES_TODAS, llavesDePageJson, recortarPageJson };
