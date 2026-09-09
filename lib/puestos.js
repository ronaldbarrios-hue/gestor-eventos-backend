'use strict';

/* El puesto: la unidad más pequeña que la boleta.
 *
 * ── Por qué hacía falta ──────────────────────────────────────────────────
 *
 * Una mesa de ringside se vende como UNA boleta y entran cuatro personas. Hoy
 * el escáner marca la boleta `usado` de una vez: cuenta una entrada y las otras
 * tres no tienen nada que mostrar.
 *
 * Con puestos, los tres modelos que usa el sector dejan de ser tres desarrollos
 * y pasan a ser configuración del tipo de boleta (`modo_entrada`, 0118):
 *
 *   individual  los N nacen con los datos del comprador, un QR cada uno
 *   contador    los N nacen vacíos, una sola credencial, y la puerta cuenta
 *   anfitrion   los N nacen vacíos y se llenan por un enlace que se comparte
 *
 * Y la reventa es transferir UN puesto: cambia de titular y se rota su token.
 *
 * ── Lo que este archivo NO hace ──────────────────────────────────────────
 *
 * No toca la base. Todo aquí es una función que recibe datos y devuelve datos,
 * para que las reglas —cuántos puestos, quién puede transferir, hasta cuándo—
 * se puedan probar sin credenciales. Lo que escribe vive en `routes/`.
 */

const MODOS = ['individual', 'contador', 'anfitrion'];

/* Cuánta gente entra con esta boleta. Es la capacidad del sitio comprado, y 1
   cuando no hay sitio —que es la inmensa mayoría de las boletas—. La misma
   cuenta que hace `cuantasPersonas.js` para el aforo, y a propósito: si estos
   dos números se separan, el aforo deja de cuadrar con la puerta. */
function cuantosPuestos(personas) {
  const n = Number(personas);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/* Las filas de `ticket_puestos` que nacen al emitir una boleta.
 *
 * El puesto 1 lleva SIEMPRE al comprador, en los tres modos: es quien pagó, va
 * a ir, y dejarlo vacío obligaría al anfitrión a apuntarse a sí mismo en su
 * propia mesa. Los demás nacen vacíos salvo en `individual`, donde el sector
 * asume que quien compra cuatro entradas es un grupo que ya está decidido.
 *
 * `qr_token` va vacío aquí: se firma en la ruta, que es la que conoce el id que
 * la base acaba de dar. Firmar antes de tener id daría credenciales que no
 * apuntan a nada. */
function filasDePuestos({ ticketId, eventoId, personas, modo, titular = {} }) {
  if (!ticketId || !eventoId) throw new Error('Un puesto necesita boleta y evento.');
  const total = cuantosPuestos(personas);
  const m = MODOS.includes(modo) ? modo : 'individual';

  return Array.from({ length: total }, (_, i) => {
    const primero = i === 0;
    const conDatos = primero || m === 'individual';
    return {
      ticket_id: ticketId,
      evento_id: eventoId,
      orden: i + 1,
      nombre: conDatos ? (titular.nombre || null) : null,
      email: conDatos ? (titular.email || null) : null,
      documento: conDatos ? (titular.documento || null) : null,
      /* `contador` no asigna a nadie más que al titular: su credencial es la de
         la boleta y la puerta lleva la cuenta. Darle estado `asignado` a un
         puesto sin nombre haría creer que ya se sabe quién va. */
      estado: conDatos && (titular.nombre || titular.email) ? 'asignado' : 'libre',
      asignado_at: conDatos && (titular.nombre || titular.email) ? new Date().toISOString() : null,
    };
  });
}

/* ── La puerta ──────────────────────────────────────────────────────────── */

/* Qué enseña el escáner al leer una boleta con varios puestos.
 *
 * La pantalla sigue siendo sí/no —con cien personas esperando es lo único que
 * importa— y el contador va debajo, no en lugar del veredicto. */
function estadoEnLaPuerta(puestos = []) {
  const total = puestos.length;
  const dentro = puestos.filter(p => p.estado === 'usado').length;
  return {
    total,
    dentro,
    quedan: Math.max(0, total - dentro),
    /* Que quede sitio es lo que decide si la puerta se abre, no el estado de la
       boleta: una mesa de cuatro con dos dentro sigue siendo una entrada
       válida, y hoy se rechazaría por estar la boleta ya `usado`. */
    puede_entrar: dentro < total,
    /* «Mesa 3 · 4 puestos · entraron 1» */
    resumen: total > 1 ? `${total} puestos · entraron ${dentro}` : null,
  };
}

/* ── La transferencia ───────────────────────────────────────────────────── */

const NO_SE_PUEDE = {
  apagado: 'Quien organiza no permite transferir las boletas de este evento.',
  cerrado: 'Ya pasó la hora límite para transferir boletas de este evento.',
  gastadas: 'Esta boleta ya se transfirió el número de veces permitido.',
  usado: 'Este puesto ya entró al evento. No se puede transferir.',
  sin_destino: 'Falta el nombre de quien la recibe.',
  sin_documento: 'Este evento exige el documento de quien recibe la boleta.',
};

/* ¿Se puede pasar este puesto a otra persona?
 *
 * Las cuatro palancas son del organizador, y ninguna es sobre dinero: desde que
 * se decidió que el pago es ajeno a la plataforma, GESTEK no ve el precio y por
 * tanto no puede —ni debe— topearlo. Lo que sí controla es la puerta.
 *
 * `hechas` son las transferencias que ya lleva ESTE puesto, no la boleta: «le
 * paso mi silla» y «vendo mi mesa entera» tienen que poder contarse aparte.
 */
function puedeTransferir({ puesto, reglas = {}, destino = {}, ahora = new Date(), hechas = 0 }) {
  const no = (motivo) => ({ ok: false, motivo, mensaje: NO_SE_PUEDE[motivo] });

  if (!reglas.permitir_transferencia) return no('apagado');
  /* Un puesto que ya entró no es transferible por lo mismo que no se devuelve
     una entrada usada: la persona ya está dentro. */
  if (puesto?.estado === 'usado') return no('usado');

  const max = Number(reglas.max_transferencias);
  /* Sin tope configurado no hay tope. El precedente colombiano —Ticketmaster—
     es una sola vez por boleta, pero eso es una recomendación del panel, no una
     regla que esta función deba imponer a eventos que no la pidieron. */
  if (Number.isInteger(max) && max > 0 && hechas >= max) return no('gastadas');

  /* Cortar unas horas antes: una transferencia a las 20:55 para un show a las
     21:00 es un problema en la puerta, no una venta. */
  if (reglas.transferencias_hasta && new Date(reglas.transferencias_hasta) <= ahora) return no('cerrado');

  if (!String(destino.nombre || '').trim()) return no('sin_destino');
  /* Decreto 1622 de 2022: en eventos DEPORTIVOS la boleta va atada al documento
     de quien la usa. No es buena práctica, es obligación, y una transferencia
     sin documento la rompería justo en el momento en que cambia de manos. */
  if (reglas.exigir_documento && !String(destino.documento || '').trim()) return no('sin_documento');

  return { ok: true };
}

/* Lo que cambia en el puesto al transferirlo, y lo que queda anotado.
 *
 * El `qr_token` NO se calcula aquí —hace falta firmarlo— pero se pone a `null`
 * a propósito: deja el puesto sin credencial hasta que la ruta firme la nueva.
 * Un fallo a mitad de camino deja una boleta que no abre, que es el lado seguro
 * de equivocarse; lo contrario dejaría dos personas con la misma entrada. */
function aplicarTransferencia({ puesto, destino, monto = null, currency = null, via = 'titular', actorId = null }) {
  return {
    puesto: {
      nombre: String(destino.nombre || '').trim(),
      email: destino.email ? String(destino.email).trim().toLowerCase() : null,
      documento: destino.documento ? String(destino.documento).trim() : null,
      qr_token: null,
      estado: 'asignado',
      asignado_at: new Date().toISOString(),
    },
    rastro: {
      puesto_id: puesto.id,
      evento_id: puesto.evento_id,
      de_nombre: puesto.nombre || null,
      de_email: puesto.email || null,
      a_nombre: String(destino.nombre || '').trim(),
      a_email: destino.email ? String(destino.email).trim().toLowerCase() : null,
      a_documento: destino.documento ? String(destino.documento).trim() : null,
      /* Se anota si alguien lo declara, y `null` es la respuesta esperada: el
         dinero de una reventa es ajeno a la plataforma. Queda aquí para que el
         organizador pueda mirar el histórico, no para cobrar sobre él. */
      monto: monto === null || monto === '' ? null : Number(monto),
      currency: currency || null,
      via: ['titular', 'panel', 'agente'].includes(via) ? via : 'titular',
      actor_id: actorId,
    },
  };
}

module.exports = {
  MODOS, cuantosPuestos, filasDePuestos, estadoEnLaPuerta,
  puedeTransferir, aplicarTransferencia, NO_SE_PUEDE,
};
