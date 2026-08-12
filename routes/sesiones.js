/* GESTEK — Inscripción a sub-eventos.

   El problema que resuelve: hoy la boleta da acceso al evento entero y no queda
   registro de a qué sub-evento entró cada quien. Así no se puede responder la
   pregunta que importa para reportar — cuánta gente asistió al evento y cuánta
   participó en cada taller, charla o competencia.

   No se monta otra boletería paralela. La boleta del evento sigue siendo la
   llave; lo que se añade es la inscripción a un sub-evento colgada de esa
   boleta, con su propio cupo y su propio formulario. Un asistente con una
   entrada puede apuntarse a tres talleres sin que se emitan tres códigos más.

   Y se admite inscribir a alguien sin boleta (con sus datos), porque en la
   práctica siempre llega quien aparece en el taller sin haber pasado por la
   entrada general — y si no se le puede registrar, el conteo miente.

   Rutas públicas (montadas en /eventos/publicos):
   - GET  /slug/:slug/sesiones                      → sub-eventos con cupo y libres
   - POST /slug/:slug/sesiones/:sesionId/inscribir  → apuntarse

   Rutas del panel (montadas en /eventos):
   - GET   /:eventoId/sesiones/participacion            → resumen por sub-evento
   - GET   /:eventoId/sesiones/:sesionId/inscripciones  → lista con sus respuestas
   - POST  /:eventoId/sesiones/:sesionId/asistencia     → marcar que sí fue
   - PATCH /:eventoId/sesiones/:sesionId/inscripciones/:id → cancelar / reactivar
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const { validarFormulario, normalizarRespuestas } = require('../lib/formularioCampos.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');

const publico = express.Router();
const panel = express.Router();

publico.use(verifySupabaseJWTOptional);
panel.use(verifySupabaseJWT);

const ESTADOS = ['inscrito', 'asistio', 'cancelada'];

/* Campos del sub-evento que se exponen. */
const COLS_SESION = `id, titulo, descripcion, inicio, fin, ubicacion, track, tipo,
  requiere_inscripcion, cupo, inscritos, ticket_type_id`;

function fallo(res, e) {
  const msg = e?.message || 'Error';
  const code = msg === 'No autorizado.' ? 403 : msg.includes('no encontrad') ? 404 : 400;
  return res.status(code).json({ error: msg });
}

/* La 0055 añade requiere_inscripcion, cupo e inscritos. Si no está aplicada, el
   select falla entero: se detecta una vez y se avisa con un mensaje que dice qué
   hacer, en vez de un error de columna inexistente. */
function faltaMigracion(error) {
  const m = String(error?.message || '');
  return /requiere_inscripcion|sesion_inscripciones|column .* does not exist/i.test(m);
}
const AVISO_MIGRACION = 'Falta aplicar la migración 0055 para usar la inscripción por sub-evento.';

/* ─────────────── PÚBLICO ─────────────── */

/* Los sub-eventos de un evento publicado, con lo que queda libre. */
publico.get('/slug/:slug/sesiones', async (req, res) => {
  const { data: evento } = await supabase
    .from('eventos').select('id, estado, deleted_at').eq('slug', req.params.slug).maybeSingle();
  if (!evento || evento.estado !== 'publicado' || evento.deleted_at) {
    return res.status(404).json({ error: 'Este evento no existe o no está publicado.' });
  }

  const { data, error } = await supabase
    .from('agenda_sessions')
    .select(COLS_SESION)
    .eq('evento_id', evento.id)
    .order('inicio', { ascending: true });
  if (error) {
    if (faltaMigracion(error)) return res.json({ sesiones: [], almacenamiento_listo: false });
    return res.status(500).json({ error: error.message });
  }

  const sesiones = (data || []).map(s => ({
    ...s,
    libres: s.cupo == null ? null : Math.max(0, s.cupo - (s.inscritos || 0)),
    lleno: s.cupo != null && (s.inscritos || 0) >= s.cupo,
  }));
  res.json({ sesiones, almacenamiento_listo: true });
});

/* Apuntarse a un sub-evento.

   Con `codigo` de boleta se cuelga de ella y se reusan los datos del asistente.
   Sin código hace falta nombre y correo. */
publico.post('/slug/:slug/sesiones/:sesionId/inscribir', async (req, res) => {
  const { slug, sesionId } = req.params;
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  const respuestas = req.body?.respuestas && typeof req.body.respuestas === 'object' ? req.body.respuestas : {};

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, titulo, slug, estado, deleted_at, page_json, cover_url, fecha_inicio, timezone, location_nombre')
    .eq('slug', slug).maybeSingle();
  if (!evento || evento.estado !== 'publicado' || evento.deleted_at) {
    return res.status(404).json({ error: 'Este evento no existe o no está publicado.' });
  }

  const { data: sesion, error: eSes } = await supabase
    .from('agenda_sessions').select(COLS_SESION).eq('id', sesionId).eq('evento_id', evento.id).maybeSingle();
  if (eSes) {
    if (faltaMigracion(eSes)) return res.status(503).json({ error: AVISO_MIGRACION });
    return res.status(500).json({ error: eSes.message });
  }
  if (!sesion) return res.status(404).json({ error: 'Sub-evento no encontrado.' });
  if (!sesion.requiere_inscripcion) {
    return res.status(400).json({ error: 'Este sub-evento no pide inscripción: basta con tu entrada al evento.' });
  }

  /* Boleta, si la trae. */
  let ticket = null;
  if (codigo) {
    const { data: t } = await supabase
      .from('tickets')
      .select('id, evento_id, estado, guest_nombre, guest_email, ticket_type_id, usuario:profiles!user_id(nombre, email)')
      .eq('codigo', codigo).eq('evento_id', evento.id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Ese código de boleta no existe en este evento.' });
    if (!['pagado', 'usado', 'emitido'].includes(t.estado)) {
      return res.status(400).json({ error: 'Esa boleta no está vigente.' });
    }
    ticket = t;
  }

  const nombre = String(req.body?.nombre || ticket?.usuario?.nombre || ticket?.guest_nombre || '').trim();
  const email = String(req.body?.email || ticket?.usuario?.email || ticket?.guest_email || '').trim().toLowerCase();
  if (!ticket) {
    if (!nombre) return res.status(400).json({ error: 'Necesitamos tu nombre.' });
    if (!email.includes('@')) return res.status(400).json({ error: 'Necesitamos un correo válido.' });
  }

  /* Cupo. Se vuelve a leer el contador justo aquí: entre pintar la página y
     pulsar el botón pudo llenarse. */
  if (sesion.cupo != null && (sesion.inscritos || 0) >= sesion.cupo) {
    return res.status(409).json({ error: 'Este sub-evento ya está lleno.' });
  }

  /* El formulario que aplica: el del tipo de boleta que fije el sub-evento, o el
     de la boleta con la que viene, o el general del evento. */
  const tipoParaForm = sesion.ticket_type_id || ticket?.ticket_type_id || null;
  const { data: campos } = await supabase
    .from('event_form_fields')
    .select('id, etiqueta, requerido, tipo, opciones, ticket_type_id')
    .eq('evento_id', evento.id);

  const falloForm = validarFormulario(campos, respuestas, tipoParaForm);
  if (falloForm) return res.status(400).json({ error: falloForm });
  const limpias = normalizarRespuestas(campos, respuestas);

  const fila = {
    evento_id: evento.id,
    session_id: sesion.id,
    ticket_id: ticket?.id || null,
    nombre: nombre || null,
    email: email || null,
    telefono: String(req.body?.telefono || '').trim() || null,
    respuestas: Object.keys(limpias).length ? limpias : null,
    estado: 'inscrito',
  };

  const { data: inscripcion, error } = await supabase
    .from('sesion_inscripciones').insert(fila).select('id, estado, created_at').single();

  if (error) {
    if (faltaMigracion(error)) return res.status(503).json({ error: AVISO_MIGRACION });
    /* El índice único de la migración es el que garantiza que nadie se apunte
       dos veces; aquí solo se traduce a algo legible. */
    if (String(error.message).includes('duplicate') || error.code === '23505') {
      return res.status(409).json({ error: 'Ya estabas inscrito en este sub-evento.' });
    }
    return res.status(500).json({ error: error.message });
  }

  /* Aviso por correo, best-effort: la inscripción ya quedó. */
  if (email) {
    let cuando = '';
    if (sesion.inicio) {
      const d = new Date(sesion.inicio);
      if (!Number.isNaN(d.getTime())) {
        cuando = d.toLocaleString('es-CO', {
          day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
          timeZone: evento.timezone || 'America/Bogota',
        });
      }
    }
    enviarEmailEvento({
      evento,
      tipo: 'cita',
      to: email,
      ctx: {
        nombre,
        /* El "lugar" del correo es el del sub-evento, no el del evento: es a
           donde tiene que ir esa persona. */
        lugar: sesion.ubicacion || evento.location_nombre || '',
        hora: cuando,
        tipo_boleta: sesion.titulo,
      },
    }).catch(() => {});
  }

  res.status(201).json({ inscripcion, sesion: sesion.titulo });
});

/* ─────────────── PANEL ─────────────── */

const PERMS_VER = ['ver_clientes', 'gestionar_clientes', 'gestionar_agenda', 'editar_evento'];
const PERMS_MARCAR = ['checkin', 'gestionar_clientes', 'gestionar_agenda', 'editar_evento'];

/* Resumen: cuánta gente por sub-evento, cuánta fue de verdad y cuánta llegó sin
   boleta. Sale de la vista v_participacion_sesiones (migración 0055). */
panel.get('/:eventoId/sesiones/participacion', async (req, res) => {
  try {
    await assertPermiso(req.params.eventoId, req.user.id, PERMS_VER, 'id, owner_id');

    const { data, error } = await supabase
      .from('v_participacion_sesiones')
      .select('*')
      .eq('evento_id', req.params.eventoId)
      .order('inicio', { ascending: true });
    if (error) {
      if (faltaMigracion(error)) return res.json({ participacion: [], totales: null, almacenamiento_listo: false });
      return res.status(500).json({ error: error.message });
    }

    /* El total del evento se cuenta aparte: son boletas, no inscripciones, y una
       persona con boleta puede no haber entrado a ningún sub-evento. */
    const { data: tickets } = await supabase
      .from('tickets').select('estado').eq('evento_id', req.params.eventoId);
    const emitidas = (tickets || []).filter(t => t.estado !== 'invalido').length;
    const entraron = (tickets || []).filter(t => t.estado === 'usado').length;

    res.json({
      participacion: data || [],
      totales: {
        boletas_emitidas: emitidas,
        entraron_al_evento: entraron,
        sub_eventos: (data || []).length,
        inscripciones: (data || []).reduce((s, r) => s + Number(r.inscritos || 0), 0),
      },
      almacenamiento_listo: true,
    });
  } catch (e) { fallo(res, e); }
});

/* Los inscritos de un sub-evento, con sus respuestas del formulario. */
panel.get('/:eventoId/sesiones/:sesionId/inscripciones', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  try {
    await assertPermiso(req.params.eventoId, req.user.id, PERMS_VER, 'id, owner_id');

    const { data, error } = await supabase
      .from('sesion_inscripciones')
      .select(`id, nombre, email, telefono, respuestas, estado, asistio_at, created_at,
               ticket:tickets!ticket_id(codigo, guest_nombre, guest_email,
                                        usuario:profiles!user_id(nombre, email))`)
      .eq('evento_id', req.params.eventoId)
      .eq('session_id', req.params.sesionId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      if (faltaMigracion(error)) return res.json({ inscripciones: [], almacenamiento_listo: false });
      return res.status(500).json({ error: error.message });
    }

    /* Se resuelve aquí el nombre que se va a mostrar, para que el panel no
       tenga que repetir la cascaraita en tres sitios. */
    const inscripciones = (data || []).map(i => ({
      ...i,
      nombre_mostrar: i.nombre || i.ticket?.usuario?.nombre || i.ticket?.guest_nombre || '—',
      email_mostrar: i.email || i.ticket?.usuario?.email || i.ticket?.guest_email || '—',
      codigo_boleta: i.ticket?.codigo || null,
    }));
    res.json({ inscripciones, almacenamiento_listo: true });
  } catch (e) { fallo(res, e); }
});

/* Marcar asistencia. Acepta el código de la boleta o el id de la inscripción,
   porque en la puerta del taller se escanea el QR que ya tiene la persona. */
panel.post('/:eventoId/sesiones/:sesionId/asistencia', async (req, res) => {
  const { eventoId, sesionId } = req.params;
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  const inscripcionId = req.body?.inscripcion_id || null;

  try {
    await assertPermiso(eventoId, req.user.id, PERMS_MARCAR, 'id, owner_id');
    if (!codigo && !inscripcionId) {
      return res.status(400).json({ error: 'Manda el código de la boleta o el id de la inscripción.' });
    }

    let query = supabase
      .from('sesion_inscripciones')
      .select('id, estado, nombre, email, ticket_id')
      .eq('evento_id', eventoId).eq('session_id', sesionId);

    if (inscripcionId) {
      query = query.eq('id', inscripcionId);
    } else {
      const { data: t } = await supabase
        .from('tickets').select('id').eq('codigo', codigo).eq('evento_id', eventoId).maybeSingle();
      if (!t) return res.status(404).json({ error: 'Ese código no existe en este evento.' });
      query = query.eq('ticket_id', t.id);
    }

    const { data: insc, error: eGet } = await query.maybeSingle();
    if (eGet) {
      if (faltaMigracion(eGet)) return res.status(503).json({ error: AVISO_MIGRACION });
      return res.status(500).json({ error: eGet.message });
    }
    if (!insc) return res.status(404).json({ error: 'Esa persona no está inscrita en este sub-evento.' });
    if (insc.estado === 'cancelada') return res.status(400).json({ error: 'Esa inscripción está cancelada.' });
    if (insc.estado === 'asistio') {
      return res.json({ ok: true, ya_marcada: true, inscripcion: insc });
    }

    const { data, error } = await supabase
      .from('sesion_inscripciones')
      .update({ estado: 'asistio', asistio_at: new Date().toISOString() })
      .eq('id', insc.id)
      .select('id, estado, asistio_at, nombre, email')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, ya_marcada: false, inscripcion: data });
  } catch (e) { fallo(res, e); }
});

/* Cancelar o reactivar una inscripción. El trigger de la 0055 recalcula el cupo. */
panel.patch('/:eventoId/sesiones/:sesionId/inscripciones/:id', async (req, res) => {
  const estado = String(req.body?.estado || '');
  if (!ESTADOS.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Usa: ${ESTADOS.join(', ')}.` });
  }
  try {
    await assertPermiso(req.params.eventoId, req.user.id, PERMS_MARCAR, 'id, owner_id');
    const parche = { estado };
    if (estado !== 'asistio') parche.asistio_at = null;

    const { data, error } = await supabase
      .from('sesion_inscripciones')
      .update(parche)
      .eq('id', req.params.id)
      .eq('evento_id', req.params.eventoId)
      .eq('session_id', req.params.sesionId)
      .select('id, estado, asistio_at')
      .maybeSingle();
    if (error) {
      if (faltaMigracion(error)) return res.status(503).json({ error: AVISO_MIGRACION });
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'Inscripción no encontrada.' });
    res.json({ inscripcion: data });
  } catch (e) { fallo(res, e); }
});

module.exports = { publico, panel };
