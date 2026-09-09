'use strict';

/* El mapa de un concierto.
 *
 * ── Por qué esto no es «un plano genérico» ───────────────────────────────
 *
 * Un plano de boda son mesas. Un plano de teatro son butacas numeradas. Un
 * concierto es otra cosa, y tiene un vocabulario fijo que se repite en todos:
 *
 *   TARIMA     no se vende, pero sin ella el mapa no se entiende: es lo que
 *              dice dónde está el frente, y por tanto qué sitio es mejor.
 *   PISTA      la general de pie, delante. No tiene sillas: cuenta gente.
 *              Suele partirse en «General A» y «General B» por precio.
 *   TRIBUNA    los bloques numerados que envuelven —«122», «203»—. El primer
 *              nivel del mapa es esto, y dentro van las butacas.
 *   PALCO      una unidad que se vende entera y entran varios.
 *
 * ── La regla que ordena todo esto ────────────────────────────────────────
 *
 * Las zonas de precio se agrupan por CALIDAD DE VISUAL, y se definen ANTES que
 * los precios. Al revés —poner precios y luego agrupar— salen bandas de precio
 * partiendo una misma tribuna por la mitad, que es lo que hace que alguien
 * pague más que su vecino de al lado sin motivo visible.
 *
 * Y la numeración copia la SEÑALÉTICA del edificio, no una numeración bonita:
 * si el recinto dice «108, fila F, asiento 14», el mapa dice eso mismo. Quien
 * llega con su boleta busca el número que está pintado en la pared.
 *
 * ── Lo que este archivo hace y lo que no ─────────────────────────────────
 *
 * Propone una plantilla: un punto de partida con las formas ya colocadas para
 * que nadie empiece delante de un lienzo vacío. NO es el recinto: el recinto se
 * termina calcando el plano de verdad encima y moviendo lo que haga falta.
 *
 * No toca la base. Devuelve espacios, y quien los guarda es la ruta.
 */

const geo = require('./geometriaDelPlano.js');

/* El vocabulario. `tipo` en `espacios` es texto libre a propósito —cada recinto
   nombra lo suyo— pero estos cuatro se conocen, y por eso se pueden dibujar y
   contar distinto. */
const PIEZAS = {
  tarima:  { modo: 'aforo',     vende: false, etiqueta: 'Tarima' },
  pista:   { modo: 'aforo',     vende: false, etiqueta: 'Pista / general' },
  tribuna: { modo: 'aforo',     vende: false, etiqueta: 'Tribuna' },
  palco:   { modo: 'vendible',  vende: true,  etiqueta: 'Palco' },
};

/* Cuánto mide el recinto de la plantilla. Son unidades del plano, sin unidad
   física: el SVG encuadra por el contenido. Lo que importa es la PROPORCIÓN
   entre la tarima, la pista y los anillos — que es lo que hace que se reconozca
   como un concierto y no como una diana.
 *
 * ── El centro de los arcos es LA TARIMA ─────────────────────────────────
 *
 * Y no un punto en medio del público. Se dibujó primero al revés y el error se
 * ve de lejos: la general daba la vuelta y pasaba POR DETRÁS del escenario,
 * porque las coronas crecían desde un centro que estaba entre la gente.
 *
 * Puesto el centro en la tarima, todo cae solo: cada anillo se aleja del
 * escenario, las filas curvan abrazándolo —cóncavas hacia él, que es como están
 * en un recinto de verdad— y ninguna sección puede acabar detrás.
 */
const MEDIDAS = {
  tarima: { ancho: 340, alto: 80 },
  pista:  { rInterior: 130, rExterior: 320 },
  anillo: { grueso: 130, hueco: 22 },
};

/* El público está DEBAJO de la tarima, que es como se lee un mapa de concierto:
   escenario arriba, gente abajo. */
const HACIA = 'abajo';

/* ── La plantilla ────────────────────────────────────────────────────────
 *
 * `anillos` son las coronas de tribunas: la primera pegada a la pista, las
 * siguientes detrás. `porAnillo` cuántos bloques tiene cada una.
 *
 * `abertura` es cuánto abraza el recinto al escenario, en grados:
 *
 *   180   escenario contra la pared —lo normal en un teatro o un auditorio—
 *   270   un arena con el escenario a un extremo
 *   360   en redondo, escenario en el centro
 *
 * Es la decisión que hay que tomar ANTES de dibujar nada, porque determina
 * todo el resto del mapa. Por eso es el primer parámetro y no una opción
 * escondida.
 */
function plantillaDeConcierto({
  abertura = 240, anillos = 2, porAnillo = 10,
  conPista = true, palcos = 0, numeracion = 100,
} = {}) {
  const nAnillos = entero(anillos, 1, 6);
  const nPorAnillo = entero(porAnillo, 1, 40);
  const ab = Number(abertura);
  if (!Number.isFinite(ab) || ab < 30 || ab > 360) {
    return { error: 'La abertura del recinto va de 30 a 360 grados.' };
  }

  const { tarima, pista, anillo } = MEDIDAS;
  const espacios = [];

  /* ¿Escenario contra la pared, o en medio?
   *
   * Por encima de 270° el público rodea el escenario, y entonces la tarima NO
   * puede estar en un borde: va en el centro y la gente lo rodea. Es la
   * diferencia entre un arena con el escenario a un extremo y un montaje en
   * redondo, y no es un detalle de dibujo — cambia qué asiento es bueno, y por
   * tanto las zonas de precio.
   *
   * Salió de una prueba que decía «nada del público por detrás de la tarima» y
   * fallaba con 300°. La prueba tenía razón para un extremo y estaba
   * equivocada para el redondo: lo que faltaba era distinguir los dos casos. */
  const enRedondo = ab > 270;

  /* La tarima no puede ser más ancha que el hueco que le deja la general. */
  const anchoDeTarima = Math.min(tarima.ancho, pista.rInterior * 1.9);

  /* 1 · La tarima. Va la primera para que quede DEBAJO de todo lo demás en el
     dibujo: en SVG manda el orden del documento. */
  espacios.push({
    nombre: 'Tarima', tipo: 'tarima', modo: PIEZAS.tarima.modo, orden: 0,
    geometria: enRedondo
      /* En medio, y más pequeña: tiene que caber dentro del radio interior de
         la general, o la primera fila se dibujaría encima del escenario. */
      ? geo.rectangulo({
          x: -pista.rInterior * 0.6, y: -pista.rInterior * 0.5,
          ancho: pista.rInterior * 1.2, alto: pista.rInterior,
        })
      /* Contra la pared: el centro es el FRENTE de la tarima y ella ocupa lo de
         atrás. Centrada en el origen se comería la primera fila. */
      /* Contra la pared: el centro es el FRENTE de la tarima y ella ocupa lo de
         atrás. Centrada en el origen se comería la primera fila.
         El ancho se recorta al hueco que deja la general: con una tarima más
         ancha que ese radio, las puntas de la pista se curvaban hacia arriba y
         acababan DENTRO del escenario. */
      : geo.rectangulo({
          x: -anchoDeTarima / 2, y: -tarima.alto,
          ancho: anchoDeTarima, alto: tarima.alto,
        }),
  });

  /* 2 · La pista. Se parte en dos —A delante, B detrás— porque es como se
     vende: la general de un concierto casi nunca es un solo precio, y partirla
     después obliga a redibujarla con boletas ya emitidas. */
  if (conPista) {
    const mitad = (pista.rInterior + pista.rExterior) / 2;
    /* La pista va DELANTE del escenario y nunca lo flanquea: media vuelta como
       mucho. Lo que rodea o queda al lado son tribunas, que están a más radio y
       por tanto pasan por fuera de la tarima. Sin este tope, con 240° las
       puntas de la general se curvaban hacia arriba y se metían dentro del
       escenario — lo cazó la prueba que comprueba que nada lo pisa. */
    const abPista = enRedondo ? ab : Math.min(ab * 0.8, 180);
    espacios.push(
      bloque({
        nombre: 'General A', tipo: 'pista', orden: 10,
        rInterior: pista.rInterior, rExterior: mitad, abertura: abPista,
      }),
      bloque({
        nombre: 'General B', tipo: 'pista', orden: 11,
        rInterior: mitad, rExterior: pista.rExterior, abertura: abPista,
      }),
    );
  }

  /* 3 · Los anillos de tribunas.
   *
   * La numeración imita la de un recinto real: 101, 102… en el primer anillo;
   * 201, 202… en el segundo. Es lo que va pintado en la pared, y el mapa tiene
   * que decir lo mismo que la señalética. */
  let r = conPista ? pista.rExterior + anillo.hueco : pista.rInterior;
  for (let a = 0; a < nAnillos; a++) {
    const rInt = r;
    const rExt = r + anillo.grueso;
    /* Un hueco entre bloques para que se distingan. Sin él, un anillo de diez
       tribunas se ve como una sola banda de color. */
    const paso = ab / nPorAnillo;
    const margen = Math.min(paso * 0.12, 2);

    for (let i = 0; i < nPorAnillo; i++) {
      const desde = -ab / 2 + paso * i + margen;
      const hasta = desde + paso - margen * 2;
      espacios.push(bloque({
        nombre: String(numeracion * (a + 1) + i + 1),
        tipo: 'tribuna', orden: 100 * (a + 1) + i,
        rInterior: rInt, rExterior: rExt, desde, hasta,
      }));
    }
    r = rExt + anillo.hueco;
  }

  /* 4 · Los palcos, si se piden. Van fuera del último anillo, que es donde
     están en casi todos los recintos, y son lo único de la plantilla que se
     VENDE tal cual: un palco es una unidad y entran varios. */
  const nPalcos = entero(palcos, 0, 60);
  if (nPalcos > 0) {
    const paso = ab / nPalcos;
    for (let i = 0; i < nPalcos; i++) {
      const desde = -ab / 2 + paso * i + paso * 0.15;
      const hasta = desde + paso * 0.7;
      espacios.push({
        ...bloque({
          nombre: `Palco ${i + 1}`, tipo: 'palco', orden: 900 + i,
          rInterior: r, rExterior: r + 70, desde, hasta,
        }),
        modo: 'vendible',
        /* Un palco entra gente, no una persona. Ocho es lo corriente y se
           cambia después; lo que no puede es nacer en 1, porque entonces el
           aforo contaría ocho veces menos gente de la que va a entrar. */
        capacidad: 8,
      });
    }
  }

  return { espacios };
}

/* Un bloque curvo con nombre. `desde`/`hasta` opcionales: si no vienen, ocupa
   la abertura entera centrada — que es lo que quiere la pista. */
function bloque({ nombre, tipo, orden, rInterior, rExterior, abertura, desde, hasta }) {
  const d = desde != null ? desde : -Number(abertura) / 2;
  const h = hasta != null ? hasta : Number(abertura) / 2;
  return {
    nombre, tipo, orden,
    modo: PIEZAS[tipo]?.modo || 'aforo',
    geometria: geo.bloqueCurvo({
      cx: 0, cy: 0,
      rInterior, rExterior, desde: d, hasta: h,
      /* El público, debajo de la tarima. Con el centro en el escenario, esto es
         lo que hace que cada anillo se aleje de él en vez de rodearlo. */
      mirandoA: HACIA,
      /* Más pasos que el valor por defecto: un bloque de estadio con ocho
         segmentos se ve poligonal, y lo que delata un plano hecho a máquina son
         precisamente las curvas que no son curvas. */
      pasos: 12,
    }),
  };
}

function entero(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

module.exports = { PIEZAS, MEDIDAS, plantillaDeConcierto };
