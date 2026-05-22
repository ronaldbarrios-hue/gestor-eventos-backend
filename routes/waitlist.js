/* GESTEK — Lista de espera (admin endpoints, auth requerida).
   Montado en /eventos en index.js.

   GET    /:eventoId/waitlist                     — lista completa (owner)
   PATCH  /:eventoId/waitlist/:waitlistId         — cambiar estado
   POST   /:eventoId/waitlist/:waitlistId/notify  — notificar manualmente
   DELETE /:eventoId/waitlist/:waitlistId         — quitar de la lista
*/

'use strict';

const express  = require('express');
const webpush  = require('web-push');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');

const router = express.Router();
router.use(verifySupabaseJWT);

const ESTADOS_VALIDOS = ['active', 'contacted', 'purchased', 'cancelled'];

/* ── Helpers ─────────────────────────────────────────────── */

async function verificarOwner(eventoId, userId) {
  const { data } = await supabase
    .from('eventos').select('owner_id').eq('id', eventoId).maybeSingle();
  if (!data) return false;
  return data.owner_id === userId;
}

/* Envía push a un user_id con el mensaje de cupo disponible (best-effort). */
async function enviarPushWaitlist(userId, eventoSlug, eventoTitulo) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const pri = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !pri || !userId) return 0;

  webpush.setVapidDetails(process.env.VAPID_CONTACT || 'mailto:hello@gestek.io', pub, pri);

  const { data: subs } = await supabase
    .from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs || subs.length === 0) return 0;

  const payload = JSON.stringify({
    title: '¡Hay un cupo disponible!',
    body : `Se liberó un lugar en "${eventoTitulo}". Entrá rápido antes de que se llene.`,
    url  : eventoSlug ? `/explorar/${eventoSlug}` : '/',
  });

  let ok = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      ok++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  return ok;
}

/* ── GET /:eventoId/waitlist ─────────────────────────────── */

router.get('/:eventoId/waitlist', async (req, res) => {
  if (!(await verificarOwner(req.params.eventoId, req.user.id))) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const { q, estado, ticket_type_id } = req.query;

  let query = supabase
    .from('event_waitlist')
    .select('*, tipo:ticket_types!ticket_type_id(id, nombre)')
    .eq('evento_id', req.params.eventoId)
    .order('ticket_type_id', { ascending: true })
    .order('posicion', { ascending: true });

  if (estado)         query = query.eq('estado', estado);
  if (ticket_type_id) query = query.eq('ticket_type_id', ticket_type_id);
  if (q)              query = query.or(`guest_email.ilike.%${q}%,guest_nombre.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const lista = data || [];
  const stats = {
    total    : lista.length,
    active   : lista.filter(e => e.estado === 'active').length,
    contacted: lista.filter(e => e.estado === 'contacted').length,
    purchased: lista.filter(e => e.estado === 'purchased').length,
    cancelled: lista.filter(e => e.estado === 'cancelled').length,
  };

  res.json({ waitlist: lista, stats });
});

/* ── PATCH /:eventoId/waitlist/:waitlistId ───────────────── */

router.patch('/:eventoId/waitlist/:waitlistId', async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `estado inválido. Usa: ${ESTADOS_VALIDOS.join(', ')}.` });
  }
  if (!(await verificarOwner(req.params.eventoId, req.user.id))) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const updates = { estado };
  if (estado === 'purchased') updates.purchased_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('event_waitlist')
    .update(updates)
    .eq('id', req.params.waitlistId)
    .eq('evento_id', req.params.eventoId)
    .select('*, tipo:ticket_types!ticket_type_id(id, nombre)')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Entrada no encontrada.' });
  res.json({ entry: data });
});

/* ── POST /:eventoId/waitlist/:waitlistId/notify ─────────── */

router.post('/:eventoId/waitlist/:waitlistId/notify', async (req, res) => {
  const esOwner = await verificarOwner(req.params.eventoId, req.user.id);
  if (!esOwner) return res.status(403).json({ error: 'No autorizado.' });

  const { data: evento } = await supabase
    .from('eventos').select('titulo, slug').eq('id', req.params.eventoId).single();

  const { data: entry, error: eEntry } = await supabase
    .from('event_waitlist')
    .select('*')
    .eq('id', req.params.waitlistId)
    .eq('evento_id', req.params.eventoId)
    .maybeSingle();

  if (eEntry) return res.status(500).json({ error: eEntry.message });
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada.' });
  if (!['active', 'contacted'].includes(entry.estado)) {
    return res.status(400).json({ error: 'Solo se puede notificar entradas activas o ya contactadas.' });
  }

  await supabase.from('event_waitlist').update({
    estado               : 'contacted',
    notified_at          : new Date().toISOString(),
    last_contact_at      : new Date().toISOString(),
    notification_attempts: (entry.notification_attempts || 0) + 1,
  }).eq('id', entry.id);

  const pushSent = entry.user_id
    ? await enviarPushWaitlist(entry.user_id, evento?.slug, evento?.titulo)
    : 0;

  res.json({ ok: true, pushSent });
});

/* ── DELETE /:eventoId/waitlist/:waitlistId ──────────────── */

router.delete('/:eventoId/waitlist/:waitlistId', async (req, res) => {
  if (!(await verificarOwner(req.params.eventoId, req.user.id))) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const { error } = await supabase
    .from('event_waitlist')
    .delete()
    .eq('id', req.params.waitlistId)
    .eq('evento_id', req.params.eventoId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
module.exports.enviarPushWaitlist = enviarPushWaitlist;
