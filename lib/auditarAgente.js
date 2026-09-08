'use strict';

/* Dejar rastro de lo que hace el agente.
 *
 * ── El agujero ───────────────────────────────────────────────────────────
 *
 * Medido sobre `lib/agente.js`: **52 escrituras a la base y cero auditadas.**
 * El panel anota cada cambio de estado, cada cortesía, cada miembro que sale
 * del equipo. Por el agente —el chat del panel y el conector de Claude— no se
 * anotaba nada.
 *
 * O sea que alguien podía publicar un evento, emitir cortesías o sacar a una
 * persona del equipo, y el registro de auditoría no lo sabía. Y desde que los
 * tokens del MCP se pueden conceder con permiso de «Dinero y accesos», eso deja
 * de ser teórico: se le puede dar a Claude, y no queda constancia.
 *
 * ── Por qué aquí y no en cada herramienta ────────────────────────────────
 *
 * Son 68 herramientas. Poner una llamada en cada una es 68 sitios donde
 * olvidarla —y la 69ª nacería sin ella—. `ejecutarTool` es el único punto por
 * el que pasan todas, así que se anota ahí: una llamada, cobertura completa, y
 * lo nuevo queda cubierto sin que nadie se acuerde.
 *
 * ── Qué NO se anota ──────────────────────────────────────────────────────
 *
 * Lo que sólo lee. `ver_asistentes` o `listar_eventos` no cambian nada, y
 * anotarlas llenaría el registro de ruido hasta que dejara de mirarse — que es
 * la forma habitual de que una auditoría deje de servir.
 */

/* `supabase` se pide DENTRO de la función y no aquí arriba.
 *
 * Cargarlo al importar obliga a tener credenciales para cualquier cosa que
 * toque este archivo — incluida una prueba de `resumirInput`, que es aritmética
 * de cadenas y no habla con nadie. Y una pieza que no se puede probar sin
 * montar medio entorno acaba sin pruebas. */

/* Los prefijos de lo que sólo consulta. Se decide por el nombre y no con una
   lista de 68: una herramienta nueva que empiece por `ver_` no hace falta que
   nadie la clasifique, y una que no encaje se anota — equivocarse hacia anotar
   de más es barato; hacia anotar de menos, no. */
const SOLO_LEEN = /^(ver_|listar_|buscar_|analitica|comparar_|resumen_|ingresos_|estadisticas_|catalogo_|tareas_|_)/;

/* De dónde sale el evento. Cada herramienta lo nombra a su manera, y sin él la
   anotación no se puede enseñar en la pantalla de auditoría del evento. */
function eventoDe(input, resultado) {
  return input?.evento_id
      || resultado?.evento?.id
      || resultado?.evento_id
      || resultado?.sesion?.evento_id
      || null;
}

/* Lo que se guarda del input. Recortado a propósito: un `detalle` con el texto
   entero de una descripción larga hace ilegible la pantalla de auditoría, y lo
   que hace falta ahí es «qué se tocó», no «con qué contenido exacto». */
function resumirInput(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.length > 120 ? `${v.slice(0, 117)}…` : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length}]`;
    else out[k] = '{…}';
  }
  return out;
}

/* Anota. No lanza y no se espera: si la anotación falla, la acción ya ocurrió y
   hacerla fracasar por el registro sería cambiar un problema pequeño por uno
   grande. Se apunta en la consola, que es lo que permite encontrarlo. */
async function anotarAccionDelAgente({ userId, nombre, input, resultado, via }) {
  if (!nombre || SOLO_LEEN.test(nombre)) return;
  /* Lo que falló no se anota como hecho. Que alguien lo intentara es
     interesante, pero mezclarlo con lo que sí ocurrió haría que el registro
     dejara de responder «qué pasó». */
  if (resultado?.error) return;

  const eventoId = eventoDe(input, resultado);
  if (!eventoId) return;   // la pantalla de auditoría es por evento

  try {
    const supabase = require('./supabase.js');
    await supabase.from('audit_log').insert({
      evento_id  : eventoId,
      actor_id   : userId || null,
      actor_email: null,
      /* El prefijo dice de dónde vino. En la pantalla, «agente.emitir_cortesia»
         se distingue de la misma acción hecha a mano — y esa diferencia es
         justo lo que alguien va a querer saber. */
      accion     : `agente.${nombre}`,
      entidad    : 'agente',
      entidad_id : null,
      detalle    : { via: via || 'panel', input: resumirInput(input) },
    });
  } catch (e) {
    console.error(`[auditar-agente] ${nombre}: ${e.message}`);
  }
}

module.exports = { anotarAccionDelAgente, SOLO_LEEN, resumirInput, eventoDe };
