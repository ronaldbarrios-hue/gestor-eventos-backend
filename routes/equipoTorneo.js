const express = require('express');
const supabase = require('../lib/supabase.js');
const {
  COLUMNAS_CAMPO, validarFormulario, normalizarRespuestas,
} = require('../lib/formularioCampos.js');

/* ── Portal del CAPITÁN de un equipo ──────────────────────────────────────
 *
 * Cuando un tipo de boleta declara `crea = 'equipo'` (migración 0093), pagarla
 * crea la ficha del equipo con lo poco que se sabe: el nombre de quien compró y
 * su correo. El resto —lo que ese torneo pida: dorsal y posición, o nick, rango
 * y servidor— lo tiene que poner el capitán, y hasta ahora **no tenía por
 * dónde**. La promesa de Q1 era «el capitán completa sus datos por su enlace» y
 * ese enlace no existía: el equipo nacía a medias y alguien del staff acababa
 * copiando datos de un WhatsApp.
 *
 * ── Se identifica con el código de su boleta, como el expositor ──────────
 *
 * Misma forma que `/expositor/:codigo`, a propósito: es el mismo caso —alguien
 * que no tiene cuenta en la plataforma y tiene que editar UNA ficha concreta— y
 * dos maneras distintas de resolverlo serían dos maneras distintas de
 * equivocarse. El backend usa service key, así que la autorización es toda de
 * código: el equipo se DERIVA del código y se ignora cualquier id que llegue
 * del cliente.
 *
 * ── Lo que el capitán NO puede tocar ─────────────────────────────────────
 *
 * Ni el grupo, ni la posición en el cuadro, ni nada del sorteo: eso lo decide
 * el torneo. Y **el nombre deja de poder cambiarse en cuanto hay fixture**: un
 * equipo que se renombra a mitad de competición deja los partidos ya jugados
 * hablando de alguien que no existe.
 */

const router = express.Router();

router.use(require('../core/permisos').publica(
  'El capitán se identifica con el código de su boleta de inscripción, no con una cuenta.'));

async function cargarEquipo(req, res, next) {
  const cod = String(req.params.codigo || '').toUpperCase().trim();
  if (cod.length < 4) return res.status(400).json({ error: 'Código inválido.' });

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, evento_id, estado, codigo')
    .eq('codigo', cod).maybeSingle();
  if (!ticket) return res.status(404).json({ error: 'Boleta no encontrada.' });
  if (!['pagado', 'usado'].includes(ticket.estado)) {
    return res.status(403).json({ error: 'Tu inscripción todavía no está confirmada.' });
  }

  /* El equipo se busca por la boleta y no por el tipo: el vínculo lo pone el
     trigger de la 0093 y es el único que garantiza que este código manda sobre
     ESTE equipo. Si la 0093 no estuviera aplicada, `ticket_id` no existe y la
     consulta falla: se contesta que no hay equipo, que es la verdad. */
  const { data: equipo, error } = await supabase
    .from('torneo_equipos')
    .select('id, torneo_id, nombre, foto_url, contacto_email, grupo, respuestas')
    .eq('ticket_id', ticket.id).maybeSingle();

  if (error || !equipo) {
    return res.status(409).json({
      error: 'Tu equipo todavía no está listo. Si acabas de pagar, espera unos segundos y recarga.',
    });
  }

  const { data: torneo } = await supabase
    .from('torneos').select('id, nombre, disciplina, formato, estado, evento_id')
    .eq('id', equipo.torneo_id).maybeSingle();
  if (!torneo || torneo.evento_id !== ticket.evento_id) {
    return res.status(404).json({ error: 'Torneo no encontrado.' });
  }

  req.equipo = { equipo, torneo, ticket };
  next();
}

/* Los campos que este torneo pide. Sin la 0095 no hay ninguno y el portal
   enseña sólo el nombre: no es un error, es un torneo que no pide nada. */
async function camposDelTorneo(eventoId, torneoId) {
  const { data, error } = await supabase
    .from('event_form_fields').select(COLUMNAS_CAMPO)
    .eq('evento_id', eventoId).eq('torneo_id', torneoId)
    .order('orden', { ascending: true });
  return error ? [] : (data || []);
}

router.get('/:codigo/panel', cargarEquipo, async (req, res) => {
  const { equipo, torneo, ticket } = req.equipo;

  const { data: evento } = await supabase
    .from('eventos').select('id, slug, titulo, fecha_inicio, timezone')
    .eq('id', ticket.evento_id).maybeSingle();

  const campos = await camposDelTorneo(ticket.evento_id, torneo.id);

  /* Cuándo juega. Es lo primero que se pregunta quien abre esto, y sale de los
     partidos ya programados; sin fixture todavía no hay respuesta y se dice. */
  const { data: partidos } = await supabase
    .from('torneo_partidos')
    .select('id, ronda, orden, fecha_hora, cancha, estado, marcador_a, marcador_b, equipo_a_id, equipo_b_id')
    .eq('torneo_id', torneo.id)
    .or(`equipo_a_id.eq.${equipo.id},equipo_b_id.eq.${equipo.id}`)
    .order('ronda', { ascending: true }).order('orden', { ascending: true });

  /* Los nombres de los rivales, para no enseñar un uuid. */
  const { data: rivales } = await supabase
    .from('torneo_equipos').select('id, nombre, foto_url').eq('torneo_id', torneo.id);

  res.json({
    equipo,
    torneo,
    evento,
    campos,
    partidos: partidos || [],
    equipos: rivales || [],
    /* El nombre se congela con el fixture: los partidos jugados hablan de este
       equipo, y renombrarlo a mitad los deja contando otra historia. */
    puede_renombrar: torneo.estado === 'armando',
  });
});

router.put('/:codigo/ficha', cargarEquipo, async (req, res) => {
  const { equipo, torneo, ticket } = req.equipo;
  const campos = await camposDelTorneo(ticket.evento_id, torneo.id);

  const cambios = {};

  if ('nombre' in req.body) {
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El equipo necesita un nombre.' });
    if (torneo.estado !== 'armando' && nombre !== equipo.nombre) {
      return res.status(409).json({
        error: 'El torneo ya empezó: el nombre no se puede cambiar. Escríbele al organizador.',
      });
    }
    cambios.nombre = nombre;
  }

  if ('foto_url' in req.body) cambios.foto_url = req.body.foto_url || null;
  if ('contacto_email' in req.body) {
    cambios.contacto_email = String(req.body.contacto_email || '').trim() || null;
  }

  if ('respuestas' in req.body) {
    if (campos.length === 0) {
      return res.status(409).json({ error: 'Este torneo no pide datos adicionales.' });
    }
    /* La misma validación que el panel y que el registro de asistentes. Si el
       torneo declara «rango» obligatorio, aquí también lo es: un formulario que
       se puede saltar por otra puerta no es un formulario. */
    const fallo = validarFormulario(campos, req.body.respuestas || {});
    if (fallo) return res.status(400).json({ error: fallo });
    cambios.respuestas = normalizarRespuestas(campos, req.body.respuestas || {});
  }

  if (Object.keys(cambios).length === 0) return res.status(400).json({ error: 'Sin cambios.' });

  /* `.eq('id', equipo.id)` y no un id del cuerpo: el equipo sale del código de
     la boleta y no hay forma de pedir que se escriba en otro. */
  const { data, error } = await supabase
    .from('torneo_equipos').update(cambios).eq('id', equipo.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ equipo: data });
});

module.exports = router;
