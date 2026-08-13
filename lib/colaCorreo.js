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
   escribiéndole es la forma más rápida de quemar la reputación del dominio. */

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

/* Se le inyecta el remitente para no crear un ciclo de require entre este
   archivo y emailPlantillas (que a su vez necesita encolar). */
async function drenar(enviarUno) {
  if (!activa()) return { saltado: 'apagada' };

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
  if (!lote?.length) return { enviados: 0, fallidos: 0 };

  let enviados = 0, fallidos = 0;

  for (const fila of lote) {
    /* Se marca antes de intentar: si el proceso muere a mitad, este correo no
       se reenvía solo al arrancar de nuevo. Duplicar una boleta confunde más
       que perderla, porque llegan dos QR distintos y nadie sabe cuál vale. */
    await supabase.from('email_cola')
      .update({ estado: 'enviando', intentos: fila.intentos + 1 })
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

  return { enviados, fallidos };
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
  activa, porHora, cupoPorPasada, MAX_INTENTOS,
};
