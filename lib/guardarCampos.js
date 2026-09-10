'use strict';

/* Guardar la definición de UN formulario, sea de quien sea.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * `event_form_fields` guarda TRES formularios distintos en la misma tabla,
 * distinguidos por qué columna llevan puesta:
 *
 *   del evento     `session_id` y `torneo_id` en NULL   → la compra de boletas
 *   de un torneo   `torneo_id`                          → la inscripción de equipos
 *   de un sub-evento `session_id`                       → la inscripción a un taller
 *
 * Y guardar cualquiera de ellos es el mismo baile de tres pasos: borrar lo que
 * ya no viene, actualizar lo que conserva su id —para no romper el vínculo con
 * las respuestas ya escritas— e insertar lo nuevo.
 *
 * Ese baile estaba escrito DOS veces, en `routes/eventos.js` y en
 * `routes/torneos.js`, con cien líneas casi iguales. Añadir el de los
 * sub-eventos habría hecho tres, y tres copias de un `delete` con filtro es la
 * forma de que un día una se olvide un `is('session_id', null)` y el editor de
 * un formulario se lleve por delante las preguntas de otro.
 *
 * Ese fallo exacto ya ocurrió en este repo con los motivos de los stands —se
 * filtró la lectura y se olvidó el borrado—, y está anotado en el comentario
 * de la ruta del evento. Aquí el filtro se escribe UNA vez y se usa para las
 * dos cosas, así que no se pueden separar.
 *
 * ── Lo que NO decide este archivo ────────────────────────────────────────
 *
 * Quién puede guardar. Eso es de cada ruta, que sabe si mira el permiso del
 * evento, el del torneo o el de la agenda.
 */

const {
  filaCampo, validarDefinicion, COLUMNAS_CAMPO,
  TIPOS_CAMPO, GRUPOS, FICHAS, PLANTILLA, MAX_CAMPOS_FORMULARIO,
} = require('./formularioCampos.js');

/* Lo que había antes de la 0055. Último recurso para que el editor abra en un
   despliegue atrasado en vez de enseñar un error. */
const COLUMNAS_VIEJAS = 'id, tipo, etiqueta, opciones, requerido, orden, ticket_type_id';

/* De quién es este formulario, dicho como el filtro que lo identifica.
 *
 * `alcance` es lo que hay que poner en las filas nuevas, y su negativo es lo
 * que hay que excluir al leer. Se derivan el uno del otro a propósito: escritos
 * aparte, un formulario acabaría leyendo un conjunto y borrando otro. */
const DUEÑOS = ['session_id', 'torneo_id'];

const esDelEvento = (alcance = {}) => !DUEÑOS.some(col => alcance[col]);

function aplicarAlcance(consulta, eventoId, alcance = {}) {
  let q = consulta.eq('evento_id', eventoId);
  for (const col of DUEÑOS) {
    /* El que manda va con `eq`; los otros con `is null`. Un formulario de
       evento excluye los dos, y uno de torneo excluye las sesiones. */
    q = alcance[col] ? q.eq(col, alcance[col]) : q.is(col, null);
  }
  return q;
}

/* Lee los campos de UN formulario.
 *
 * Con reintento sin `torneo_id`: en un despliegue sin la 0095 esa columna no
 * existe y el filtro rompe la consulta ENTERA — o sea, el editor se abre vacío
 * y guardar borraría todo lo que hay. Sin la columna no hay campos de torneo
 * que proteger, así que se repite sin ella; lo que no se puede es guardar a
 * ciegas. */
async function leerCampos(eventoId, alcance = {}) {
  const supabase = require('./supabase.js');
  const pedir = (alc, columnas) => aplicarAlcance(
    supabase.from('event_form_fields').select(columnas), eventoId, alc,
  ).order('orden', { ascending: true });

  let { data, error } = await pedir(alcance, COLUMNAS_CAMPO);
  if (error && /torneo_id/i.test(error.message || '')) {
    const sinTorneo = { ...alcance };
    delete sinTorneo.torneo_id;
    ({ data, error } = await pedir(sinTorneo, COLUMNAS_CAMPO));
  }
  /* Y un último intento con las columnas de antes de la 0055: sin `grupo` ni
     `ayuda` el editor pierde el agrupado, pero sigue abriendo. Se avisa a quien
     lo lee —`agrupacion_lista`— para que no ofrezca lo que no se va a guardar. */
  let completo = true;
  if (error) {
    completo = false;
    ({ data, error } = await pedir(alcance, COLUMNAS_VIEJAS));
  }
  return { campos: data || [], completo, error: error || null };
}

/* Guarda la lista completa de UN formulario. Devuelve `{ campos }` con lo que
 * quedó, o `{ error, estado }`.
 *
 * `campos` es la lista ENTERA: lo que no venga se borra. Por eso el filtro
 * importa tanto — es lo único que separa «borra lo que sobra de este
 * formulario» de «borra las preguntas de los demás».
 */
async function guardarCampos({ eventoId, alcance = {}, campos, max }) {
  const supabase = require('./supabase.js');
  const lista = Array.isArray(campos) ? campos : [];

  const falloDef = validarDefinicion(lista, max ? { max } : undefined);
  if (falloDef) return { error: falloDef, estado: 400 };

  const pedirIds = (cols) => aplicarAlcance(
    supabase.from('event_form_fields').select('id'), eventoId, cols,
  );
  let { data: existentes, error: eGet } = await pedirIds(alcance);
  if (eGet && /torneo_id/i.test(eGet.message || '')) {
    const sinTorneo = { ...alcance };
    delete sinTorneo.torneo_id;
    ({ data: existentes, error: eGet } = await pedirIds(sinTorneo));
  }
  if (eGet) return { error: eGet.message, estado: 500 };

  const idsExistentes = new Set((existentes || []).map(c => c.id));
  const idsEnviados = new Set(lista.filter(c => c.id && idsExistentes.has(c.id)).map(c => c.id));

  /* 1 · Borrar lo que ya no viene. */
  const idsABorrar = [...idsExistentes].filter(id => !idsEnviados.has(id));
  if (idsABorrar.length) {
    const { error } = await supabase.from('event_form_fields').delete().in('id', idsABorrar);
    if (error) return { error: error.message, estado: 500 };
  }

  /* 2 · Actualizar los que conservan su id. Se conserva a propósito: lo que ya
     contestó alguien apunta a él, y cambiarlo dejaría respuestas huérfanas. */
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    if (!c.id || !idsExistentes.has(c.id)) continue;
    const { error } = await supabase
      .from('event_form_fields').update(filaCampo(c, i)).eq('id', c.id);
    if (error) return { error: error.message, estado: 500 };
  }

  /* 3 · Insertar los nuevos, con el alcance puesto. */
  const nuevos = lista.map((c, i) => ({ ...c, _orden: i }))
    .filter(c => !c.id || !idsExistentes.has(c.id));
  if (nuevos.length) {
    const filas = nuevos.map(c => ({
      evento_id: eventoId,
      ...alcance,
      /* «Sólo para el tipo VIP» es un filtro del formulario de COMPRA. En el de
         un torneo o un taller el filtro ya es el torneo o el taller, y dejar un
         `ticket_type_id` ahí escondería la pregunta sin que nadie sepa por qué. */
      ...filaCampo(esDelEvento(alcance) ? c : { ...c, ticket_type_id: null }, c._orden),
    }));
    const { error } = await supabase.from('event_form_fields').insert(filas);
    if (error) return { error: error.message, estado: 500 };
  }

  /* Se relee con el MISMO filtro: lo que se devuelve es lo que el editor
     volverá a mandar la próxima vez, así que colar aquí un campo de otro
     formulario es hacer que este editor lo adopte sin querer. */
  const { campos: final, error: eFinal } = await leerCampos(eventoId, alcance);
  /* Se acaban de guardar: si la relectura falla y se devuelve vacío, el panel
     enseña que no hay campos justo después de crearlos. */
  if (eFinal) console.error(`[formulario] releer ${eventoId}: ${eFinal.message}`);

  return { campos: final };
}

/* Lo que hace falta para PINTAR un editor de formulario: qué tipos de pregunta
 * existen, qué grupos se sugieren, qué fichas prearmadas hay y cómo es la hoja
 * de importación.
 *
 * ── Por qué viaja con la respuesta y por qué es UNA función ──────────────
 *
 * Con la respuesta, porque si el panel guarda su propia copia del catálogo, un
 * tipo nuevo del servidor no aparece en el desplegable y nadie se entera: la
 * plataforma «no lo hace», sin ningún error.
 *
 * Y en una función porque las tres rutas lo armaban a mano, y no armaban lo
 * mismo. El formulario del evento mandaba `fichas` y `plantilla`; los de
 * sub-evento y torneo, no. Resultado: la ficha de contacto y la importación
 * desde Excel existían sólo en uno de los tres editores — quien tenía que
 * escribir veintiuna preguntas de un torneo las escribía a mano una a una,
 * mientras la misma pantalla las importaba de una hoja para el evento. Nada
 * fallaba; simplemente no estaba.
 *
 * `fichas` sigue pudiendo apagarse por ruta si algún día una no las quiere,
 * pero apagarla es entonces una decisión escrita, no un olvido. */
function catalogoDeFormulario({ max = MAX_CAMPOS_FORMULARIO, fichas = true } = {}) {
  return {
    tipos: TIPOS_CAMPO,
    grupos: GRUPOS,
    fichas: fichas ? FICHAS : [],
    plantilla: PLANTILLA,
    max_campos: max,
  };
}

module.exports = {
  catalogoDeFormulario,
  DUEÑOS, COLUMNAS_VIEJAS, aplicarAlcance, leerCampos, guardarCampos, esDelEvento };
