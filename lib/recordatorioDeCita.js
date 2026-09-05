/* GESTEK — Recordar una cita de la rueda antes de que empiece.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 *
 * En una rueda de negocios, la reunión a la que nadie se presenta es el peor
 * resultado posible: la mesa esperó, la casilla figuraba ocupada —así que
 * nadie más pudo pedirla— y no salió nada de ella. Desde la 0110 eso se mide;
 * esto es lo único que mueve ese número.
 *
 * Ya se manda un correo al reservar y otro al confirmar, con el calendario
 * adjunto. Pero el correo de hace tres semanas no le recuerda a nadie que su
 * cita es a las 10:15 en la mesa 12.
 *
 * ── Las decisiones, y por qué ────────────────────────────────────────────
 *
 * · **Una hora antes**, no un día. Una rueda entera cabe en una mañana: avisar
 *   la víspera de quince reuniones es un correo que se archiva. Una hora antes
 *   es cuando alguien todavía puede reorganizarse o cancelar.
 * · **Sólo las confirmadas.** Una cita pedida y sin aprobar todavía puede no
 *   existir; recordarle a alguien que vaya a una reunión que el equipo no ha
 *   aceptado es mandarlo a una mesa que no lo espera.
 * · **Sólo a quien tiene correo.** Con la 0108 hay citas de invitados sin
 *   cuenta: tienen `guest_email` y ése es su único canal.
 * · **Se marca ANTES de mandar.** El cron corre cada quince minutos: si se
 *   marcara después y el envío tardara, la siguiente pasada mandaría el mismo
 *   aviso otra vez. Perder un recordatorio es molesto; mandar cuatro es lo que
 *   hace que se dejen de leer todos, incluidos los que importan.
 * · **Cancelar se dice en el mismo correo.** Quien no va a ir y lo sabe con una
 *   hora de margen puede liberar la casilla — y ésa es la otra mitad de que la
 *   mesa no se quede sola.
 */

'use strict';

const supabase = require('./supabase.js');
const { enviarEmailEvento } = require('./emailPlantillas.js');
const { notificar } = require('./notificar.js');

/* Cuánto antes se avisa, y con cuánta tolerancia. El cron no corre al minuto
   exacto, así que se busca una ventana y no un instante. */
const MINUTOS_ANTES = 60;
const VENTANA_MIN = 20;

/* Tope por pasada. Sin él, un evento con seiscientas citas intentaría mandar
   seiscientos correos en una sola vuelta del cron y se comería la cuota del
   proveedor de golpe. Lo que sobre se manda en la siguiente pasada: hay cuatro
   por hora y el aviso sigue llegando a tiempo. */
const TOPE_POR_PASADA = 100;

async function citasPorAvisar(ahora = Date.now()) {
  const desde = new Date(ahora + (MINUTOS_ANTES - VENTANA_MIN) * 60 * 1000).toISOString();
  const hasta = new Date(ahora + (MINUTOS_ANTES + VENTANA_MIN) * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('networking_citas')
    .select(`
      id, evento_id, user_id, guest_email, guest_nombre, estado, recordatorio_at,
      horario:networking_horarios!horario_id(inicio, fin,
        expositor:networking_expositores!expositor_id(nombre, stand))
    `)
    .eq('estado', 'confirmada')
    .is('recordatorio_at', null)
    .limit(500);

  if (error) {
    /* Sin la 0112 la columna no existe y PostgREST contesta error. Se avisa
       UNA vez y se sigue: el resto del cron —los avisos del evento, la lista
       de espera— no tiene por qué caerse con esto. */
    console.warn('[citas] no se pudieron buscar los recordatorios (¿falta la 0112?):', error.message);
    return [];
  }

  /* La ventana se filtra aquí y no en la consulta: `inicio` vive en la tabla
     de horarios, y filtrar por una columna de la tabla embebida obliga a un
     `!inner` — que es justo el detalle que hoy ya costó una lista entera. Con
     500 filas como mucho, filtrarlas en memoria no cuesta nada. */
  return (data || [])
    .filter(c => c.horario?.inicio >= desde && c.horario?.inicio <= hasta)
    .slice(0, TOPE_POR_PASADA);
}

/* A quién se le manda y con qué nombre. Con cuenta, el perfil; sin ella, lo
   que dejó el equipo al sentarla (0108). */
async function destinatario(cita) {
  if (cita.guest_email) {
    return { email: cita.guest_email, nombre: cita.guest_nombre || '', userId: null };
  }
  if (!cita.user_id) return null;
  const { data } = await supabase
    .from('profiles').select('nombre, email').eq('id', cita.user_id).maybeSingle();
  if (!data?.email) return null;
  return { email: data.email, nombre: data.nombre || '', userId: cita.user_id };
}

async function correrCicloCitas() {
  const pendientes = await citasPorAvisar();
  if (!pendientes.length) return { avisadas: 0 };

  /* La zona horaria del evento: una hora escrita en la del servidor manda a
     alguien a su mesa con cinco horas de diferencia. */
  const zonas = new Map();
  let avisadas = 0;

  for (const cita of pendientes) {
    try {
      const quien = await destinatario(cita);
      /* Sin correo no hay a quién avisar. Se marca igual para no volver a
         mirarla en cada pasada durante toda la mañana del evento. */
      if (!quien) {
        await supabase.from('networking_citas')
          .update({ recordatorio_at: new Date().toISOString() }).eq('id', cita.id);
        continue;
      }

      if (!zonas.has(cita.evento_id)) {
        const { data: ev } = await supabase
          .from('eventos').select('timezone').eq('id', cita.evento_id).maybeSingle();
        zonas.set(cita.evento_id, ev?.timezone || 'America/Bogota');
      }
      const tz = zonas.get(cita.evento_id);

      const d = new Date(cita.horario.inicio);
      const hora = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: tz });
      const fecha = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
      const mesa = cita.horario?.expositor?.nombre || 'tu mesa';
      const lugar = cita.horario?.expositor?.stand
        ? `${mesa} (stand ${cita.horario.expositor.stand})`
        : mesa;

      /* Se marca ANTES de mandar: si se marcara después y el envío tardara, la
         siguiente pasada del cron mandaría el mismo aviso otra vez. */
      const { data: marcada } = await supabase
        .from('networking_citas')
        .update({ recordatorio_at: new Date().toISOString() })
        .eq('id', cita.id)
        .is('recordatorio_at', null)
        .select('id');
      /* Y el candado: si otra pasada se le adelantó, no toca ninguna fila y
         aquí no se manda nada. */
      if (!marcada || marcada.length === 0) continue;

      await enviarEmailEvento({
        evento: cita.evento_id,
        tipo: 'cita_recordatorio',
        to: quien.email,
        ctx: { nombre: quien.nombre || 'Hola', hora, fecha, lugar },
      });

      /* Y en la campana, para quien tenga cuenta y esté con la aplicación
         abierta: en una rueda es más rápido que abrir el correo. */
      if (quien.userId) {
        notificar({
          userId: quien.userId, tipo: 'networking',
          titulo: `Tu cita es a las ${hora}`,
          cuerpo: `Con ${mesa}. Si no puedes ir, cancélala para dejar el espacio libre.`,
          link: `/eventos/${cita.evento_id}`, eventoId: cita.evento_id,
        });
      }

      avisadas++;
    } catch (e) {
      /* Una cita que falla no puede llevarse las otras noventa y nueve. */
      console.warn(`[citas] no se pudo recordar la cita ${cita.id}:`, e.message);
    }
  }

  if (avisadas) console.log(`[citas] ${avisadas} recordatorio(s) de cita enviados.`);
  return { avisadas };
}

module.exports = { correrCicloCitas, citasPorAvisar, MINUTOS_ANTES, VENTANA_MIN, TOPE_POR_PASADA };
