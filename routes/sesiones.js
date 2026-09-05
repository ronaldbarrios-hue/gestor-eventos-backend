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
const { sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { horaDelEscaneo } = require('../lib/horaDeEscaneo.js');
const { anotarConstancia } = require('../lib/constanciaLegal.js');
const { verifySupabaseJWT, verifySupabaseJWTOptional } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const {
  validarFormulario, normalizarRespuestas,
  TIPOS_CAMPO, COLUMNAS_CAMPO, filaCampo, validarDefinicion,
} = require('../lib/formularioCampos.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const { resolverTicket } = require('../lib/ticketLookup.js');
const { otorgarPuntos, reglasPuntosDeEvento } = require('../lib/gamificacion.js');

const publico = express.Router();

/* Inscripción a sub-eventos desde la página pública, con el código de la
   boleta. El router `panel`, que es el del organizador, NO lleva esta marca. */
publico.use(require('../core/permisos').publica('Inscripción a sub-eventos desde la página pública, identificada por el código de la boleta.'));
const panel = express.Router();

publico.use(verifySupabaseJWTOptional);
panel.use(verifySupabaseJWT);

const ESTADOS = ['inscrito', 'asistio', 'cancelada'];

/* Campos del sub-evento que se exponen. */
const COLS_SESION = `id, titulo, descripcion, inicio, fin, ubicacion, track, tipo,
  requiere_inscripcion, cupo, inscritos, ticket_type_id, formulario_modo`;

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

/* Las preguntas que aplican a un sub-evento, según su modo.

   'ninguno' devuelve lista vacía: nada que preguntar, nada que validar.
   'propio'  devuelve solo las preguntas colgadas de ESE sub-evento (session_id).
   'evento'  devuelve el formulario general, que es como se comportaba antes. */
async function camposDeSesion(eventoId, sesion) {
  const modo = sesion?.formulario_modo || 'ninguno';
  if (modo === 'ninguno') return [];

  /* COLUMNAS_CAMPO y no una lista recortada: sin `visible_si`, `validarFormulario`
     (línea 215 abajo) no puede saber que un campo estaba OCULTO por su
     condición y lo exige igual. */
  const cols = COLUMNAS_CAMPO;

  if (modo === 'propio') {
    const { data } = await supabase
      .from('event_form_fields').select(cols)
      .eq('session_id', sesion.id)
      .order('orden', { ascending: true });
    return data || [];
  }

  /* 'evento': las del evento, sin las que pertenezcan a otro sub-evento. */
  const { data } = await supabase
    .from('event_form_fields').select(cols)
    .eq('evento_id', eventoId)
    .is('session_id', null)
    .order('orden', { ascending: true });
  return data || [];
}

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

  /* Las preguntas de los que tienen formulario propio, para poder pintarlas sin
     una petición por sub-evento. */
  const conPropio = (data || []).filter(s => s.formulario_modo === 'propio').map(s => s.id);
  const preguntas = {};
  if (conPropio.length) {
    const { data: campos } = await supabase
      .from('event_form_fields')
      .select(`${COLUMNAS_CAMPO}, session_id`)
      .in('session_id', conPropio)
      .order('orden', { ascending: true });
    for (const c of (campos || [])) {
      (preguntas[c.session_id] = preguntas[c.session_id] || []).push(c);
    }
  }

  const sesiones = (data || []).map(s => {
    const modo = s.formulario_modo || 'ninguno';
    /* Un sub-evento en modo 'propio' pero sin ninguna pregunta guardada se
       comporta como 'ninguno': basta un botón. Es la misma regla que aplica el
       editor al guardar (panel.put .../formulario), pero repetida al leer para
       cubrir los que quedaron a medias — p.ej. si el modo se puso desde los
       ajustes del sub-evento y las preguntas nunca llegaron a guardarse. */
    const propioVacio = modo === 'propio' && !(preguntas[s.id]?.length);
    return {
      ...s,
      libres: s.cupo == null ? null : Math.max(0, s.cupo - (s.inscritos || 0)),
      lleno: s.cupo != null && (s.inscritos || 0) >= s.cupo,
      /* Para que la página sepa si tiene que mostrar preguntas o basta un botón. */
      pide_datos: modo !== 'ninguno' && !propioVacio,
    };
  });

  res.json({ sesiones, preguntas, almacenamiento_listo: true });
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

  /* Qué se le pregunta al inscribirse. El caso NORMAL es nada: la boleta ya
     identificó a la persona, y volver a pedirle sus datos para apuntarse a un
     taller del mismo evento es hacerle escribir dos veces lo mismo.

     Solo si el organizador lo pide se piden preguntas, y entonces son las suyas
     de ese sub-evento — cortas y sobre la actividad— y no el formulario general
     del evento. El modo 'evento' se mantiene para los sub-eventos que ya venían
     comportándose así. */
  const campos = await camposDeSesion(evento.id, sesion);
  const tipoParaForm = sesion.formulario_modo === 'evento'
    ? (sesion.ticket_type_id || ticket?.ticket_type_id || null)
    : null;

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

  /* El cupo, comprobado OTRA VEZ y ahora de verdad.
   *
   * La comprobación de arriba lee el contador y después inserta, y entre las
   * dos cosas cabe otra inscripción: dos personas que pulsan a la vez por la
   * última plaza pasan las dos. En un taller eso son dos sillas para una, y se
   * descubre en la puerta del taller.
   *
   * Aquí ya se puede decidir sin ambigüedad: el disparador
   * `trg_sync_inscritos_sesion` mantiene el contador, así que después de mi
   * `insert` la fila existe y se puede contar CUÁNTAS entraron antes que la
   * mía. Si antes que yo ya había tantas como plazas, el que sobra soy yo — y
   * el criterio es el mismo para las dos peticiones que compiten, así que
   * exactamente una se queda.
   *
   * Se deshace la propia inscripción y se contesta lo mismo que si se hubiera
   * llegado tarde por un segundo, que es lo que pasó. */
  if (sesion.cupo != null) {
    const { count: antesQueYo, error: eCuenta } = await supabase
      .from('sesion_inscripciones')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sesion.id)
      .neq('estado', 'cancelada')
      .lt('created_at', inscripcion.created_at);

    /* Si no se puede contar, se deja la inscripción: perder una plaza por una
       consulta que falló es peor que arriesgar una de más, y esto ya pasó el
       control de arriba. Queda en el log. */
    if (eCuenta) {
      console.error(`[sesiones] no se pudo confirmar el cupo de ${sesion.id}: ${eCuenta.message}`);
    } else if ((antesQueYo || 0) >= sesion.cupo) {
      await supabase.from('sesion_inscripciones').delete().eq('id', inscripcion.id);
      return res.status(409).json({ error: 'Este sub-evento ya está lleno.' });
    }
  }

  /* Constancia de aceptación (0069). Mejor esfuerzo, después de inscribir. */
  anotarConstancia('sesion_inscripciones', inscripcion.id, evento.id, req.body?.legal_aceptado);

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
panel.get('/:eventoId/sesiones/participacion', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
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

/* ── Las preguntas propias de un sub-evento ────────────────────────────
   El modo 'propio' existía desde la 0059 y se podía elegir, pero no había
   pantalla para ESCRIBIR las preguntas: quedaba sin ninguna y se comportaba
   como 'ninguno'. Esto es esa pantalla, por el lado del servidor.

   Es el espejo del PUT /eventos/:id/formulario, con el cuidado invertido:
   aquel filtra por `session_id is null` para no llevarse por delante las de
   los sub-eventos; éste filtra por `session_id = :sesionId` para no llevarse
   por delante ni el formulario del evento ni las de OTRO sub-evento. Los dos
   diffs borran lo que no viene en el payload, así que el filtro es lo único
   que separa "guardar mis preguntas" de "borrar las de los demás". */

const PERMS_EDITAR_FORM = ['gestionar_agenda', 'editar_evento'];

/* Tope propio y más bajo que el del evento (60). Estas preguntas son "cortas y
   sobre la actividad": si alguien necesita treinta, lo que quiere es el
   formulario del evento, y para eso está el modo 'evento'. */
const MAX_CAMPOS_SUBEVENTO = 12;

async function sesionDelEvento(eventoId, sesionId) {
  const { data } = await supabase
    .from('agenda_sessions')
    .select('id, titulo, formulario_modo')
    .eq('id', sesionId).eq('evento_id', eventoId).maybeSingle();
  return data;
}

panel.get('/:eventoId/sesiones/:sesionId/formulario', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId, sesionId } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, PERMS_EDITAR_FORM, 'id, owner_id');

    const sesion = await sesionDelEvento(eventoId, sesionId);
    if (!sesion) return res.status(404).json({ error: 'Sub-evento no encontrado.' });

    const { data, error } = await supabase
      .from('event_form_fields')
      .select(COLUMNAS_CAMPO)
      .eq('evento_id', eventoId)
      .eq('session_id', sesionId)
      .order('orden', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    res.json({
      sesion,
      campos: data || [],
      /* El catálogo viaja con la respuesta, igual que en el formulario del
         evento: el panel no mantiene su propia copia. */
      tipos: TIPOS_CAMPO,
      max_campos: MAX_CAMPOS_SUBEVENTO,
    });
  } catch (e) { fallo(res, e); }
});

panel.put('/:eventoId/sesiones/:sesionId/formulario', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId, sesionId } = req.params;
  try {
    await assertPermiso(eventoId, req.user.id, PERMS_EDITAR_FORM, 'id, owner_id');

    const sesion = await sesionDelEvento(eventoId, sesionId);
    if (!sesion) return res.status(404).json({ error: 'Sub-evento no encontrado.' });

    const campos = Array.isArray(req.body.campos) ? req.body.campos : [];
    const falloDef = validarDefinicion(campos, { max: MAX_CAMPOS_SUBEVENTO });
    if (falloDef) return res.status(400).json({ error: falloDef });

    /* Sólo las de ESTE sub-evento. Sin el `.eq('session_id', …)` el diff se
       llevaría el formulario del evento entero. */
    const { data: existentes, error: eGet } = await supabase
      .from('event_form_fields')
      .select('id')
      .eq('evento_id', eventoId)
      .eq('session_id', sesionId);
    if (eGet) return res.status(500).json({ error: eGet.message });

    const idsExistentes = new Set((existentes || []).map(c => c.id));
    const idsEnviados = new Set(campos.filter(c => c.id && idsExistentes.has(c.id)).map(c => c.id));

    const idsABorrar = [...idsExistentes].filter(id => !idsEnviados.has(id));
    if (idsABorrar.length) {
      const { error } = await supabase.from('event_form_fields').delete().in('id', idsABorrar);
      if (error) return res.status(500).json({ error: error.message });
    }

    for (let i = 0; i < campos.length; i++) {
      const c = campos[i];
      if (!c.id || !idsExistentes.has(c.id)) continue;
      /* Conserva el id: las respuestas ya guardadas apuntan a él y renombrar
         una pregunta no puede huerfanizar lo que ya contestó la gente. */
      const { error } = await supabase
        .from('event_form_fields').update(filaCampo(c, i)).eq('id', c.id);
      if (error) return res.status(500).json({ error: error.message });
    }

    const nuevos = campos
      .map((c, i) => ({ ...c, _orden: i }))
      .filter(c => !c.id || !idsExistentes.has(c.id));
    if (nuevos.length) {
      const filas = nuevos.map(c => ({
        evento_id: eventoId,
        session_id: sesionId,
        /* Una pregunta de sub-evento nunca es "sólo para el tipo VIP": ese
           filtro es del formulario de compra y aquí no significa nada. */
        ...filaCampo({ ...c, ticket_type_id: null }, c._orden),
      }));
      const { error } = await supabase.from('event_form_fields').insert(filas);
      if (error) return res.status(500).json({ error: error.message });
    }

    /* Guardar preguntas y dejar el sub-evento en un modo que no las usa sería
       escribir en el vacío. Se pone en 'propio' solo; y si se quedó sin
       ninguna, se vuelve a 'ninguno' para que la agenda pública no enseñe un
       formulario vacío. */
    const modoQueToca = campos.length ? 'propio' : (sesion.formulario_modo === 'propio' ? 'ninguno' : sesion.formulario_modo);
    if (modoQueToca !== sesion.formulario_modo) {
      await supabase.from('agenda_sessions')
        .update({ formulario_modo: modoQueToca }).eq('id', sesionId);
    }

    const { data: final, error: eFinal } = await supabase
      .from('event_form_fields')
      .select(COLUMNAS_CAMPO)
      .eq('evento_id', eventoId)
      .eq('session_id', sesionId)
      .order('orden', { ascending: true });
    /* Relectura después de guardar el formulario: una lista vacía dice que se
       perdieron las preguntas que se acaban de escribir. */
    if (eFinal) console.error(`[sesiones] releer campos de ${sesionId}: ${eFinal.message}`);

    res.json({ campos: final || [], formulario_modo: modoQueToca });
  } catch (e) { fallo(res, e); }
});

/* Los inscritos de un sub-evento, con sus respuestas del formulario. */
panel.get('/:eventoId/sesiones/:sesionId/inscripciones', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
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

/* Marcar asistencia a UN sub-evento. Acepta el QR firmado de la boleta, su
   código corto o el id de la inscripción.

   Esto es lo único que suma a las métricas de un sub-evento, y es a propósito:
   entrar al evento no es asistir a un taller. El check-in de la puerta cuenta
   el ingreso al recinto y no toca nada de aquí; para que una charla sume, la
   persona tiene que estar inscrita en ella y volver a pasar su QR en su
   puerta. Sin las dos cosas, "asistió a la charla" querría decir "estaba en el
   edificio", que no es lo que nadie quiere reportar.

   Por eso no hay atajo para marcar a quien no está inscrito: la respuesta dice
   quién es y que le falta registrarse, y el staff lo registra primero. */
panel.post('/:eventoId/sesiones/:sesionId/asistencia', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
  const { eventoId, sesionId } = req.params;
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  const qrToken = req.body?.qr_token || null;
  const inscripcionId = req.body?.inscripcion_id || null;
  /* `at` (opcional): la hora REAL del escaneo cuando viene de la cola sin
     conexión de la puerta del taller. Sin esto, todos los que entraron durante
     un corte de red aparecerían apelotonados en el minuto en que volvió el
     wifi — y «cuánta gente había a las 4» es justo lo que se mira después.
     Misma validación que el control de ingreso, y en el mismo sitio. */
  const asistioAt = horaDelEscaneo(req.body?.at);

  try {
    const evento = await assertPermiso(eventoId, req.user.id, PERMS_MARCAR, 'id, owner_id');
    if (!codigo && !qrToken && !inscripcionId) {
      return res.status(400).json({ error: 'Manda el QR o el código de la boleta, o el id de la inscripción.' });
    }

    let query = supabase
      .from('sesion_inscripciones')
      .select('id, estado, nombre, email, ticket_id')
      .eq('evento_id', eventoId).eq('session_id', sesionId);

    /* La boleta se resuelve con el mismo helper que el resto de escáneres: en
       la puerta de un taller se escanea el QR de la escarapela, que puede ser
       el token firmado o el código corto según cuándo se imprimió. */
    let ticket = null;
    if (inscripcionId) {
      query = query.eq('id', inscripcionId);
    } else {
      try {
        ticket = await resolverTicket(eventoId, { qr_token: qrToken, codigo });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      if (!ticket) return res.status(404).json({ error: 'Esa boleta no existe en este evento.' });
      query = query.eq('ticket_id', ticket.id);
    }

    const { data: insc, error: eGet } = await query.maybeSingle();
    if (eGet) {
      if (faltaMigracion(eGet)) return res.status(503).json({ error: AVISO_MIGRACION });
      return res.status(500).json({ error: eGet.message });
    }
    if (!insc) {
      return res.status(404).json({
        error: 'Esa persona no está inscrita en este sub-evento. Regístrala primero y vuelve a escanear.',
        no_inscrito: true,
        ticket: ticket ? { codigo: ticket.codigo, nombre: ticket.guest_nombre, tipo: ticket.tipo?.nombre } : null,
      });
    }
    if (insc.estado === 'cancelada') return res.status(400).json({ error: 'Esa inscripción está cancelada.' });
    if (insc.estado === 'asistio') {
      return res.json({ ok: true, ya_marcada: true, inscripcion: insc, ticket: ticket ? { codigo: ticket.codigo } : null });
    }

    const { data, error } = await supabase
      .from('sesion_inscripciones')
      .update({ estado: 'asistio', asistio_at: asistioAt })
      .eq('id', insc.id)
      .select('id, estado, asistio_at, nombre, email')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    /* Puntos por ir de verdad al sub-evento, y con su procedencia escrita.

       Va DESPUÉS del update y sólo cuando `ya_marcada` era falso —el camino de
       arriba devuelve antes—, así que volver a escanear la misma escarapela no
       paga dos veces el mismo taller.

       Sólo cobra quien tiene cuenta: los puntos cuelgan de un `user_id`, y el
       inscrito sin boleta (que existe a propósito, ver la cabecera) no lo
       tiene. Se resuelve desde la boleta, no desde la inscripción, porque la
       inscripción guarda nombre y correo pero no a quién pertenecen.

       Todo esto es best-effort: si falla, la asistencia ya quedó marcada, que
       es lo que la puerta del taller necesita. */
    try {
      const { data: sesion } = await supabase
        .from('agenda_sessions').select('titulo').eq('id', sesionId).maybeSingle();
      const organizadorId = evento?.owner_id;
      let asistenteId = ticket?.user_id || null;
      if (!asistenteId && insc.ticket_id) {
        const { data: t } = await supabase
          .from('tickets').select('user_id').eq('id', insc.ticket_id).maybeSingle();
        asistenteId = t?.user_id || null;
      }
      if (organizadorId && asistenteId) {
        const reglas = await reglasPuntosDeEvento(eventoId);
        if (reglas.activo && reglas.participacion_sesion > 0) {
          otorgarPuntos({
            userId: asistenteId, organizadorId, audiencia: 'cliente',
            eventoId, accion: 'participacion_sesion',
            puntos: reglas.participacion_sesion,
            origen: { tipo: 'sesion', id: sesionId, detalle: sesion?.titulo || null },
          });
        }
      }
    } catch { /* los puntos no pueden tumbar un escaneo en la puerta */ }

    /* Cuántos van dentro de ESTE sub-evento, para que la puerta del taller vea
       su propio número sin salir de la pantalla del escáner. */
    const { data: todas } = await supabase
      .from('sesion_inscripciones')
      .select('estado').eq('evento_id', eventoId).eq('session_id', sesionId);
    const conteo = {
      inscritos : (todas || []).filter(i => i.estado !== 'cancelada').length,
      asistieron: (todas || []).filter(i => i.estado === 'asistio').length,
    };

    res.json({ ok: true, ya_marcada: false, inscripcion: data, conteo, ticket: ticket ? { codigo: ticket.codigo } : null });
  } catch (e) { fallo(res, e); }
});

/* Cancelar o reactivar una inscripción. El trigger de la 0055 recalcula el cupo. */
panel.patch('/:eventoId/sesiones/:sesionId/inscripciones/:id', sesion("Panel del evento: la ruta llama a assertPermiso con su lista concreta antes de tocar nada."), async (req, res) => {
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
