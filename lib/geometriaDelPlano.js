'use strict';

/* La forma de las cosas en el plano.
 *
 * ── Qué cambia respecto a lo que había ───────────────────────────────────
 *
 * Hasta ahora un espacio tenía `geometria: { x, y }` y punto. Con eso se dibuja
 * una cuadrícula, y una cuadrícula no es un recinto: en un teatro las filas son
 * ARCOS que miran al escenario, y en un estadio lo primero que ve quien compra
 * no son sillas sino BLOQUES —«122», «General B»— que se pintan del color de su
 * precio y se tocan para entrar dentro.
 *
 * Así que la geometría pasa a tener tres formas, y ninguna obliga a migrar
 * nada: `geometria` ya es `jsonb` desde la 0117.
 *
 *   punto     { x, y, rot? }            una silla, una mesa, un palco
 *   poligono  { puntos: [[x,y], …] }    un bloque, una gradería, la tarima
 *   arco      { cx, cy, r, desde, hasta }  una fila curva, ya resuelta a puntos
 *
 * ── Por qué el arco se resuelve aquí y no al dibujar ─────────────────────
 *
 * Una silla tiene que poder venderse, retenerse y escanearse una a una. Si el
 * arco viviera sólo como fórmula, la silla 14 de la fila C no sería una fila en
 * la base: sería un cálculo. Y entonces no se le puede poner precio, ni
 * reservarla, ni saber si está ocupada.
 *
 * El arco es, por tanto, un GENERADOR: produce los puntos una vez, al crear las
 * sillas, y a partir de ahí cada silla es un punto como cualquier otro. Lo que
 * se gana es que salen colocadas como en el recinto de verdad en vez de en
 * rejilla — y se pueden seguir moviendo a mano después.
 *
 * ── Y el sistema de coordenadas ──────────────────────────────────────────
 *
 * Unidades del plano, sin unidad física: el SVG encuadra por el contenido, así
 * que veinte mesas y dos mil sillas caben igual. La `y` crece hacia ABAJO, como
 * en SVG y al revés que en matemáticas — se dice aquí porque es el error que se
 * comete al escribir el segundo generador.
 */

const FORMAS = ['punto', 'poligono', 'arco'];

/* El paso de la rejilla base. Una silla mide 24 y el hueco 32, así que queda
   un pasillo visible. Vive aquí porque el generador y el dibujo tienen que
   estar de acuerdo: si sólo lo supiera el SVG, cambiarlo descolocaría los
   planos ya guardados. */
/* Hacia dónde mira cada cosa. Es UNA sola tabla para todo el archivo a
   propósito: mientras las sillas contaban los grados desde «arriba» y los
   bloques desde «la derecha», las dos funciones eran correctas por separado y
   el recinto salía descuadrado. En SVG la `y` crece hacia abajo, así que
   «arriba» es -90°.

   `mirandoA` es siempre desde el punto de vista del PÚBLICO: 'arriba' quiere
   decir que el escenario está arriba y la gente lo mira. */
const EJES = { arriba: -90, abajo: 90, izquierda: 180, derecha: 0 };

const PASO = 32;
const LADO = 24;

/* Qué forma tiene una geometría guardada. Lo que no se reconoce es `null` y no
   un error: un plano con una forma rara se dibuja sin ella, no se cae. */
function formaDe(geometria) {
  if (!geometria || typeof geometria !== 'object') return null;
  if (Array.isArray(geometria.puntos) && geometria.puntos.length >= 3) return 'poligono';
  if (Number.isFinite(Number(geometria.x)) && Number.isFinite(Number(geometria.y))) return 'punto';
  return null;
}

/* ── El arco ────────────────────────────────────────────────────────────
 *
 * Una fila curva de `cuantas` sitios, centrada en (cx, cy) y a distancia `r`.
 *
 * `abertura` son los grados que abarca la fila, y `mirandoA` hacia dónde da:
 * 'arriba' es el caso normal —el público mira al escenario, que está arriba— y
 * es lo que hace que la curva se vea como en un teatro y no boca abajo.
 *
 * Cada sitio sale con su `rot`, los grados que hay que girarlo para que quede
 * de cara al centro. Sin eso las sillas de los extremos se ven torcidas
 * respecto a la fila, que es exactamente lo que delata un plano generado.
 */
function puntosDeArco({ cuantas, cx = 0, cy = 0, r = 200, abertura = 90, mirandoA = 'arriba' } = {}) {
  const n = Number(cuantas);
  if (!Number.isInteger(n) || n < 1) return [];

  /* Grados de la mitad del arco a cada lado del eje.
   *
   * Con UNA sola silla no hay nada que repartir y va justo en el eje. Restar
   * media abertura como en los demás casos la dejaba pegada al extremo
   * izquierdo del arco: un palco único aparecía descolocado y nadie sabría por
   * qué. Lo cazó la prueba, no la vista. */
  const media = n === 1 ? 0 : Number(abertura) / 2;
  const paso = n === 1 ? 0 : Number(abertura) / (n - 1);

  const eje = EJES[mirandoA] ?? EJES.arriba;

  return Array.from({ length: n }, (_, i) => {
    const ang = eje - media + paso * i;
    const rad = (ang * Math.PI) / 180;
    return {
      x: redondear(cx + Math.cos(rad) * r),
      y: redondear(cy + Math.sin(rad) * r),
      /* Girar el sitio para que mire al centro del arco. `+90` porque un
         rectángulo sin girar «mira» hacia arriba. */
      rot: redondear(ang + 90),
    };
  });
}

/* Las sillas de una sección curva entera: `filas` arcos concéntricos.
 *
 * Cada fila que se aleja es más larga, así que lleva más sitios — igual que en
 * un teatro. Se puede fijar `porFila` para que todas tengan los mismos, que es
 * lo que quiere quien numera a mano.
 */
function sillasEnAbanico({ filas = 1, porFila = null, cx = 0, cy = 0,
                           radioPrimera = 200, separacion = PASO,
                           abertura = 90, mirandoA = 'arriba' } = {}) {
  const nf = Number(filas);
  if (!Number.isInteger(nf) || nf < 1) return [];

  const out = [];
  for (let f = 0; f < nf; f++) {
    const r = Number(radioPrimera) + f * Number(separacion);
    /* Cuántas caben en esta fila si no se fijó a mano: el largo del arco
       dividido por el hueco entre sillas. Es lo que hace que la fila de atrás
       tenga más sitios sin que nadie los cuente. */
    const cuantas = Number.isInteger(Number(porFila)) && Number(porFila) > 0
      ? Number(porFila)
      : Math.max(1, Math.round((Number(abertura) * Math.PI / 180) * r / PASO));
    out.push(puntosDeArco({ cuantas, cx, cy, r, abertura, mirandoA }).map((p, i) => ({
      ...p, fila: f, numero: i + 1,
    })));
  }
  return out;
}

/* ── El bloque ──────────────────────────────────────────────────────────
 *
 * Un polígono. Es lo que se dibuja en el primer nivel del mapa: «122», «GENERAL
 * B», la tarima. No se vende —se toca para entrar dentro— salvo que sea una
 * localidad de pie, que sí.
 */

/* Un rectángulo, que es el 90 % de los bloques de un estadio. Se guarda como
   polígono y no como `{x,y,w,h}` para que haya UNA forma de leer un bloque:
   dos representaciones del mismo bloque acaban divergiendo. */
function rectangulo({ x = 0, y = 0, ancho = 100, alto = 60 } = {}) {
  return { puntos: [[x, y], [x + ancho, y], [x + ancho, y + alto], [x, y + alto]] };
}

/* Un bloque de gradería: un trapecio curvado hacia el centro, que es la forma
   real de una sección de estadio.
 *
 * `desde`/`hasta` son grados MEDIDOS DESDE EL EJE, igual que en `puntosDeArco`
 * — no desde el 0° de la trigonometría.
 *
 * Esa era la trampa: los dos generadores hablaban en grados, pero el de las
 * sillas contaba desde «arriba» y el de los bloques desde «la derecha». Sobre
 * el papel las dos funciones eran correctas; puestas en el mismo plano, la
 * gradería salía girada noventa grados respecto a su propio patio de butacas.
 * No lo cazó ninguna prueba: lo cazó mirar el dibujo. */
function bloqueCurvo({ cx = 0, cy = 0, rInterior = 200, rExterior = 320,
                       desde = -30, hasta = 30, pasos = 8, mirandoA = 'arriba' } = {}) {
  const eje = EJES[mirandoA] ?? EJES.arriba;
  const arco = (r, a, b) => Array.from({ length: pasos + 1 }, (_, i) => {
    const ang = ((eje + a + (b - a) * (i / pasos)) * Math.PI) / 180;
    return [redondear(cx + Math.cos(ang) * r), redondear(cy + Math.sin(ang) * r)];
  });
  /* Ida por dentro y vuelta por fuera: así el polígono se cierra sin cruzarse.
     Al revés sale un lazo, que se dibuja como un nudo. */
  return { puntos: [...arco(rInterior, desde, hasta), ...arco(rExterior, hasta, desde)] };
}

/* El encuadre de todo lo que hay, para que el SVG se ajuste al contenido: un
   recinto de veinte mesas y uno de dos mil sillas tienen que caber igual.
 *
 * Devuelve `null` si no hay nada con forma — y quien llama enseña la lista, que
 * funciona igual: el plano es una forma de elegir, no la única. */
function encuadre(espacios = [], margen = PASO) {
  const xs = [];
  const ys = [];
  for (const e of espacios) {
    const g = e.geometria;
    const forma = formaDe(g);
    if (forma === 'punto') {
      xs.push(Number(g.x), Number(g.x) + LADO);
      ys.push(Number(g.y), Number(g.y) + LADO);
    } else if (forma === 'poligono') {
      for (const [px, py] of g.puntos) {
        if (!Number.isFinite(Number(px)) || !Number.isFinite(Number(py))) continue;
        xs.push(Number(px)); ys.push(Number(py));
      }
    }
  }
  if (!xs.length) return null;
  const x = Math.min(...xs) - margen;
  const y = Math.min(...ys) - margen;
  return { x, y, w: Math.max(...xs) - x + margen, h: Math.max(...ys) - y + margen };
}

/* ── Los colores de las localidades ─────────────────────────────────────
 *
 * En un mapa de concierto el color ES el precio: «la roja son 450 mil, la azul
 * 180». Por eso el color vive en el tipo de boleta —la localidad— y no en la
 * silla: cambiar el color de una localidad tiene que repintar sus dos mil
 * sillas de una vez.
 *
 * Esta paleta es sólo la propuesta para quien no elige. Se reparte en el orden
 * en que están las localidades, que el organizador ordena por precio.
 */
const PALETA = [
  '#DC2626', // rojo    · lo más caro, delante
  '#EA580C', // naranja
  '#CA8A04', // ámbar
  '#16A34A', // verde
  '#0891B2', // cian
  '#2563EB', // azul
  '#7C3AED', // violeta
  '#DB2777', // rosa
];

/* Un color de la paleta por posición, dando la vuelta si hay más localidades
   que colores. Nunca devuelve `undefined`: una localidad sin color se dibuja
   invisible sobre el fondo, y eso parece un plano roto. */
function colorPorDefecto(i) {
  const n = Number(i);
  return PALETA[(Number.isInteger(n) && n >= 0 ? n : 0) % PALETA.length];
}

/* Sólo se acepta `#rrggbb`. Es lo que entiende el SVG y lo que se puede
   guardar sin sorpresas; un `red` o un `rgb(…)` viajarían bien y romperían el
   día que alguien los compare o los pinte en un PDF. */
const ES_COLOR = /^#[0-9a-f]{6}$/i;
function colorValido(c) {
  return typeof c === 'string' && ES_COLOR.test(c.trim()) ? c.trim().toLowerCase() : null;
}

const redondear = (n) => Math.round(Number(n) * 100) / 100;

module.exports = {
  FORMAS, PASO, LADO, PALETA, EJES,
  formaDe, puntosDeArco, sillasEnAbanico,
  rectangulo, bloqueCurvo, encuadre,
  colorPorDefecto, colorValido,
};
