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

const router = express.Router();

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_CONTACT = process.env.VAPID_CONTACT || 'mailto:hello@gestek.io';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
}

router.get('/push/vapid-key', (_req, res) => {
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Web push no configurado en el server.' });
  res.json({ key: VAPID_PUBLIC });
});

router.post('/me/push/subscribe', verifySupabaseJWT, async (req, res) => {
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

router.delete('/me/push/unsubscribe', verifySupabaseJWT, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint requerido.' });
  await supabase.from('push_subscriptions').delete().eq('user_id', req.user.id).eq('endpoint', endpoint);
  res.json({ ok: true });
});

router.post('/me/push/test', verifySupabaseJWT, async (req, res) => {
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

router.post('/eventos/:eventoId/push/broadcast', verifySupabaseJWT, async (req, res) => {
  const { eventoId } = req.params;
  const { titulo, mensaje, url } = req.body || {};
  if (!VAPID_PUBLIC) return res.status(503).json({ error: 'Web push no configurado.' });
  if (!titulo?.trim() || !mensaje?.trim()) return res.status(400).json({ error: 'Título y mensaje son requeridos.' });

  /* Owner + plan Pro check */
  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id, titulo').eq('id', eventoId).single();
  if (!ev || ev.owner_id !== req.user.id) return res.status(403).json({ error: 'No autorizado.' });

  const { data: prof } = await supabase
    .from('profiles').select('plan, plan_expires_at').eq('id', req.user.id).single();
  const esPro = prof?.plan === 'pro' && (!prof.plan_expires_at || new Date(prof.plan_expires_at) > new Date());
  if (!esPro) return res.status(402).json({ error: 'Broadcast de notificaciones requiere plan Pro.' });

  /* Audiencia: owner + miembros del equipo activos */
  const { data: miembros } = await supabase
    .from('event_members').select('user_id').eq('evento_id', eventoId).eq('status', 'active');
  const userIds = new Set([ev.owner_id, ...(miembros || []).map(m => m.user_id).filter(Boolean)]);

  const { data: subs } = await supabase
    .from('push_subscriptions').select('*').in('user_id', Array.from(userIds));
  if (!subs || subs.length === 0) return res.json({ enviadas: 0, fallidas: 0, sin_subs: true });

  const payload = JSON.stringify({
    title: titulo.trim(),
    body : mensaje.trim(),
    url  : url || `/eventos/${eventoId}`,
    evento: { id: ev.id, titulo: ev.titulo },
  });

  const results = await Promise.all(subs.map(s => enviar(s, payload)));
  const ok = results.filter(r => r.ok).length;
  res.json({ enviadas: ok, fallidas: results.length - ok, destinatarios: userIds.size });
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
