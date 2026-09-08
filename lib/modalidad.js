'use strict';

/* Cómo se llama a un evento presencial.
 *
 * ── El fallo que destapó esto ────────────────────────────────────────────
 *
 * Publicando un concierto desde el Gestbot, el aviso dijo: «Es un evento en
 * línea y no tiene enlace de conexión». Era un concierto en un coliseo.
 *
 * El motivo: la plataforma guarda `fisico` —13 de los 15 eventos de la base—
 * y la herramienta del agente declaraba y escribía `presencial`. Dos nombres
 * para lo mismo, y no había ninguna lista canónica en ninguno de los dos
 * repositorios: cada sitio comparaba contra la cadena que le pareció.
 *
 * ── Lo que se rompía, y no sólo el aviso ─────────────────────────────────
 *
 * El editor del panel enseña los campos de lugar sólo si la modalidad es
 * `fisico` o `hibrido`. Un evento creado por el agente se quedaba **sin
 * dirección visible en su propio editor**, sin ningún error: el campo existía
 * en la base y la pantalla no lo pintaba.
 *
 * ── Por qué se normaliza y no se cambia el enunciado ─────────────────────
 *
 * «Presencial» es como habla la gente, y es lo que va a escribir quien le pida
 * un evento a Claude. Prohibirlo obligaría al modelo a acertar una palabra
 * interna. Se acepta y se traduce al escribir, que es donde importa.
 */

/* Lo que se guarda. Cualquier comparación en el código va contra esto. */
const MODALIDADES = ['fisico', 'virtual', 'hibrido'];
const POR_DEFECTO = 'fisico';

/* Cómo lo dice la gente → cómo se guarda. Sin tildes ni mayúsculas: llega de
   un modelo de lenguaje y de formularios, no de un desplegable. */
const ALIAS = {
  presencial: 'fisico',
  fisica: 'fisico',
  fisico: 'fisico',
  insitu: 'fisico',
  online: 'virtual',
  remoto: 'virtual',
  virtual: 'virtual',
  streaming: 'virtual',
  hibrido: 'hibrido',
  mixto: 'hibrido',
};

const sinTildes = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().toLowerCase();

/* Devuelve siempre algo válido. Una modalidad inventada cae en la de por
   defecto y no en `null`: un evento sin modalidad no se pinta en ninguna parte,
   y eso es peor que uno mal clasificado. */
function normalizarModalidad(valor) {
  return ALIAS[sinTildes(valor)] || POR_DEFECTO;
}

/* Si hay que preguntar por un enlace de conexión. Se pregunta aquí y no
   comparando cadenas sueltas por ahí, que es como nació el fallo. */
function necesitaEnlace(modalidad) {
  return normalizarModalidad(modalidad) !== 'fisico';
}

module.exports = { MODALIDADES, POR_DEFECTO, ALIAS, normalizarModalidad, necesitaEnlace };
