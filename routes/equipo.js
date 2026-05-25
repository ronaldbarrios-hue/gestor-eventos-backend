const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { notificar } = require('../lib/notificar.js');
const { auditar } = require('../lib/auditar.js');
const { assertPermiso } = require('../lib/acceso.js');
const { sendMail } = require('../lib/email.js');

/* Se monta en /eventos. Los paths internos incluyen :eventoId. */
const router = express.Router();
router.use(verifySupabaseJWT);

const PERMS_EQUIPO = ['invitar_staff', 'gestionar_roles', 'remover_miembros'];

function assertOwner(eventoId, userId, perms = PERMS_EQUIPO) {
  return assertPermiso(eventoId, userId, perms, 'id, owner_id');
}

/* GET /eventos/:eventoId/equipo — listar miembros + el owner */
router.get('/:eventoId/equipo', async (req, res) => {
  const eventoId = req.params.eventoId;
  try {
    const evento = await assertOwner(eventoId, req.user.id);

    const { data: miembros, error } = await supabase
      .from('event_members')
      .select(`
        id, email, nombre_invitado, rol, rol_id, custom_permissions, status, invited_at, accepted_at,
        profile:profiles!user_id(id, nombre, avatar_url, email),
        rol_detail:event_roles!rol_id(id, nombre, descripcion)
      `)
      .eq('evento_id', eventoId)
      .neq('status', 'removed')
      .order('invited_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const { data: owner } = await supabase
      .from('profiles').select('id, nombre, avatar_url, email').eq('id', evento.owner_id).maybeSingle();

    res.json({ owner, miembros: miembros || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/equipo — invitar */
router.post('/:eventoId/equipo', async (req, res) => {
  const eventoId = req.params.eventoId;
  const { email, rol_id, nombre_invitado } = req.body;

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email requerido.' });
  if (!rol_id)                        return res.status(400).json({ error: 'Selecciona un rol primero.' });

  try {
    await assertOwner(eventoId, req.user.id, ['invitar_staff']);

    const { data: rol } = await supabase
      .from('event_roles').select('id, nombre').eq('id', rol_id).eq('evento_id', eventoId).maybeSingle();
    if (!rol) return res.status(400).json({ error: 'Rol inválido para este evento.' });

    const { data: existingProfile } = await supabase
      .from('profiles').select('id').ilike('email', email).maybeSingle();

    const payload = {
      evento_id      : eventoId,
      email          : email.toLowerCase(),
      nombre_invitado: nombre_invitado || null,
      rol            : rol.nombre,
      rol_id         : rol.id,
      invited_by     : req.user.id,
      user_id        : existingProfile?.id || null,
      status         : existingProfile ? 'active' : 'invited',
      accepted_at    : existingProfile ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
      .from('event_members')
      .insert(payload)
      .select(`*, profile:profiles!user_id(id, nombre, avatar_url, email), rol_detail:event_roles!rol_id(id, nombre, descripcion)`)
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ese email ya está en el equipo.' });
      return res.status(500).json({ error: error.message });
    }

    /* Trae el título del evento para el email */
    const { data: ev } = await supabase
      .from('eventos').select('titulo').eq('id', eventoId).maybeSingle();

    /* Enviar email de invitación siempre */
    const resultEmail = await sendMail({
      to: email.toLowerCase(),
      subject: `Te invitaron al equipo de "${ev?.titulo || 'un evento'}" en GESTEK`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;background:#070C18;color:#E5E5E5;">
          <h2 style="color:#F1F5F9;">¡Te sumaron a un equipo!</h2>
          <p style="color:#94A3B8;">Fuiste invitado como <strong style="color:#F1F5F9;">${rol.nombre}</strong> en el evento <strong style="color:#F1F5F9;">${ev?.titulo || 'un evento'}</strong>.</p>
          <a href="${process.env.FRONTEND_URL || 'https://gestor-eventos-frontend.vercel.app'}/eventos/${eventoId}"
             style="display:inline-block;margin-top:24px;background:#fafafa;color:#0a0a0a;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:600;">
            Ver el evento
          </a>
          <p style="font-size:12px;color:#71717A;margin-top:28px;">Enviado por GESTEK Event OS.</p>
        </div>
      `,
    });
    console.log('[equipo] email invitación resultado:', resultEmail);

    /* Si el invitado ya tiene cuenta, le notificamos in-app */
    if (existingProfile?.id) {
      notificar({
        userId : existingProfile.id,
        tipo   : 'equipo',
        titulo : 'Te sumaron a un equipo',
        cuerpo : `Ahora sos ${rol.nombre} en ${ev?.titulo || 'un evento'}.`,
        link   : `/eventos/${eventoId}`,
        eventoId,
      });
    }

    auditar(req, eventoId, 'equipo.invitar', { entidad: 'miembro', entidadId: data.id, detalle: { email: email.toLowerCase(), rol: rol.nombre } });
    res.status(201).json({ miembro: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PATCH /eventos/:eventoId/equipo/:miembroId — cambiar rol */
router.patch('/:eventoId/equipo/:miembroId', async (req, res) => {
  const { eventoId, miembroId } = req.params;
  const { rol_id } = req.body;
  if (!rol_id) return res.status(400).json({ error: 'rol_id requerido.' });

  try {
