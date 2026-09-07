/* GESTEK — Lo que esta boleta ya contestó, listo para heredar.
 *
 * La consulta que hace falta en los tres sitios que heredan: la inscripción a
 * un sub-evento, el panel del capitán y la ficha del expositor. Escrita una
 * vez porque las tres tienen que mirar el MISMO origen — el formulario del
 * evento tal como estaba — y si cada una arma su propia consulta acaban
 * heredando cosas distintas de la misma boleta.
 */

'use strict';

const supabase = require('./supabase.js');
const { COLUMNAS_CAMPO } = require('./formularioCampos.js');
const { porEtiqueta } = require('./heredarRespuestas.js');

/* Devuelve un Map etiqueta→valor. Vacío si no hay nada que heredar, y vacío
   también si algo falla: heredar es una comodidad y nunca puede tumbar la
   pantalla que la usa. */
async function loQueYaContesto(eventoId, respuestas) {
  if (!respuestas || !Object.keys(respuestas).length) return new Map();

  /* Los campos del EVENTO, que es donde se contestó. Sin los de otro
     sub-evento ni los de un torneo: heredar de un taller a otro taller
     cruzaría respuestas entre actividades que no tienen que ver. */
  const { data, error } = await supabase
    .from('event_form_fields').select(COLUMNAS_CAMPO)
    .eq('evento_id', eventoId)
    .is('session_id', null)
    .is('torneo_id', null)
    .order('orden', { ascending: true });

  if (error) {
    console.warn('[heredar] no se pudieron leer los campos del evento:', error.message);
    return new Map();
  }
  return porEtiqueta(data || [], respuestas);
}

module.exports = { loQueYaContesto };
