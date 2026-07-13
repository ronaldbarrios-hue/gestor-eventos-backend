/* GESTEK — Recordatorios automáticos de eventos vía push.
   Corre periódicamente (ver index.js) y revisa qué eventos están por
   empezar en ~24h o ~2h, avisando a quienes tienen boleta pagada. */

const cron = require('node-cron');
const webpush = require('web-push');
const supabase = require('./supabase.js');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:hello@gestek.io';

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

async function correrCicloRecordatorios() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[recordatorios] VAPID no configurado, se omite el ciclo.');
    return;
  }
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);

  /* Recordatorio de 24h */
  const eventos24h = await eventosParaAvisar(24, 'recordatorio_24h_at');
  for (const ev of eventos24h) {
    const r = await avisarAsistentes(ev, 'Mañana');
    await supabase.from('eventos').update({ recordatorio_24h_at: new Date().toISOString() }).eq('id', ev.id);
    console.log(`[recordatorios] 24h — "${ev.titulo}": ${r.enviadas}/${r.destinatarios} enviadas`);
  }

  /* Recordatorio de 2h */
  const eventos2h = await eventosParaAvisar(2, 'recordatorio_2h_at');
  for (const ev of eventos2h) {
    const r = await avisarAsistentes(ev, 'Empieza pronto');
    await supabase.from('eventos').update({ recordatorio_2h_at: new Date().toISOString() }).eq('id', ev.id);
    console.log(`[recordatorios] 2h — "${ev.titulo}": ${r.enviadas}/${r.destinatarios} enviadas`);
  }
}

/* Se llama una sola vez desde index.js al arrancar el servidor.
   Corre cada 15 minutos ("*/15 * * * *"). */
function iniciarCronRecordatorios() {
  cron.schedule('*/15 * * * *', () => {
    correrCicloRecordatorios().catch(e => console.error('[recordatorios] error en el ciclo:', e.message));
  });
  console.log('[recordatorios] cron programado cada 15 minutos.');
}

module.exports = { iniciarCronRecordatorios, correrCicloRecordatorios };
