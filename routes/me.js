const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { otorgarBadge } = require('../lib/gamificacion.js');
const { esUrlImagenSegura } = require('../lib/urls.js');
const { signTicketQR } = require('../lib/qr.js');
const { sendMail, plantillaTicket } = require('../lib/email.js');
const router = express.Router();
router.use(verifySupabaseJWT);

/* GET /me — perfil del usuario logueado */
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (data && !data.avatar_url) {
    const md = req.user.user_metadata || {};
    const foto = md.foto || md.avatar_url || md.picture || null;
    if (foto && esUrlImagenSegura(foto)) {
      data.avatar_url = foto;
      supabase.from('profiles').update({ avatar_url: foto })
        .eq('id', req.user.id).then(() => {}, () => {});
    }
  }
  if (req.user.email) {
    supabase
      .from('event_members')
      .update({
        user_id: req.user.id,
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .eq('email', req.user.email.toLowerCase())
      .eq('status', 'invited')
      .is('user_id', null)
      .then(() => {}, () => {});
  }
  res.json({ profile: data });
});

/* PATCH /me — actualizar campos editables del perfil */
router.patch('/', async (req, res) => {
  const allowed = ['nombre', 'handle', 'avatar_url', 'telefono', 'ciudad', 'empresa', 'ocupacion', 'bio'];
  const updates = {};
  for (const k of allowed) {
    if (k in req.body) updates[k] = req.body[k];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Sin campos válidos para actualizar.' });
  }
  if ('avatar_url' in updates && !esUrlImagenSegura(updates.avatar_url)) {
    return res.status(400).json({ error: 'La URL de avatar no es válida.' });
  }
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  if (data.nombre && data.telefono && data.ciudad) {
    otorgarBadge(req.user.id, 'perfil_completo');
  }
  res.json({ profile: data });
});

/* GET /me/boletas — boletas compradas por el usuario logueado */
router.get('/boletas', async (req, res) => {
  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, fecha_fin, location_nombre, cover_url, estado)
    `)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const { data: porEmail, error: e2 } = await supabase
    .from('tickets')
    .select(`
      id, codigo, qr_token, estado, precio_pagado, created_at, checked_in_at,
      tipo:ticket_types!ticket_type_id(nombre, descripcion, currency),
      evento:eventos!evento_id(id, slug, titulo, fecha_inicio, fecha_fin, location_nombre, cover_url, estado)
    `)
    .eq('guest_email', req.user.email.toLowerCase())
    .is('user_id', null)
    .order('created_at', { ascending: false });
  if (e2) return res.status(500).json({ error: e2.message });
  const todas = [...(data || []), ...(porEmail || [])];
  const unicas = Object.values(Object.fromEntries(todas.map(t => [t.id, t])));
  unicas.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ boletas: unicas, total: unicas.length });
});

/* POST /me/boletas/:id/transferir — transfiere una boleta propia a otro correo.
   Body: { email, nombre? }
   Reglas: solo boletas en estado 'pagado' (no usadas, no reembolsadas/inválidas),
   y que le pertenezcan al usuario logueado (por user_id o por guest_email).
   Las respuestas del formulario personalizado se limpian (quedan en null),
   para que la nueva persona tenga que completarlo con sus propios datos. */
router.post('/boletas/:id/transferir', async (req, res) => {
  const { id } = req.params;
  const { email, nombre } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Ingresa un email válido.' });
  }
  const nuevoEmail = email.toLowerCase().trim();
  if (nuevoEmail === (req.user.email || '').toLowerCase()) {
    return res.status(400).json({ error: 'No puedes transferirte la boleta a ti mismo.' });
  }

  try {
    /* Verificar que la boleta le pertenece al usuario logueado */
    const { data: ticket, error: eT } = await supabase
      .from('tickets')
      .select(`
        id, codigo, estado, evento_id, ticket_type_id, user_id, guest_email, guest_nombre, precio_pagado,
        tipo:ticket_types!ticket_type_id(nombre),
        evento:eventos!evento_id(titulo, cover_url, fecha_inicio, location_nombre, slug)
      `)
      .eq('id', id)
      .maybeSingle();

    if (eT) return res.status(500).json({ error: eT.message });
    if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.' });

    const esMia = ticket.user_id === req.user.id
      || (!ticket.user_id && ticket.guest_email?.toLowerCase() === (req.user.email || '').toLowerCase());
    if (!esMia) return res.status(403).json({ error: 'Esta boleta no te pertenece.' });

    if (ticket.estado !== 'pagado') {
      return res.status(400).json({ error: 'Solo se pueden transferir boletas confirmadas (pagadas) que aún no se hayan usado.' });
    }

    /* Generar un código y QR nuevos — invalida el anterior por seguridad,
       así la persona original ya no puede usar el QR viejo. */
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let nuevoCodigo = '';
    for (let i = 0; i < 8; i++) nuevoCodigo += chars[Math.floor(Math.random() * chars.length)];

    const { data: actualizado, error: eU } = await supabase
      .from('tickets')
      .update({
        user_id: null,
        guest_email: nuevoEmail,
        guest_nombre: nombre?.trim() || null,
        codigo: nuevoCodigo,
        /* Se limpian las respuestas del formulario personalizado: la nueva
           persona debe llenar sus propios datos (cédula, edad, etc.), no
           heredar los del dueño anterior. */
        respuestas: null,
      })
      .eq('id', id)
      .select('id, codigo')
      .single();
    if (eU) return res.status(500).json({ error: eU.message });

    const qr_token = signTicketQR({ ticket_id: actualizado.id, evento_id: ticket.evento_id, codigo: actualizado.codigo });
    await supabase.from('tickets').update({ qr_token }).eq('id', actualizado.id);

    /* Si el nuevo correo ya tiene una cuenta en GESTEK, vinculamos la boleta
       directo a esa cuenta para que le aparezca en "Mis boletas". */
    const { data: perfilExistente } = await supabase
      .from('profiles').select('id').ilike('email', nuevoEmail).maybeSingle();
    if (perfilExistente?.id) {
      await supabase.from('tickets').update({ user_id: perfilExistente.id }).eq('id', actualizado.id);
    }

    /* Aviso por correo a la nueva persona, con su QR ya listo */
    const frontendUrl = (process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app').split(',')[0];
    const resultadoEmail = await sendMail({
      to: nuevoEmail,
      subject: `Te transfirieron una entrada para "${ticket.evento?.titulo || 'un evento'}"`,
      html: plantillaTicket({
        eventoTitulo: ticket.evento?.titulo,
        eventoCoverUrl: ticket.evento?.cover_url,
        eventoFecha: ticket.evento?.fecha_inicio,
        eventoLugar: ticket.evento?.location_nombre,
        nombre: nombre?.trim() || null,
        codigo: nuevoCodigo,
        qrToken: qr_token,
        tipoNombre: ticket.tipo?.nombre,
        linkTicket: `${frontendUrl}/mi-ticket/${nuevoCodigo}`,
        gratis: !ticket.precio_pagado || Number(ticket.precio_pagado) === 0,
      }),
    });

    res.json({ ok: true, nuevo_codigo: nuevoCodigo, email_enviado: resultadoEmail.ok });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
