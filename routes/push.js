/* GESTEK — Web Push. Endpoints:
   GET    /push/vapid-key                — pública: la public key VAPID
   POST   /me/push/subscribe             — guarda la subscription del browser actual
   DELETE /me/push/unsubscribe           — borra una subscription por endpoint
   POST   /me/push/test                  — manda una notificación de prueba a TODOS los dispositivos del user
   POST   /eventos/:id/push/broadcast    — (Pro) manda push al organizador + equipo del evento
*/

const express = require('express');
const webpush = require('web-push');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { notificarVarios } = require('../lib/notificar.js');

const { sesion, publica } = require('../core/permisos');
const router = express.Router();

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:hello@gestek.io';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
}

router.get('/push/vapid-key', publica('La clave PÚBLICA de push: el navegador la necesita para suscribirse, y es pública por definición.'), (_req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Web push no configurado en el server.' });
  res.json({ key: VAPID_PUBLIC });
});

router.post('/me/push/subscribe', verifySupabaseJWT, sesion("La suscripción de push de SU navegador, identificada por su endpoint."), async (req, res) => {
  const { endpoint, keys, user_agent } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription incompleta.' });
  }

  /* upsert por endpoint */
  const { data: existing } = await supabase
    .from('push_subscriptions').select('id').eq('endpoint', endpoint).maybeSingle();

  if (existing) {
    await supabase.from('push_subscriptions').update({
      user_id: req.user.id, keys, user_agent: user_agent || null, last_seen_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    await supabase.from('push_subscriptions').insert({
      user_id: req.user.id, endpoint, keys, user_agent: user_agent || null,
    });
  }
  res.json({ ok: true });
});

router.delete('/me/push/unsubscribe', verifySupabaseJWT, sesion("La suscripción de push de SU navegador, identificada por su endpoint."), async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint requerido.' });
  await supabase.from('push_subscriptions').delete().eq('user_id', req.user.id).eq('endpoint', endpoint);
  res.json({ ok: true });
});

router.post('/me/push/test', verifySupabaseJWT, sesion("La suscripción de push de SU navegador, identificada por su endpoint."), async (req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Web push no configurado.' });

  const { data: subs } = await supabase
    .from('push_subscriptions').select('*').eq('user_id', req.user.id);
  if (!subs || subs.length === 0) return res.status(400).json({ error: 'No tenés dispositivos suscritos.' });

  const payload = JSON.stringify({
    title: 'GESTEK',
    body : 'Funciona ✓ — las notificaciones llegan correctamente.',
    url  : '/configuracion',
  });

  const results = await Promise.all(subs.map(s => enviar(s, payload)));
  const ok = results.filter(r => r.ok).length;
  const ko = results.length - ok;
  res.json({ enviadas: ok, fallidas: ko });
});

/* POST /eventos/:id/push/broadcast — anunciar algo al equipo del evento.

   Antes esto era SÓLO un push del navegador, y por eso no funcionaba:

     · arrancaba con `if (!VAPID_PUBLIC) return 503`, y las claves VAPID no
       están puestas, así que el anuncio fallaba entero antes de mirar
       siquiera a quién iba;
     · aun con claves, sólo alcanzaba a quien hubiera aceptado notificaciones
       del navegador. No escribía en `notificaciones`, así que la campana del
       panel no se enteraba;
     · y no se guardaba en ningún sitio: enviado y evaporado.

   Ahora el orden de importancia está al revés. Lo que SIEMPRE ocurre es que
   el anuncio se guarda y se crea una notificación in-app por destinatario —
   ése es el canal que no depende de claves ni de permisos del navegador. El
   push se manda además, si se puede. */
router.post('/eventos/:eventoId/push/broadcast', verifySupabaseJWT, sesion("Sólo el dueño del evento puede lanzar un aviso a todo el mundo; se comprueba contra owner_id."), async (req, res) => {
  const { eventoId } = req.params;
  const { titulo, mensaje, url } = req.body || {};
  if (!titulo?.trim() || !mensaje?.trim()) return res.status(400).json({ error: 'Título y mensaje son requeridos.' });

  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id, titulo').eq('id', eventoId).single();
  if (!ev || ev.owner_id !== req.user.id) return res.status(403).json({ error: 'No autorizado.' });

  /* Audiencia: el dueño y los miembros activos del equipo. */
  const { data: miembros } = await supabase
    .from('event_members').select('user_id').eq('evento_id', eventoId).eq('status', 'active');
  const userIds = [...new Set([ev.owner_id, ...(miembros || []).map(m => m.user_id).filter(Boolean)])];
  const destino = url || `/eventos/${eventoId}`;

  /* 1 · La notificación in-app. Es la que de verdad llega. */
  await notificarVarios(userIds, {
    tipo    : 'anuncio',
    titulo  : titulo.trim(),
    cuerpo  : mensaje.trim(),
    link    : destino,
    eventoId,
  });

  /* 2 · El push, si hay claves y alguien lo tiene activado. Best-effort: que
     falle no puede tumbar un anuncio que ya está entregado por dentro. */
  let pushOk = 0, pushSubs = 0;
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
      const { data: subs } = await supabase
        .from('push_subscriptions').select('*').in('user_id', userIds);
      pushSubs = (subs || []).length;
      if (pushSubs) {
        const payload = JSON.stringify({
          title : titulo.trim(),
          body  : mensaje.trim(),
          url   : destino,
          evento: { id: ev.id, titulo: ev.titulo },
        });
        const results = await Promise.all(subs.map(s => enviar(s, payload)));
        pushOk = results.filter(r => r.ok).length;
      }
    } catch (e) {
      console.warn('[broadcast] el push falló, la notificación in-app ya salió:', e.message);
    }
  }

  /* 3 · Queda guardado. Sin esto no había forma de saber qué se anunció. */
  let anuncio = null;
  try {
    const { data } = await supabase.from('evento_anuncios').insert({
      evento_id: eventoId,
      autor_id : req.user.id,
      titulo   : titulo.trim(),
      mensaje  : mensaje.trim(),
      url      : url?.trim() || null,
      destinatarios: userIds.length,
      push_enviados: pushOk,
    }).select('id, titulo, mensaje, url, destinatarios, push_enviados, created_at').single();
    anuncio = data;
  } catch (e) {
    /* Sin la 0068 aplicada no hay tabla. El anuncio ya llegó; sólo no queda
       en el historial. */
    console.warn('[broadcast] no se pudo guardar el anuncio (¿migración 0068?):', e.message);
  }

  res.json({
    ok: true,
    anuncio,
    destinatarios: userIds.length,
    enviadas: pushOk,
    push_disponible: Boolean(VAPID_PUBLIC && VAPID_PRIVATE),
    push_subs: pushSubs,
  });
});

/* GET /eventos/:id/anuncios — lo que ya se anunció. */
router.get('/eventos/:eventoId/anuncios', verifySupabaseJWT, sesion("Comprueba a mano que quien pide es el dueño del evento, o un miembro activo de su equipo."), async (req, res) => {
  const { eventoId } = req.params;
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  if (ev.owner_id !== req.user.id) {
    const { data: m } = await supabase.from('event_members').select('id')
      .eq('evento_id', eventoId).eq('user_id', req.user.id).eq('status', 'active').maybeSingle();
    if (!m) return res.status(403).json({ error: 'No autorizado.' });
  }

  const { data, error } = await supabase
    .from('evento_anuncios')
    .select('id, titulo, mensaje, url, destinatarios, push_enviados, created_at, autor:profiles!autor_id(nombre)')
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.json({ anuncios: [] });   // sin la 0068, lista vacía
  res.json({ anuncios: data || [] });
});

async function enviar(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    return { ok: true };
  } catch (err) {
    /* 410 / 404 → subscription muerta, la borramos */
    if (err.statusCode === 410 || err.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('id', sub.id);
    }
    return { ok: false, error: err.message, status: err.statusCode };
  }
}

module.exports = router;
