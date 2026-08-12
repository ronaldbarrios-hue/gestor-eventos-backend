/* GESTEK — Recordatorios automáticos de eventos.
   Tres sistemas en un mismo cron periódico:
   1) Push (24h / 2h antes) — vía web-push, marca eventos.recordatorio_24h_at / recordatorio_2h_at.
   2) Email (7 días / 1 día / 1 hora antes) — vía Resend/SMTP, usa la función SQL
      find_pending_reminders() (creada en la migración 0017_email_reminders.sql) y
      registra cada envío en email_log para no duplicar.
   3) Lista de espera — caduca las ofertas de cupo vencidas y se lo ofrece al
      siguiente de la fila (lib/waitlistOferta.js). */

const cron = require('node-cron');
const webpush = require('web-push');
const supabase = require('./supabase.js');
const { enviarEmailEvento } = require('./emailPlantillas.js');
const { caducarOfertasVencidas } = require('./waitlistOferta.js');

/* Los códigos que devuelve find_pending_reminders → tipos de plantilla. */
const TIPO_RECORDATORIO = {
  t7d: 'recordatorio_7d',
  t1d: 'recordatorio_1d',
  t1h: 'recordatorio_1h',
};

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:hello@gestek.io';

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app').split(',')[0];

/* Ventana de tolerancia: como el cron no corre exactamente cada minuto,
   buscamos eventos que empiecen dentro de un rango (ej. entre 23h50m y
   24h10m desde ahora) en vez de un instante exacto. */
const VENTANA_MIN = 20;

async function enviarPush(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('id', sub.id);
    }
    return { ok: false };
  }
}

/* Busca eventos cuya fecha_inicio caiga dentro de la ventana [horasAntes - tolerancia, horasAntes + tolerancia]
   y que todavía no tengan marcado el recordatorio correspondiente. */
async function eventosParaAvisar(horasAntes, columna) {
  const ahora = Date.now();
  const desde = new Date(ahora + (horasAntes * 60 - VENTANA_MIN) * 60 * 1000).toISOString();
  const hasta = new Date(ahora + (horasAntes * 60 + VENTANA_MIN) * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('eventos')
    .select('id, titulo, fecha_inicio, location_nombre, slug')
    .eq('estado', 'publicado')
    .is('deleted_at', null)
    .is(columna, null)
    .gte('fecha_inicio', desde)
    .lte('fecha_inicio', hasta);

  if (error) {
    console.error('[recordatorios] error consultando eventos:', error.message);
    return [];
  }
  return data || [];
}

async function avisarAsistentes(evento, etiqueta) {
  /* Solo boletas pagadas/confirmadas — no tiene sentido avisar a alguien
     con una reserva pendiente de pago o cancelada. */
  const { data: tickets } = await supabase
    .from('tickets')
    .select('id')
    .eq('evento_id', evento.id)
    .eq('estado', 'pagado');

  if (!tickets || tickets.length === 0) return { destinatarios: 0, enviadas: 0 };

  /* Los tickets son de "guests" (no siempre tienen user_id vinculado) —
     el push se manda por user_id, así que solo llega a quienes compraron
     con una cuenta logueada y tienen notificaciones activas. Esto es
     coherente con cómo ya funciona el resto del sistema de push. */
  const { data: ticketsConUser } = await supabase
    .from('tickets')
    .select('user_id')
    .eq('evento_id', evento.id)
    .eq('estado', 'pagado')
    .not('user_id', 'is', null);

  const userIds = [...new Set((ticketsConUser || []).map(t => t.user_id))];
  if (userIds.length === 0) return { destinatarios: 0, enviadas: 0 };

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  if (!subs || subs.length === 0) return { destinatarios: userIds.length, enviadas: 0 };

  const fecha = new Date(evento.fecha_inicio);
  const horaTxt = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  const payload = JSON.stringify({
    title: `${etiqueta}: ${evento.titulo}`,
    body : evento.location_nombre
      ? `Hoy a las ${horaTxt} en ${evento.location_nombre}. ¡Te esperamos!`
      : `Comienza a las ${horaTxt}. ¡Te esperamos!`,
    url  : `/explorar/${evento.slug}`,
    tag  : `evento-${evento.id}`,
  });

  const results = await Promise.all(subs.map(s => enviarPush(s, payload)));
  const ok = results.filter(r => r.ok).length;
  return { destinatarios: userIds.length, enviadas: ok };
}

async function correrCicloPush() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[recordatorios] VAPID no configurado, se omite el ciclo de push.');
    return;
  }
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);

  /* Recordatorio de 24h */
  const eventos24h = await eventosParaAvisar(24, 'recordatorio_24h_at');
  for (const ev of eventos24h) {
    const r = await avisarAsistentes(ev, 'Mañana');
    await supabase.from('eventos').update({ recordatorio_24h_at: new Date().toISOString() }).eq('id', ev.id);
    console.log(`[recordatorios] push 24h — "${ev.titulo}": ${r.enviadas}/${r.destinatarios} enviadas`);
  }

  /* Recordatorio de 2h */
  const eventos2h = await eventosParaAvisar(2, 'recordatorio_2h_at');
  for (const ev of eventos2h) {
    const r = await avisarAsistentes(ev, 'Empieza pronto');
    await supabase.from('eventos').update({ recordatorio_2h_at: new Date().toISOString() }).eq('id', ev.id);
    console.log(`[recordatorios] push 2h — "${ev.titulo}": ${r.enviadas}/${r.destinatarios} enviadas`);
  }
}

/* Ciclo de recordatorios por EMAIL (7 días / 1 día / 1 hora antes).
   Usa la función SQL find_pending_reminders() (migración 0017), que ya
   calcula qué tickets pagados necesitan cada tipo de recordatorio y
   filtra los que ya se enviaron (vía email_log) — acá solo hace falta
   iterar el resultado, mandar el correo, y registrar el envío. */
async function correrCicloEmail() {
  const { data: pendientes, error } = await supabase.rpc('find_pending_reminders', { p_limit: 200 });

  if (error) {
    /* Si la función o la tabla email_log todavía no existen en esta base
       de datos (migración 0017 no aplicada), lo dejamos como aviso y no
       rompemos el resto del cron. */
    console.warn('[recordatorios] no se pudo consultar find_pending_reminders (¿migración 0017 aplicada?):', error.message);
    return;
  }
  if (!pendientes || pendientes.length === 0) return;

  for (const r of pendientes) {
    try {
      /* find_pending_reminders (0017) devuelve t7d/t1d/t1h; los tipos de
         plantilla se llaman por su nombre completo. El email_log sigue
         guardando el código corto, que es lo que la función SQL consulta para
         no repetir un envío. */
      const tipoPlantilla = TIPO_RECORDATORIO[r.tipo] || 'recordatorio_1d';

      const resultado = await enviarEmailEvento({
        evento: r.evento_id,
        tipo: tipoPlantilla,
        to: r.guest_email,
        ctx: {
          nombre: r.guest_nombre,
          codigo: r.codigo,
          enlace: `${FRONTEND_URL}/explorar/${r.evento_slug}`,
        },
      });

      await supabase.from('email_log').insert({
        ticket_id: r.ticket_id,
        evento_id: r.evento_id,
        tipo: r.tipo,
        destinatario: r.guest_email,
        status: resultado.ok ? 'sent' : 'failed',
        error: resultado.ok ? null : (resultado.motivo || 'envío falló'),
      });

      console.log(`[recordatorios] email ${r.tipo} — "${r.evento_titulo}" a ${r.guest_email}: ${resultado.ok ? 'OK' : 'FALLÓ'}`);
    } catch (e) {
      console.error(`[recordatorios] error procesando recordatorio de ${r.guest_email}:`, e.message);
      /* Aunque falle, igual registramos el intento para no bloquear el
         resto del batch reintentando esta misma fila infinitamente. */
      await supabase.from('email_log').insert({
        ticket_id: r.ticket_id,
        evento_id: r.evento_id,
        tipo: r.tipo,
        destinatario: r.guest_email,
        status: 'failed',
        error: e.message,
      }).catch(() => {});
    }
  }
}

async function correrCicloRecordatorios() {
  await correrCicloPush();
  await correrCicloEmail();
  /* Las ofertas de la lista de espera caducan, y cuando caducan hay que
     ofrecer al siguiente. Cuelga de aquí en vez de montar un segundo
     planificador: es la misma cadencia y una pieza menos que mantener. */
  await caducarOfertasVencidas();
}

/* Se llama una sola vez desde index.js al arrancar el servidor.
   Corre cada quince minutos, usando la expresión cron estandar de 5 campos. */
function iniciarCronRecordatorios() {
  const expresionCron = ['*/15', '*', '*', '*', '*'].join(' ');
  cron.schedule(expresionCron, () => {
    correrCicloRecordatorios().catch(e => console.error('[recordatorios] error en el ciclo:', e.message));
  });
  console.log('[recordatorios] cron programado cada 15 minutos (push + email + lista de espera).');
}

module.exports = { iniciarCronRecordatorios, correrCicloRecordatorios };
