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

/* Las puertas, espejadas como zonas de tipo ingreso (0096).
 *
 * Una puerta y una zona son la misma cosa —sitios del recinto— y desde la 0094
 * lo que las distingue es el tipo. Pero las REGLAS de la puerta —qué tipos de
 * boleta admite, qué staff la atiende— siguen en `page_json.accesos`, que es de
 * donde las lee el control de ingreso.
 *
 * Así que hay un dueño y un espejo: el JSON manda, y esta función deja la fila
 * de `zonas` diciendo lo mismo. Sin esto, renombrar una puerta la dejaría con
 * dos nombres distintos según quién la mire.
 *
 * El id se conserva —el `acc_…` de la puerta es el id de la zona— para que los
 * marcadores del plano sigan apuntando a algo que existe.
 *
 * No lanza, por lo mismo que `sincronizarZonas`: es una escritura de
 * acompañamiento, y si fallara, la puerta sigue entera donde el ingreso la lee. */
async function sincronizarPuertas(eventoId, accesos) {
  try {
    const quedan = (Array.isArray(accesos) ? accesos : [])
      .filter((a) => a && a.id && String(a.nombre || '').trim())
      .map((a, i) => ({
        id: String(a.id),
        evento_id: eventoId,
        nombre: String(a.nombre).trim(),
        /* Una puerta no declara aforo: no se llena, se cruza. */
        aforo_max: null,
        tipo: 'ingreso',
        /* Las reglas viajan con la puerta (0098). Sin esto, renombrarla desde el
           panel dejaría la fila con el nombre nuevo y las reglas viejas. */
        reglas: {
          ...(Array.isArray(a.tipos) && a.tipos.length ? { tipos: a.tipos } : {}),
          ...(Array.isArray(a.staff) && a.staff.length ? { staff: a.staff } : {}),
          ...(a.zona_id ? { zona_destino: a.zona_id } : {}),
        },
        orden: 1000 + i,
      }));

    if (quedan.length) {
      const { error } = await supabase.from('zonas').upsert(quedan, { onConflict: 'id' });
      if (error) throw error;
    }

    /* Las puertas que ya no están se borran de `zonas`, pero **sólo las de tipo
       ingreso**: sin ese filtro, guardar la lista de puertas se llevaría por
       delante todas las zonas del evento. Es la misma trampa que apareció con
       los motivos de los stands —un borrado por ausencia contra una lista que
       no conoce a los demás—. */
    let borrado = supabase.from('zonas').delete().eq('evento_id', eventoId).eq('tipo', 'ingreso');
    const vivos = quedan.map((z) => z.id);
    if (vivos.length) borrado = borrado.not('id', 'in', `(${vivos.map((v) => `"${v}"`).join(',')})`);
    await borrado;
  } catch (e) {
    console.error(`[zonas] no se pudieron espejar las puertas del evento ${eventoId}: ${e.message}`);
  }
}

/* Devolver el evento con sus zonas dentro de `page_json`, como si nunca se
 * hubieran mudado.
 *
 * ── Por qué esto es imprescindible desde la 0092 ───────────────────────
 *
 * La 0092 quitó `page_json.zonas`. En el servidor la mudanza estaba hecha —el
 * aforo lee de la tabla—, pero **el panel y la página pública leen el evento
 * que este endpoint devuelve**, y ahí dentro buscan `page_json.zonas`: la
 * pantalla de Zonas, el selector de zona de un sub-evento, el escáner y el
 * bloque de mapa de la landing. Cuatro sitios que se quedaron en blanco a la
 * vez, sin un solo error, en cuanto la migración corrió.
 *
 * Así que la tabla es la fuente y esto es la traducción: quien lee el evento
 * sigue viendo la misma forma de siempre. Se hace aquí, en un sitio, en vez de
 * cambiar los cuatro consumidores —que además tendrían que pedir las zonas por
 * su cuenta y convertir una petición en cinco—.
 */
async function conZonas(evento) {
  if (!evento || typeof evento !== 'object') return evento;
  try {
    const zonas = await leerZonas(evento.id);
    return { ...evento, page_json: { ...(evento.page_json || {}), zonas } };
  } catch (e) {
    /* Si la consulta falla, se devuelve el evento tal cual: mejor una pantalla
       sin zonas que un evento que no carga. Y queda dicho en el log, que es lo
       que faltaba la última vez. */
    console.error(`[zonas] no se pudieron adjuntar al evento ${evento.id}: ${e.message}`);
    return evento;
  }
}

/* Una puerta con sus reglas: qué boletas admite y quién la atiende.
 *
 * ── Por qué mira los dos sitios ───────────────────────────────────
 *
 * Las reglas se mudan a `zonas.reglas` (0098) y el original se queda en
 * `page_json.accesos` hasta que el código lleve tiempo leyendo de la tabla. Así
 * que esto prefiere la tabla y cae al JSON cuando la fila no tiene nada —una
 * puerta creada con el código viejo, o la migración todavía sin correr—.
 *
 * La vuelta atrás importa más aquí que en las zonas: esto decide **quién
 * entra**. Una lectura vacía no sería una pantalla en blanco, sería una puerta
 * que deja pasar a cualquiera —o que no deja pasar a nadie—.
 *
 * Devuelve la forma de siempre —`{ id, nombre, tipos, staff, zona_id }`— para
 * que el control de ingreso no tenga que enterarse de nada. */
async function leerPuerta(eventoId, accesoId) {
  if (!accesoId) return null;

  const { data: fila } = await supabase
    .from('zonas')
    .select('id, nombre, tipo, reglas')
    .eq('id', accesoId).eq('evento_id', eventoId).maybeSingle();

  const reglas = fila?.reglas && Object.keys(fila.reglas).length ? fila.reglas : null;
  if (fila && reglas) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      tipos: Array.isArray(reglas.tipos) ? reglas.tipos : [],
      staff: Array.isArray(reglas.staff) ? reglas.staff : [],
      zona_id: reglas.zona_destino || null,
    };
  }

  const { data: ev } = await supabase
    .from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
  const lista = Array.isArray(ev?.page_json?.accesos) ? ev.page_json.accesos : [];
  const a = lista.find(x => x && x.id === accesoId);
  if (!a) return fila ? { id: fila.id, nombre: fila.nombre, tipos: [], staff: [], zona_id: null } : null;

  return {
    id: a.id,
    nombre: a.nombre,
    tipos: Array.isArray(a.tipos) ? a.tipos : [],
    staff: Array.isArray(a.staff) ? a.staff : [],
    zona_id: a.zona_id || null,
  };
}

module.exports = {
  leerZonas, sincronizarZonas, sincronizarPuertas, conZonas, leerPuerta,
  utilizables, TIPOS, TIPO_DEFECTO,
};
