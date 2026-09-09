'use strict';

/* Los sitios accesibles, y si están donde deben.
 *
 * ── Por qué esto no es una casilla más ───────────────────────────────────
 *
 * Marcar un sitio como accesible es fácil y no sirve de nada por sí solo. Lo
 * que de verdad falla es DÓNDE están: la forma normal de incumplir es poner los
 * treinta y seis juntos en una esquina del fondo, en la localidad más barata, y
 * dar el asunto por resuelto.
 *
 * Las ADA Standards for Accessible Design lo dicen con dos reglas, y la segunda
 * es la que nadie comprueba:
 *
 *   CUÁNTOS   desde 5.000 asientos, al menos 36 espacios para silla de ruedas,
 *             más uno por cada 200 asientos por encima de 5.000.
 *   DÓNDE     repartidos horizontal y verticalmente, por niveles y por bandas
 *             de precio.
 *
 * Es norma de EE. UU. y aquí no obliga, pero da el patrón, y ninguna de las
 * plataformas del sector lo revisa sola. Por eso esto AVISA y no impide: quien
 * organiza sabrá si su recinto tiene una razón; lo que no puede es no enterarse.
 *
 * ── Y el acompañante ─────────────────────────────────────────────────────
 *
 * Un espacio de silla de ruedas sin asiento de acompañante al lado obliga a
 * quien va con alguien a separarse de su acompañante. Se cuenta aparte porque
 * es un fallo distinto y se arregla distinto.
 */

/* El umbral y la proporción de la norma. En constantes con nombre para que se
   pueda cambiar cuando Colombia fije los suyos, sin buscar números sueltos. */
const DESDE_AFORO = 5000;
const MINIMO_BASE = 36;
const UNO_CADA = 200;

/* Cuántos espacios de silla de ruedas tocan para un aforo. */
function cuantosTocan(aforo) {
  const n = Number(aforo);
  if (!Number.isFinite(n) || n <= 0) return 0;
  /* Por debajo del umbral la norma usa una tabla por tramos que no es esta
     cuenta. Devolver 0 aquí no dice «ninguno»: dice «esta regla no aplica», y
     quien llama lo distingue por `aplica`. */
  if (n < DESDE_AFORO) return 0;
  return MINIMO_BASE + Math.floor((n - DESDE_AFORO) / UNO_CADA);
}

/* Un espacio es accesible si lo dice su ficha. Vive en `atributos` y no en una
   columna porque `atributos` es justo para esto —lo que distingue un sitio de
   otro sin cambiar el esquema— y porque mañana habrá «visión reducida» o
   «acceso sin escaleras» y no se va a migrar por cada uno. */
const esAccesible = (e) => Boolean(e?.atributos?.accesible);
const esAcompanante = (e) => Boolean(e?.atributos?.acompanante);

/* ── El reparto ──────────────────────────────────────────────────────────
 *
 * «Repartidos» se comprueba contra las dos cosas que el plano ya sabe: de qué
 * BLOQUE cuelga cada sitio, y a qué LOCALIDAD pertenece —o sea, su precio—.
 *
 * No se inventa una medida de distancia: dos sitios accesibles en extremos
 * opuestos de la misma tribuna barata están «lejos» y siguen incumpliendo el
 * espíritu de la norma, que es que quien usa silla de ruedas pueda elegir
 * sección y precio como cualquiera.
 */
function revisar({ espacios = [], localidades = new Map(), aforo = null } = {}) {
  const vendibles = espacios.filter(e => e.modo === 'vendible');
  const accesibles = vendibles.filter(esAccesible);
  const acompanantes = vendibles.filter(esAcompanante);

  const total = Number(aforo) || vendibles.reduce((n, e) => n + (Number(e.capacidad) || 1), 0);
  const tocan = cuantosTocan(total);

  const bloques = new Set(accesibles.map(e => e.parent_id || '__sueltos__'));
  const bloquesConSitios = new Set(vendibles.map(e => e.parent_id || '__sueltos__'));
  const preciosAccesibles = new Set(accesibles.map(e => localidades.get(e.id)).filter(Boolean));
  const preciosTodos = new Set(vendibles.map(e => localidades.get(e.id)).filter(Boolean));

  const avisos = [];

  if (tocan > 0 && accesibles.length < tocan) {
    avisos.push({
      clave: 'faltan',
      texto: accesibles.length === 0
        ? `Un recinto de ${total.toLocaleString('es-CO')} personas necesita al menos ${tocan} espacios accesibles, y no hay ninguno marcado.`
        : `Hay ${accesibles.length} espacios accesibles y para ${total.toLocaleString('es-CO')} personas tocarían ${tocan}.`,
    });
  }

  /* Amontonados. Sólo tiene sentido decirlo si el recinto tiene más de un
     bloque: en una sala de un solo espacio, «repartidos» no significa nada. */
  if (accesibles.length >= 2 && bloquesConSitios.size > 1 && bloques.size === 1) {
    avisos.push({
      clave: 'amontonados',
      texto: `Los ${accesibles.length} espacios accesibles están todos en la misma zona. La norma pide repartirlos por el recinto.`,
    });
  }

  /* Todos en la misma banda de precio. Es la forma más común de incumplir sin
     darse cuenta: se ponen todos en la localidad más barata. */
  if (accesibles.length >= 2 && preciosTodos.size > 1 && preciosAccesibles.size === 1) {
    avisos.push({
      clave: 'un_solo_precio',
      texto: 'Todos los espacios accesibles están en la misma localidad. Tienen que existir en varias bandas de precio.',
    });
  }

  if (accesibles.length > 0 && acompanantes.length === 0) {
    avisos.push({
      clave: 'sin_acompanante',
      texto: 'Ningún sitio está marcado como acompañante. Sin ellos, quien use silla de ruedas tiene que separarse de quien lo acompaña.',
    });
  }

  return {
    /* `aplica` distingue «cumple» de «esta regla no es para este recinto». Sin
       esa distinción, un salón de 200 personas saldría en verde por una norma
       que ni siquiera se le aplica, y eso engaña. */
    aplica: tocan > 0,
    aforo: total,
    tocan,
    accesibles: accesibles.length,
    acompanantes: acompanantes.length,
    zonas: bloques.size,
    localidades: preciosAccesibles.size,
    avisos,
    ok: avisos.length === 0,
  };
}

module.exports = {
  DESDE_AFORO, MINIMO_BASE, UNO_CADA,
  cuantosTocan, esAccesible, esAcompanante, revisar,
};
