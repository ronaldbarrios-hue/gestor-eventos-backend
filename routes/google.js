/* Google Calendar — conectar la cuenta del organizador (OAuth) y estado.
   El callback es PÚBLICO (Google redirige el navegador con code+state).
   Inerte hasta configurar GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI. */
const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const gc = require('../lib/googleCalendar.js');

const { publica, sesion } = require('../core/permisos');
const router = express.Router();
function front() { return (process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app').split(',')[0]; }

/* Inicia el flujo: devuelve la URL de consentimiento de Google. */
router.get('/me/google/conectar', verifySupabaseJWT, sesion("La conexión con Google de su propia cuenta."), async (req, res) => {
  if (!gc.configurado()) return res.status(503).json({ error: 'Google Calendar aún no está configurado en la plataforma.' });
  res.json({ url: gc.authUrl(req.user.id) });
});

/* Estado de conexión. */
router.get('/me/google', verifySupabaseJWT, sesion("La conexión con Google de su propia cuenta."), async (req, res) => {
  const { data } = await supabase.from('profiles').select('google_email, google_connected_at, google_refresh_token').eq('id', req.user.id).maybeSingle();
  res.json({ disponible: gc.configurado(), conectado: Boolean(data?.google_refresh_token), email: data?.google_email || null, connected_at: data?.google_connected_at || null });
});

router.delete('/me/google', verifySupabaseJWT, sesion("La conexión con Google de su propia cuenta."), async (req, res) => {
  const { error } = await supabase.from('profiles').update({ google_refresh_token: null, google_email: null, google_connected_at: null }).eq('id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* Callback público de Google OAuth. */
router.get('/integraciones/google/callback', publica("Callback de OAuth: lo llama Google, sin cabecera de sesión. Quién es sale del parámetro `state` firmado, que se verifica antes de guardar nada."), async (req, res) => {
  const { code, state, error: oauthErr } = req.query;
  if (oauthErr) return res.redirect(`${front()}/ajustes?google=error`);
  const userId = gc.verificarEstado(state);
  if (!userId || !code) return res.redirect(`${front()}/ajustes?google=error`);
  try {
    const tok = await gc.intercambiarCodigo(String(code));
    let email = null;
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (r.ok) email = (await r.json()).email || null;
    } catch { /* opcional */ }
    if (tok.refresh_token) {
      await supabase.from('profiles').update({
        google_refresh_token: tok.refresh_token, google_email: email, google_connected_at: new Date().toISOString(),
      }).eq('id', userId);
    }
    res.redirect(`${front()}/ajustes?google=conectado`);
  } catch (e) {
    console.error('[google callback]', e.message);
    res.redirect(`${front()}/ajustes?google=error`);
  }
});

module.exports = router;
