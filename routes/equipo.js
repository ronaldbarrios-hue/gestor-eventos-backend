const express = require('express');
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { notificar } = require('../lib/notificar.js');
const { auditar } = require('../lib/auditar.js');
const { assertPermiso } = require('../lib/acceso.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const { baseFrontend } = require('../lib/frontend.js');

const router = express.Router();
router.use(verifySupabaseJWT);

const PERMS_EQUIPO = ['invitar_staff', 'gestionar_roles', 'remover_miembros'];
function assertOwner(eventoId, userId, perms = PERMS_EQUIPO) {
  return assertPermiso(eventoId, userId, perms, 'id, owner_id');
}

/* GET /eventos/:eventoId/equipo */
router.get('/:eventoId/equipo', sesion("Cada ruta llama a assertOwner con la lista de permisos que le toca (invitar_staff, gestionar_roles, remover_miembros): el permiso se comprueba dentro, contra el rol del miembro."), async (req, res) => {
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
router.post('/:eventoId/equipo', sesion("Cada ruta llama a assertOwner con la lista de permisos que le toca (invitar_staff, gestionar_roles, remover_miembros): el permiso se comprueba dentro, contra el rol del miembro."), async (req, res) => {
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

    // Verificar si ya existe (incluso removido)
    const { data: existing } = await supabase
      .from('event_members')
      .select('id, status')
      .eq('evento_id', eventoId)
      .ilike('email', email)
      .maybeSingle();

    let data, error;
    if (existing) {
      if (existing.status !== 'removed') {
        return res.status(409).json({ error: 'Ese email ya está en el equipo.' });
      }
      // Reactivar miembro removido
      ({ data, error } = await supabase
        .from('event_members')
        .update({ ...payload })
        .eq('id', existing.id)
        .select(`*, profile:profiles!user_id(id, nombre, avatar_url, email), rol_detail:event_roles!rol_id(id, nombre, descripcion)`)
        .single());
    } else {
      ({ data, error } = await supabase
        .from('event_members')
        .insert(payload)
        .select(`*, profile:profiles!user_id(id, nombre, avatar_url, email), rol_detail:event_roles!rol_id(id, nombre, descripcion)`)
        .single());
    }
    if (error) return res.status(500).json({ error: error.message });

    const { data: ev } = await supabase
      .from('eventos').select('titulo, cover_url').eq('id', eventoId).maybeSingle();

    /* La plantilla sale de la del evento (o del texto por defecto) y lleva su
       marca. `enviarEmailEvento` completa lo que falte del evento por su
       cuenta y nunca lanza: una invitación que no se puede enviar por correo no
       debe deshacer al miembro ya creado. */
    const resultEmail = await enviarEmailEvento({
      evento: eventoId,
      tipo: 'invitacion_equipo',
      to: email.toLowerCase(),
      ctx: {
        nombre: nombre_invitado || (email || '').split('@')[0],
        rol: rol.nombre,
        enlace: `${baseFrontend()}/eventos/${eventoId}`,
      },
    });
    console.log('[equipo] email invitación resultado:', resultEmail);

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
router.patch('/:eventoId/equipo/:miembroId', sesion("Cada ruta llama a assertOwner con la lista de permisos que le toca (invitar_staff, gestionar_roles, remover_miembros): el permiso se comprueba dentro, contra el rol del miembro."), async (req, res) => {
  const { eventoId, miembroId } = req.params;
  const { rol_id } = req.body;
  if (!rol_id) return res.status(400).json({ error: 'rol_id requerido.' });
  try {
    await assertOwner(eventoId, req.user.id, ['gestionar_roles']);
    const { data: rol } = await supabase
      .from('event_roles').select('id, nombre').eq('id', rol_id).eq('evento_id', eventoId).maybeSingle();
    if (!rol) return res.status(400).json({ error: 'Rol inválido para este evento.' });
    const { data, error } = await supabase
      .from('event_members')
      .update({ rol_id: rol.id, rol: rol.nombre })
      .eq('id', miembroId)
      .eq('evento_id', eventoId)
      .select(`*, profile:profiles!user_id(id, nombre, avatar_url, email), rol_detail:event_roles!rol_id(id, nombre, descripcion)`)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'equipo.rol', { entidad: 'miembro', entidadId: miembroId, detalle: { rol: rol.nombre } });
    res.json({ miembro: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/equipo/:miembroId — sacar del equipo (soft) */
router.delete('/:eventoId/equipo/:miembroId', sesion("Cada ruta llama a assertOwner con la lista de permisos que le toca (invitar_staff, gestionar_roles, remover_miembros): el permiso se comprueba dentro, contra el rol del miembro."), async (req, res) => {
  const { eventoId, miembroId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id, ['remover_miembros']);
    const { error } = await supabase
      .from('event_members')
      .update({ status: 'removed' })
      .eq('id', miembroId)
      .eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    auditar(req, eventoId, 'equipo.quitar', { entidad: 'miembro', entidadId: miembroId });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/vincular-invitaciones — vincula todas las invitaciones pendientes
   de este usuario recién autenticado (por email) a su cuenta nueva, marcándolas
   como aceptadas. Se llama justo después de registro/login exitoso.
   Devuelve rol y título del evento de la primera invitación (la más reciente),
   para que el frontend pueda mostrar el mensaje de bienvenida sin tener que
   volver a consultar por separado (evita condición de carrera con el status). */
router.post('/vincular-invitaciones', sesion("Acepta las invitaciones dirigidas al email de SU sesión. No recibe a quién vincular: sale de req.user."), async (req, res) => {
  const email = (req.user.email || '').toLowerCase().trim();
  if (!email) return res.json({ vinculadas: 0, invitaciones: [] });

  const { data: pendientes, error: e1 } = await supabase
    .from('event_members')
    .select(`
      id, evento_id, rol,
      evento:eventos!evento_id(id, titulo)
    `)
    .eq('email', email)
    .eq('status', 'invited')
    .is('user_id', null)
    .order('invited_at', { ascending: false });
  if (e1) return res.status(500).json({ error: e1.message });
  if (!pendientes || pendientes.length === 0) return res.json({ vinculadas: 0, invitaciones: [] });

  const { error: e2 } = await supabase
    .from('event_members')
    .update({ user_id: req.user.id, status: 'active', accepted_at: new Date().toISOString() })
    .eq('email', email)
    .eq('status', 'invited')
    .is('user_id', null);
  if (e2) return res.status(500).json({ error: e2.message });

  res.json({
    vinculadas: pendientes.length,
    invitaciones: pendientes.map(p => ({
      eventoId: p.evento_id,
      rol: p.rol,
      eventoTitulo: p.evento?.titulo || null,
    })),
  });
});

module.exports = router;
