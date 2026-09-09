'use strict';

/* Qué es cada boleta, dicho en la lista de compra.
 *
 * ── El problema ──────────────────────────────────────────────────────────
 *
 * Un evento con cuatro boletas las enseña en una lista plana:
 *
 *     Registro Festech 2026            Gratis   [Regístrate]
 *     Encuentro de Mujeres en la Ciencia  Gratis   [Regístrate]
 *     PijaoHub DemoDay                 Gratis   [Regístrate]
 *     PijaoTech                        Gratis   [Regístrate]
 *
 * Y nada dice cuál es la entrada al evento y cuáles son actividades de dentro.
 * Quien llega ve cuatro cosas iguales y elige una: se inscribe al DemoDay sin
 * entrada, o pide las cuatro «por si acaso». Queda a interpretación, y la
 * interpretación equivocada se descubre en la puerta.
 *
 * ── Por qué hace falta un campo y no se puede deducir ────────────────────
 *
 * Porque en la base son idénticas. `crea` dice qué se crea al pagarse —un
 * stand, un equipo— y eso distingue algunas, pero «Encuentro de Mujeres» y
 * «Registro general» son las dos `crea: nada`. No hay nada que mirar.
 *
 * ── Y por qué NO es la forma buena de montarlo ───────────────────────────
 *
 * Conviene decirlo aquí, donde se va a leer: la plataforma ya tiene otro
 * modelo para esto, y es mejor. La 0055 lo dejó escrito —«no se crea otra
 * boletería paralela: la boleta del evento sigue siendo la llave; lo que se
 * añade es la INSCRIPCIÓN a un sub-evento, con su propio cupo, sin emitir tres
 * códigos más»—. Con inscripciones, una persona tiene UNA escarapela y se
 * apunta a los talleres que quiera.
 *
 * Montar cada actividad como un tipo de boleta aparte da tres códigos QR a la
 * misma persona, y en la puerta nadie sabe cuál enseñar.
 *
 * Pero es lo que hay montado en eventos que ya vendieron cientos de boletas, y
 * remodelarlos a mitad de camino no es una opción. Así que esto hace lo
 * segundo mejor: que la lista DIGA lo que cada boleta es.
 */

/* Los tres papeles que puede tener una boleta.
 *
 * `entrada` es el valor por defecto y es lo que hoy hacen todas: así ningún
 * evento cambia de aspecto hasta que alguien decida marcar algo. */
const ROLES = {
  entrada: {
    etiqueta: 'Entrada al evento',
    titulo: 'Entrada al evento',
    ayuda: null,
  },
  actividad: {
    etiqueta: 'Actividad',
    titulo: 'Actividades dentro del evento',
    /* La frase que evita el error caro: alguien que se inscribe a un taller y
       se presenta el día del evento sin entrada. */
    ayuda: 'Necesitas además tu entrada al evento.',
  },
  extra: {
    etiqueta: 'Complemento',
    titulo: 'Complementos',
    ayuda: 'Se suma a tu entrada.',
  },
};

const ORDEN = ['entrada', 'actividad', 'extra'];

const rolValido = (r) => (Object.prototype.hasOwnProperty.call(ROLES, r) ? r : 'entrada');

/* Lo que ya se sabe de una boleta sin que nadie lo declare.
 *
 * `crea` es un dato real y viejo: una boleta que crea un equipo es una
 * postulación, y una que crea un stand trae un stand. Decirlo en la tarjeta no
 * necesita ninguna migración y ya distingue las que se pueden distinguir. */
const QUE_TRAE = {
  stand: 'Incluye stand de expositor',
  equipo: 'Postulación de equipo',
};
const queTrae = (crea) => QUE_TRAE[crea] || null;

/* Qué papel PARECE tener una boleta, para proponérselo al organizador.
 *
 * Sólo se usa como sugerencia en el panel, nunca en la página pública: la
 * página dice lo que está declarado, y si no hay nada declarado no se inventa
 * un encabezado que puede estar mal. Adivinarle al público es peor que no
 * agrupar. */
function sugerirRol(tipo = {}) {
  if (tipo.crea === 'equipo') return 'actividad';
  if (tipo.crea === 'stand') return 'extra';
  return 'entrada';
}

/* La lista agrupada, tal como se va a pintar.
 *
 * Devuelve `null` si NO hay que agrupar, y ése es el caso normal: un evento con
 * una sola boleta, o con varias que son todas entradas, no gana nada con
 * encabezados. Poner «Entrada al evento» encima de una única boleta es ruido
 * que hay que leer.
 */
function agrupar(tipos = []) {
  const conRol = tipos.map(t => ({ ...t, rol: rolValido(t.rol) }));
  const presentes = ORDEN.filter(r => conRol.some(t => t.rol === r));
  if (presentes.length < 2) return null;

  return presentes.map(rol => ({
    rol,
    titulo: ROLES[rol].titulo,
    ayuda: ROLES[rol].ayuda,
    tipos: conRol.filter(t => t.rol === rol),
  }));
}

module.exports = { ROLES, ORDEN, rolValido, queTrae, QUE_TRAE, sugerirRol, agrupar };
