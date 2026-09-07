/* GESTEK — La agenda de UNA mesa de la rueda.
 *
 * ── El hueco que tapa ────────────────────────────────────────────────────
 *
 * Una rueda tiene dos lados y hasta ahora sólo uno podía consultar su día.
 * Quien visita ve «Mis citas». La empresa que está SENTADA en la mesa no tenía
 * ninguna pantalla: para saber a quién iba a recibir a las 10:15 había que
 * pedírselo a quien organiza, que lo leía de la parrilla.
 *
 * Y quien organiza tampoco podía mirar una sola: la parrilla las enseña todas
 * a la vez —correcto para operar el salón, y lo peor para contestar «¿qué
 * tiene mañana Café del Tolima?»—.
 *
 * ── Por qué la lógica vive aquí ──────────────────────────────────────────
 *
 * La misma agenda se pide desde dos sitios con dos permisos distintos: el
 * panel (quien gestiona la rueda) y el enlace público de la empresa (con el
 * código de su boleta-stand, sin cuenta). Escrita dos veces, una de las dos
 * acabaría enseñando las canceladas o escondiendo los huecos.
 */

'use strict';

/* Las que cuentan para una agenda. Las CANCELADAS no: una agenda es lo que hay
   que hacer, no lo que se deshizo. Las PEDIDAS sí, con su estado — quien la
   recibe tiene que saber que esa hora todavía puede caerse. */
const ESTADOS_EN_AGENDA = ['confirmada', 'solicitada'];

/* Arma la agenda a partir de lo ya leído. Puro: sin base, para que las pruebas
   puedan correrlo.
 *
 * Devuelve TODAS las franjas, con y sin cita. Los huecos son la mitad de la
 * información: quien mira su día quiere saber cuándo está libre tanto como con
 * quién se reúne, y a quien organiza le dicen dónde queda sitio para meter a
 * alguien que se quedó sin agenda.
 *
 * `verPersonas` decide si viaja quién es la contraparte. Falso deja la franja
 * como «ocupada» y sin nombre: sirve para enseñar una agenda a quien no tiene
 * por qué saber quién más está en el salón. */
function armarAgenda({ horarios = [], citas = [], personas = new Map(), verPersonas = true } = {}) {
  const porHorario = new Map(
    citas.filter(c => ESTADOS_EN_AGENDA.includes(c.estado)).map(c => [c.horario_id, c]),
  );

  return [...horarios]
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))
    .map(h => {
      const cita = porHorario.get(h.id) || null;
      const p = cita ? personas.get(cita.user_id) : null;
      return {
        horario_id: h.id,
        inicio: h.inicio,
        fin: h.fin,
        /* Sin la 0113 estas dos columnas no existen: `bloqueado` tiene que
           quedar en `false` y no en `undefined`, o la pantalla pinta una
           franja bloqueada donde sólo hay una columna que falta. */
        bloqueado: h.bloqueado === true,
        bloqueo_motivo: h.bloqueado === true ? (h.bloqueo_motivo || null) : null,
        cita: cita ? {
          id: cita.id,
          estado: cita.estado,
          resultado: cita.resultado || null,
          hubo_acuerdo: cita.hubo_acuerdo ?? null,
          persona: verPersonas ? personaDe(cita, p) : null,
        } : null,
      };
    });
}

function personaDe(cita, perfil) {
  if (perfil) return { nombre: perfil.nombre || null, email: perfil.email || null };
  if (cita.guest_email) return { nombre: cita.guest_nombre || null, email: cita.guest_email };
  return null;
}

/* El resumen que va arriba de la agenda. Se calcula aquí y no en la pantalla
   porque las dos pantallas que la pintan tienen que decir lo mismo. */
function resumenDeAgenda(agenda = []) {
  const r = { franjas: 0, ocupadas: 0, pedidas: 0, libres: 0, bloqueadas: 0 };
  for (const f of agenda) {
    r.franjas++;
    if (f.cita) {
      r.ocupadas++;
      if (f.cita.estado === 'solicitada') r.pedidas++;
    } else if (f.bloqueado) r.bloqueadas++;
    else r.libres++;
  }
  return r;
}

module.exports = { ESTADOS_EN_AGENDA, armarAgenda, resumenDeAgenda };
