'use strict';

/* Los espacios de un evento: la silla, la mesa, el palco, el stand.
 *
 * ── Qué hay aquí y qué no ────────────────────────────────────────────────
 *
 * Aquí sólo va lo que se puede decidir SIN base: validar lo que llega, armar el
 * árbol, generar filas de sillas a partir de un patrón, y dar forma al mapa
 * público. Todo eso se prueba sin montar servidor ni base, que es lo que hace
 * que se pruebe de verdad.
 *
 * Lo que NO está aquí, y a propósito: retener una silla. Eso vive en una
 * función de Postgres (`retener_espacio`, migración 0117) porque `supabase-js`
 * no puede abrir una transacción de varias sentencias, y retener son dos pasos
 * que tienen que ir juntos —liberar lo caducado de esa silla e insertar lo
 * nuevo—. Hecho desde aquí, entre el uno y el dos cabe otra persona comprando
 * la misma silla.
 */

/* Los tres modos. `tipo` es libre —cada recinto nombra lo suyo: pabellón,
   gradería, palco, pesebrera— y lo que el software mira es esto. */
const MODOS = ['aforo', 'asignable', 'vendible'];

/* Cuántos minutos se retiene una silla mientras alguien paga.
 *
 * Diez, no tres. Un pago con tarjeta y 3-D Secure se va fácil a cinco, y el
 * salto a la pasarela abre otra pestaña. Un plazo corto genera lo peor de todo:
 * alguien que pagó y ya no tiene su silla. Y no treinta: media hora de carritos
 * abandonados en una preventa deja el mapa en rojo sin que nadie haya comprado. */
const MINUTOS_RETENCION = 10;

/* Tope de unidades que se generan de una vez. No es una opinión sobre cuántas
   sillas puede tener un recinto: es un cortafuegos contra un patrón mal escrito
   —«200 filas de 300»— que insertaría sesenta mil filas de un clic. */
const MAX_POR_LOTE = 2000;

const COLUMNAS = 'id, evento_id, parent_id, nombre, tipo, modo, aforo_max, capacidad, geometria, atributos, orden';

/* ── Validar lo que llega ────────────────────────────────────────────── */

function validarEspacio(e = {}) {
  const nombre = String(e.nombre || '').trim();
  if (!nombre) return 'Cada espacio necesita un nombre.';
  if (nombre.length > 120) return 'El nombre del espacio es demasiado largo.';

  const modo = e.modo || 'aforo';
  if (!MODOS.includes(modo)) return `Modo inválido: ${modo}. Usa ${MODOS.join(', ')}.`;

  if (e.aforo_max != null && e.aforo_max !== '') {
    const n = Number(e.aforo_max);
    if (!Number.isInteger(n) || n <= 0) return 'El aforo tiene que ser un número entero mayor que cero.';
  }

  if (e.capacidad != null && e.capacidad !== '') {
    const n = Number(e.capacidad);
    if (!Number.isInteger(n) || n <= 0) return 'La capacidad tiene que ser un número entero mayor que cero.';
  }

  /* Un aforo en algo vendible no significa nada: lo vendible se cuenta por
     unidades, no por cabeza. Dejarlo pasar guardaría un número que nadie mira,
     y alguien lo leería creyendo que hace algo. */
  if (modo === 'vendible' && e.aforo_max) {
    return 'Un espacio que se vende se cuenta por unidades, no por aforo. Quita el aforo o cambia el modo.';
  }

  return null;
}

/* La fila que se guarda. Se limpia aquí y no en la ruta para que las dos que
   escriben —crear y editar— no se separen. */
function filaEspacio(e, eventoId) {
  const modo = e.modo || 'aforo';
  return {
    evento_id: eventoId,
    parent_id: e.parent_id || null,
    nombre   : String(e.nombre).trim(),
    tipo     : String(e.tipo || 'zona').trim().slice(0, 40),
    modo,
    /* Sólo donde significa algo. Si no, cambiar el modo de un espacio dejaría
       un aforo viejo colgando. */
    aforo_max: modo === 'aforo' && e.aforo_max ? Number(e.aforo_max) : null,
    capacidad: modo === 'vendible' && e.capacidad ? Number(e.capacidad) : 1,
    geometria: e.geometria && typeof e.geometria === 'object' ? e.geometria : null,
    atributos: e.atributos && typeof e.atributos === 'object' ? e.atributos : {},
    orden    : Number.isInteger(e.orden) ? e.orden : 0,
  };
}

/* ── Generar por patrón ─────────────────────────────────────────────────
 *
 * Nadie va a crear 2.000 sillas a mano, y nadie debería. Se describe la sección
 * —«12 filas de 20»— y salen las unidades con su nombre.
 *
 * Las filas se nombran A, B, C… y las sillas 1, 2, 3…, que es como está escrito
 * en el suelo de cualquier recinto. Si alguien numera al revés, se le da la
 * vuelta con `desde_la_derecha` en vez de obligarle a renombrar 240 sillas.
 */

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function nombreDeFila(i) {
  /* Más de 26 filas: AA, AB… Pasa en un estadio y es mejor que «Fila 27». */
  if (i < 26) return LETRAS[i];
  return LETRAS[Math.floor(i / 26) - 1] + LETRAS[i % 26];
}

function generarUnidades({ filas = 1, porFila = 1, tipo = 'silla', capacidad = 1,
                           prefijoFila = 'Fila', desdeLaDerecha = false } = {}) {
  const nf = Number(filas), nc = Number(porFila);
  if (!Number.isInteger(nf) || nf < 1) return { error: 'El número de filas no es válido.' };
  if (!Number.isInteger(nc) || nc < 1) return { error: 'El número de unidades por fila no es válido.' };
  if (nf * nc > MAX_POR_LOTE) {
    return { error: `Son ${nf * nc} unidades de una vez y el máximo es ${MAX_POR_LOTE}. Hazlo por secciones.` };
  }

  const unidades = [];
  for (let f = 0; f < nf; f++) {
    for (let c = 0; c < nc; c++) {
      const numero = desdeLaDerecha ? nc - c : c + 1;
      unidades.push({
        /* Una sola fila no lleva letra: «Mesa 3», no «Mesa A3». Es el caso de
           los palcos y las mesas de ringside, que es por donde se empieza. */
        nombre: nf === 1
          ? `${tipo === 'silla' ? 'Silla' : capitalizar(tipo)} ${numero}`
          : `${prefijoFila} ${nombreDeFila(f)}${numero}`,
        tipo,
        modo: 'vendible',
        capacidad: Number(capacidad) || 1,
        /* La cuadrícula base. El editor la mueve después; esto es para que algo
           se vea desde el primer momento en vez de un montón de puntos en el
           origen. */
        geometria: { x: c * 32, y: f * 32 },
        orden: f * 1000 + numero,
      });
    }
  }
  return { unidades };
}

const capitalizar = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/* ── El árbol ───────────────────────────────────────────────────────────
 *
 * Se arma en memoria de una sola lectura. La alternativa —una consulta
 * recursiva por nivel— son N viajes a la base para pintar un plano.
 */

function armarArbol(espacios = []) {
  const porId = new Map();
  for (const e of espacios) porId.set(e.id, { ...e, hijos: [] });

  const raiz = [];
  for (const e of porId.values()) {
    const padre = e.parent_id ? porId.get(e.parent_id) : null;
    /* Un padre que no está en la lista —borrado a medias, o filtrado— no puede
       hacer desaparecer a sus hijos del plano: se suben a la raíz. */
    if (padre) padre.hijos.push(e);
    else raiz.push(e);
  }

  const ordenar = (lista) => {
    lista.sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    for (const x of lista) ordenar(x.hijos);
  };
  ordenar(raiz);
  return raiz;
}

/* Las hojas vendibles, en plano. Es lo que necesita el mapa. */
function unidadesVendibles(espacios = []) {
  return espacios.filter(e => e.modo === 'vendible');
}

/* ── El mapa que se sirve al público ────────────────────────────────────
 *
 * Sale del backend YA AGREGADO: id del espacio y si está libre. Lo que no sale
 * es de quién es cada reserva — `sesion_compra` identifica un carrito y
 * `ticket_id` lleva a una persona. Un mapa que dijera «vendida a X» sería una
 * lista de asistentes servida sin autenticación.
 */
function mapaPublico({ espacios = [], reservas = [], ahora = new Date() } = {}) {
  const ocupados = new Set();
  for (const r of reservas) {
    if (r.estado === 'vendido') { ocupados.add(r.espacio_id); continue; }
    /* Una retención caducada no ocupa, aunque el trabajo que las libera no haya
       pasado todavía. Si no, el mapa enseña en rojo sillas que sí se pueden
       comprar — y quien mira concluye que está agotado. */
    if (r.estado === 'retenido' && r.expira_at && new Date(r.expira_at) > ahora) {
      ocupados.add(r.espacio_id);
    }
  }

  return unidadesVendibles(espacios).map(e => ({
    id: e.id,
    nombre: e.nombre,
    tipo: e.tipo,
    capacidad: e.capacidad,
    geometria: e.geometria,
    atributos: e.atributos,
    parent_id: e.parent_id,
    libre: !ocupados.has(e.id),
  }));
}

/* Cuántas quedan por localidad. El número que el público mira antes de abrir el
   plano, y el que decide si merece la pena abrirlo. */
function resumenPorPadre(mapa = []) {
  const cuenta = new Map();
  for (const u of mapa) {
    const k = u.parent_id || '__sueltas__';
    const c = cuenta.get(k) || { total: 0, libres: 0 };
    c.total += 1;
    if (u.libre) c.libres += 1;
    cuenta.set(k, c);
  }
  return cuenta;
}

/* ── La sesión de compra ────────────────────────────────────────────────
 *
 * Quién tiene retenida una silla. No es el usuario: alguien sin cuenta también
 * compra, y la misma persona puede tener dos pestañas con dos carritos.
 *
 * Lo pone el cliente y el servidor no se lo cree para nada más que para
 * comparar consigo mismo: sirve para «esta silla es de este carrito», no para
 * identificar a nadie.
 */
function sesionValida(s) {
  const v = String(s || '').trim();
  return v.length >= 8 && v.length <= 100 ? v : null;
}

/* Los errores que devuelven las funciones de Postgres, traducidos.
 *
 * Se traducen aquí y no en cada ruta para que «se acaba de tomar» se diga
 * igual en todas — y porque el mensaje ES la funcionalidad: quien lo lee tiene
 * que entender que puede elegir otra, no que la plataforma falló. */
const ERRORES = {
  ESPACIO_OCUPADO: { estado: 409, mensaje: 'Esa silla se acaba de tomar. Elige otra.' },
  ESPACIO_NO_EXISTE: { estado: 404, mensaje: 'Ese espacio no existe.' },
  ESPACIO_NO_VENDIBLE: { estado: 400, mensaje: 'Ese espacio no se vende por separado.' },
  ESPACIO_DE_OTRO_EVENTO: { estado: 400, mensaje: 'Ese espacio no es de este evento.' },
};

function traducirError(e) {
  const txt = String(e?.message || e || '');
  for (const [clave, r] of Object.entries(ERRORES)) {
    if (txt.includes(clave)) return r;
  }
  return null;
}

module.exports = {
  MODOS,
  MINUTOS_RETENCION,
  MAX_POR_LOTE,
  COLUMNAS,
  validarEspacio,
  filaEspacio,
  generarUnidades,
  nombreDeFila,
  armarArbol,
  unidadesVendibles,
  mapaPublico,
  resumenPorPadre,
  sesionValida,
  ERRORES,
  traducirError,
};
