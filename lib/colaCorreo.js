/* GESTEK — Cola de correo con freno por hora.

   Por qué: cPanel corta en 200 correos/hora de fábrica y pasarse BLOQUEA la
   cuenta. No es un límite teórico — es el que decide si el día que abren los
   registros la gente recibe su boleta o no.

   Con la venta repartida en semanas la media (~250/día) cabe de sobra. Lo que
   no cabe son los picos: la apertura de registros, y cualquier envío masivo.
   La cola convierte un pico en una fila que avanza sola.

   Cómo se enciende: `EMAIL_COLA_ACTIVA=1`. Mientras esté apagada, el envío
   sigue siendo directo y esto no estorba. Se puede encender y apagar sin
   desplegar, que es lo que uno quiere el día del evento.

   Lo que NO hace, a propósito: reintentar para siempre. Tres intentos y a
   'fallido', porque una dirección que rebota no mejora insistiendo y seguir
   escribiéndole es la forma más rápida de quemar la reputación del dominio.

   ── La contingencia: los que se quedan colgados ──────────────────────────

   Una fila se marca `enviando` ANTES de intentar el envío, para que un proceso
   que muere a mitad no reenvíe la boleta al arrancar de nuevo: dos QR distintos
   en la bandeja de alguien confunden más que uno que no llegó.

   El precio de esa decisión es que esa fila se queda en `enviando` y ya no la
   mira nadie: el envío se pierde EN SILENCIO. Mientras el proceso vivía para
   siempre casi no pasaba; con el backend en cPanel pasa a ser rutina, porque
   Passenger recicla la aplicación cuando nadie la usa y el cron puede caer en
   mitad de una pasada.

   `rescatarColgados` cierra ese agujero sin romper la regla: lo que lleva
   demasiado tiempo en `enviando` NO se reenvía solo —eso duplicaría—, pasa a
   `fallido` con el motivo escrito. Deja de ser invisible, sale en el resumen, y
   reenviarlo es una decisión de alguien (`reintentarFallidos`), no un accidente
   del planificador. */

const supabase = require('./supabase.js');

const activa = () => process.env.EMAIL_COLA_ACTIVA === '1';

/* Por debajo del tope real, con margen: el propio panel de cPanel, los correos
   de la cuenta y cualquier cosa fuera de la cola también gastan cupo. */
const porHora = () => {
  const n = Number(process.env.EMAIL_MAX_POR_HORA);
  return Number.isFinite(n) && n > 0 ? n : 150;
};

const MAX_INTENTOS = 3;

const faltaTabla = (e) => /email_cola|does not exist|relation .* does not exist/i.test(String(e?.message || ''));

/* ── Meter en la cola ───────────────────────────────────────────────── */

/* `prioridad`: 0 transaccional (boleta recién comprada), 5 masivo. Una boleta
   tiene que adelantar a 7.000 recordatorios encolados hace una hora; si no, el
   comprador espera su QR detrás de toda la campaña. */
async function encolar({ evento_id, tipo, to, ctx = {}, prioridad = 0, cuando = null }) {
  const destinatario = String(to || '').trim().toLowerCase();
  if (!destinatario.includes('@')) return { ok: false, motivo: 'sin_destinatario' };

  const { data, error } = await supabase
    .from('email_cola')
    .insert({
      evento_id: evento_id || null,
      tipo,
      destinatario,
      ctx,
      prioridad,
      proximo_intento: cuando || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    if (faltaTabla(error)) return { ok: false, motivo: 'sin_cola' };
    return { ok: false, motivo: error.message };
  }
  return { ok: true, id: data.id };
}

/* Encolar muchos de golpe: una campaña de 7.000 no puede ser 7.000 inserts.
   Devuelve cuántos entraron. */
async function encolarLote(filas = [], { prioridad = 5 } = {}) {
  const validas = filas
    .map(f => ({
      evento_id: f.evento_id || null,
      tipo: f.tipo,
      destinatario: String(f.to || '').trim().toLowerCase(),
      ctx: f.ctx || {},
      prioridad: f.prioridad ?? prioridad,
      proximo_intento: f.cuando || new Date().toISOString(),
    }))
    .filter(f => f.destinatario.includes('@'));

  let metidas = 0;
  for (let i = 0; i < validas.length; i += 500) {
    const { error } = await supabase.from('email_cola').insert(validas.slice(i, i + 500));
    if (error) {
      if (faltaTabla(error)) return { ok: false, metidas, motivo: 'sin_cola' };
      return { ok: false, metidas, motivo: error.message };
    }
    metidas += Math.min(500, validas.length - i);
  }
  return { ok: true, metidas };
}

/* ── Vaciar la cola ─────────────────────────────────────────────────── */

/* Cuántos caben en esta pasada. El worker corre cada minuto, así que el cupo
   por minuto es el de la hora dividido entre 60, mínimo 1: con un tope de 150
   salen 2 o 3 por minuto, unos 3.600 al día sin acercarse al corte. */
function cupoPorPasada() {
  return Math.max(1, Math.floor(porHora() / 60));
}

/* Cuánto puede estar una fila en `enviando` antes de darla por interrumpida.
   Diez minutos es de sobra: el envío más lento que se ha visto —SMTP con
   adjunto y reintento de TLS— no pasa de treinta segundos. Lo que tarda más es
   que el proceso ya no exista. */
const MINUTOS_COLGADO = 10;

/* Rescata lo que quedó a medias. Devuelve cuántas filas se marcaron. */
async function rescatarColgados({ minutos = MINUTOS_COLGADO } = {}) {
  const corte = new Date(Date.now() - minutos * 60_000).toISOString();

  /* Se mira `proximo_intento`, que al pasar a `enviando` se pone en la hora de
     ese momento. La tabla no tiene una columna de «última modificación» y
     añadirla habría sido una migración en producción para algo que esta
     columna ya sabe decir: si lleva en `enviando` desde antes del corte, nadie
     la ha tocado desde entonces. */
  const { data, error } = await supabase
    .from('email_cola')
    .update({
      estado: 'fallido',
      ultimo_error: 'Interrumpido: el proceso se cortó a mitad del envío. No se reenvía solo para no duplicar la boleta; reintentar desde el panel si hace falta.',
    })
    .eq('estado', 'enviando')
    .lt('proximo_intento', corte)
    .select('id');

  if (error) {
    if (faltaTabla(error)) return { rescatados: 0, saltado: true };
    console.warn('[cola] no se pudieron rescatar los colgados:', error.message);
    return { rescatados: 0, saltado: true };
  }

  const n = (data || []).length;
  if (n) console.warn(`[cola] ${n} correo(s) quedaron a medias y se marcaron como fallidos.`);
  return { rescatados: n };
}

/* Devuelve a la fila lo que falló, para volver a intentarlo. Es una decisión
   de alguien —un botón del panel—, nunca automática: si el motivo del fallo
   era una dirección que rebota, insistir sola quema la reputación del dominio. */
async function reintentarFallidos(eventoId) {
  const { data, error } = await supabase
    .from('email_cola')
    .update({ estado: 'pendiente', intentos: 0, proximo_intento: new Date().toISOString() })
    .eq('evento_id', eventoId)
    .eq('estado', 'fallido')
    .select('id');

  if (error) return { ok: false, error: error.message };
  return { ok: true, reencolados: (data || []).length };
}

/* Se le inyecta el remitente para no crear un ciclo de require entre este
   archivo y emailPlantillas (que a su vez necesita encolar). */
async function drenar(enviarUno) {
  if (!activa()) return { saltado: 'apagada' };

  /* Antes de nada, lo que quedó a medias en una pasada anterior. Va aquí y no
     en un cron aparte porque es exactamente el momento en que importa: si no,
     esas filas se quedan invisibles hasta que alguien las busque. */
  const { rescatados } = await rescatarColgados();

  const cupo = cupoPorPasada();
  const { data: lote, error } = await supabase
    .from('email_cola')
    .select('id, evento_id, tipo, destinatario, ctx, intentos')
    .eq('estado', 'pendiente')
    .lte('proximo_intento', new Date().toISOString())
    /* Prioridad primero y luego antigüedad: dentro del mismo nivel, el que
       lleva más esperando. */
    .order('prioridad', { ascending: true })
    .order('proximo_intento', { ascending: true })
    .limit(cupo);

  if (error) {
    if (faltaTabla(error)) return { saltado: 'sin_cola' };
    console.warn('[cola] no se pudo leer:', error.message);
    return { saltado: 'error' };
  }
  if (!lote?.length) return { enviados: 0, fallidos: 0, rescatados };

  let enviados = 0, fallidos = 0;

  for (const fila of lote) {
    /* Se marca antes de intentar: si el proceso muere a mitad, este correo no
       se reenvía solo al arrancar de nuevo. Duplicar una boleta confunde más
       que perderla, porque llegan dos QR distintos y nadie sabe cuál vale. */
    await supabase.from('email_cola')
      .update({
        estado: 'enviando',
        intentos: fila.intentos + 1,
        /* La hora de este intento. Es lo que permite, más tarde, distinguir un
           envío en curso de uno que se quedó colgado porque el proceso murió:
           `rescatarColgados` mira justo esto. */
        proximo_intento: new Date().toISOString(),
      })
      .eq('id', fila.id);

    let r;
    try {
      r = await enviarUno(fila);
    } catch (e) {
      r = { ok: false, motivo: e.message };
    }

    if (r?.ok) {
      enviados++;
      await supabase.from('email_cola')
        .update({ estado: 'enviado', enviado_at: new Date().toISOString(), ultimo_error: null })
        .eq('id', fila.id);
      continue;
    }

    fallidos++;
    const agotado = fila.intentos + 1 >= MAX_INTENTOS;
    await supabase.from('email_cola')
      .update({
        estado: agotado ? 'fallido' : 'pendiente',
        ultimo_error: String(r?.motivo || 'error').slice(0, 300),
        /* Espera creciente: 5 y 25 minutos. Si el proveedor está caído o el
           tope de la hora se agotó, insistir cada minuto sólo empeora. */
        proximo_intento: new Date(Date.now() + (fila.intentos + 1) ** 2 * 5 * 60_000).toISOString(),
      })
      .eq('id', fila.id);
  }

  return { enviados, fallidos, rescatados };
}

/* ── Estado, para el panel ──────────────────────────────────────────── */

async function resumen(eventoId = null) {
  let q = supabase.from('email_cola').select('estado, prioridad');
  if (eventoId) q = q.eq('evento_id', eventoId);
  const { data, error } = await q;
  if (error) return { disponible: false };

  const cuenta = { pendiente: 0, enviado: 0, fallido: 0, cancelado: 0, enviando: 0 };
  for (const f of data || []) cuenta[f.estado] = (cuenta[f.estado] || 0) + 1;

  const porH = porHora();
  return {
    disponible: true,
    activa: activa(),
    por_hora: porH,
    ...cuenta,
    /* Lo que de verdad quiere saber quien mira esto el día del evento. */
    horas_para_vaciar: cuenta.pendiente > 0 ? Math.ceil(cuenta.pendiente / porH) : 0,
  };
}

/* Cancela lo que aún no ha salido de un evento: el botón de pánico si alguien
   encoló una campaña equivocada a 7.000 personas. */
async function cancelarPendientes(eventoId) {
  const { error, count } = await supabase
    .from('email_cola')
    .update({ estado: 'cancelado' }, { count: 'exact' })
    .eq('evento_id', eventoId)
    .eq('estado', 'pendiente');
  if (error) return { ok: false, motivo: error.message };
  return { ok: true, cancelados: count ?? 0 };
}

module.exports = {
  encolar, encolarLote, drenar, resumen, cancelarPendientes,
  rescatarColgados, reintentarFallidos,
  activa, porHora, cupoPorPasada, MAX_INTENTOS, MINUTOS_COLGADO,
};
