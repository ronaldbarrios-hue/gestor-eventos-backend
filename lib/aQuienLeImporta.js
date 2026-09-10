'use strict';

/* Quién tiene que enterarse de algo que pasa en el evento.
 *
 * ── El problema ──────────────────────────────────────────────────────────
 *
 * Los avisos del evento se mandaban a `evento.owner_id` y a nadie más. Es la
 * cuenta que creó el evento, que casi nunca es quien está mirando.
 *
 * El caso que lo destapó: el aviso de aforo lleno. Quien vigila el aforo es
 * quien lleva la logística —está en el sitio, con el teléfono en la mano— y el
 * aviso le llegaba a otra persona, que a lo mejor está en una reunión. La zona
 * se pasaba de aforo y la única que se enteraba era la que no podía hacer nada
 * al respecto. No fallaba nada: la notificación salía, puntual, a la persona
 * equivocada.
 *
 * ── La regla ─────────────────────────────────────────────────────────────
 *
 * Se avisa a quien PUEDE hacer algo: quien tiene alguno de los permisos que
 * abren esa pantalla, más quien creó el evento —que sigue queriendo saberlo— y
 * los co-dueños. Es la misma lista que decide si la pantalla se abre, así que
 * un aviso nunca lleva a una puerta cerrada.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────
 *
 * No decide cuándo avisar ni cuántas veces. Eso lo sabe quien llama —el aviso
 * de aforo, por ejemplo, se manda una vez por episodio— y meterlo aquí haría
 * que dos avisos distintos compartieran un contador que no tienen por qué
 * compartir.
 */

/* Tope de a cuánta gente se le manda un mismo aviso.
 *
 * No por coste: por ruido. Un evento con treinta personas en el equipo y una
 * puerta llena toda la tarde convierte el aviso en algo que todo el mundo
 * silencia, y entonces no avisa de nada. Si alguna vez se llega aquí, es señal
 * de que el permiso elegido es demasiado ancho para este aviso. */
const TOPE = 12;

/* Devuelve los ids de usuario a los que hay que avisar. Nunca lanza: un aviso
 * que no se puede repartir no puede tumbar lo que estaba pasando. */
async function aQuienLeImporta(eventoId, permisos = [], { ownerId = null, salvo = null } = {}) {
  const supabase = require('./supabase.js');
  const gente = new Set();

  let dueño = ownerId;
  if (!dueño) {
    const { data } = await supabase.from('eventos').select('owner_id').eq('id', eventoId).maybeSingle();
    dueño = data?.owner_id || null;
  }
  if (dueño) gente.add(String(dueño));

  const { data, error } = await supabase
    .from('event_members')
    .select('user_id, custom_permissions, rol_detail:event_roles!rol_id(permissions)')
    .eq('evento_id', eventoId)
    .eq('status', 'active');

  if (error) {
    /* Se anota y se sigue con el dueño: repartir a menos gente es peor que a
       nadie, pero mucho mejor que quedarse callado. */
    console.error(`[avisos] no se pudo mirar el equipo de ${eventoId}: ${error.message}`);
  }

  for (const m of data || []) {
    if (!m.user_id) continue;
    const suyos = new Set([...(m.rol_detail?.permissions || []), ...(m.custom_permissions || [])]);
    /* `*` es el co-dueño: manda igual que quien creó el evento, así que se
       entera de lo mismo. La misma regla que `lib/acceso.js`. */
    if (suyos.has('*') || permisos.some(p => suyos.has(p))) gente.add(String(m.user_id));
  }

  /* Quien provocó el aviso no necesita que se lo cuenten. */
  if (salvo) gente.delete(String(salvo));

  return [...gente].slice(0, TOPE);
}

module.exports = { aQuienLeImporta, TOPE };
