/* GESTEK — Gestión de API tokens y webhooks.
   Auth: Supabase JWT. Montado en /me. */

const express = require('express');
const crypto = require('crypto');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { generarToken } = require('../lib/apitoken.js');

const router = express.Router();
router.use(verifySupabaseJWT);

const TIPOS_WEBHOOK = ['ticket.pagado', 'checkin.realizado', 'evento.publicado'];

/* ── API TOKENS ── */
router.get('/integraciones/tokens', async (req, res) => {
  const { data, error } = await supabase
    .from('api_tokens')
    .select('id, nombre, prefix, scopes, last_used_at, revoked, created_at')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ tokens: data || [], tipos_webhook: TIPOS_WEBHOOK });
});

router.post('/integraciones/tokens', async (req, res) => {
  const nombre = (req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Poné un nombre al token.' });

  const { token, hash, prefix } = generarToken();
  const { data, error } = await supabase
    .from('api_tokens')
    .insert({ owner_id: req.user.id, nombre, token_hash: hash, prefix })
    .select('id, nombre, prefix, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  /* token completo se muestra UNA sola vez */
  res.status(201).json({ token: { ...data, valor: token } });
});

router.delete('/integraciones/tokens/:id', async (req, res) => {
  const { error } = await supabase
    .from('api_tokens').update({ revoked: true })
    .eq('id', req.params.id).eq('owner_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ── WEBHOOKS ── */
router.get('/integraciones/webhooks', async (req, res) => {
  const { data, error } = await supabase
    .from('webhooks')
    .select('id, url, eventos, activo, secret, created_at')
    .eq('owner_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ webhooks: data || [] });
});

router.post('/integraciones/webhooks', async (req, res) => {
  const { url, eventos } = req.body || {};
  if (!/^https?:\/\//.test(url || '')) return res.status(400).json({ error: 'URL inválida (debe ser http/https).' });
  const evs = (Array.isArray(eventos) ? eventos : []).filter(e => TIPOS_WEBHOOK.includes(e));
  if (evs.length === 0) return res.status(400).json({ error: 'Elegí al menos un tipo de evento.' });

  const secret = 'whsec_' + crypto.randomBytes(20).toString('hex');
  const { data, error } = await supabase
    .from('webhooks')
    .insert({ owner_id: req.user.id, url, eventos: evs, secret })
    .select('id, url, eventos, activo, secret, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ webhook: data });
});

router.patch('/integraciones/webhooks/:id', async (req, res) => {
  const updates = {};
  if ('activo' in req.body) updates.activo = Boolean(req.body.activo);
  if (Array.isArray(req.body.eventos)) updates.eventos = req.body.eventos.filter(e => TIPOS_WEBHOOK.includes(e));
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });
  const { data, error } = await supabase
    .from('webhooks').update(updates)
    .eq('id', req.params.id).eq('owner_id', req.user.id)
    .select('id, url, eventos, activo, secret, created_at').single();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Webhook no encontrado.' });
  res.json({ webhook: data });
});

router.delete('/integraciones/webhooks/:id', async (req, res) => {
  const { error } = await supabase
    .from('webhooks').delete()
    .eq('id', req.params.id).eq('owner_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.get('/integraciones/webhooks/:id/deliveries', async (req, res) => {
  /* verifica pertenencia */
  const { data: w } = await supabase
    .from('webhooks').select('id').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle();
  if (!w) return res.status(404).json({ error: 'Webhook no encontrado.' });
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('id, evento_tipo, status, response_code, intentos, created_at')
    .eq('webhook_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deliveries: data || [] });
});

module.exports = router;
