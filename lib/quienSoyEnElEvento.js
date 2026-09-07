/* GESTEK — La misma persona, con cuenta y sin ella.
 *
 * ── La relación que no existía ───────────────────────────────────────────
 *
 * Comprar una boleta es anónimo a propósito: de la mayoría de asistentes lo
 * único que queda es su correo (`guest_email`, con `user_id` en nulo). Y desde
 * la 0108, el equipo puede sentar a alguien en la rueda por ese mismo correo.
 *
 * Después esa persona se crea una cuenta con EL MISMO correo — y todo lo que
 * la busca por `user_id` deja de encontrarla. Entra a «Mis citas» y ve cero
 * citas teniendo tres. No falla nada: la fila está, y quien la busca mira
 * dónde no está.
 *
 * `/me/boletas` ya lo resolvía mirando por los dos lados. Esto es lo mismo,
 * escrito una vez, para todo lo demás que pregunta «¿qué es mío?».
 *
 * ── Por qué NO se adopta la fila al entrar ───────────────────────────────
 *
 * Sería tentador: al iniciar sesión, poner `user_id` en toda fila con ese
 * `guest_email`. No se hace, y es a propósito. Escribir sobre boletas y citas
 * ajenas en cada login es una operación grande disparada por algo tan común
 * como entrar, y basta un correo repetido en dos cuentas —o una mayúscula mal
 * comparada— para que alguien se lleve las boletas de otro. Leer por los dos
 * lados da el mismo resultado y no escribe nada.
 */

'use strict';

/* El filtro de PostgREST para «lo de esta persona», mire donde mire.
 *
 * Se usa como `query.or(filtroDeMio(user))`. El correo va en minúsculas porque
 * así se guarda al comprar; comparar sin normalizar deja fuera a quien escribió
 * su correo con una mayúscula. */
function filtroDeMio(user, columnaEmail = 'guest_email') {
  const id = user?.id;
  const email = String(user?.email || '').toLowerCase().trim();
  const partes = [];
  if (id) partes.push(`user_id.eq.${id}`);
  if (email) partes.push(`${columnaEmail}.eq.${email}`);
  return partes.join(',');
}

/* ¿Esta fila es de esta persona? Para comprobar después de leer, cuando la
   consulta ya se hizo por otro camino. */
function esMia(fila, user) {
  if (!fila || !user) return false;
  if (fila.user_id && user.id && fila.user_id === user.id) return true;
  const email = String(user.email || '').toLowerCase().trim();
  return Boolean(email && String(fila.guest_email || '').toLowerCase() === email);
}

module.exports = { filtroDeMio, esMia };
