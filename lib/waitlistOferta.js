/* GESTEK — La lista de espera, de verdad.

   Antes esto no existía: `event_waitlist` guardaba gente y estados y no
   disparaba nada. Cuando se liberaba un cupo, el primero de la fila pasaba a
   'contacted', recibía un push si tenía la app abierta, y ahí moría. La
   plantilla de correo `cupo_liberado` llevaba escrita desde la 0052 sin que
   nadie la llamara.

   El ciclo completo, que es lo que este módulo implementa:

     1. Se libera un cupo (reembolso, cancelación, o el organizador sube el
        cupo o el aforo) → `ofrecerCupoAlSiguiente`.
     2. Al primero de la fila le sale un correo con un enlace que sólo sirve
        para él y caduca (`WAITLIST_HORAS_OFERTA`, 24 por defecto).
     3. Mientras la oferta esté viva, ese cupo NO se lo puede llevar otro: las
        ofertas vigentes descuentan de la disponibilidad para todo el mundo
        salvo para su dueño. Sin esto el correo sería una carrera y llegar el
        primero de la lista no significaría nada.
     4. Si no lo usa, el barrido lo marca `expired` —que no es lo mismo que
        haberse dado de baja— y ofrece al siguiente.

   El barrido cuelga del cron de recordatorios, que ya corre cada quince
   minutos. Montar un segundo planificador para esto sería una pieza más que
   mantener a cambio de nada. */

'use strict';

const crypto = require('crypto');
const supabase = require('./supabase.js');
const { enviarEmailEvento } = require('./emailPlantillas.js');
const { baseFrontend } = require('./frontend.js');

/* Cuánto vale una oferta. Veinticuatro horas es el equilibrio entre no
   atascar la fila y no exigirle a alguien que mire el correo en una tarde. */
const HORAS_OFERTA = Math.max(1, Number(process.env.WAITLIST_HORAS_OFERTA || 24));

function frontendUrl() {
  return baseFrontend()
    .split(',')[0].trim().replace(/\/+$/, '');
}

function generarToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/* ── Disponibilidad con las ofertas vivas descontadas ──────────────────
   `exceptoId` es la fila de quien está intentando comprar: su propia oferta
   no puede bloquearle el cupo que se le ofreció. */
async function ofertasVigentes({ eventoId, ticketTypeId, exceptoId }) {
  let q = supabase
    .from('event_waitlist')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId)
    .eq('estado', 'contacted')
    .not('oferta_token', 'is', null)
    .gt('oferta_expira', new Date().toISOString());
  if (ticketTypeId) q = q.eq('ticket_type_id', ticketTypeId);
  if (exceptoId)    q = q.neq('id', exceptoId);
  const { count } = await q;
  return count || 0;
}

/* ¿Queda sitio de verdad para una boleta más de este tipo?
   Mira las dos puertas que tiene el evento —el cupo del tipo y el aforo
   general— y en las dos descuenta las ofertas vivas. */
async function hayCupoLibre({ evento, tipo, exceptoId }) {
  if (tipo.cupo != null) {
    const reservadas = await ofertasVigentes({ eventoId: evento.id, ticketTypeId: tipo.id, exceptoId });
    if ((tipo.vendidos || 0) + reservadas >= tipo.cupo) return false;
  }
  if (evento.aforo_total) {
    const reservadasEvento = await ofertasVigentes({ eventoId: evento.id, exceptoId });
    if ((evento.aforo_vendido || 0) + reservadasEvento >= evento.aforo_total) return false;
  }
  return true;
}

/* ── El disparador ─────────────────────────────────────────────────────
   Se llama cada vez que un cupo puede haberse liberado. Es idempotente y
   barato: si no hay fila, o no hay sitio, o alguien ya tiene una oferta viva
   para ese tipo, no hace nada.

   No lanza nunca. Esto cuelga de un reembolso o de un webhook de pago: que
   falle el correo no puede tumbar la operación que lo provocó. */
async function ofrecerCupoAlSiguiente({ eventoId, ticketTypeId }) {
  try {
    if (!eventoId || !ticketTypeId) return { ok: false, motivo: 'sin_parametros' };

    /* Si ya hay una oferta viva para este tipo, el cupo libre es suyo y no
       hay nada que ofrecer. Comprobarlo primero evita ofrecer dos veces el
       mismo asiento cuando entran dos reembolsos seguidos. */
    const vivas = await ofertasVigentes({ eventoId, ticketTypeId });

    const { data: evento } = await supabase
      .from('eventos')
      .select('id, slug, titulo, aforo_total, aforo_vendido, estado, deleted_at')
      .eq('id', eventoId).maybeSingle();
    if (!evento || evento.deleted_at || evento.estado !== 'publicado') {
      return { ok: false, motivo: 'evento_no_publicado' };
    }

    const { data: tipo } = await supabase
      .from('ticket_types')
      .select('id, nombre, cupo, vendidos, activo, venta_hasta')
      .eq('id', ticketTypeId).eq('evento_id', eventoId).maybeSingle();
    if (!tipo || !tipo.activo) return { ok: false, motivo: 'tipo_no_disponible' };
    if (tipo.venta_hasta && new Date(tipo.venta_hasta) < new Date()) {
      return { ok: false, motivo: 'venta_cerrada' };
    }

    /* `vivas` cuenta también la que acabaríamos de crear, así que el hueco
       tiene que existir POR ENCIMA de las ya ofrecidas. */
    if (tipo.cupo != null && (tipo.vendidos || 0) + vivas >= tipo.cupo) {
      return { ok: false, motivo: 'sin_cupo' };
    }
    if (evento.aforo_total) {
      const vivasEvento = await ofertasVigentes({ eventoId });
      if ((evento.aforo_vendido || 0) + vivasEvento >= evento.aforo_total) {
        return { ok: false, motivo: 'sin_aforo' };
      }
    }

    /* El primero de la fila que siga esperando. Quien dejó pasar una oferta
       ('expired') vuelve a la cola detrás de los que aún no han tenido
       ninguna: perder un correo no debería costarte el puesto para siempre,
       pero tampoco puede darte otra ronda por delante de quien nunca tuvo. */
    const { data: candidatos } = await supabase
      .from('event_waitlist')
      .select('id, guest_email, guest_nombre, user_id, posicion, ofertas_recibidas, notification_attempts, estado')
      .eq('evento_id', eventoId)
      .eq('ticket_type_id', ticketTypeId)
      .in('estado', ['active', 'expired'])
      .order('posicion', { ascending: true });

    const siguiente = (candidatos || [])
      .sort((a, b) => (a.ofertas_recibidas || 0) - (b.ofertas_recibidas || 0)
                   || (a.posicion || 0) - (b.posicion || 0))[0];
    if (!siguiente) return { ok: false, motivo: 'fila_vacia' };

    const token = generarToken();
    const ahora = new Date();
    const expira = new Date(ahora.getTime() + HORAS_OFERTA * 3600 * 1000);

    const { error: eUpd } = await supabase.from('event_waitlist').update({
      estado               : 'contacted',
      oferta_token         : token,
      oferta_expira        : expira.toISOString(),
      oferta_enviada_at    : ahora.toISOString(),
      ofertas_recibidas    : (siguiente.ofertas_recibidas || 0) + 1,
      notified_at          : ahora.toISOString(),
      last_contact_at      : ahora.toISOString(),
      notification_attempts: (siguiente.notification_attempts || 0) + 1,
    }).eq('id', siguiente.id).eq('estado', siguiente.estado);
    /* El `.eq('estado', …)` es el candado: si entre la lectura y la escritura
       otro proceso ya le ofreció el cupo a esta misma persona, el update no
       toca ninguna fila y no se manda un segundo correo. */
    if (eUpd) return { ok: false, motivo: eUpd.message };

    const enlace = `${frontendUrl()}/explorar/${evento.slug}?cupo=${encodeURIComponent(token)}`;

    const envio = await enviarEmailEvento({
      evento,
      tipo: 'cupo_liberado',
      to: siguiente.guest_email,
      ctx: {
        nombre     : siguiente.guest_nombre || 'Hola',
        tipo_boleta: tipo.nombre,
        enlace,
      },
    });

    await enviarPushWaitlist(siguiente.user_id, evento.slug, evento.titulo, token);

    return { ok: true, waitlistId: siguiente.id, email: siguiente.guest_email, expira, envio };
  } catch (e) {
    console.warn('[waitlist] no se pudo ofrecer el cupo:', e.message);
    return { ok: false, motivo: e.message };
  }
}

/* ── El barrido ────────────────────────────────────────────────────────
   Cierra las ofertas vencidas y ofrece a los siguientes. Sin esto, una
   persona que no abre el correo congela la fila entera para siempre. */
async function caducarOfertasVencidas() {
  try {
    const { data: vencidas, error } = await supabase
      .from('event_waitlist')
      .select('id, evento_id, ticket_type_id')
      .eq('estado', 'contacted')
      .not('oferta_token', 'is', null)
      .lt('oferta_expira', new Date().toISOString());
    if (error) {
      /* Si la 0061 no está aplicada, las columnas no existen. Se avisa una vez
         y se sigue: el resto del cron no tiene por qué caerse con esto. */
      console.warn('[waitlist] no se pudo revisar las ofertas (¿migración 0061 aplicada?):', error.message);
      return { caducadas: 0, ofrecidas: 0 };
    }
    if (!vencidas?.length) return { caducadas: 0, ofrecidas: 0 };

    let ofrecidas = 0;
    /* Un par por evento+tipo: si caducan tres ofertas del mismo tipo, hay que
       ofrecer tres veces, no una. Se hace en serie a propósito, porque cada
       llamada mira la disponibilidad que dejó la anterior. */
    for (const v of vencidas) {
      await supabase.from('event_waitlist').update({
        estado       : 'expired',
        oferta_token : null,
        oferta_expira: null,
      }).eq('id', v.id).eq('estado', 'contacted');

      const r = await ofrecerCupoAlSiguiente({ eventoId: v.evento_id, ticketTypeId: v.ticket_type_id });
      if (r.ok) ofrecidas++;
    }
    console.log(`[waitlist] ${vencidas.length} oferta(s) caducada(s), ${ofrecidas} nueva(s) enviada(s).`);
    return { caducadas: vencidas.length, ofrecidas };
  } catch (e) {
    console.warn('[waitlist] barrido de ofertas falló:', e.message);
    return { caducadas: 0, ofrecidas: 0 };
  }
}

/* ── Uso del token ─────────────────────────────────────────────────────
   `validarOferta` no consume nada: sólo dice si el enlace sigue sirviendo y
   para qué. La página pública la usa para saber si enseñar el cartel de
   "tienes un cupo reservado" antes de que la persona rellene nada. */
async function validarOferta(token) {
  if (!token || typeof token !== 'string') return null;
  const { data } = await supabase
    .from('event_waitlist')
    .select('id, evento_id, ticket_type_id, guest_email, guest_nombre, estado, oferta_expira')
    .eq('oferta_token', token)
    .maybeSingle();
  if (!data) return null;
  if (data.estado !== 'contacted') return null;
  if (!data.oferta_expira || new Date(data.oferta_expira) < new Date()) return null;
  return data;
}

/* Quema el token y cierra la fila de esa persona. Devuelve `true` sólo a quien
   se lo lleva.

   ── Por qué es un candado y no un apunte ────────────────────────────────
   `validarOferta` sólo LEE, y el enlace del correo llega por un sitio donde
   pulsar dos veces es normal: el móvil, con mala cobertura, y un botón que
   tarda. Dos peticiones con el mismo token pasaban las dos la validación, y
   además pasaban `hayCupoLibre`, porque a quien trae el token se le descuenta
   su propia oferta a propósito — o sea que ÉSTE es justo el camino donde el
   control de aforo está desactivado por diseño. Un cupo ofrecido salía en dos
   boletas, y el desajuste aparecía en la puerta.

   El `.eq('estado', 'contacted')` lo resuelve en una sola operación: la
   primera petición cambia la fila, la segunda no toca ninguna y lo sabe. */
async function consumirOferta(waitlistId) {
  if (!waitlistId) return false;
  try {
    const { data, error } = await supabase.from('event_waitlist').update({
      estado       : 'purchased',
      purchased_at : new Date().toISOString(),
      oferta_token : null,
      oferta_expira: null,
    }).eq('id', waitlistId).eq('estado', 'contacted').select('id');
    if (error) {
      console.warn('[waitlist] no se pudo cerrar la entrada tras la compra:', error.message);
      return false;
    }
    return Boolean(data && data.length);
  } catch (e) {
    console.warn('[waitlist] no se pudo cerrar la entrada tras la compra:', e.message);
    return false;
  }
}

/* ── Push (best-effort) ────────────────────────────────────────────────
   Vivía en routes/waitlist.js. Se trae aquí para que el aviso de cupo salga
   por un solo camino: antes el push del reembolso y el del botón manual del
   organizador eran dos copias que ya habían empezado a separarse. */
async function enviarPushWaitlist(userId, eventoSlug, eventoTitulo, token) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const pri = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !pri || !userId) return 0;

  const webpush = require('web-push');
  webpush.setVapidDetails(process.env.VAPID_CONTACT || 'mailto:hello@gestek.io', pub, pri);

  const { data: subs } = await supabase
    .from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs?.length) return 0;

  const destino = eventoSlug
    ? `/explorar/${eventoSlug}${token ? `?cupo=${encodeURIComponent(token)}` : ''}`
    : '/';
  const payload = JSON.stringify({
    title: '¡Hay un cupo disponible!',
    body : token
      ? `Se liberó un lugar en "${eventoTitulo}". Es tuyo durante ${HORAS_OFERTA} horas.`
      : `Se liberó un lugar en "${eventoTitulo}".`,
    url  : destino,
  });

  let ok = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      ok++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  return ok;
}

module.exports = {
  HORAS_OFERTA,
  ofrecerCupoAlSiguiente,
  caducarOfertasVencidas,
  validarOferta,
  consumirOferta,
  ofertasVigentes,
  hayCupoLibre,
  enviarPushWaitlist,
};
