'use strict';

/* Llenar una tribuna con sus butacas.
 *
 * ── Por qué esto y no «genera 240 sillas» ────────────────────────────────
 *
 * El generador de siempre pide filas y sillas por fila, y las coloca en el
 * origen o en un abanico que hay que recolocar a mano. Eso funciona cuando se
 * empieza por las sillas.
 *
 * Pero desde que se puede TRAZAR la tribuna sobre el plano del recinto, el
 * orden natural se invierte: primero está el bloque —con su forma, en su sitio,
 * calcado del plano real— y lo que falta es llenarlo. Pedir entonces «12 filas
 * de 20» y que salgan en otro lado es hacerle repetir a alguien un trabajo que
 * ya hizo con el ratón.
 *
 * Aquí se le dice al bloque «llénate», y las butacas salen DENTRO de él, en
 * arcos que miran al escenario.
 *
 * ── Cómo se decide dónde cabe cada butaca ────────────────────────────────
 *
 * El recinto tiene un centro —la tarima— y todo se mide desde ahí. Del polígono
 * se sacan su rango de RADIOS (lo cerca y lo lejos que está del escenario) y su
 * rango de ÁNGULOS (cuánto abarca de lado a lado). Con eso se tienden arcos
 * dentro de ese rango y se queda sólo lo que cae dentro de la figura.
 *
 * Es lo que hace que una tribuna trapezoidal salga con las filas de atrás más
 * largas que las de delante sin que nadie lo calcule: no se dibuja un
 * rectángulo de sillas y se recorta, se tiende cada fila y se pregunta cuáles
 * caben.
 */

const geo = require('./geometriaDelPlano.js');
/* A, B… Z, AA, AB… La misma numeración de filas que el generador de siempre, y
   traída de allí en vez de reescrita: dos bloques del mismo recinto con letras
   distintas es el tipo de cosa que nadie nota hasta la puerta.
   Va ARRIBA y no al final del archivo: `const` no se eleva, y un require al pie
   sería una bomba de relojería para el día que alguien lo llame antes. */
const { nombreDeFila } = require('./espacios.js');

/* Cuántas butacas de una vez. El mismo tope que el generador de siempre, y por
   lo mismo: una petición que crea diez mil filas no se distingue de un ataque,
   y a medio insertar deja un bloque con la mitad de sus sillas. */
const MAX = 2000;

/* ¿Está el punto dentro del polígono? Lanzando un rayo y contando cruces.
 *
 * Se usa el algoritmo clásico y no una comprobación por caja porque una tribuna
 * NO es una caja: con la caja, las butacas de las esquinas de un trapecio
 * quedarían fuera del bloque, flotando en el pasillo, y nadie las vería mal
 * hasta el día del evento.
 */
function dentro(puntos, x, y) {
  let hay = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [xi, yi] = puntos[i];
    const [xj, yj] = puntos[j];
    const cruza = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (cruza) hay = !hay;
  }
  return hay;
}

/* El rango de radios y ángulos que ocupa el polígono visto desde el centro.
 *
 * El ángulo se «desenrolla»: si el bloque cruza la línea de los -180°, los
 * ángulos saltan de 179 a -179 y el rango salido de un min/max sería casi la
 * circunferencia entera. Sumando una vuelta a los que se quedan atrás, el rango
 * vuelve a ser el que se ve.
 */
function alcance(puntos, cx, cy) {
  const rs = [];
  const angs = [];
  for (const [x, y] of puntos) {
    rs.push(Math.hypot(x - cx, y - cy));
    angs.push((Math.atan2(y - cy, x - cx) * 180) / Math.PI);
  }
  angs.sort((a, b) => a - b);
  /* El hueco más grande entre ángulos consecutivos es lo que el bloque NO
     ocupa; el resto, sí. Con eso el corte cae donde toca aunque el bloque
     cruce el ±180. */
  let corte = 0;
  let mayor = 360 + angs[0] - angs[angs.length - 1];
  for (let i = 1; i < angs.length; i++) {
    const hueco = angs[i] - angs[i - 1];
    if (hueco > mayor) { mayor = hueco; corte = i; }
  }
  const ordenados = [...angs.slice(corte), ...angs.slice(0, corte).map(a => a + 360)];
  return {
    rMin: Math.min(...rs),
    rMax: Math.max(...rs),
    desde: ordenados[0],
    hasta: ordenados[ordenados.length - 1],
  };
}

/* El tramo de un arco de radio `r` que cae DENTRO del polígono.
 *
 * Se busca a saltos finos: doscientas muestras a lo largo del alcance del
 * bloque, y se queda con la primera y la última que estén dentro. Doscientas
 * porque una tribuna de veinte metros con muestras cada medio grado se mide con
 * error de centímetros, y bajar de ahí empieza a recortar butacas de los
 * bordes.
 *
 * Devuelve `null` si a ese radio no cabe nada — el pico de un bloque
 * triangular, por ejemplo—, y entonces esa fila no existe. */
function tramoUtil(puntos, cx, cy, r, desde, hasta, muestras = 200) {
  let primera = null;
  let ultima = null;
  for (let i = 0; i <= muestras; i++) {
    const ang = desde + ((hasta - desde) * i) / muestras;
    const rad = (ang * Math.PI) / 180;
    if (!dentro(puntos, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r)) continue;
    if (primera === null) primera = ang;
    ultima = ang;
  }
  if (primera === null || ultima === primera) return null;
  return { desde: primera, hasta: ultima };
}

/* Las butacas que caben en `geometria`, en arcos mirando al centro.
 *
 * `filas` fija cuántas hay; si no se dice, salen las que caben separadas por
 * `separacion`. `porFila` fija las de cada fila; si no, cada fila lleva las que
 * quepan — que es lo que hace que la de atrás tenga más, como en un teatro.
 */
function butacasDelBloque({
  geometria, cx = 0, cy = 0,
  filas = null, porFila = null,
  separacion = geo.PASO, hueco = geo.PASO,
  prefijoFila = 'Fila', desdeLaDerecha = false, capacidad = 1, tipo = 'silla',
} = {}) {
  const puntos = geometria?.puntos;
  if (!Array.isArray(puntos) || puntos.length < 3) {
    return { error: 'Ese bloque no tiene forma dibujada. Trázalo primero.' };
  }

  const { rMin, rMax, desde, hasta } = alcance(puntos, cx, cy);
  const fondo = rMax - rMin;
  if (fondo < geo.LADO) return { error: 'Ese bloque es demasiado estrecho para poner butacas.' };

  /* Media fila de margen por delante y por detrás: pegadas al borde, las
     butacas se dibujan mordiendo la línea del bloque y parece un error. */
  const margen = Math.min(separacion / 2, fondo / 4);
  const nFilas = Number.isInteger(Number(filas)) && Number(filas) > 0
    ? Number(filas)
    : Math.max(1, Math.floor((fondo - margen * 2) / separacion) + 1);

  const unidades = [];
  /* Las filas que de verdad llevaron butacas. No es `f`: una fila donde no cupo
     nada no gasta letra, o el bloque tendría fila A, C y D y quien busque la B
     no la encontrará. */
  let puestas = 0;
  for (let f = 0; f < nFilas; f++) {
    /* La fila 0 es la más CERCA del escenario, y se numera A. Al revés, la fila
       A sería la del fondo y quien compre «fila A» se llevaría la peor. */
    const r = nFilas === 1
      ? (rMin + rMax) / 2
      : rMin + margen + (f * (fondo - margen * 2)) / (nFilas - 1);

    /* Hasta dónde llega ESTA fila dentro del bloque.
     *
     * No es el alcance del polígono entero: un bloque curvo se cierra con
     * cuerdas rectas, así que a cada radio el tramo útil es distinto —más corto
     * en la fila de delante, más largo en la de atrás—. Repartir sobre el
     * alcance total y descartar lo que se sale parecía funcionar, y no lo hacía:
     * pidiendo «8 por fila» salían 6, porque los dos de los extremos caían
     * fuera. Quien numera butacas a mano contaba 8 en la pared y 6 en la
     * pantalla. */
    const tramo = tramoUtil(puntos, cx, cy, r, desde, hasta);
    if (!tramo) continue;
    const abertura = tramo.hasta - tramo.desde;

    /* Cuántas caben: el largo del tramo entre el hueco. Es lo que hace que la
       fila de atrás tenga más butacas sin que nadie las cuente. */
    const caben = Number.isInteger(Number(porFila)) && Number(porFila) > 0
      ? Number(porFila)
      : Math.max(1, Math.floor(((abertura * Math.PI) / 180) * r / hueco) + 1);

    const paso = caben === 1 ? 0 : abertura / (caben - 1);
    const enFila = [];
    for (let c = 0; c < caben; c++) {
      const ang = caben === 1 ? (tramo.desde + tramo.hasta) / 2 : tramo.desde + paso * c;
      const rad = (ang * Math.PI) / 180;
      const x = cx + Math.cos(rad) * r;
      const y = cy + Math.sin(rad) * r;
      /* Se comprueba igualmente el CENTRO de la butaca: el tramo se midió a
         saltos, y un bloque con una muesca puede tener un hueco dentro. */
      if (!dentro(puntos, x, y)) continue;
      enFila.push({ x: x - geo.LADO / 2, y: y - geo.LADO / 2, rot: ang + 90 });
    }

    if (!enFila.length) continue;

    const letra = nombreDeFila(puestas);
    puestas += 1;
    enFila.forEach((p, i) => {
      const numero = desdeLaDerecha ? enFila.length - i : i + 1;
      unidades.push({
        nombre: `${prefijoFila} ${letra}${numero}`,
        tipo,
        modo: 'vendible',
        capacidad: Number(capacidad) || 1,
        geometria: { x: redondear(p.x), y: redondear(p.y), rot: redondear(p.rot) },
        orden: puestas * 1000 + numero,
      });
    });
  }

  if (!unidades.length) return { error: 'No cabe ninguna butaca ahí. Prueba con menos separación.' };
  if (unidades.length > MAX) {
    return { error: `Saldrían ${unidades.length} butacas y el máximo de una vez es ${MAX}. Divide la tribuna.` };
  }
  return { unidades };
}

const redondear = (n) => Math.round(Number(n) * 100) / 100;

module.exports = { MAX, dentro, alcance, tramoUtil, butacasDelBloque };
