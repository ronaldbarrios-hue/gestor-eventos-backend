'use strict';

/* Guardar un recinto una vez, y partir de él cada concierto.
 *
 * ── Qué se guarda y qué NO ───────────────────────────────────────────────
 *
 * Se guarda **el edificio**: la forma de cada bloque, su nombre, su tipo, su
 * capacidad y quién cuelga de quién. Es lo que cuesta horas de dibujar.
 *
 * NO se guarda nada de un concierto concreto:
 *
 *   ids                se generan nuevos al copiar; el mismo id en dos eventos
 *                      haría que una reserva apuntara al plano equivocado
 *   evento_id          por lo mismo
 *   reservas, ventas   son de aquel show, no del edificio
 *   localidades        el precio es del concierto; el mismo arena tiene la
 *                      platea a 450 mil un sábado y a 180 el domingo
 *
 * Es la línea que hay que tener clara: **la plantilla es el edificio, no el
 * evento**. Si se colara el precio, copiar un recinto traería los precios del
 * show anterior y alguien los publicaría sin mirar.
 */

/* Lo que viaja de cada espacio a la plantilla. Escrito como lista y no como
   «todo menos esto»: con `delete`, una columna nueva en `espacios` acabaría
   copiándose sin que nadie lo decidiera — y el día que esa columna sea
   `vendidos` o `precio`, la plantilla mentiría. */
const DEL_EDIFICIO = ['nombre', 'tipo', 'modo', 'aforo_max', 'capacidad', 'geometria', 'atributos', 'orden'];

/* Los espacios de un evento → el plano guardado.
 *
 * El árbol se conserva por POSICIÓN y no por id: cada espacio lleva el índice
 * de su padre dentro de la misma lista. Guardar los uuid obligaría a mantener
 * un diccionario al copiar, y un diccionario a medias deja bloques huérfanos —
 * sillas que no cuelgan de ninguna tribuna y por tanto no se pueden vender. */
function aPlantilla(espacios = []) {
  const orden = espacios.map(e => e.id);
  const indice = new Map(orden.map((id, i) => [id, i]));

  return espacios.map(e => {
    const fila = {};
    for (const c of DEL_EDIFICIO) if (e[c] !== undefined) fila[c] = e[c];
    /* `null` explícito para las raíces: `undefined` desaparece al serializar a
       JSON y al leerlo de vuelta no se distingue de «se me olvidó». */
    fila.padre = e.parent_id != null && indice.has(e.parent_id) ? indice.get(e.parent_id) : null;
    return fila;
  });
}

/* El plano guardado → filas listas para insertar en un evento.
 *
 * Se inserta en DOS pasadas y no en una: los padres primero, y luego los hijos
 * con el `parent_id` que la base acaba de dar. En una sola pasada no hay forma
 * de conocer el id del padre antes de escribirlo.
 *
 * Devuelve niveles: `[[raíces], [hijos], [nietos], …]`. Quien llama inserta
 * nivel a nivel y va rellenando `parent_id`.
 */
function porNiveles(plano = []) {
  if (!Array.isArray(plano) || !plano.length) return [];

  /* La profundidad de cada uno. Con un tope, porque un plano manipulado a mano
     puede traer un ciclo —A hijo de B, B hijo de A— y sin tope esto no
     termina. */
  const profundidad = plano.map(() => 0);
  for (let i = 0; i < plano.length; i++) {
    let p = plano[i]?.padre;
    let saltos = 0;
    while (p != null && plano[p] && saltos < 20) { profundidad[i] += 1; p = plano[p].padre; saltos += 1; }
    /* Un ciclo se trata como raíz. Un bloque suelto en el plano se ve y se
       arregla; un servidor colgado, no. */
    if (saltos >= 20) profundidad[i] = 0;
  }

  const niveles = [];
  for (let i = 0; i < plano.length; i++) {
    const d = profundidad[i];
    (niveles[d] = niveles[d] || []).push({ indice: i, espacio: plano[i] });
  }
  return niveles.filter(Boolean);
}

/* Qué es aceptable como plano guardado. Se comprueba al guardar y no al copiar:
   descubrir que una plantilla estaba rota cuando alguien la está usando para
   montar un concierto es tarde. */
function validarPlano(plano) {
  if (!Array.isArray(plano)) return 'El plano tiene que ser una lista de espacios.';
  if (!plano.length) return 'No hay nada que guardar: dibuja el recinto primero.';
  if (plano.length > 5000) return `Son ${plano.length} espacios y el máximo de una plantilla es 5000.`;
  for (const e of plano) {
    if (!e || typeof e !== 'object') return 'Hay un espacio que no es un objeto.';
    if (!String(e.nombre || '').trim()) return 'Hay un espacio sin nombre.';
    if (e.padre != null && !(Number.isInteger(e.padre) && e.padre >= 0 && e.padre < plano.length)) {
      return `«${e.nombre}» cuelga de un espacio que no está en el plano.`;
    }
  }
  return null;
}

/* Lo que se enseña de un recinto en una lista, sin arrastrar el plano entero:
   veinte recintos de dos mil espacios cada uno son megas por una pantalla que
   sólo necesita nombres. */
function resumen(r) {
  const plano = Array.isArray(r?.plano) ? r.plano : [];
  return {
    id: r.id,
    nombre: r.nombre,
    ciudad: r.ciudad || null,
    aforo_legal: r.aforo_legal || null,
    espacios: plano.length,
    /* Cuánta gente cabe según lo dibujado. No es el aforo legal —eso lo dice el
       edificio— y por eso van los dos: enseñar sólo uno hace creer que el otro
       no existe. */
    capacidad: plano.reduce((n, e) => n + (Number(e.capacidad) || 0), 0),
    actualizado: r.updated_at || r.created_at || null,
  };
}

module.exports = { DEL_EDIFICIO, aPlantilla, porNiveles, validarPlano, resumen };
