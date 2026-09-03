'use strict';

const supabase = require('./supabase.js');

/* Las zonas del evento — PASO 2 de la mudanza de `page_json` a tabla.
 *
 * ── Dónde estamos ─────────────────────────────────────────────────────────
 *
 *   0091 (aplicada)  la tabla `zonas` existe y tiene copia de lo que había.
 *   ESTO             se lee de la tabla y se escribe en las DOS.
 *   0093             dejar de escribir el JSON, y sólo entonces borrarlo.
 *
 * Escribir en las dos no es indecisión: es lo que permite volver atrás. Si el
 * paso siguiente resulta que rompe algo, `page_json.zonas` sigue completo y
 * revertir es dejar de leer de la tabla. En cuanto se deje de escribirlo, ya
 * no.
 *
 * ── Por qué la lectura tiene vuelta atrás ────────────────────────────────
 *
 * `leerZonas` cae a `page_json` cuando la tabla no tiene NADA para ese evento.
 * No es paranoia: la 0091 copió lo que existía el 2 de septiembre, y un evento
 * creado antes de que este código se despliegue —o restaurado de una copia—
 * puede tener zonas en el JSON y ninguna fila. Devolver una lista vacía haría
 * desaparecer el plano de un evento en marcha, en silencio.
 *
 * La vuelta atrás se cae sola en el paso 3, cuando el JSON deje de existir. */

/* Forma única de una zona, la misma que devolvía `page_json`: quien lee no
   tiene que enterarse de que cambió de sitio. */
const TIPOS = ['evento', 'ingreso', 'evacuacion', 'otra'];
const TIPO_DEFECTO = 'evento';

/* `tipo` (0094) no viaja en `page_json`: las zonas de antes son zonas de
   evento, que es lo que eran. Un valor desconocido también cae ahí en vez de
   propagarse —la base lo rechazaría con un `check`, y aquí es preferible
   guardar algo cierto que romper el guardado entero por un campo de más. */
const normalizar = (z) => ({
  id: String(z.id),
  nombre: String(z.nombre || '').trim(),
  aforo_max: Number(z.aforo_max) || null,
  tipo: TIPOS.includes(z.tipo) ? z.tipo : TIPO_DEFECTO,
});

/* Las que se pueden usar: con id y con nombre de verdad. Mismo filtro que
   aplicaba `zonasDelEvento` al leer el JSON — una zona a medio crear no es una
   opción que se pueda elegir. */
const utilizables = (zonas) => (Array.isArray(zonas) ? zonas : [])
  .filter((z) => z && z.id && String(z.nombre || '').trim())
  .map(normalizar);

async function leerZonas(eventoId) {
  /* Se pide `tipo`, y si la 0094 todavía no está aplicada PostgREST contesta
     con un error —no con una lista vacía—. Ese error hay que MIRARLO: sin
     mirarlo, `filas` llega vacío, la lectura se cae al JSON y el plano del
     evento se vacía sin que nadie se entere. Ya ha pasado en esta base.

     Cuando falta la columna se reintenta sin ella y se deja constancia en el
     log, que es lo único honesto: las zonas se siguen sirviendo y queda dicho
     por qué no tienen tipo. */
  let { data: filas, error } = await supabase
    .from('zonas')
    .select('id, nombre, aforo_max, tipo')
    .eq('evento_id', eventoId)
    .order('orden', { ascending: true });

  if (error) {
    console.error(`[zonas] la tabla no respondió con \`tipo\` (¿falta la 0094?): ${error.message}`);
    ({ data: filas } = await supabase
      .from('zonas')
      .select('id, nombre, aforo_max')
      .eq('evento_id', eventoId)
      .order('orden', { ascending: true }));
  }

  if (filas && filas.length) return filas.map(normalizar);

  /* La vuelta atrás. Se mira `zonas` y, si la 0092 ya movió el JSON,
     `zonas_respaldo`: así sigue habiendo red durante el tiempo en que el
     respaldo exista, sin que este archivo tenga que saber si la migración
     está aplicada o no. */
  const { data: ev } = await supabase
    .from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
  return utilizables(ev?.page_json?.zonas ?? ev?.page_json?.zonas_respaldo);
}

/* Dejar la tabla igual que la lista que acaba de guardar el organizador.
 *
 * Se hace por diferencia y no borrando todo para reinsertar: un `delete` de
 * todas las zonas del evento haría saltar el `on delete set null` de las claves
 * foráneas y **dejaría sin zona a las charlas y los stands** que sí la tenían,
 * aunque la zona siguiera existiendo un milisegundo después. El síntoma sería
 * un plano que se vacía solo al guardar cualquier cosa.
 *
 * Las que desaparecen de la lista sí se borran, y ahí el `set null` es lo que
 * se quiere: la zona ya no existe.
 *
 * No lanza. Es una escritura de acompañamiento mientras el JSON siga siendo la
 * fuente de verdad para volver atrás; si fallara, lo que se guardó en
 * `page_json` sigue estando bien y la lectura cae ahí sola. */
async function sincronizarZonas(eventoId, zonas) {
  try {
    const quedan = utilizables(zonas);
    const vivos = quedan.map((z) => z.id);

    if (quedan.length) {
      const { error: falloUpsert } = await supabase.from('zonas').upsert(
        quedan.map((z, i) => ({
          id: z.id,
          evento_id: eventoId,
          nombre: z.nombre,
          aforo_max: z.aforo_max,
          tipo: z.tipo,
          orden: i,
        })),
        { onConflict: 'id' },
      );

      /* Sin la 0094 el upsert entero falla por una columna que no existe, y la
         zona se quedaría sólo en el JSON. Se reintenta sin `tipo` para no
         perder el guardado: es exactamente el caso para el que existe la
         vuelta atrás de la lectura. */
      if (falloUpsert) {
        console.error(`[zonas] upsert sin \`tipo\` (¿falta la 0094?): ${falloUpsert.message}`);
        await supabase.from('zonas').upsert(
          quedan.map((z, i) => ({
            id: z.id, evento_id: eventoId, nombre: z.nombre, aforo_max: z.aforo_max, orden: i,
          })),
          { onConflict: 'id' },
        );
      }
    }

    let borrado = supabase.from('zonas').delete().eq('evento_id', eventoId);
    if (vivos.length) borrado = borrado.not('id', 'in', `(${vivos.map((v) => `"${v}"`).join(',')})`);
    await borrado;
  } catch (e) {
    console.error(`[zonas] no se pudo sincronizar la tabla del evento ${eventoId}: ${e.message}`);
  }
}

module.exports = { leerZonas, sincronizarZonas, utilizables, TIPOS, TIPO_DEFECTO };
