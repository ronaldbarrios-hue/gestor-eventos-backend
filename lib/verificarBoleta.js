'use strict';

/* «¿Esta boleta es real?» — para quien la está comprando a otra persona.
 *
 * ── El encargo, dicho por quien lo pidió ─────────────────────────────────
 *
 * «Que la reventa se pueda realizar en la página, pero vendría siendo ajeno a
 * la plataforma. Así lo único que se asegura es que la boleta sea real.»
 *
 * Es una decisión de producto buena y ahorra medio proyecto: GESTEK no es un
 * mercado —no cobra, no retiene, no arbitra— y se queda con lo único que de
 * verdad falla en una reventa: que la entrada sea falsa, esté anulada, ya se
 * haya usado, o se la hayan vendido a tres personas a la vez.
 *
 * ── Por qué esto NO puede ser «abrir la boleta» ──────────────────────────
 *
 * En GESTEK el código de la boleta ES la credencial: `/ticket/:codigo` devuelve
 * la entrada entera, con su `qr_token`. Mandar a quien va a comprar a esa
 * página sería regalarle la boleta — confirmaría que es real quedándose con
 * ella, sin pagar y sin transferencia.
 *
 * Por eso esto es una superficie distinta y más estrecha: dice lo justo para
 * confiar, y nada que sirva para entrar.
 *
 * ── Y por qué el nombre va tapado ────────────────────────────────────────
 *
 * Sin nombre, quien compra no puede comprobar que la persona que le está
 * vendiendo es la titular — que es la mitad de la estafa. Con el nombre entero,
 * cualquiera con un código lee quién va al evento, y probar códigos es barato.
 *
 * Tapado, quien tiene la cédula del vendedor delante puede cotejar «J*** M***»
 * y quien sólo tiene el código no se lleva nada.
 */

/* Deja las iniciales de cada palabra. «Juan Medina» → «J*** M***».
 *
 * No se enseña el correo ni siquiera tapado: `j***@gmail.com` sigue diciendo el
 * dominio y la primera letra, y con el nombre al lado identifica a la persona
 * casi tan bien como el correo entero. */
function taparNombre(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return null;
  return partes.map(p => `${p[0].toUpperCase()}***`).join(' ');
}

/* Qué se le puede decir a quien está a punto de comprar.
 *
 * Los estados se traducen a una frase que decide por él, en vez de a un código
 * que tenga que interpretar: quien mira esto está en una conversación de
 * WhatsApp a punto de transferir dinero.
 */
const VEREDICTOS = {
  valida: {
    ok: true,
    titulo: 'Boleta válida',
    detalle: 'Existe, está activa y todavía no se ha usado.',
  },
  usada: {
    ok: false,
    titulo: 'Esta boleta ya se usó',
    detalle: 'Alguien entró con ella al evento. No sirve para entrar otra vez.',
  },
  anulada: {
    ok: false,
    titulo: 'Esta boleta está anulada',
    detalle: 'Fue reembolsada o invalidada por quien organiza. No abre la puerta.',
  },
  sin_pagar: {
    ok: false,
    titulo: 'Esta boleta no está pagada',
    detalle: 'Existe, pero su compra no se completó. Hoy no abre la puerta.',
  },
  no_existe: {
    ok: false,
    titulo: 'No encontramos esta boleta',
    detalle: 'Revisa el código. Si lo copiaste bien, esa boleta no existe en GESTEK.',
  },
};

/* `estado` viene de la boleta; `esGratis` distingue una reserva legítimamente
   sin pagar de una compra a medias. */
function veredictoDe({ ticket, esGratis }) {
  if (!ticket) return VEREDICTOS.no_existe;
  if (ticket.estado === 'usado') return VEREDICTOS.usada;
  if (ticket.estado === 'reembolsado' || ticket.estado === 'invalido') return VEREDICTOS.anulada;
  /* `emitido` en una boleta de pago es «empezó a comprar y no terminó». En una
     gratuita no existe ese estado —salen ya pagadas—, así que si aparece se
     trata como válida y no se asusta a nadie sin motivo. */
  if (ticket.estado === 'emitido' && !esGratis) return VEREDICTOS.sin_pagar;
  return VEREDICTOS.valida;
}

/* Lo que sale por la ruta pública. Todo lo que NO está aquí es deliberado:
 *
 *   qr_token         sería entregar la entrada
 *   guest_email      identifica a la persona
 *   respuestas       son los datos del formulario, incluida la cédula
 *   id               no hace falta para nada y es una llave más circulando
 */
function respuestaPublica({ ticket, evento, tipo, espacio, esGratis }) {
  const v = veredictoDe({ ticket, esGratis });
  if (!ticket) return { ...v, codigo: null };

  return {
    ...v,
    codigo: ticket.codigo,
    evento: evento ? {
      titulo: evento.titulo,
      fecha_inicio: evento.fecha_inicio,
      lugar: evento.location_nombre || null,
      /* Un evento cancelado hace inútil la boleta aunque la boleta esté bien, y
         eso es exactamente lo que alguien necesita saber antes de pagar. */
      cancelado: evento.estado === 'cancelado',
    } : null,
    boleta: {
      tipo: tipo?.nombre || null,
      /* El sitio es la mitad de lo que se compra en un concierto: «Platea Fila
         C-14» es lo que hay que poder cotejar con lo que dijo el vendedor. */
      sitio: espacio?.nombre || null,
      a_nombre_de: taparNombre(ticket.guest_nombre),
    },
  };
}

module.exports = { taparNombre, veredictoDe, respuestaPublica, VEREDICTOS };
