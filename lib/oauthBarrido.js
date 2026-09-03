'use strict';

const supabase = require('./supabase.js');

/* Barrer los códigos y tokens de OAuth caducados.
 *
 * ── Por qué existía y no corría ───────────────────────────────────────────
 *
 * La 0073 dejó escrita `public.oauth_barrer()` y explicó en su cabecera que se
 * haría «por consulta y no con pg_cron a propósito: pg_cron es justamente una
 * de las piezas de las que queremos depender menos, y esto lo puede llamar el
 * backend en el mismo ciclo que ya corre cada quince minutos».
 *
 * Ese último paso nunca se dio. La función quedó en la base sin que nadie la
 * llamara, así que `oauth_codes` y `oauth_tokens` **crecen sin límite** desde
 * entonces. Es la forma más silenciosa de deuda: no falla nada, sólo engorda
 * una tabla que nadie mira, en una cuenta con 9,81 GB compartidos.
 *
 * ── Dónde se llama ────────────────────────────────────────────────────────
 *
 * Desde `scripts/cron-recordatorios.js`, que es el ciclo de quince minutos que
 * la migración tenía en mente. No lleva cron propio: una entrada más en cPanel
 * es una cosa más que alguien tiene que acordarse de crear al desplegar, y
 * esto no necesita su propio horario — necesita correr de vez en cuando.
 *
 * Los umbrales viven en la función SQL (un día para los códigos, treinta para
 * los tokens revocados) y no aquí: lo que se borra es una decisión de la base,
 * no del planificador. */

async function barrerOauth() {
  const { error } = await supabase.rpc('oauth_barrer');
  if (error) throw new Error(error.message);
}

module.exports = { barrerOauth };
