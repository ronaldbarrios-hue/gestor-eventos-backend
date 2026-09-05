const express = require('express');
const { exige, sesion } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { notificar } = require('../lib/notificar.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const { enviarEmailEvento } = require('../lib/emailPlantillas.js');
const {
  COLS_TARJETA, COLS_COMPLETAS, CAMPOS_EDITABLES_ORGANIZADOR,
} = require('../lib/expositores.js');
const { zonasDelEvento } = require('../lib/aforoZonas.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Categorías donde tiene sentido ofrecer Rueda de Negocios. Los slugs deben
   coincidir con los que ya existen en la tabla `categorias`. */
const CATEGORIAS_PERMITIDAS = ['negocios', 'marketing', 'tecnologia'];

/* `gestionar_expositores` es el permiso fino (stands y rueda de negocios);
   `editar_evento` sigue valiendo para no romper a quien ya lo tenía.

   La lista es UNA: la declara la ruta con `exige()` y la vuelve a comprobar el
   helper dentro. Escrita dos veces acabarían separándose, y entonces la ruta
   diría que pide un permiso y el handler exigiría otro. */
const PERMS_EXPOSITORES = ['gestionar_expositores', 'editar_evento'];

function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, PERMS_EXPOSITORES, 'id, owner_id');
}

/* Verifica que el evento tenga una categoría habilitada para este módulo. */
async function assertCategoriaPermitida(eventoId) {
  const { data: ev } = await supabase
    .from('eventos')
    .select('categoria:categorias(slug, nombre)')
    .eq('id', eventoId)
    .maybeSingle();
  const slug = ev?.categoria?.slug;
  if (!slug || !CATEGORIAS_PERMITIDAS.includes(slug)) {
    throw new Error('La Rueda de Negocios solo está disponible para eventos de categoría Negocios, Marketing o Tecnología.');
  }
}

/* El organizador siempre puede; cualquier otro usuario necesita tener al
   menos una boleta (en cualquier estado) para ese evento. Así, solo
   quienes efectivamente asisten al evento pueden agendar citas de
   networking — no cualquiera con cuenta en GESTEK. */
async function assertPuedeParticipar(eventoId, user) {
  const { data: ev } = await supabase.from('eventos').select('owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) throw new Error('Evento no encontrado.');
  if (ev.owner_id === user.id) return;

  const email = (user.email || '').toLowerCase();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id')
    .eq('evento_id', eventoId)
    .or(`user_id.eq.${user.id},guest_email.eq.${email}`)
    .limit(1)
    .maybeSingle();

  if (!ticket) throw new Error('Necesitas una boleta para este evento para participar en la Rueda de Negocios.');
}

/* GET /eventos/:eventoId/networking/expositores — lista pública (para
   asistentes con boleta u organizador) con sus horarios y si cada
   horario ya está reservado. */
router.get('/:eventoId/networking/expositores', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. La comprobación es «esta persona va al evento».'), async (req, res) => {
  const { eventoId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  /* Sólo los que RECIBEN, y sólo los activos.
   *
   * En una rueda se sientan los compradores y rotan los vendedores. Sin este
   * filtro, quien busca con quién reunirse veía también a los que van a pasar
   * por las mesas —gente sin horarios que ofrecer— y a los dados de baja. Una
   * lista donde la mitad no se puede reservar enseña a no fiarse de la lista.
   *
   * `rol` nace en `comprador` (0105), así que un evento que no use los tres
   * papeles sigue viéndolo todo: esto no esconde nada que existiera antes.
   *
   * El error se MIRA: sin la 0105 corrida, PostgREST contesta con error y no
   * con una lista vacía — y sin mirarlo la rueda saldría vacía sin que nadie
   * supiera por qué. Ya pasó en esta base con `zonas.tipo`. */
  const { data: expositores, error: e1 } = await supabase
    .from('networking_expositores')
    .select(`${COLS_TARJETA}, descripcion`)
    .eq('evento_id', eventoId)
    .eq('rol', 'comprador')
    .eq('activo', true)
    .order('nombre', { ascending: true });
  if (e1) {
    console.error(`[networking] la lista de mesas falló (¿falta la 0105?): ${e1.message}`);
    return res.status(500).json({ error: e1.message });
  }

  const { data: horarios, error: e2 } = await supabase
    .from('networking_horarios')
    .select('id, expositor_id, inicio, fin')
    .in('expositor_id', (expositores || []).map(e => e.id).length ? expositores.map(e => e.id) : ['00000000-0000-0000-0000-000000000000'])
    .order('inicio', { ascending: true });
  if (e2) return res.status(500).json({ error: e2.message });

  /* Confirmadas Y solicitadas.
   *
   * Miraba sólo las confirmadas, y con la rueda en modo «solicitud» eso rompía
   * el modo entero: pedías una hora, la casilla seguía saliendo libre, y otra
   * persona la pedía encima. La segunda se llevaba un 409 —o peor, las dos se
   * presentaban a la misma mesa a la misma hora—.
   *
   * Una cancelada sí libera la casilla, y aquí se pinta libre. Ojo con el
   * porqué, que estaba escrito al revés: el índice único de `networking_citas`
   * es sobre `horario_id` a secas —no es parcial, comprobado en producción—,
   * así que la fila cancelada SIGUE ocupando la casilla en la base. Quien la
   * libera de verdad es la reserva, que reutiliza esa fila cuando choca. Sin
   * eso, cada cancelación del organizador dejaba una casilla que se veía libre
   * y contestaba «ya fue reservado» para siempre. */
  const { data: citas, error: e3 } = await supabase
    .from('networking_citas')
    .select('id, horario_id, user_id, estado')
    .eq('evento_id', eventoId)
    .in('estado', ['confirmada', 'solicitada']);
  if (e3) return res.status(500).json({ error: e3.message });

  const citaPorHorario = new Map((citas || []).map(c => [c.horario_id, c]));

  const resultado = (expositores || []).map(exp => ({
    ...exp,
    horarios: (horarios || [])
      .filter(h => h.expositor_id === exp.id)
      .map(h => {
        const cita = citaPorHorario.get(h.id);
        return {
          id: h.id,
          inicio: h.inicio,
          fin: h.fin,
          disponible: !cita,
          esMio: cita?.user_id === req.user.id,
          /* Si es mía, en qué estado. «Pedida» y «Reservada» no son lo mismo
             para quien está mirando su agenda del día. Sólo viaja cuando es
             suya: el estado de la cita de otro no es asunto de nadie. */
          estado: cita?.user_id === req.user.id ? cita.estado : undefined,
        };
      }),
  }));

  res.json({ expositores: resultado });
});

/* GET /eventos/:eventoId/networking/mis-citas — agenda del usuario logueado */
router.get('/:eventoId/networking/mis-citas', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. La comprobación es «esta persona va al evento».'), async (req, res) => {
  const { eventoId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const { data, error } = await supabase
    .from('networking_citas')
    .select(`
      id, estado, created_at, notas, creada_por,
      horario:networking_horarios!horario_id(id, inicio, fin,
        expositor:networking_expositores!expositor_id(id, nombre, stand, logo_url))
    `)
    .eq('evento_id', eventoId)
    .eq('user_id', req.user.id)
    /* Antes sólo las `confirmada`. Con eso, una cita PEDIDA y todavía sin
       aprobar no aparecía en ningún sitio: la persona la solicitaba y la
       pantalla se quedaba igual que antes de pedirla. Lo único que no se
       enseña es lo cancelado, que ya no es una cita. */
    .neq('estado', 'cancelada');
  if (error) return res.status(500).json({ error: error.message });

  const citas = (data || []).sort((a, b) => new Date(a.horario?.inicio) - new Date(b.horario?.inicio));
  res.json({ citas });
});

/* PATCH /eventos/:eventoId/networking/citas/:citaId/notas
 *
 * Lo que anotó quien asistió, sobre su propia cita.
 *
 * ── Por qué esto importa más de lo que parece ────────────────────────────
 *
 * Una rueda son quince reuniones de veinte minutos. Al día siguiente no hay
 * forma de saber cuál era cuál, y la libreta de papel que todo el mundo saca
 * es exactamente el hueco. Aquí la nota vive pegada a la cita: con la empresa,
 * la hora y el stand al lado.
 *
 * ── El filtro que no se puede quitar ─────────────────────────────────────
 *
 * `.eq('user_id', req.user.id)`. Sin él, cualquiera con una boleta del evento
 * podría escribir en la cita de otro con sólo cambiar el id de la URL — y las
 * notas de una rueda de negocios son de lo más sensible que se guarda aquí:
 * con quién hablaste y qué te pareció.
 */
router.patch('/:eventoId/networking/citas/:citaId/notas', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. Y la cita tiene que ser suya.'), async (req, res) => {
  const { eventoId, citaId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const notas = typeof req.body?.notas === 'string' ? req.body.notas.slice(0, 4000) : null;

  const { data, error } = await supabase
    .from('networking_citas')
    .update({ notas })
    .eq('id', citaId)
    .eq('evento_id', eventoId)
    .eq('user_id', req.user.id)
    .select('id, notas')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data)  return res.status(404).json({ error: 'Esa cita no es tuya.' });
  res.json({ cita: data });
});

/* POST /eventos/:eventoId/networking/horarios/:horarioId/reservar
   Confirmación automática — si el horario ya está tomado, falla con 409. */
router.post('/:eventoId/networking/horarios/:horarioId/reservar', sesion('Rueda de negocios: hace falta tener una boleta del evento, no un permiso. La comprobación es «esta persona va al evento».'), async (req, res) => {
  const { eventoId, horarioId } = req.params;

  try {
    await assertPuedeParticipar(eventoId, req.user);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  const { data: horario, error: e1 } = await supabase
    .from('networking_horarios')
    .select('id, expositor_id, networking_expositores!expositor_id(evento_id)')
    .eq('id', horarioId)
    .maybeSingle();
  if (e1) return res.status(500).json({ error: e1.message });
  if (!horario || horario.networking_expositores?.evento_id !== eventoId) {
    return res.status(404).json({ error: 'Horario no encontrado.' });
  }

  /* El modo lo decide el evento, no quien reserva.
   *
   * `auto` —lo de siempre y el valor por omisión— confirma en el acto.
   * `solicitud` deja la cita pendiente de que el equipo la apruebe, que es
   * como funcionan las ruedas donde las agendas se cruzan.
   *
   * Se lee aquí y no se cachea: son cuatro bytes y el modo puede cambiar a
   * mitad de un evento, que es justo cuando cambiarlo sirve de algo. */
  const { data: evModo } = await supabase
    .from('eventos').select('networking_modo').eq('id', eventoId).maybeSingle();
  const estadoInicial = evModo?.networking_modo === 'solicitud' ? 'solicitada' : 'confirmada';

  const { data: cita, error: e2 } = await supabase
    .from('networking_citas')
    .insert({
      horario_id: horarioId, evento_id: eventoId, user_id: req.user.id,
      estado: estadoInicial,
      /* Quién la creó. Sin esto, una agenda armada a mano por el equipo y una
         reservada por la persona se ven idénticas — y al reclamar «yo no pedí
         esto» no hay a qué mirar. */
      creada_por: req.user.id,
    })
    .select('id, estado')
    .single();

  let citaId = cita?.id;
  let estadoFinal = cita?.estado;

  if (e2) {
    if (e2.code !== '23505') return res.status(500).json({ error: e2.message });

    /* ── La casilla que se veía libre y no se podía reservar ──────────────
     *
     * El índice único de `networking_citas` es sobre `horario_id` A SECAS —
     * comprobado en producción, no es parcial—. Así que una cita CANCELADA
     * sigue ocupando su casilla en la base, mientras que la disponibilidad
     * que se pinta descarta las canceladas y la enseña libre.
     *
     * Cancelar desde la parrilla no borra la fila (guarda el histórico y la
     * nota del equipo), así que cada cancelación del organizador dejaba una
     * casilla muerta: se veía libre, se pulsaba, y contestaba «ya fue
     * reservado por alguien más» — por alguien que canceló. Sin forma de
     * arreglarlo desde ninguna pantalla.
     *
     * Se reutiliza esa fila. El `.eq('estado', 'cancelada')` es el candado:
     * si entre el insert y esto otra persona se llevó la casilla, no toca
     * ninguna fila y se contesta el 409 de verdad. Las notas se limpian
     * porque son de la reserva anterior y no de ésta. */
    const { data: revividas } = await supabase
      .from('networking_citas')
      .update({
        user_id: req.user.id, estado: estadoInicial, creada_por: req.user.id,
        notas: null, nota_gestor: null,
      })
      .eq('horario_id', horarioId)
      .eq('estado', 'cancelada')
      .select('id, estado');

    if (!revividas || revividas.length === 0) {
      return res.status(409).json({ error: 'Ese horario ya fue reservado por alguien más.' });
    }
    citaId = revividas[0].id;
    estadoFinal = revividas[0].estado;
  }

  /* El correo que toca, no el de siempre. La plantilla `cita` dice «quedó
     confirmada»; con el modo en «solicitud» eso sería mentira. */
  avisarDeLaCita({
    eventoId, horarioId, userId: req.user.id,
    plantilla: estadoInicial === 'solicitada' ? 'cita_pedida' : 'cita',
  });

  /* Va el ESTADO, no sólo el id. Sin él la pantalla no puede saber si la cita
     quedó confirmada o pendiente de aprobación, y decía «¡Cita confirmada!» en
     los dos casos — la misma mentira que el correo. */
  res.status(201).json({ ok: true, cita_id: citaId, estado: estadoFinal });
});

/* El correo de una cita, en un sitio.
 *
 * Lo manda tanto quien reserva como el equipo al aprobar, y son dos textos
 * distintos: en modo «solicitud» la cita nace pendiente y hasta ahora llegaba
 * igualmente «tu cita quedó confirmada». La persona se presentaba a una hora
 * que nadie le había dado, y al otro lado no había nadie esperándola.
 *
 * Best-effort y siempre después de responder: la cita ya está guardada, y un
 * fallo de SMTP no puede convertirse en un error de reserva.
 */
async function avisarDeLaCita({ eventoId, horarioId, userId, plantilla }) {
  try {
    const { data: h } = await supabase
      .from('networking_horarios')
      .select('inicio, fin, expositor:networking_expositores!expositor_id(nombre, stand)')
      .eq('id', horarioId).maybeSingle();

    const { data: perfil } = await supabase
      .from('profiles').select('nombre, email').eq('id', userId).maybeSingle();
    if (!perfil?.email) return;

    const { data: ev } = await supabase
      .from('eventos').select('timezone').eq('id', eventoId).maybeSingle();
    const tz = ev?.timezone || 'America/Bogota';

    let cuando = '';
    if (h?.inicio) {
      const d = new Date(h.inicio);
      if (!Number.isNaN(d.getTime())) {
        cuando = d.toLocaleString('es-CO', {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: 'numeric', minute: '2-digit', timeZone: tz,
        });
      }
    }

    await enviarEmailEvento({
      evento: eventoId,
      tipo: plantilla,
      to: perfil.email,
      ctx: {
        nombre: perfil?.nombre || '',
        hora: cuando,
        /* El «lugar» útil aquí es el stand, no la sede: es a donde tiene que
           ir esa persona. */
        lugar: h?.expositor?.stand ? `Stand ${h.expositor.stand}` : '',
        tipo_boleta: h?.expositor?.nombre || '',
      },
    });
  } catch (e) {
    console.warn(`[networking] no se pudo avisar de la cita (${plantilla}):`, e.message);
  }
}

/* DELETE /eventos/:eventoId/networking/citas/:citaId — cancelar mi propia cita.
   Se filtra por user_id, así que ya está implícitamente protegido. */
router.delete('/:eventoId/networking/citas/:citaId', sesion('Su propia cita: el borrado filtra por user_id, así que nadie puede tocar la de otro.'), async (req, res) => {
  const { citaId } = req.params;
  const { error } = await supabase
    .from('networking_citas')
    .delete()
    .eq('id', citaId)
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ────────────── Gestión del organizador ────────────── */

/* Todo lo que se puede guardar de un stand, para poder leerlo también.

   El select de antes devolvía nueve campos de los que CAMPOS_STAND acepta al
   guardar: contacto_nombre, contacto_email, contacto_telefono, tipo_persona y
   redes se escribían bien y no se volvían a ver nunca. En el panel parecía que
   la ficha no tuviera contacto ni redes, y de ahí salió la idea de que hacía
   falta "ampliarla" — lo que hacía falta era devolverla.

   Ahora la lista vive en `lib/expositores.js`, con las otras dos y con las de
   escritura: era la misma lección repetida en diez copias, y `zona_id` (0088)
   iba camino de repetirla otra vez. */
const COLS_STAND = COLS_COMPLETAS;

/* GET /eventos/:eventoId/expositores — expositores para el MAPA y el directorio
   (staff). Sin gate de categoría.

   Con `?todos=1` vienen también los desactivados: el panel los necesita para
   reactivarlos, y antes quedaban invisibles pese a que el comentario prometía
   "incluye borradores". */
router.get('/:eventoId/expositores', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  try {
    await assertOwner(eventoId, req.user.id);
    let q = supabase
      .from('networking_expositores')
      .select(COLS_STAND)
      .eq('evento_id', eventoId);
    if (!todos) q = q.eq('activo', true);

    const { data, error } = await q
      .order('orden', { ascending: true }).order('nombre', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    /* Cuánto ha repartido cada stand y cuánto le queda. Sale de
       v_consumo_puntos_stand (0057), que lo suma de ticket_interacciones — la
       única fuente de verdad de lo otorgado. Si la migración no está, se sigue
       sin los números en vez de fallar. */
    const consumo = {};
    const { data: filas } = await supabase
      .from('v_consumo_puntos_stand')
      .select('expositor_id, otorgados, veces, asistentes_distintos, disponibles')
      .eq('evento_id', eventoId);
    for (const f of (filas || [])) consumo[f.expositor_id] = f;

    /* Motivos y premios propios: es lo que dice si el stand puede operar o es
       una tarjeta vacía. */
    const ids = (data || []).map(x => x.id);
    const conMotivos = new Set();
    const conPremios = new Set();
    if (ids.length) {
      const [mots, recs] = await Promise.all([
        supabase.from('evento_motivos').select('expositor_id').in('expositor_id', ids),
        supabase.from('recompensas').select('expositor_id').in('expositor_id', ids),
      ]);
      for (const m of (mots.data || [])) conMotivos.add(m.expositor_id);
      for (const r of (recs.data || [])) conPremios.add(r.expositor_id);
    }

    /* El código de la boleta-stand: es con lo que el expositor entra a su portal
       (/expositor/:codigo). Estaba en tickets y el panel no lo tenía, así que
       había que armar ese enlace a mano mirando la base. */
    const codigos = {};
    const ticketIds = (data || []).map(x => x.ticket_id).filter(Boolean);
    if (ticketIds.length) {
      const { data: tks } = await supabase
        .from('tickets').select('id, codigo').in('id', ticketIds);
      for (const tk of (tks || [])) codigos[tk.id] = tk.codigo;
    }

    const expositores = (data || []).map(x => ({
      ...x,
      puntos: consumo[x.id] || { otorgados: 0, veces: 0, asistentes_distintos: 0, disponibles: null },
      tiene_motivos: conMotivos.has(x.id),
      tiene_premios: conPremios.has(x.id),
      /* El vínculo con la boleta-stand que lo creó estaba en ticket_id y no se
         mostraba en ningún sitio. */
      creado_por_boleta: Boolean(x.ticket_id),
      codigo_boleta: x.ticket_id ? (codigos[x.ticket_id] || null) : null,
      listo: conMotivos.has(x.id) && x.estado_ficha === 'completa',
    }));

    res.json({ expositores, consumo_disponible: Boolean(filas) });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ── Bolsa de puntos del evento ───────────────────────────────────────
   El organizador define un total y reparte cuota por stand. El tope lo aplica
   además un trigger de la 0057: si mañana aparece otro camino para otorgar
   puntos, sigue valiendo. Comprobarlo solo aquí sería confiar en que nadie
   escriba una segunda ruta. */

router.get('/:eventoId/expositores/bolsa', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const [bolsa, reparto] = await Promise.all([
      supabase.from('v_bolsa_evento').select('*').eq('evento_id', eventoId).maybeSingle(),
      supabase.from('v_consumo_puntos_stand')
        .select('expositor_id, nombre, stand, cuota_puntos, otorgados, veces, asistentes_distintos, disponibles')
        .eq('evento_id', eventoId).order('nombre', { ascending: true }),
    ]);
    /* Sin la 0057 no existen las vistas: se avisa en vez de reventar. */
    if (bolsa.error || reparto.error) {
      return res.json({ bolsa: null, reparto: [], almacenamiento_listo: false });
    }
    res.json({ bolsa: bolsa.data || null, reparto: reparto.data || [], almacenamiento_listo: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* PUT /eventos/:eventoId/expositores/bolsa — el total de la bolsa y su nota.
 *
 * ── `cuota_defecto` se guarda y NO lo hace cumplir nadie ─────────────────
 *
 * Se acepta aquí, vive en la tabla desde la 0057 y sale en `v_bolsa_evento`.
 * Pero el disparador que aplica el tope (`fn_verificar_cuota_stand`) lee la
 * cuota DEL STAND y, si es null, deja pasar sin límite: nunca cae a este
 * valor. O sea que un organizador que ponga 500 aquí creería que ningún stand
 * puede repartir más de 500, y todos los que no tengan cuota propia estarían
 * repartiendo sin tope. En una economía de puntos eso es la diferencia entre
 * tener presupuesto y no tenerlo.
 *
 * No se quita ni se hace funcionar en esta pasada: hacerlo funcionar cambia
 * a quién se le corta el grifo en mitad del evento, y eso se decide, no se
 * deduce. Queda escrito para que nadie construya encima creyendo que aplica.
 * Hoy no engaña a nadie porque ninguna pantalla lo manda ni lo enseña —
 * medido: la tabla está vacía en producción. */
router.put('/:eventoId/expositores/bolsa', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const aEntero = (v) => (v === null || v === '' || v === undefined)
    ? null
    : Math.max(0, Math.trunc(Number(v)));
  try {
    await assertOwner(eventoId, req.user.id);
    const total = aEntero(req.body?.total);
    if (total !== null && !Number.isFinite(total)) {
      return res.status(400).json({ error: 'El total debe ser un número.' });
    }

    /* Sólo lo que VIENE en el cuerpo.
     *
     * Antes se escribían siempre los tres campos, así que guardar el total
     * —que es lo único que manda la pantalla— ponía la nota y la cuota por
     * defecto a null. Un ajuste que se borra al tocar otro distinto: nadie lo
     * relaciona, porque el guardado que lo borró decía «guardado».
     *
     * Es un PUT y por escrito eso significa «reemplaza», pero lo que hace esta
     * ruta es actualizar la bolsa; el que llama nunca ha mandado el objeto
     * entero. Se ajusta la ruta a cómo se usa, no al revés.
     *
     * `null` explícito SÍ borra —es como se quita un tope—; lo que ya no borra
     * es la ausencia. */
    const fila = {
      evento_id: eventoId,
      updated_by: req.user.id,
      updated_at: new Date().toISOString(),
    };
    if ('total' in (req.body || {})) fila.total = total;
    if ('cuota_defecto' in (req.body || {})) fila.cuota_defecto = aEntero(req.body.cuota_defecto);
    if ('nota' in (req.body || {})) {
      fila.nota = req.body.nota ? String(req.body.nota).slice(0, 300) : null;
    }

    const { data, error } = await supabase
      .from('evento_bolsa_puntos')
      .upsert(fila, { onConflict: 'evento_id' })
      .select('*').single();
    if (error) return res.status(503).json({ error: 'Falta aplicar la migración 0057.', detalle: error.message });
    res.json({ bolsa: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* Reparto: { cuotas: { <expositor_id>: numero|null } }.
   La suma se valida ANTES de guardar nada: repartir de más y descubrirlo stand
   por stand es peor que no dejar guardar. */
router.put('/:eventoId/expositores/cuotas', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const cuotas = req.body?.cuotas && typeof req.body.cuotas === 'object' ? req.body.cuotas : null;
  if (!cuotas) return res.status(400).json({ error: 'Manda { cuotas: { id: puntos } }.' });

  try {
    await assertOwner(eventoId, req.user.id);

    const { data: mios } = await supabase
      .from('networking_expositores').select('id, cuota_puntos').eq('evento_id', eventoId);
    const validos = new Map((mios || []).map(x => [x.id, x.cuota_puntos]));

    const limpias = {};
    for (const [id, v] of Object.entries(cuotas)) {
      if (!validos.has(id)) return res.status(400).json({ error: 'Un stand de la lista no es de este evento.' });
      const n = (v === null || v === '' || v === undefined) ? null : Math.max(0, Math.trunc(Number(v)));
      if (n !== null && !Number.isFinite(n)) {
        return res.status(400).json({ error: 'Las cuotas deben ser números.' });
      }
      limpias[id] = n;
    }

    const { data: bolsa } = await supabase
      .from('evento_bolsa_puntos').select('total').eq('evento_id', eventoId).maybeSingle();

    if (bolsa?.total != null) {
      /* Se suma lo que va a quedar: las cuotas que llegan más las que esta
         petición no toca. */
      let suma = 0;
      for (const [id, actual] of validos) {
        const futura = (id in limpias) ? limpias[id] : actual;
        suma += futura || 0;
      }
      if (suma > bolsa.total) {
        return res.status(400).json({
          error: `El reparto suma ${suma} y la bolsa del evento son ${bolsa.total}. Sobran ${suma - bolsa.total}.`,
        });
      }
    }

    /* Nadie puede quedar con cuota por debajo de lo que ya repartió: sería
       dejarle el contador en rojo sin explicación. */
    const { data: consumo } = await supabase
      .from('v_consumo_puntos_stand').select('expositor_id, nombre, otorgados').eq('evento_id', eventoId);
    for (const c of (consumo || [])) {
      if (!(c.expositor_id in limpias)) continue;
      const nueva = limpias[c.expositor_id];
      if (nueva !== null && nueva < Number(c.otorgados || 0)) {
        return res.status(400).json({
          error: `"${c.nombre}" ya repartió ${c.otorgados} puntos: su cuota no puede quedar en ${nueva}.`,
        });
      }
    }

    for (const [id, cuota] of Object.entries(limpias)) {
      const { error } = await supabase
        .from('networking_expositores')
        .update({ cuota_puntos: cuota }).eq('id', id).eq('evento_id', eventoId);
      if (error) return res.status(500).json({ error: error.message });
    }

    const { data: reparto, error: eReparto } = await supabase
      .from('v_consumo_puntos_stand')
      .select('expositor_id, nombre, stand, cuota_puntos, otorgados, disponibles')
      .eq('evento_id', eventoId).order('nombre', { ascending: true });
    /* Es una VISTA, y una vista que no existe —porque falta su migración— da
       error, no cero filas. Vacío se leería como «nadie ha repartido puntos»,
       que en mitad del evento es exactamente lo contrario de la verdad. */
    if (eReparto) console.error(`[bolsa] reparto de ${eventoId} (¿falta la vista?): ${eReparto.message}`);

    res.json({ reparto: reparto || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ── Gestión de STANDS (expositores) desde el panel del organizador ──
   A diferencia de la Rueda de Negocios (gateada por categoría), los stands
   funcionan para CUALQUIER evento: se crean solos al comprar una boleta-stand
   y también se pueden agregar A MANO aquí (ticket_id = null). */
const CAMPOS_STAND = CAMPOS_EDITABLES_ORGANIZADOR;

/* La zona tiene que ser una de las declaradas en el plano del evento.
 *
 * Las zonas viven dentro de `page_json.zonas`, así que la base no puede
 * comprobarlo con una clave foránea: si nadie mira, un `zona_id` inventado se
 * guarda igual y el stand queda ubicado en ninguna parte. Quien lee aguanta
 * eso —itera sobre las zonas declaradas, y una referencia huérfana
 * simplemente no aparece—, pero aguantarlo no es lo mismo que provocarlo.
 *
 * La 0079 y la 0080 no lo validan y por eso acumulan huérfanos cuando alguien
 * borra una zona. Aquí, al menos, no se crean nuevos por escribir mal.
 * Vaciar la zona ('' → null) sigue siendo válido: es "todavía sin ubicar". */
async function zonaInvalida(eventoId, zonaId) {
  if (zonaId === undefined || zonaId === null) return null;
  const zonas = await zonasDelEvento(eventoId).catch(() => []);
  if (zonas.some(z => z.id === zonaId)) return null;
  return zonas.length
    ? `Esa zona no existe en el plano del evento. Las que hay: ${zonas.map(z => z.nombre).join(', ')}.`
    : 'El evento todavía no tiene zonas en su plano, así que no se puede ubicar el stand.';
}

/* ── Un solo alta, una sola edicion, un solo borrado ───────────────────────
 *
 * Habia dos altas de expositor contra ESTA MISMA TABLA: la de Stands, que
 * escribia los diecisiete campos de `CAMPOS_STAND`, y la de la Rueda de
 * Negocios, que escribia cuatro. Y la de la Rueda no tenia PATCH, asi que un
 * expositor creado desde ahi **no se podia editar desde ninguna parte**: ni
 * corregir el nombre, ni ponerle zona, ni arreglar el contacto.
 *
 * Los manejadores viven aqui una sola vez y se montan en las dos rutas. Las
 * dos URL siguen existiendo porque las usan dos pantallas distintas y romper
 * una para unificar la otra no arregla nada; lo que deja de estar duplicado es
 * la logica, que es lo que se separaba.
 *
 * Lo unico que NO comparten es el gate: la Rueda de Negocios solo existe para
 * ciertas categorias de evento (`assertCategoriaPermitida`), y los stands
 * funcionan para cualquiera. Por eso el gate es un middleware de la ruta y no
 * una linea dentro del manejador. */

async function crearExpositor(req, res) {
  const { eventoId } = req.params;
  const nombre = (req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'El nombre del stand es requerido.' });
  try {
    await assertOwner(eventoId, req.user.id);
    /* `estado_ficha: 'completa'` no es un detalle: el directorio y el mapa
       PUBLICOS filtran por el (`routes/eventos.publicos.js`, dos consultas), y
       la columna nace en `'borrador'`. Sin esto, un expositor creado a mano se
       veia en el panel y el publico NO lo veia nunca, sin un solo aviso.

       El `'borrador'` por defecto es correcto para el otro camino, que es el
       que la columna tenia en mente: el trigger de la 0036 crea la ficha
       cuando se paga una boleta-stand, y la completa el propio expositor desde
       `/expositor/:codigo` con `marcar_completa`. Ahi hay alguien a quien
       esperar; cuando la crea el organizador a mano no hay nadie. */
    const fila = { evento_id: eventoId, nombre, ticket_id: null, activo: true, estado_ficha: 'completa', tipo_persona: 'empresa' };
    for (const k of CAMPOS_STAND) {
      if (k === 'nombre') continue;
      if (req.body?.[k] !== undefined) fila[k] = req.body[k] === '' ? null : req.body[k];
    }
    const malaZona = await zonaInvalida(eventoId, fila.zona_id);
    if (malaZona) return res.status(400).json({ error: malaZona });
    const { data, error } = await supabase.from('networking_expositores').insert(fila).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ expositor: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
}

async function editarExpositor(req, res) {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const patch = {};
    for (const k of CAMPOS_STAND) {
      if (req.body?.[k] !== undefined) patch[k] = req.body[k] === '' ? null : req.body[k];
    }
    if (patch.nombre !== undefined) {
      const n = (patch.nombre || '').trim();
      if (!n) return res.status(400).json({ error: 'El nombre no puede quedar vacío.' });
      patch.nombre = n;
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });
    const malaZona = await zonaInvalida(eventoId, patch.zona_id);
    if (malaZona) return res.status(400).json({ error: malaZona });
    const { data, error } = await supabase.from('networking_expositores')
      .update(patch).eq('id', id).eq('evento_id', eventoId).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Stand no encontrado.' });
    res.json({ expositor: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
}

async function borrarExpositor(req, res) {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    /* El `.eq('evento_id')` no es decoracion. `assertOwner` comprueba que esta
       persona manda en ESTE evento, no que el expositor sea de este evento: la
       version de la Rueda de Negocios borraba por `id` a secas, asi que quien
       organizara un evento cualquiera podia borrar la ficha de otro evento
       ajeno pasando su id. Filtrar por evento cierra eso. */
    const { error } = await supabase.from('networking_expositores')
      .delete().eq('id', id).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
}

/* El gate de la Rueda de Negocios, como middleware: solo lo llevan sus rutas. */
async function soloCategoriaNetworking(req, res, next) {
  try {
    await assertCategoriaPermitida(req.params.eventoId);
    next();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/* Stands: cualquier evento. */
router.post('/:eventoId/expositores', exige(PERMS_EXPOSITORES), crearExpositor);
router.patch('/:eventoId/expositores/:id', exige(PERMS_EXPOSITORES), editarExpositor);
router.delete('/:eventoId/expositores/:id', exige(PERMS_EXPOSITORES), borrarExpositor);

/* Rueda de Negocios: mismas operaciones, con el gate de categoría delante. */
router.post('/:eventoId/networking/expositores', exige(PERMS_EXPOSITORES), soloCategoriaNetworking, crearExpositor);
router.patch('/:eventoId/networking/expositores/:id', exige(PERMS_EXPOSITORES), soloCategoriaNetworking, editarExpositor);
router.delete('/:eventoId/networking/expositores/:id', exige(PERMS_EXPOSITORES), soloCategoriaNetworking, borrarExpositor);

/* GET /eventos/:eventoId/networking/admin — expositores + horarios + quién reservó cada uno */
router.get('/:eventoId/networking/admin', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);

    const { data: expositores } = await supabase
      .from('networking_expositores')
      .select(`${COLS_TARJETA}, descripcion`)
      .eq('evento_id', eventoId)
      .order('nombre', { ascending: true });

    const ids = (expositores || []).map(e => e.id);
    const { data: horarios } = ids.length
      ? await supabase.from('networking_horarios').select('id, expositor_id, inicio, fin').in('expositor_id', ids).order('inicio', { ascending: true })
      : { data: [] };

    /* El error SE MIRA. Antes no: la consulta fallaba por la relacion que no
       existe, `citas` volvia null, y la pantalla pintaba todas las casillas
       libres. Una agenda llena que se ve vacia es peor que un error. */
    const { data: citas, error: eCitas } = await supabase
      .from('networking_citas')
      .select('id, horario_id, estado, user_id, guest_email, guest_nombre')
      .eq('evento_id', eventoId)
      .eq('estado', 'confirmada');
    if (eCitas) return res.status(500).json({ error: eCitas.message });

    const personas = await personasDeLasCitas(citas);
    const citaPorHorario = new Map((citas || []).map(c => [
      c.horario_id,
      {
        ...c,
        usuario: personas.get(c.user_id)
          || (c.guest_email ? { nombre: c.guest_nombre || null, email: c.guest_email } : null),
      },
    ]));
    const resultado = (expositores || []).map(exp => ({
      ...exp,
      horarios: (horarios || []).filter(h => h.expositor_id === exp.id).map(h => ({
        ...h,
        cita: citaPorHorario.get(h.id) || null,
      })),
    }));

    res.json({ expositores: resultado });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* POST /eventos/:eventoId/networking/expositores/:id/horarios
   Body: { inicio, fin, duracion_min } — genera bloques consecutivos de
   `duracion_min` minutos entre `inicio` y `fin`, todo en un solo llamado
   (así el organizador no crea horario por horario a mano). */
/* ═══════════ Las citas, desde el panel ═══════════════════════════════════
 *
 * El formato real de una rueda es una compradora sentada y vendedores que
 * rotan por hora. Quien organiza tiene que poder ver la parrilla entera,
 * aprobar lo pedido y mover a alguien de casilla cuando una empresa no llega —
 * hasta ahora una cita sólo la podía soltar quien la había reservado, así que
 * un hueco se quedaba muerto toda la jornada.
 */

const ESTADOS_CITA = ['solicitada', 'confirmada', 'cancelada', 'realizada'];

/* GET /eventos/:eventoId/networking/citas — la parrilla completa. */
/* ── Quién es cada persona de una cita ─────────────────────────────────
 *
 * NO se puede pedir con un `profiles!user_id(...)` dentro del select, y esto
 * costó una pantalla entera: `networking_citas.user_id` apunta a
 * `auth.users`, no a `public.profiles` —comprobado en produccion—, asi que
 * PostgREST no encuentra la relacion y contesta:
 *
 *   Could not find a relationship between 'networking_citas' and 'profiles'
 *
 * En la parrilla eso salia en la cara. En la vista de gestion era peor: el
 * error no se miraba, `citas` volvia null, y TODAS las casillas se pintaban
 * libres — una agenda llena que se ve vacia.
 *
 * Se resuelve con una segunda consulta y un mapa. Es una consulta mas y a
 * cambio no depende de una relacion que la base no declara.
 */
async function personasDeLasCitas(citas) {
  const ids = [...new Set((citas || []).map(c => c.user_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profiles').select('id, nombre, email, avatar_url').in('id', ids);
  if (error) {
    /* Sin los nombres la parrilla sigue sirviendo —las casillas ocupadas se
       ven igual—, asi que se avisa y se sigue en vez de tumbar la pantalla. */
    console.warn('[networking] no se pudieron cargar las personas de las citas:', error.message);
    return new Map();
  }
  return new Map((data || []).map(p => [p.id, p]));
}

router.get('/:eventoId/networking/citas', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const { data, error } = await supabase
    .from('networking_citas')
    .select(`
      id, estado, notas, nota_gestor, creada_por, created_at, user_id, guest_email, guest_nombre,
      horario:networking_horarios!horario_id(id, inicio, fin,
        expositor:networking_expositores!expositor_id(id, nombre, stand, logo_url))
    `)
    .eq('evento_id', eventoId);
  if (error) return res.status(500).json({ error: error.message });

  /* Por hora, que es como se mira una parrilla. Las que se quedaron sin
     horario —porque alguien borró la franja— van al final en vez de romper la
     comparación de fechas. */
  const citas = (data || []).sort((a, b) => {
    const x = a.horario?.inicio, y = b.horario?.inicio;
    if (!x) return 1;
    if (!y) return -1;
    return new Date(x) - new Date(y);
  });

  /* `notas` viaja porque el equipo necesita saber si la reunión dejó algo
     escrito, pero se manda RECORTADA: son apuntes personales sobre con quién
     se habló y qué pareció. La parrilla es para operar, no para leerlos. */
  const personas = await personasDeLasCitas(citas);

  res.json({
    citas: citas.map((c) => ({
      ...c,
      /* Con cuenta o sin ella, la parrilla enseña UNA persona. Sin este
         respaldo, a quien el equipo sentó por correo se le veía la casilla
         ocupada y el nombre en blanco: imposible saber a quién llamar. */
      persona: personas.get(c.user_id)
        || (c.guest_email ? { nombre: c.guest_nombre || null, email: c.guest_email, sin_cuenta: true } : null),
      notas: c.notas ? `${c.notas.slice(0, 140)}${c.notas.length > 140 ? '…' : ''}` : null,
      tiene_notas: Boolean(c.notas),
    })),
  });
});

/* PATCH /eventos/:eventoId/networking/citas/:citaId — aprobar, mover, anotar.
 *
 * Tres cosas en una ruta porque son la misma acción desde la parrilla: tocar
 * una casilla. Separarlas obligaría a la pantalla a decidir a cuál llamar
 * según qué cambió, que es una decisión que no le toca.
 */
router.patch('/:eventoId/networking/citas/:citaId', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId, citaId } = req.params;
  const updates = {};

  if (req.body?.estado) {
    if (!ESTADOS_CITA.includes(req.body.estado)) {
      return res.status(400).json({ error: `Estado inválido. Usa: ${ESTADOS_CITA.join(', ')}.` });
    }
    updates.estado = req.body.estado;
  }

  /* La nota del equipo, aparte de la de quien asistió. No se pisan: son de
     dueños distintos y se escriben en momentos distintos. */
  if ('nota_gestor' in (req.body || {})) {
    updates.nota_gestor = typeof req.body.nota_gestor === 'string'
      ? req.body.nota_gestor.slice(0, 4000) : null;
  }

  /* Mover de casilla. El horario nuevo tiene que ser de ESTE evento: sin
     comprobarlo, un id de otro evento movería la cita fuera de su rueda y
     dejaría de aparecer en las dos. */
  if (req.body?.horario_id) {
    const { data: h } = await supabase
      .from('networking_horarios')
      .select('id, expositor:networking_expositores!expositor_id(evento_id)')
      .eq('id', req.body.horario_id)
      .maybeSingle();
    if (!h || h.expositor?.evento_id !== eventoId) {
      return res.status(400).json({ error: 'Ese horario no es de este evento.' });
    }
    updates.horario_id = req.body.horario_id;

    /* Una cita CANCELADA sigue ocupando su casilla —el indice unico es sobre
       `horario_id` a secas—, mientras la parrilla la pinta libre. Al arrastrar
       a alguien ahi, la base contestaba «ya esta ocupada» senalando una casilla
       vacia en pantalla. Aqui no se puede reutilizar la fila (la que se mueve
       es otra), asi que se quita la cancelada: es lo unico que libera el hueco,
       y una cita cancelada de la que sale otra en su sitio no deja nada que
       consultar despues. */
    await supabase
      .from('networking_citas')
      .delete()
      .eq('horario_id', req.body.horario_id)
      .eq('evento_id', eventoId)
      .eq('estado', 'cancelada');
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Sin cambios.' });
  }

  const { data, error } = await supabase
    .from('networking_citas')
    .update(updates)
    .eq('id', citaId)
    .eq('evento_id', eventoId)
    .select('id, estado, horario_id, nota_gestor, user_id')
    .maybeSingle();

  /* El horario está tomado por otra cita. Es un caso normal al reorganizar
     —se arrastra a alguien a una casilla ocupada— y merece un mensaje, no un
     500 que se lee como que la aplicación se rompió. */
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Esa casilla ya está ocupada.' });
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Cita no encontrada.' });

  /* Avisar a quien va a la cita. Es lo mínimo: le acaban de cambiar la hora o
     de aprobar algo que pidió, y hasta ahora se enteraba abriendo la pantalla
     por su cuenta. */
  if (data.user_id && data.user_id !== req.user.id) {
    const que = updates.horario_id ? 'Te cambiaron la hora de una cita'
      : updates.estado === 'confirmada' ? 'Te confirmaron una cita'
      : updates.estado === 'cancelada' ? 'Te cancelaron una cita'
      : 'Hay novedades en una de tus citas';
    notificar({
      userId: data.user_id, tipo: 'networking', titulo: que,
      cuerpo: 'Míralo en la rueda de negocios del evento.',
      link: `/explorar/${req.params.eventoId}/networking`, eventoId,
    });

    /* Y el correo cuando se APRUEBA, que es la otra mitad del modo
       «solicitud». Sin esto, quien pidió una cita recibía «la estamos
       revisando» y ya: nada le decía que se la habían dado. Tenía que volver
       a entrar a mirar por su cuenta, y quien no vuelve, no va.
       Sólo al pasar a confirmada — mover de casilla o cancelar ya se cuentan
       con el aviso de arriba, y un correo por cada toque de la parrilla el día
       del evento es correo que se deja de leer. */
    if (updates.estado === 'confirmada' && data.horario_id) {
      avisarDeLaCita({
        eventoId, horarioId: data.horario_id, userId: data.user_id, plantilla: 'cita',
      });
    }
  }

  res.json({ cita: data });
});

/* POST /eventos/:eventoId/networking/citas — armar la agenda a mano.
 *
 * Quien organiza sienta a alguien en una casilla. Es la otra mitad de «tanto
 * autogestionado como por solicitud»: hay ruedas donde la agenda la arma el
 * equipo entera y el asistente sólo la recibe.
 */
router.post('/:eventoId/networking/citas', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId } = req.params;
  const { horario_id } = req.body || {};
  if (!horario_id) return res.status(400).json({ error: 'Falta el horario.' });

  /* ── A quién se sienta: una cuenta, o un correo ──────────────────────
   *
   * Pedir `user_id` obligaba a que esa persona YA tuviera cuenta en GESTEK, y
   * la mayoria de quien compra una boleta no la tiene: la compra es anonima a
   * proposito y lo unico que queda de ella es su correo en la boleta. Con esa
   * regla, armar la agenda a mano —que es como funcionan muchas ruedas— era
   * imposible para casi todos los asistentes.
   *
   * Si el correo tiene cuenta, se guarda como cuenta: asi esa persona ve la
   * cita en «Mis citas» al entrar, que es mejor que tener dos agendas para el
   * mismo humano. */
  const correo = String(req.body?.email || '').trim().toLowerCase();
  let user_id = req.body?.user_id || null;
  let guest_email = null;
  let guest_nombre = req.body?.nombre ? String(req.body.nombre).trim().slice(0, 120) : null;

  if (!user_id) {
    if (!correo.includes('@')) {
      return res.status(400).json({ error: 'Escribe el correo de la persona, o elígela de la lista.' });
    }

    /* Tiene que ir al evento. Sin esta comprobacion se podria sentar a
       cualquier correo del mundo en una mesa, y quien llega a la puerta no
       tiene boleta: la mesa se queda vacia y el hueco ya no se puede dar a
       otro. */
    const { data: boleta, error: eB } = await supabase
      .from('tickets')
      .select('id, guest_nombre, user_id')
      .eq('evento_id', eventoId)
      .eq('guest_email', correo)
      .limit(1).maybeSingle();
    if (eB) return res.status(500).json({ error: eB.message });

    const { data: perfil } = await supabase
      .from('profiles').select('id, nombre').eq('email', correo).maybeSingle();

    if (!boleta && !perfil) {
      return res.status(404).json({
        error: `Nadie con el correo ${correo} está registrado en este evento. Revisa el correo, o emítele una boleta primero desde Asistentes.`,
      });
    }

    if (perfil?.id) user_id = perfil.id;
    else {
      guest_email = correo;
      guest_nombre = guest_nombre || boleta?.guest_nombre || null;
    }
  }

  const { data: h } = await supabase
    .from('networking_horarios')
    .select('id, expositor:networking_expositores!expositor_id(evento_id)')
    .eq('id', horario_id).maybeSingle();
  if (!h || h.expositor?.evento_id !== eventoId) {
    return res.status(400).json({ error: 'Ese horario no es de este evento.' });
  }

  const { data, error } = await supabase
    .from('networking_citas')
    .insert({
      horario_id, evento_id: eventoId, user_id, guest_email, guest_nombre,
      /* Puesta por el equipo: nace confirmada. Pedirle a alguien que apruebe
         una cita que le acaban de poner sería devolverle el trabajo. */
      estado: 'confirmada',
      creada_por: req.user.id,
    })
    .select('id, estado')
    .single();

  let creada = data;
  if (error) {
    if (error.code !== '23505') return res.status(500).json({ error: error.message });

    /* La misma casilla muerta que en la reserva: una cita cancelada sigue
       ocupando su hueco en la base —el indice unico es sobre `horario_id` a
       secas— mientras la parrilla la pinta libre. Se reutiliza esa fila, con
       el `.eq('estado', 'cancelada')` de candado. Las notas se limpian: son de
       la cita anterior. */
    const { data: revividas } = await supabase
      .from('networking_citas')
      .update({ user_id, guest_email, guest_nombre, estado: 'confirmada', creada_por: req.user.id, notas: null, nota_gestor: null })
      .eq('horario_id', horario_id)
      .eq('estado', 'cancelada')
      .select('id, estado');
    if (!revividas || revividas.length === 0) {
      return res.status(409).json({ error: 'Esa casilla ya está ocupada.' });
    }
    creada = revividas[0];
  }

  /* El aviso interno sólo llega a quien tiene cuenta: es una notificación
     dentro de GESTEK. A quien se sentó por correo se le avisa por correo, que
     es el único canal que tiene. */
  if (user_id) {
    notificar({
      userId: user_id, tipo: 'networking', titulo: 'Te agendaron una cita',
      cuerpo: 'Míralo en la rueda de negocios del evento.',
      link: `/explorar/${eventoId}/networking`, eventoId,
    });
  }

  res.status(201).json({ cita: creada });
});

router.post('/:eventoId/networking/expositores/:id/horarios', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId, id } = req.params;
  const { inicio, fin, duracion_min = 15 } = req.body;
  if (!inicio || !fin) return res.status(400).json({ error: 'inicio y fin son requeridos.' });

  try {
    await assertOwner(eventoId, req.user.id);
    await assertCategoriaPermitida(eventoId);

    const { data: exp } = await supabase.from('networking_expositores').select('id').eq('id', id).eq('evento_id', eventoId).maybeSingle();
    if (!exp) return res.status(404).json({ error: 'Expositor no encontrado.' });

    const bloques = [];
    let cursor = new Date(inicio);
    const finDate = new Date(fin);
    const durMs = duracion_min * 60 * 1000;
    while (cursor.getTime() + durMs <= finDate.getTime()) {
      const bloqueInicio = new Date(cursor);
      const bloqueFin = new Date(cursor.getTime() + durMs);
      bloques.push({ expositor_id: id, inicio: bloqueInicio.toISOString(), fin: bloqueFin.toISOString() });
      cursor = bloqueFin;
    }
    if (bloques.length === 0) return res.status(400).json({ error: 'El rango de tiempo es muy corto para generar bloques.' });
    if (bloques.length > 100) return res.status(400).json({ error: 'Demasiados bloques (máximo 100 por generación).' });

    const { data, error } = await supabase.from('networking_horarios').insert(bloques).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ horarios: data, creados: data.length });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* DELETE /eventos/:eventoId/networking/horarios/:id — borrar un bloque (solo si no tiene cita) */
router.delete('/:eventoId/networking/horarios/:id', exige(PERMS_EXPOSITORES), async (req, res) => {
  const { eventoId, id } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data: cita } = await supabase.from('networking_citas').select('id').eq('horario_id', id).eq('estado', 'confirmada').maybeSingle();
    if (cita) return res.status(400).json({ error: 'Ese horario ya tiene una cita confirmada. Cancélala primero.' });
    const { error } = await supabase.from('networking_horarios').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
