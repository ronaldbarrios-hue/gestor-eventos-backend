/* Google Calendar — OAuth (server-side) + crear evento con invitación.
   Para agendar entrevistas de vacantes en el calendario del ORGANIZADOR y
   avisar al candidato. Nivel plataforma: GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI
   en env. Inerte si no están (el scope de calendar exige verificar la app en
   Google, que tarda; conviene arrancar esa verificación pronto). */
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function configurado() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

/* Estado firmado para el flujo OAuth: identifica al usuario sin poder falsearlo. */
function firmarEstado(userId) {
  const secret = process.env.GOOGLE_STATE_SECRET || process.env.JWT_SECRET || 'gestek';
  const h = crypto.createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 24);
  return `${userId}.${h}`;
}
function verificarEstado(state) {
  const [userId, h] = String(state || '').split('.');
  if (!userId || !h) return null;
  return firmarEstado(userId).endsWith(`.${h}`) ? userId : null;
}

function authUrl(userId) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: firmarEstado(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function intercambiarCodigo(code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json();
  if (!r.ok) throw new Error(`Google token ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function accessTokenDesdeRefresh(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json();
  if (!r.ok) throw new Error(`Google refresh ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

/* Crea un evento en el calendario principal. Devuelve { id, htmlLink }. */
async function crearEvento({ refreshToken, summary, description, inicio, fin, invitados = [] }) {
  const accessToken = await accessTokenDesdeRefresh(refreshToken);
  const evento = {
    summary, description,
    start: { dateTime: new Date(inicio).toISOString() },
    end: { dateTime: new Date(fin || new Date(new Date(inicio).getTime() + 30 * 60000)).toISOString() },
    attendees: invitados.filter(Boolean).map(email => ({ email })),
  };
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(evento),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Google event ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return { id: data.id, htmlLink: data.htmlLink };
}

module.exports = { configurado, authUrl, verificarEstado, intercambiarCodigo, accessTokenDesdeRefresh, crearEvento };
