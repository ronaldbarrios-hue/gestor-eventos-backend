'use strict';

/* Lo que se crea junto con un evento nuevo.
 *
 * Paso 4 de la fase 6 (ver db/migraciones/NOTAS-ESQUEMA.md). Hoy son tres
 * disparadores sobre `eventos` —`seed_chat_channels`, `seed_event_roles` y
 * `seed_page_json_v2`— y se van al código.
 *
 * ── Por qué esto NO es como los contadores ────────────────────────────────
 *
 * `modules/contadores/` existe porque un disparador que cuenta es atómico y el
 * mismo contador desde el código no lo es. Aquí no hay nada de eso: crear
 * cuatro canales de chat al crear un evento no compite con nadie. Lo que se
 * gana al sacarlo es otra cosa:
 *
 *   · Se puede LEER. «El evento nace con estos diez roles y estos cuatro
 *     canales» es una decisión de producto, y estaba escondida en una función
 *     de base que hay que saber que existe para encontrarla.
 *   · Se puede CAMBIAR sin migración. Añadir un rol hoy es un `CREATE OR
 *     REPLACE FUNCTION` en producción; aquí es una línea y un despliegue.
 *   · Se puede PROBAR sin base.
 *
 * ── El orden importa ──────────────────────────────────────────────────────
 *
 * Los tres van DESPUÉS de que el evento exista, porque los tres cuelgan de su
 * id. El de la página es la excepción: en Postgres es un BEFORE INSERT que
 * rellena la columna antes de guardarla, así que aquí devuelve el valor y quien
 * cree el evento lo mete en el INSERT. Hacerlo después obligaría a un UPDATE
 * inmediato, y ahí sí habría una ventana en la que el evento existe sin página.
 *
 * ── Estado ────────────────────────────────────────────────────────────────
 *
 * No se llama desde ninguna ruta todavía: los datos siguen en Supabase y allí
 * los disparadores hacen su trabajo. Se escribe ahora porque es la parte que
 * hay que decidir, no la que hay que teclear.
 */

/* ── Los canales de chat ──────────────────────────────────────────────────
 *
 * `general` lo ve todo el mundo; los `staff` sólo el equipo. Esa distinción es
 * la que hace que el chat sirva para las dos cosas a la vez, y por eso el tipo
 * va aquí y no se deduce del nombre. */
const CANALES = [
  { nombre: 'General',   tipo: 'general' },
  { nombre: 'Acceso',    tipo: 'staff'   },
  { nombre: 'Logística', tipo: 'staff'   },
  { nombre: 'Atención',  tipo: 'staff'   },
];

/* ── Los roles del evento ─────────────────────────────────────────────────
 *
 * Copiados de `private.fn_roles_semilla()` tal como está en producción, con
 * sus permisos exactos. Nacen como `is_system` para que se distingan de los
 * que cree el organizador: los suyos se pueden borrar, éstos no.
 *
 * Ojo: seis de estos permisos no los verifica todavía nadie —`vip_zone`,
 * `crear_canales`, `borrar_mensajes`, `ver_pagos`, `reembolsar` y
 * `gestionar_descuentos`—. Están en la semilla a propósito: el rol describe lo
 * que ESE puesto hace, y quitarlos ahora obligaría a acordarse de volver a
 * ponerlos el día que se implementen. Quedan anotados en POR-HACER.md §4. */
const ROLES = [
  { nombre: 'Editor',            descripcion: 'Edita información, agenda y página pública', orden: 1,
    permissions: ['editar_evento', 'editar_pagina_publica', 'gestionar_imagenes', 'gestionar_agenda'] },
  { nombre: 'Coordinador',       descripcion: 'Coordina al staff y al evento completo', orden: 2,
    permissions: ['editar_evento', 'invitar_staff', 'gestionar_agenda', 'ver_clientes', 'ver_analytics', 'crear_canales'] },
  { nombre: 'Staff · Acceso',    descripcion: 'Controla entrada y hace check-in con QR', orden: 3,
    permissions: ['checkin', 'ver_clientes'] },
  { nombre: 'Staff · Logística', descripcion: 'Montaje, técnica y escenario', orden: 4,
    permissions: ['crear_canales', 'gestionar_agenda'] },
  { nombre: 'Staff · Atención',  descripcion: 'Atiende asistentes durante el evento', orden: 5,
    permissions: ['ver_clientes', 'checkin'] },
  { nombre: 'VIP host',          descripcion: 'Anfitrión de zona VIP', orden: 6,
    permissions: ['vip_zone', 'ver_clientes', 'checkin'] },
  { nombre: 'Expositor',         descripcion: 'Gestiona su stand, su ficha y sus puntos', orden: 7,
    permissions: ['gestionar_expositores'] },
  { nombre: 'Speaker',           descripcion: 'Ponente: ve su franja y el cronograma', orden: 8,
    permissions: ['gestionar_agenda'] },
  { nombre: 'Finanzas',          descripcion: 'Ve ingresos, facturación y reembolsos', orden: 9,
    permissions: ['ver_pagos', 'reembolsar', 'ver_clientes', 'ver_analytics'] },
  { nombre: 'Moderación',        descripcion: 'Modera el chat y la agenda pública', orden: 10,
    permissions: ['borrar_mensajes', 'crear_canales', 'gestionar_agenda'] },
];

/* ── La página por defecto ────────────────────────────────────────────────
 *
 * Los siete bloques con los que nace una landing. Los ids son fijos (`sys_*`)
 * y no aleatorios, igual que en `public.default_page_blocks()`: un embed
 * exportado «de esta sección exacta» apunta a uno de ellos, y si cambiaran en
 * cada evento no habría forma de referirse a «la sección de boletas».
 *
 * `tickets` va incluido, y conviene que se note: un evento que nace sin él
 * enseña una landing donde las boletas no aparecen aunque estén creadas, y
 * desde fuera se lee como «no las configuró». Pasó con un evento real. */
const BLOQUES_INICIALES = [
  'portada', 'titulo', 'descripcion', 'info', 'direccion', 'links', 'tickets',
];

function paginaPorDefecto() {
  return {
    pages: [{
      id: 'p_inicio',
      nombre: 'Inicio',
      blocks: BLOQUES_INICIALES.map(type => ({ id: `sys_${type}`, data: {}, type })),
    }],
  };
}

/* ── Aplicarlas ──────────────────────────────────────────────────────────
 *
 * Recibe la conexión para poder ir dentro de la transacción que crea el
 * evento: si algo falla, el evento tampoco queda. Un evento a medio sembrar
 * —sin roles, o sin canales— es peor que ninguno, porque parece completo.
 */
async function sembrarEvento(cx, evento) {
  if (!evento?.id) throw new Error('Falta el evento.');

  for (const c of CANALES) {
    await cx.consultar(
      'INSERT INTO chat_channels (evento_id, nombre, tipo, created_by) VALUES (?, ?, ?, ?)',
      [evento.id, c.nombre, c.tipo, evento.owner_id],
    );
  }

  for (const r of ROLES) {
    /* `INSERT IGNORE` es el equivalente del `on conflict do nothing` del
       original: sembrar dos veces el mismo evento no puede fallar, porque
       reintentar la creación es algo que pasa. */
    await cx.consultar(
      `INSERT IGNORE INTO event_roles (evento_id, nombre, descripcion, permissions, is_system, orden)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [evento.id, r.nombre, r.descripcion, JSON.stringify(r.permissions), r.orden],
    );
  }

  return { canales: CANALES.length, roles: ROLES.length };
}

module.exports = {
  CANALES,
  ROLES,
  BLOQUES_INICIALES,
  paginaPorDefecto,
  sembrarEvento,
};
