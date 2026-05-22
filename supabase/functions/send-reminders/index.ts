/* GESTEK — Edge Function: envía recordatorios pendientes (T-7d / T-1d / T-1h).
   Ejecutada cada hora vía pg_cron (ver instrucciones en docs/RECORDATORIOS.md).

   Env vars requeridas (Settings → Edge Functions → Secrets):
     SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY
     RESEND_API_KEY           — key de https://resend.com
     RESEND_FROM              — ej. "GESTEK <eventos@tu-dominio.com>"
     PUBLIC_FRONTEND_URL      — ej. https://gestek.io
*/

// @ts-ignore — Deno runtime en Supabase
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-ignore
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')!;
// @ts-ignore
const RESEND_FROM  = Deno.env.get('RESEND_FROM') || 'GESTEK <onboarding@resend.dev>';
// @ts-ignore
const FRONTEND_URL = Deno.env.get('PUBLIC_FRONTEND_URL') || 'https://gestek.io';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

interface Pending {
  ticket_id: string;
  evento_id: string;
  tipo: 't7d' | 't1d' | 't1h';
  guest_email: string;
  guest_nombre: string;
  codigo: string;
  qr_token: string | null;
  evento_titulo: string;
  evento_inicio: string;
  evento_location: string | null;
  evento_slug: string;
  owner_nombre: string | null;
  owner_empresa: string | null;
}

function tituloPorTipo(tipo: string, eventoTitulo: string) {
  if (tipo === 't7d') return `Faltan 7 días para ${eventoTitulo}`;
  if (tipo === 't1d') return `${eventoTitulo} es mañana`;
  if (tipo === 't1h') return `${eventoTitulo} empieza en 1 hora`;
  return `Recordatorio: ${eventoTitulo}`;
}

function buildHtml(p: Pending) {
  const fecha = new Date(p.evento_inicio).toLocaleString('es-CO', {
    weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const ticketUrl = `${FRONTEND_URL}/mi-ticket/${p.codigo}`;
  const eventoUrl = `${FRONTEND_URL}/explorar/${p.evento_slug}`;
  const remitente = p.owner_empresa || p.owner_nombre || 'el organizador';
  const titulo = tituloPorTipo(p.tipo, p.evento_titulo);

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e5e5e5;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <p style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#71717a;margin:0 0 12px;">${p.tipo === 't1h' ? 'Empieza pronto' : 'Recordatorio'}</p>
    <h1 style="font-size:28px;font-weight:700;margin:0 0 16px;color:#fafafa;line-height:1.2;">${titulo}</h1>
    <p style="font-size:16px;line-height:1.6;color:#a1a1aa;margin:0 0 28px;">
      Hola ${p.guest_nombre || 'invitado'}, te recordamos los detalles de tu reserva.
    </p>

    <div style="background:#171717;border:1px solid #262626;border-radius:16px;padding:20px;margin-bottom:24px;">
      <p style="font-size:14px;color:#a1a1aa;margin:0 0 4px;">Evento</p>
      <p style="font-size:18px;color:#fafafa;font-weight:600;margin:0 0 12px;">${p.evento_titulo}</p>
      <p style="font-size:14px;color:#a1a1aa;margin:0 0 4px;">Fecha</p>
      <p style="font-size:15px;color:#e5e5e5;margin:0 0 12px;text-transform:capitalize;">${fecha}</p>
      ${p.evento_location ? `<p style="font-size:14px;color:#a1a1aa;margin:0 0 4px;">Lugar</p>
      <p style="font-size:15px;color:#e5e5e5;margin:0 0 12px;">${p.evento_location}</p>` : ''}
      <p style="font-size:14px;color:#a1a1aa;margin:0 0 4px;">Tu código</p>
      <p style="font-size:20px;color:#fafafa;font-family:monospace;letter-spacing:0.1em;margin:0;">${p.codigo}</p>
    </div>

    <div style="text-align:center;margin:32px 0;">
      <a href="${ticketUrl}" style="display:inline-block;background:#fafafa;color:#0a0a0a;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;">Ver mi boleta y QR</a>
    </div>

    <p style="font-size:13px;color:#71717a;line-height:1.6;margin:24px 0 0;text-align:center;">
      Enviado por ${remitente} vía <a href="${eventoUrl}" style="color:#a1a1aa;">GESTEK</a>.
    </p>
  </div>
</body></html>`;
}

async function sendEmail(p: Pending): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to  : [p.guest_email],
        subject: tituloPorTipo(p.tipo, p.evento_titulo),
        html: buildHtml(p),
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, error: `Resend ${resp.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// @ts-ignore — Deno serve API
Deno.serve(async (req: Request) => {
  /* Permitir invocación por pg_cron via POST sin body, o manual via GET */
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { data: pending, error } = await supabase.rpc('find_pending_reminders', { p_limit: 200 });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let enviados = 0;
  let fallidos = 0;
  const detalles: any[] = [];

  for (const row of (pending || []) as Pending[]) {
    const result = await sendEmail(row);
    await supabase.from('email_log').insert({
      ticket_id   : row.ticket_id,
      evento_id   : row.evento_id,
      tipo        : row.tipo,
      destinatario: row.guest_email,
      status      : result.ok ? 'sent' : 'failed',
      error       : result.error || null,
    });
    if (result.ok) enviados++; else fallidos++;
    detalles.push({ ticket: row.ticket_id, tipo: row.tipo, ok: result.ok, error: result.error });
  }

  return new Response(JSON.stringify({
    procesados: (pending || []).length,
    enviados,
    fallidos,
    detalles,
  }), { headers: { 'Content-Type': 'application/json' } });
});
