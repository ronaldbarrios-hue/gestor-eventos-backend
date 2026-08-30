'use strict';

/* Las dos funciones de recordatorios, traídas al código.
 *
 * Paso 5 de la fase 6 (ver db/migraciones/NOTAS-ESQUEMA.md). De las siete RPC
 * que el backend llama, cinco ya estaban —las cuatro de aforo en
 * `modules/aforo/consultas.js` y `canjear_recompensa` en
 * `modules/contadores/index.js`—; estas dos son las que faltaban:
 *
 *   `find_pending_reminders`      → qué boletas toca avisar por correo
 *   `generar_recordatorios_inapp` → los avisos dentro de la aplicación
 *
 * ── Lo que salió al portarlas ─────────────────────────────────────────────
 *
 * `generar_recordatorios_inapp` NUNCA ha creado una sola fila. Inserta en
 * `notificaciones` una columna `link` que esa tabla no tiene, así que revienta
 * en el primer INSERT del bucle y se lleva por delante la transacción entera.
 * Medido el 30 de agosto de 2026 sobre producción:
 *
 *   · `recordatorio_inapp_log`                 → 0 filas
 *   · `notificaciones`, en toda su historia    → 0 filas
 *   · `email_log` con tipo t7d/t1d/t1h         → 28 filas
 *   · eventos que hoy cumplen las condiciones  → 11
 *
 * Es decir: el recordatorio por CORREO funciona y ha salido 28 veces; el de
 * dentro de la aplicación no ha funcionado nunca. Esto es lo que
 * `MIGRACION-SUPABASE.md` §2 llamaba «el recordatorio nunca ha funcionado»,
 * ahora con la causa exacta en vez de la sospecha.
 *
 * La versión de aquí no escribe `link`. No es que falte la columna: el
 * frontend no la lee en ningún sitio —ni el widget de la campana ni la página
 * de notificaciones— así que la columna que sobra es la del INSERT.
 *
 * ── Estado ────────────────────────────────────────────────────────────────
 *
 * Como el resto de la fase 6, esto se usará cuando los datos vivan en MySQL.
 * Hoy la plataforma sigue sobre Supabase y las RPC siguen ahí. Que la de
 * in-app esté rota EN Supabase es un fallo aparte, y se arregla en su propia
 * migración.
 */

/* Los tres avisos, con su ventana. Se sacan a una constante porque el original
   los repetía en las dos funciones con márgenes DISTINTOS —±30 min en el de
   correo, ±1 h en el de in-app— y esa diferencia no estaba explicada en
   ninguna parte. Aquí cada uno lleva el suyo, escrito. */
const AVISOS = [
  /* faltan · margen antes · margen después, todo en minutos */
  { tipo: 't7d', faltan: 7 * 24 * 60, correo: 30, inapp: 60, etiqueta: 'en 7 días' },
  { tipo: 't1d', faltan: 24 * 60,     correo: 30, inapp: 60, etiqueta: 'mañana' },
  { tipo: 't1h', faltan: 60,          correo: 15, inapp: 15, etiqueta: 'en 1 hora' },
];

/* La ventana de un aviso, como un par de fechas absolutas. Se calcula desde un
   `ahora` que se pasa por fuera: sin eso las pruebas dependerían del reloj. */
function ventana(aviso, ahora, cual) {
  const margen = cual === 'correo' ? aviso.correo : aviso.inapp;
  const centro = ahora.getTime() + aviso.faltan * 60_000;
  return [new Date(centro - margen * 60_000), new Date(centro + margen * 60_000)];
}

/* El `case when ... then 't7d' ... end` del original, en SQL y de una pieza,
   para poder clasificar en la misma consulta que filtra. */
function sqlClasifica(cual) {
  const ramas = AVISOS.map(a => `WHEN e.fecha_inicio BETWEEN ? AND ? THEN '${a.tipo}'`);
  return `CASE ${ramas.join(' ')} ELSE NULL END`;
}

function paramsClasifica(ahora, cual) {
  return AVISOS.flatMap(a => ventana(a, ahora, cual));
}

/* ── 1 · Qué boletas toca avisar por correo ───────────────────────────────
 *
 * Original: `find_pending_reminders(p_limit)`. La llama `lib/recordatorios.js`
 * con p_limit = 200.
 *
 * Devuelve una boleta pagada por cada aviso que todavía no se le mandó. El
 * `not exists` contra `email_log` es lo que impide mandarlo dos veces, y por
 * eso el registro se escribe SIEMPRE, aunque el envío falle: si no, el fallo
 * de un correo se convertiría en un bucle que lo reintenta cada minuto.
 */
async function pendientesDeCorreo(bd, { limite = 200, ahora = new Date() } = {}) {
  const sql = `
    SELECT t.id            AS ticket_id,
           t.evento_id,
           ${sqlClasifica('correo')} AS tipo,
           t.guest_email, t.guest_nombre, t.codigo, t.qr_token,
           e.titulo        AS evento_titulo,
           e.fecha_inicio  AS evento_inicio,
           COALESCE(e.location_nombre, e.location_direccion) AS evento_location,
           e.slug          AS evento_slug,
           p.nombre        AS owner_nombre,
           p.empresa       AS owner_empresa
      FROM tickets t
      JOIN eventos  e ON e.id = t.evento_id
      JOIN profiles p ON p.id = e.owner_id
     WHERE t.estado = 'pagado'
       AND e.email_reminders = 1
       AND e.deleted_at IS NULL
       AND e.estado = 'publicado'
       AND t.guest_email IS NOT NULL
       AND ${sqlClasifica('correo')} IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM email_log l
              WHERE l.ticket_id = t.id
                AND l.tipo = ${sqlClasifica('correo')}
           )
     ORDER BY e.fecha_inicio ASC
     LIMIT ?`;

  /* El CASE aparece tres veces y MySQL no tiene `lateral` ni alias reusables en
     el WHERE, así que los parámetros van tres veces también. Es feo y es
     deliberado: la alternativa —una subconsulta envolvente— obliga a MySQL a
     materializar la tabla derivada entera antes de filtrar. */
  const p = paramsClasifica(ahora, 'correo');
  return bd('datos').consultar(sql, [...p, ...p, ...p, limite]);
}

/* ── 2 · Los avisos dentro de la aplicación ───────────────────────────────
 *
 * Original: `generar_recordatorios_inapp()`. La llama
 * `POST /me/notificaciones/generar-recordatorios`.
 *
 * Tres clases de destinatario por evento próximo: el dueño, el equipo activo,
 * y los asistentes que tengan cuenta y boleta válida. El `union` del original
 * (no `union all`) ya quitaba los repetidos —alguien puede ser las tres cosas
 * a la vez—, y aquí se conserva con `DISTINCT`.
 *
 * El log se escribe en la MISMA transacción que la notificación. Si se
 * escribieran por separado y el proceso muriera en medio, o la persona
 * recibiría el aviso dos veces o no lo recibiría nunca, según el orden.
 */
async function generarAvisosEnApp(bd, { ahora = new Date() } = {}) {
  const clasifica = sqlClasifica('inapp');
  const p = paramsClasifica(ahora, 'inapp');

  const sql = `
    SELECT DISTINCT d.evento_id, d.titulo, d.slug, d.tipo, d.user_id
      FROM (
            SELECT e.id AS evento_id, e.titulo, e.slug, ${clasifica} AS tipo,
                   e.owner_id AS user_id
              FROM eventos e
             WHERE e.estado='publicado' AND e.deleted_at IS NULL AND e.email_reminders=1
            UNION
            SELECT e.id, e.titulo, e.slug, ${clasifica}, m.user_id
              FROM eventos e
              JOIN event_members m
                ON m.evento_id = e.id AND m.status='active' AND m.user_id IS NOT NULL
             WHERE e.estado='publicado' AND e.deleted_at IS NULL AND e.email_reminders=1
            UNION
            SELECT e.id, e.titulo, e.slug, ${clasifica}, t.user_id
              FROM eventos e
              JOIN tickets t
                ON t.evento_id = e.id AND t.user_id IS NOT NULL
               AND t.estado IN ('pagado','usado')
             WHERE e.estado='publicado' AND e.deleted_at IS NULL AND e.email_reminders=1
           ) d
     WHERE d.tipo IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM recordatorio_inapp_log l
              WHERE l.scope_id = d.user_id
                AND l.evento_id = d.evento_id
                AND l.tipo = d.tipo
           )`;

  const filas = await bd('datos').consultar(sql, [...p, ...p, ...p]);
  if (!filas.length) return 0;

  let creadas = 0;
  await bd('datos').transaccion(async cx => {
    for (const f of filas) {
      const etiqueta = (AVISOS.find(a => a.tipo === f.tipo) || {}).etiqueta || 'pronto';

      /* Sin `link`: la tabla no tiene esa columna y el frontend no la lee.
         Escribirla es lo que hacía que esto no funcionara nunca. */
      await cx.consultar(
        `INSERT INTO notificaciones (user_id, tipo, titulo, cuerpo, evento_id)
         VALUES (?, 'sistema', ?, ?, ?)`,
        [f.user_id, `Recordatorio: ${f.titulo}`,
         `El evento empieza ${etiqueta}.`, f.evento_id],
      );
      await cx.consultar(
        'INSERT INTO recordatorio_inapp_log (evento_id, scope_id, tipo) VALUES (?, ?, ?)',
        [f.evento_id, f.user_id, f.tipo],
      );
      creadas++;
    }
  });

  return creadas;
}

module.exports = {
  AVISOS,
  ventana,
  pendientesDeCorreo,
  generarAvisosEnApp,
};
