'use strict';

/* Qué tramo de una lista larga se pide, y cómo se contesta.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * Porque el mismo fallo estaba en tres listas del panel, y es de los que no
 * dan error:
 *
 *   asistentes                se servían de 100 en 100 y el panel no mandaba
 *                             página ni la enseñaba. En un evento de 386
 *                             boletas se veían las primeras 100 y la lista
 *                             simplemente terminaba.
 *   inscritos de un taller    tope de 500, sin decirlo
 *   auditoría del evento      tope de 100, sin decirlo
 *
 * Una lista que se corta en silencio es peor que un error y peor que una lista
 * vacía: el error se arregla, el vacío se nota, y esto se cree. Quien buscaba a
 * alguien de la mitad de la lista concluía que no estaba inscrito.
 *
 * Y el saneado de los parámetros estaba escrito a mano en cada una, cada una
 * con su tope y su forma de tratar la basura: `Math.min(Number(limit) || 500,
 * 2000)` en una, `Math.min(Number(limit) || 100, 300)` en otra, y en la tercera
 * `(Number(page) - 1) * Number(limit)` sin red — que con `page=abc` da `NaN`, y
 * `range(NaN, NaN)` no devuelve una lista vacía: revienta la consulta.
 *
 * Tres copias de esto es la forma de que la cuarta lista nazca otra vez sin
 * paginar. Aquí se escribe una vez.
 */

/* Cuántas por página cuando nadie lo pide. Cincuenta: cabe en una pantalla sin
   que la barra de desplazamiento se vuelva un hilo. */
const POR_PAGINA = 50;

/* Tope por petición. Por encima de esto lo que se quiere es una exportación,
   que va por otro camino y sabe que va a tardar. Doscientos deja sitio para que
   el panel recorra la lista entera por tandas cuando necesita el total —el PDF
   de asistentes lo hace— sin abrir la puerta a traerse un evento completo de
   una vez. */
const MAXIMO = 200;

/* Lo que llega por la URL, convertido en un tramo utilizable.
 *
 * Nunca devuelve `NaN` ni negativos: eso es el punto. `porDefecto` y `tope`
 * dejan que una lista concreta pida otra cosa —la auditoría se lee de golpe
 * más a menudo— sin volver a escribir la aritmética. */
function tramoPedido({ limit, page } = {}, { porDefecto = POR_PAGINA, tope = MAXIMO } = {}) {
  const pedido = Math.floor(Number(limit));
  const porPagina = Number.isFinite(pedido) && pedido > 0
    ? Math.min(pedido, tope)
    : Math.min(porDefecto, tope);
  const p = Math.floor(Number(page));
  const pagina = Number.isFinite(p) && p > 0 ? p : 1;
  const desde = (pagina - 1) * porPagina;
  return { porPagina, pagina, desde, hasta: desde + porPagina - 1 };
}

/* Lo que hay que devolver SIEMPRE junto a las filas.
 *
 * `total` es el de la consulta con sus filtros puestos, no el de la tabla: si
 * se está mirando «sin pagar», el número tiene que ser cuántos sin pagar hay.
 * Y `paginas` viaja calculado para que el panel no tenga que dividir —dividir
 * en dos sitios es como se acaba enseñando «página 9 de 8»—. */
function datosDelTramo(tramo, total) {
  const cuantas = Number(total) || 0;
  return {
    total: cuantas,
    pagina: tramo.pagina,
    por_pagina: tramo.porPagina,
    paginas: Math.max(1, Math.ceil(cuantas / tramo.porPagina)),
  };
}

/* Lo que se escribe en una caja de búsqueda, listo para un `or()` de PostgREST.
 *
 * La coma separa las condiciones de un `or()` y los paréntesis lo delimitan:
 * buscar «Pérez, Juan» rompía la consulta entera —un 400 en la cara de quien
 * sólo estaba buscando a alguien—. Se cambian por `%`, que en un `ilike` es «lo
 * que sea», así que «Pérez, Juan» encuentra a «Pérez Juan» y no rompe nada.
 *
 * Lo que NO hace: encontrar «Juan Pérez» buscando «Pérez, Juan». Para eso hay
 * que partir la búsqueda en palabras y exigirlas todas, que es otra cosa y más
 * grande. Aquí se arregla el 400.
 */
function paraBuscar(q) {
  return String(q == null ? '' : q).trim().slice(0, 120).replace(/[,()"\\]/g, '%');
}

/* ── Buscar por palabras, no por trozo literal ──────────────────────────
 *
 * `paraBuscar` deja el texto listo para un `ilike`, y con eso solo la busqueda
 * es una subcadena: el ORDEN importa. Escribir «Perez, Juan» no encuentra a
 * «Juan Perez», que es como esta escrito en la base la mitad de las veces —y
 * quien busca no lo sabe, ni tiene por que—. Contesta «sin resultados» sobre
 * una lista donde la persona esta.
 *
 * Lo mismo con «ana gmail» para encontrar ana@gmail.com, que es como se busca
 * un correo cuando uno recuerda el dominio y no el nombre entero.
 *
 * ── La regla, dicha en una linea ────────────────────────────────────────
 *
 * TODAS las palabras, en el MISMO campo.
 *
 * Es lo que se puede explicar sin mentir: «Juan Perez» encuentra a quien tenga
 * las dos palabras en su nombre, o las dos en su correo. Lo que NO hace es
 * repartirlas entre campos —«Juan» en el nombre y «gmail» en el correo—, y no
 * se hace a proposito: eso empieza a devolver gente que no se parece a lo que
 * se escribio, y una busqueda que devuelve de mas es tan inutil como una que
 * devuelve de menos, solo que mas dificil de notar.
 */

/* Cuatro palabras. A partir de ahi son condiciones que se acumulan en una URL
   y nadie escribe cinco palabras esperando un resultado util. */
const PALABRAS_MAX = 4;

function palabrasDeBusqueda(q) {
  const limpio = paraBuscar(q);
  if (!limpio) return [];
  const palabras = limpio.split(/[\s%]+/).map(w => w.trim()).filter(w => w.length >= 2);
  /* Si no sobrevive ninguna —se busco «a», o dos letras sueltas— se usa el
     texto entero como una sola. Devolver la lista SIN filtrar seria contestar
     «aqui esta todo» a quien pidio algo concreto. */
  if (!palabras.length) return [limpio.replace(/[\s%]+/g, '%')];
  return palabras.slice(0, PALABRAS_MAX);
}

/* La condicion `or()` de PostgREST para una busqueda por palabras.
 *
 * Devuelve `null` cuando no hay nada que filtrar, para que quien llama pueda
 * distinguir «no busques» de «busca esto» sin mirar el texto otra vez. */
function condicionDeTexto(q, campos = []) {
  const palabras = palabrasDeBusqueda(q);
  if (!palabras.length || !campos.length) return null;
  /* Un `and(...)` por campo con todas las palabras, y los campos entre si con
     `or`. Con una sola palabra el `and(...)` sobra pero no estorba, y tenerlo
     siempre evita dos caminos que hay que probar por separado. */
  return campos
    .map(c => `and(${palabras.map(w => `${c}.ilike.%${w}%`).join(',')})`)
    .join(',');
}

/* Aplica la busqueda a una consulta, si hay algo que buscar. */
function filtrarPorTexto(query, q, campos) {
  const cond = condicionDeTexto(q, campos);
  return cond ? query.or(cond) : query;
}

module.exports = {
  tramoPedido, datosDelTramo, paraBuscar,
  palabrasDeBusqueda, condicionDeTexto, filtrarPorTexto,
  PALABRAS_MAX, POR_PAGINA, MAXIMO,
};
