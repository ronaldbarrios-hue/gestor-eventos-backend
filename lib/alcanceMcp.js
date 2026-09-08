'use strict';

/* Qué puede hacer Claude con tu cuenta.
 *
 * ── El estado del que se parte ───────────────────────────────────────────
 *
 * El servidor MCP ya existía y ya exponía las 73 herramientas del Gestbot. La
 * columna `api_tokens.scopes` también existía. Y nadie las miraba: un token
 * valía para TODO, incluido emitir cortesías, marcar boletas como pagadas y
 * sacar gente del equipo.
 *
 * Peor todavía: `api_tokens` tenía **cero filas**, porque la pantalla de
 * Integraciones sólo ofrecía Google Calendar. O sea que el servidor MCP estaba
 * construido, montado y era inalcanzable — el fallo de siempre en esta base:
 * la pieza existe y no hay control para llegar a ella.
 *
 * ── Por qué grupos y no 73 casillas ──────────────────────────────────────
 *
 * Una pantalla con setenta y tres interruptores no se configura: se acepta por
 * defecto. Y un permiso que nadie lee de verdad es peor que ninguno, porque da
 * la sensación de haber decidido algo.
 *
 * Cuatro grupos, y el corte no es por módulo sino por **qué pasa si se
 * equivoca**: leer no rompe nada; montar cosas se deshace; publicar y tocar
 * dinero o el equipo, no.
 */

/* Las que no salen por MCP pase lo que pase. `solicitar_formulario` le pide
   datos al usuario por la pantalla del chat, y por MCP no hay pantalla: se
   quedaría esperando una respuesta que nunca llega. */
const NUNCA = new Set(['solicitar_formulario']);

const GRUPOS = [
  {
    id: 'leer',
    label: 'Ver información',
    detalle: 'Consultar eventos, asistentes, agenda, torneos, ingresos y analítica. No cambia nada.',
    /* Va marcado y no se puede quitar: un token que no lee no sirve para nada,
       y dejar crear uno vacío sería dejar crear algo que no funciona. */
    fijo: true,
    prueba: (n) => /^(ver_|listar_|buscar_|analitica|comparar_|resumen_|ingresos_|estadisticas_|catalogo_|tareas_)/.test(n),
  },
  {
    id: 'montar',
    label: 'Crear y editar',
    detalle: 'Armar eventos, boletas, agenda, torneos, expositores, la página pública. Todo esto se puede deshacer a mano.',
    prueba: () => true,   // lo que no cae en otro grupo
  },
  {
    id: 'publicar',
    label: 'Publicar y cancelar',
    detalle: 'Abrir el evento al público o cerrarlo. Aparte porque publicar sin querer manda correos y hace visible algo a medio montar.',
    prueba: (n) => /^(publicar_|cambiar_estado_evento)/.test(n),
  },
  {
    id: 'dinero',
    label: 'Dinero y accesos',
    detalle: 'Marcar boletas como pagadas, emitir cortesías, códigos de descuento, invitar o sacar gente del equipo. Lo que no se deshace con un clic.',
    prueba: (n) => /(reembols|marcar_boleta_pagada|cortesia|descuento|invitar_miembro|quitar_miembro|crear_rol|checkin_)/.test(n),
  },
];

/* El orden importa: `montar` es el cajón de sastre y tiene que evaluarse el
   ÚLTIMO, o se quedaría con todo. */
const ORDEN = ['leer', 'publicar', 'dinero', 'montar'];

function grupoDe(nombre) {
  for (const id of ORDEN) {
    const g = GRUPOS.find(x => x.id === id);
    if (g.prueba(nombre)) return id;
  }
  return 'montar';
}

const IDS = GRUPOS.map(g => g.id);
const FIJOS = GRUPOS.filter(g => g.fijo).map(g => g.id);

/* Lo que se guarda en `api_tokens.scopes`.
 *
 * Se limpia aquí para que la ruta que crea y la que comprueba no puedan
 * separarse: un alcance inventado que se guarda y luego no se reconoce dejaría
 * un token que no puede hacer nada y no dice por qué. */
function alcancesValidos(lista) {
  const pedidos = Array.isArray(lista) ? lista : [];
  const limpios = pedidos.filter(x => IDS.includes(x));
  return [...new Set([...FIJOS, ...limpios])];
}

/* Las herramientas que ve un token.
 *
 * Un token SIN alcances guardados —los que existían antes de esto— se trata
 * como si los tuviera todos. No es una laguna: es que revocarle permisos a algo
 * que ya funcionaba, sin avisar, rompe una integración en marcha sin dejar
 * rastro de por qué. Lo que se hace es que los nuevos nazcan con su lista.
 */
function herramientasPara(tools = [], scopes) {
  const disponibles = tools.filter(t => t?.name && !t.name.startsWith('_') && !NUNCA.has(t.name));
  if (!Array.isArray(scopes) || scopes.length === 0) return disponibles;
  const permitidos = new Set(alcancesValidos(scopes));
  return disponibles.filter(t => permitidos.has(grupoDe(t.name)));
}

/* Si una herramienta se puede ejecutar con este token.
 *
 * Se comprueba APARTE de la lista, y no dando por hecho que quien llama sólo
 * pide lo que se le enseñó. Un cliente MCP puede llamar a `tools/call` con
 * cualquier nombre: filtrar la lista es cortesía, comprobar la llamada es la
 * seguridad. */
function puedeEjecutar(nombre, scopes, tools = []) {
  if (!nombre || NUNCA.has(nombre) || nombre.startsWith('_')) return false;
  /* Que EXISTA, además de que el alcance la permita. Son dos preguntas
     distintas y al principio sólo hice la segunda: como un token sin alcances
     lo permite todo, un nombre inventado pasaba el filtro y llegaba hasta
     `ejecutarTool`. Lo cazó la prueba que espera -32602. */
  if (tools.length && !tools.some(t => t?.name === nombre)) return false;
  if (!Array.isArray(scopes) || scopes.length === 0) return true;
  return alcancesValidos(scopes).includes(grupoDe(nombre));
}

/* Para la pantalla: los grupos con cuántas herramientas trae cada uno. Sin el
   número, «Crear y editar» no dice si son tres cosas o cuarenta. */
function catalogo(tools = []) {
  const cuenta = {};
  for (const t of tools) {
    if (!t?.name || t.name.startsWith('_') || NUNCA.has(t.name)) continue;
    const g = grupoDe(t.name);
    cuenta[g] = (cuenta[g] || 0) + 1;
  }
  return GRUPOS.map(g => ({
    id: g.id, label: g.label, detalle: g.detalle,
    fijo: Boolean(g.fijo), herramientas: cuenta[g.id] || 0,
  }));
}

module.exports = { GRUPOS, IDS, FIJOS, NUNCA, grupoDe, alcancesValidos, herramientasPara, puedeEjecutar, catalogo };
