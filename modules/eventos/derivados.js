'use strict';

/* Los cuatro disparadores que quedaban por traer al código.
 *
 * Paso 4 de la fase 6 (ver db/migraciones/NOTAS-ESQUEMA.md). Los cinco
 * primeros ya están: los tres `seed_*` en `modules/eventos/semillas.js`, y los
 * dos que cuentan en `modules/contadores/index.js`. Estos cuatro son los que
 * faltaban:
 *
 *   `fn_touch_email_plantilla`   → `updated_at` de una plantilla de correo
 *   `evento_legal_version`       → la huella del texto legal
 *   `fn_puente_page_json`        → el puente entre columnas y `page_json`
 *   `fn_expositor_desde_boleta`  → crear el expositor al pagar su boleta
 *
 * Ninguno de los cuatro CUENTA, que es lo que hacía peligrosos a los otros
 * dos: son transformaciones de la fila que se está escribiendo. Por eso aquí
 * no hay transacciones ni bloqueos, y las tres primeras son funciones puras
 * que se prueban sin base.
 *
 * ── Estado ────────────────────────────────────────────────────────────────
 *
 * Igual que el resto de la fase 6: esto se usará cuando los datos vivan en
 * MySQL. Hoy la plataforma sigue sobre Supabase y los disparadores siguen ahí
 * haciendo su trabajo, así que nada de aquí se llama todavía, a propósito.
 */

const crypto = require('crypto');

/* ── 1 · `updated_at` de una plantilla de correo ──────────────────────────
 *
 * Original: `fn_touch_email_plantilla`, BEFORE UPDATE sobre
 * `evento_email_plantillas`. Pone `updated_at := now()`.
 *
 * En MySQL esto NO necesita código: se resuelve en el propio DDL con
 * `ON UPDATE CURRENT_TIMESTAMP(6)`, que es lo que el generador emite ahora.
 * Se deja escrito igualmente porque el backend a veces arma la fila entera y
 * la manda de una pieza, y en ese caso quien decide la marca de tiempo es
 * quien escribe, no la base.
 */
function tocar(fila) {
  return { ...fila, updated_at: new Date() };
}

/* ── 2 · La huella del texto legal ────────────────────────────────────────
 *
 * Original: `evento_legal_version`, BEFORE INSERT OR UPDATE sobre
 * `evento_legal`. Calcula `version` como el md5 de los cuatro campos legales
 * unidos por `|`.
 *
 * Para qué sirve: cada boleta guarda `legal_version`, así que al cambiar los
 * términos se sabe quién aceptó cuál. Si la huella se calculara distinto aquí
 * que en Postgres, las boletas viejas dejarían de casar con su texto — de ahí
 * que se reproduzca EXACTO, incluidos el separador y el orden. `md5` no está
 * aquí por seguridad sino por compatibilidad con las filas ya escritas: es una
 * huella de contenido, no un resumen de contraseña.
 */
function versionLegal(fila) {
  const v = x => (x === null || x === undefined ? '' : String(x));
  const huella = crypto.createHash('md5').update(
    [v(fila.terminos_texto), v(fila.terminos_url),
     v(fila.privacidad_texto), v(fila.privacidad_url)].join('|'),
    'utf8',
  ).digest('hex');
  return { ...fila, version: huella };
}

/* ── 3 · El puente entre las columnas y `page_json` ───────────────────────
 *
 * Original: `private.fn_puente_page_json`, BEFORE INSERT OR UPDATE sobre
 * `eventos`.
 *
 * Qué resuelve: `paginas`, `branding` y `navbar` viven a la vez como columna
 * propia y como clave dentro de `page_json`. El código viejo lee de
 * `page_json`; el nuevo, de la columna. El disparador mantiene las dos caras
 * iguales mientras conviven, y decide cuál gana:
 *
 *   · si cambió la COLUMNA          → manda la columna, y se copia al JSON
 *   · si sólo cambió el JSON        → manda el JSON, y se copia a la columna
 *   · si no cambió ninguna          → se copia la columna al JSON igualmente
 *
 * El caso que hay que respetar es el tercero de `branding` y `navbar`: una
 * marca borrada a propósito (`{}`) tiene que BORRAR también la copia dentro
 * del JSON. Si sólo se dejara de escribir, el código viejo la leería del JSON
 * y la resucitaría en la siguiente lectura — que es exactamente el fallo de
 * «la marca se borra sola» que costó encontrar la primera vez.
 *
 * `paginas` no tiene ese caso: una lista vacía es una lista vacía, y se copia.
 */

/* Comparación por valor, que es lo que hace `is distinct from` en Postgres.
   Comparar los objetos con `!==` daría «cambió» siempre que llegara una copia
   nueva con el mismo contenido, y entonces la columna ganaría siempre. */
function iguales(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function esObjeto(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function puentePageJson(nueva, previa = null) {
  const inserta = previa === null;
  const fila = { ...nueva };
  const pj = { ...(fila.page_json || {}) };
  const pjPrevio = inserta ? {} : (previa.page_json || {});

  /* paginas ↔ pj.pages */
  const jsonCambio = !iguales(pj.pages, pjPrevio.pages);
  const colCambio  = inserta || !iguales(fila.paginas, previa.paginas);
  if (!colCambio && jsonCambio && Array.isArray(pj.pages)) {
    fila.paginas = pj.pages;
  } else {
    pj.pages = fila.paginas ?? [];
  }

  /* branding y navbar ↔ pj.branding y pj.navbar — misma regla los dos, y la
     única diferencia con `pages` es que el objeto vacío borra la copia. */
  for (const clave of ['branding', 'navbar']) {
    const jCambio = !iguales(pj[clave], pjPrevio[clave]);
    const cCambio = inserta || !iguales(fila[clave], previa[clave]);
    const valor   = fila[clave] ?? {};
    const vacio   = !esObjeto(valor) || Object.keys(valor).length === 0;

    if (cCambio) {
      if (!vacio) pj[clave] = valor; else delete pj[clave];
    } else if (jCambio && esObjeto(pj[clave])) {
      fila[clave] = pj[clave];
    } else if (!vacio) {
      pj[clave] = valor;
    }
  }

  fila.page_json = pj;
  return fila;
}

/* ── 4 · El expositor que nace de su boleta ───────────────────────────────
 *
 * Original: `fn_expositor_desde_boleta`, AFTER INSERT OR UPDATE sobre
 * `tickets`. Si el tipo de boleta lleva `es_expositor`, al pagarla se crea (o
 * se reactiva) su ficha en `networking_expositores`; y si la boleta se cancela
 * o se reembolsa, la ficha se desactiva.
 *
 * Es el único de los cuatro que escribe en OTRA tabla, así que necesita base.
 * Se le pasa `bd` para poder probarlo con una base simulada, igual que en
 * `modules/contadores`.
 *
 * El `on conflict (ticket_id) do update set activo = true` de Postgres se
 * traduce con `ON DUPLICATE KEY UPDATE`, que necesita que `ticket_id` tenga
 * índice único en MySQL — está en la lista de índices que emite el generador.
 * Se pone sólo `activo`, no el nombre ni el email: si el expositor ya editó su
 * ficha, reactivarla no debe deshacerle lo que escribió.
 */
const CANCELADOS = ['cancelado', 'reembolsado', 'invalido'];

async function expositorDesdeBoleta(bd, boleta) {
  const tipo = await bd('datos').unaFila(
    'SELECT es_expositor FROM ticket_types WHERE id = ?', [boleta.ticket_type_id],
  );
  if (!tipo || !tipo.es_expositor) return { accion: 'ninguna' };

  if (boleta.estado === 'pagado') {
    const nombre = String(boleta.guest_nombre || '').trim() || 'Expositor';
    await bd('datos').consultar(
      `INSERT INTO networking_expositores
         (evento_id, ticket_id, nombre, contacto_email, tipo_persona, activo, estado_ficha)
       VALUES (?, ?, ?, ?, 'empresa', 1, 'borrador')
       ON DUPLICATE KEY UPDATE activo = 1`,
      [boleta.evento_id, boleta.id, nombre, boleta.guest_email],
    );
    return { accion: 'alta' };
  }

  if (CANCELADOS.includes(boleta.estado)) {
    await bd('datos').consultar(
      'UPDATE networking_expositores SET activo = 0 WHERE ticket_id = ?', [boleta.id],
    );
    return { accion: 'baja' };
  }

  return { accion: 'ninguna' };
}

module.exports = {
  tocar,
  versionLegal,
  puentePageJson,
  expositorDesdeBoleta,
  CANCELADOS,
};
