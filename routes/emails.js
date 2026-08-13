/* GESTEK — Correos del evento.

   Todo el HTML lo produce lib/emailPlantillas.js, el mismo renderizador que
   usan los envíos automáticos. Antes este archivo tenía su propio cascarón
   —claro, azul, con seis variables— distinto del de lib/email.js, así que la
   vista previa del editor no se parecía a lo que llegaba al buzón.

   Endpoints (montados en /):
   - GET    /eventos/:id/emails                 → tipos, variables, plantillas y diagnóstico
   - PUT    /eventos/:id/emails/:tipo           → guardar una plantilla
   - DELETE /eventos/:id/emails/:tipo           → volver al texto por defecto
   - POST   /eventos/:id/emails/previsualizar   → { asunto, html } sin enviar nada
   - GET    /eventos/:id/emails/diagnostico     → ¿hay proveedor de correo?
   - GET    /eventos/:id/emails/envios          → últimos envíos y sus fallos
   - POST   /eventos/:id/emails/prueba          → se envía al correo de quien pide
   - POST   /eventos/:id/emails/enviar          → campaña segmentada

   audiencia: 'todos' | 'equipo' | 'tipo:<ticket_type_id>'
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const {
  TIPOS, IDS_TIPOS, VARIABLES,
  renderEmail, ctxDeEvento, plantillaDe, enviarEmailEvento, diagnosticoProveedor,
} = require('../lib/emailPlantillas.js');
const { verificarConexion } = require('../lib/email.js');

const router = express.Router();
router.use(verifySupabaseJWT);

const MAX_DESTINATARIOS = 500;  // tope de seguridad por envío
const LOTE = 5;                 // concurrencia para no saturar el SMTP

/* Campos que el organizador puede guardar en una plantilla. */
const CAMPOS = ['asunto', 'encabezado', 'cuerpo', 'boton_texto', 'boton_url', 'imagen', 'footer'];

/* ─────────── Delegación al microservicio de correo ───────────
   Si MAIL_SERVICE_URL está configurada, este router valida el permiso y delega
   el envío. Sin ella se usa el camino local, para que la migración al
   microservicio no deje el correo caído en ningún momento. */
const MAIL_URL = (process.env.MAIL_SERVICE_URL || '').replace(/\/$/, '');
const MAIL_KEY = process.env.MAIL_SERVICE_KEY || '';

async function delegar(ruta, payload) {
  const r = await fetch(`${MAIL_URL}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gestek-key': MAIL_KEY },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/* ─────────── helpers ─────────── */

/* Los correos son parte de la página que ve el público, así que quien puede
   editarla puede editarlos. Antes esto era exclusivo del dueño, y un
   colaborador con `editar_pagina_publica` se topaba con un 403 sin motivo
   aparente. Enviar sí se queda más arriba: ver `assertEnvio`. */
const PERMS_EDITAR = ['editar_pagina_publica', 'editar_evento'];

async function cargarEvento(eventoId, userId, perms = PERMS_EDITAR) {
  await assertPermiso(eventoId, userId, perms, 'id, owner_id');
  const { data } = await supabase
    .from('eventos')
    .select(`id, titulo, slug, owner_id, fecha_inicio, timezone, cover_url,
             location_nombre, location_direccion, page_json,
             organizador:profiles!owner_id(nombre, empresa)`)
    .eq('id', eventoId).maybeSingle();
  if (!data) throw new Error('Evento no encontrado.');
  return data;
}

/* Mandar correos en nombre del evento mueve la reputación del dominio, así que
   además de editar hace falta poder tocar la lista de asistentes. */
const PERMS_ENVIAR = ['gestionar_clientes', 'editar_evento'];

function fallo(res, e) {
  const msg = e?.message || 'Error';
  const code = msg === 'No autorizado.' ? 403 : msg === 'Evento no encontrado.' ? 404 : 400;
  return res.status(code).json({ error: msg });
}

/* Solo los campos conocidos, recortados. Sin esto un cliente podía guardar
   cualquier clave en la fila. */
function limpiar(body) {
  const out = {};
  for (const k of CAMPOS) {
    if (k in (body || {})) {
      const v = body[k];
      out[k] = v == null ? null : String(v).slice(0, k === 'cuerpo' ? 8000 : 500);
    }
  }
  return out;
}

/* Resuelve los destinatarios según la audiencia elegida. */
async function resolverDestinatarios(evento, audiencia) {
  if (audiencia === 'equipo') {
    const lista = [];
    const { data: miembros } = await supabase
      .from('event_members')
      .select('email, profile:profiles!user_id(nombre, email)')
      .eq('evento_id', evento.id);
    for (const m of (miembros || [])) {
      const email = m.profile?.email || m.email;
      if (email) lista.push({ email, nombre: m.profile?.nombre || '' });
    }
    const { data: owner } = await supabase.from('profiles').select('nombre, email').eq('id', evento.owner_id).maybeSingle();
    if (owner?.email) lista.push({ email: owner.email, nombre: owner.nombre || '' });
    return lista;
  }

  let q = supabase
    .from('tickets')
    .select(`guest_email, guest_nombre, codigo, ticket_type_id,
             usuario:profiles!user_id(nombre, email),
             tipo:ticket_types!ticket_type_id(nombre)`)
    .eq('evento_id', evento.id)
    .neq('estado', 'invalido');

  if (String(audiencia || '').startsWith('tipo:')) {
    q = q.eq('ticket_type_id', String(audiencia).slice(5));
  }
  const { data: tickets } = await q;
  /* Una boleta comprada con sesión guarda el correo en el perfil, no en
     guest_email. Antes solo se miraba guest_email, así que las campañas se
     saltaban justo a los asistentes registrados. */
  return (tickets || [])
    .map(t => ({
      email: t.usuario?.email || t.guest_email,
      nombre: t.usuario?.nombre || t.guest_nombre || '',
      codigo: t.codigo || '',
      tipo_boleta: t.tipo?.nombre || '',
    }))
    .filter(d => d.email);
}

function dedupe(lista) {
  const vistos = new Set();
  const out = [];
  for (const d of lista) {
    const k = String(d.email || '').toLowerCase().trim();
    if (!k || !k.includes('@') || vistos.has(k)) continue;
    vistos.add(k);
    out.push({ ...d, email: k });
  }
  return out;
}

/* ─────────── catálogo + plantillas guardadas ─────────── */

router.get('/eventos/:id/emails', async (req, res) => {
  try {
    const evento = await cargarEvento(req.params.id, req.user.id);

    let plantillas = {};
    let tablaLista = true;
    const { data, error } = await supabase
      .from('evento_email_plantillas')
      .select('tipo, asunto, encabezado, cuerpo, boton_texto, boton_url, imagen, footer, activo, updated_at')
      .eq('evento_id', evento.id);

    if (error) {
      /* La 0052 todavía no está aplicada. Se avisa en vez de fingir que se
         puede guardar: el editor muestra el aviso y deja ver los defaults. */
      tablaLista = false;
    } else {
      for (const p of (data || [])) plantillas[p.tipo] = p;
    }

    /* Lo que quedó en page_json de antes de la 0052, para no dar por perdido
       lo que alguien ya escribió. */
    const heredadas = evento.page_json?.emails || {};
    for (const [tipo, p] of Object.entries(heredadas)) {
      if (!plantillas[tipo] && p && typeof p === 'object') {
        plantillas[tipo] = { tipo, ...p, origen: 'page_json' };
      }
    }

    res.json({
      tipos: TIPOS,
      variables: VARIABLES,
      plantillas,
      diagnostico: diagnosticoProveedor(),
      almacenamiento_listo: tablaLista,
    });
  } catch (e) { fallo(res, e); }
});

router.put('/eventos/:id/emails/:tipo', async (req, res) => {
  const tipo = String(req.params.tipo || '');
  if (!IDS_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de correo desconocido.' });
  try {
    const evento = await cargarEvento(req.params.id, req.user.id);
    const fila = {
      evento_id: evento.id,
      tipo,
      ...limpiar(req.body),
      updated_by: req.user.id,
    };
    if ('activo' in (req.body || {})) fila.activo = req.body.activo !== false;

    const { data, error } = await supabase
      .from('evento_email_plantillas')
      .upsert(fila, { onConflict: 'evento_id,tipo' })
      .select('tipo, asunto, encabezado, cuerpo, boton_texto, boton_url, imagen, footer, activo, updated_at')
      .single();
    if (error) {
      return res.status(503).json({
        error: 'Falta aplicar la migración 0052 para poder guardar plantillas.',
        detalle: error.message,
      });
    }
    res.json({ plantilla: data });
  } catch (e) { fallo(res, e); }
});

router.delete('/eventos/:id/emails/:tipo', async (req, res) => {
  const tipo = String(req.params.tipo || '');
  if (!IDS_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de correo desconocido.' });
  try {
    const evento = await cargarEvento(req.params.id, req.user.id);
    const { error } = await supabase
      .from('evento_email_plantillas')
      .delete().eq('evento_id', evento.id).eq('tipo', tipo);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, tipo });
  } catch (e) { fallo(res, e); }
});

/* ─────────── vista previa ───────────
   Devuelve el HTML de verdad, el mismo que saldría por SMTP, con datos de
   ejemplo. La plantilla puede venir en el body sin guardar, para ver los
   cambios mientras se escriben. */
router.post('/eventos/:id/emails/previsualizar', async (req, res) => {
  const tipo = String(req.body?.tipo || 'personalizado');
  if (!IDS_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de correo desconocido.' });
  try {
    const evento = await cargarEvento(req.params.id, req.user.id);
    const plantilla = req.body?.plantilla && typeof req.body.plantilla === 'object'
      ? limpiar(req.body.plantilla)
      : (await plantillaDe(evento, tipo)).plantilla || {};

    /* Ejemplos de las variables que no salen del evento. */
    const ctx = ctxDeEvento(evento, {
      nombre     : 'Ana Martínez',
      tipo_boleta: 'Entrada general',
      codigo     : 'GTK-4F8B2A',
      rol        : 'Coordinador',
      tarea      : 'Confirmar catering',
    });

    const { asunto, html } = renderEmail({ tipo, plantilla, evento, ctx });
    res.json({ asunto, html, ctx });
  } catch (e) { fallo(res, e); }
});

router.get('/eventos/:id/emails/diagnostico', async (req, res) => {
  try {
    await cargarEvento(req.params.id, req.user.id);
    const base = diagnosticoProveedor();

    /* `?verificar=1` abre la conexión de verdad y hace login. Es lo que
       distingue «las variables están puestas» de «el correo funciona»: hasta
       ahora una contraseña equivocada daba `configurado: true` y los envíos se
       descartaban en silencio. Va bajo bandera porque tarda un segundo y el
       panel pinta el diagnóstico al entrar; el botón «Probar conexión» sí la pide. */
    if (req.query.verificar === '1') {
      const conexion = await Promise.race([
        verificarConexion(),
        new Promise(r => setTimeout(() => r({
          ok: false,
          causa: 'conexion',
          mensaje: 'El servidor de correo no respondió en 12 segundos.',
          sugerencia: 'Suele ser el puerto bloqueado desde donde corre el backend, o un host mal escrito.',
        }), 12_000)),
      ]);
      return res.json({ ...base, conexion });
    }

    res.json(base);
  } catch (e) { fallo(res, e); }
});

/* Últimos envíos: para ver si un asistente recibió su boleta y por qué no. */
router.get('/eventos/:id/emails/envios', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 300);
  try {
    const evento = await cargarEvento(req.params.id, req.user.id, PERMS_ENVIAR);
    const { data, error } = await supabase
      .from('evento_email_envios')
      .select('id, tipo, destinatario, asunto, ok, motivo, created_at')
      .eq('evento_id', evento.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.json({ envios: [], almacenamiento_listo: false });
    res.json({ envios: data || [], almacenamiento_listo: true });
  } catch (e) { fallo(res, e); }
});

/* ─────────── envíos ─────────── */

router.post('/eventos/:id/emails/prueba', async (req, res) => {
  const tipo = String(req.body?.tipo || 'personalizado');
  if (!IDS_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de correo desconocido.' });
  try {
    const evento = await cargarEvento(req.params.id, req.user.id);
    const destino = req.user.email;
    if (!destino) return res.status(400).json({ error: 'Tu cuenta no tiene correo.' });

    if (MAIL_URL) {
      const r = await delegar('/prueba', { evento_id: evento.id, tipo, to: destino });
      return res.status(r.status).json(r.data);
    }

    const diag = diagnosticoProveedor();
    if (!diag.configurado) return res.status(503).json({ error: diag.aviso });

    const r = await enviarEmailEvento({
      evento, tipo, to: destino,
      ctx: {
        nombre: 'Prueba', tipo_boleta: 'Entrada general', codigo: 'GTK-PRUEBA',
        rol: 'Coordinador', tarea: 'Tarea de prueba',
      },
      registrar: false,
    });
    if (!r.ok) return res.status(502).json({ error: `No se pudo enviar: ${r.motivo}` });
    res.json({ ok: true, enviado_a: destino, origen: r.origen });
  } catch (e) { fallo(res, e); }
});

router.post('/eventos/:id/emails/enviar', async (req, res) => {
  const tipo = String(req.body?.tipo || 'personalizado');
  const audiencia = String(req.body?.audiencia || 'todos');
  if (!IDS_TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de correo desconocido.' });
  try {
    const evento = await cargarEvento(req.params.id, req.user.id, PERMS_ENVIAR);

    if (MAIL_URL) {
      const r = await delegar('/enviar', { evento_id: evento.id, tipo, audiencia });
      return res.status(r.status).json(r.data);
    }

    const diag = diagnosticoProveedor();
    if (!diag.configurado) return res.status(503).json({ error: diag.aviso });

    let destinatarios;
    try { destinatarios = dedupe(await resolverDestinatarios(evento, audiencia)); }
    catch (e) { return res.status(500).json({ error: 'No se pudieron resolver los destinatarios: ' + e.message }); }

    if (destinatarios.length === 0) return res.status(400).json({ error: 'No hay destinatarios para ese segmento.' });
    if (destinatarios.length > MAX_DESTINATARIOS) {
      return res.status(400).json({ error: `Demasiados destinatarios (${destinatarios.length}). El máximo por envío es ${MAX_DESTINATARIOS}.` });
    }

    let enviados = 0;
    const errores = [];
    for (let i = 0; i < destinatarios.length; i += LOTE) {
      const lote = destinatarios.slice(i, i + LOTE);
      await Promise.all(lote.map(async (d) => {
        const r = await enviarEmailEvento({
          evento, tipo, to: d.email,
          ctx: { nombre: d.nombre, codigo: d.codigo, tipo_boleta: d.tipo_boleta },
        });
        if (r.ok) enviados++;
        else errores.push({ email: d.email, motivo: r.motivo });
      }));
    }

    res.json({ enviados, fallidos: errores.length, total: destinatarios.length, errores: errores.slice(0, 20) });
  } catch (e) { fallo(res, e); }
});

module.exports = router;
