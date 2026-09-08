'use strict';

/* Qué le falta a un evento que se acaba de publicar.
 *
 * ── Por qué es un módulo y no código dentro de la ruta ───────────────────
 *
 * Hay DOS caminos para publicar y no pasan por el mismo sitio:
 *
 *   PATCH /eventos/:id/estado   el panel
 *   publicar_evento             la herramienta del Gestbot y del MCP
 *
 * El segundo hace su propio `update` contra la base. Comprobado publicando el
 * concierto de prueba desde el agente: se publicó **sin un solo aviso** —y sin
 * anotar en la auditoría ni notificar—, en un evento con 124 boletas de pago y
 * ninguna cuenta de cobro conectada.
 *
 * O sea que el camino más rápido para publicar era también el único que no
 * avisaba de nada. Los avisos existían y el agente los tiraba.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────
 *
 * Bloquear. Hay motivos legítimos para publicar antes de abrir inscripciones
 * —una página de aviso, un evento con registro por fuera— y decidirlo por el
 * organizador sería pasarse. Esto avisa; publicar ya ocurrió.
 */

const supabase = require('./supabase.js');
const { necesitaEnlace } = require('./modalidad.js');

/* Devuelve una lista de frases. Vacía si no hay nada que decir.
 *
 * `evento` llega ya leído porque quien llama acaba de escribirlo: volver a
 * pedirlo sería una consulta de más y una ventana para leer algo distinto de
 * lo que se guardó.
 *
 * No lanza nunca. Un fallo contando lo que falta no puede tumbar una
 * publicación que ya se autorizó y ya ocurrió — se anota y se sigue, porque un
 * aviso ausente es un aviso, no un error.
 */
async function avisosDePublicacion(eventoId, evento) {
  const avisos = [];
  try {
    /* ── Nadie puede inscribirse ── */
    const { count } = await supabase
      .from('ticket_types').select('id', { count: 'exact', head: true })
      .eq('evento_id', eventoId).eq('activo', true);
    if (!count) {
      avisos.push('No hay tipos de boleta activos: nadie puede inscribirse desde la página.');
    }

    /* ── Lo básico que la gente pregunta ── */
    if (!evento?.fecha_inicio) avisos.push('El evento no tiene fecha de inicio.');
    if (!evento?.location_nombre && necesitaEnlace(evento?.modalidad) === false) {
      avisos.push('No hay lugar. Es de lo primero que preguntan.');
    }
    /* Con la función y no comparando cadenas sueltas: comparar `!== 'fisico'`
       aquí es lo que hacía que un concierto en un coliseo —guardado por el
       agente como «presencial»— recibiera «es un evento en línea». */
    if (necesitaEnlace(evento?.modalidad) && !evento?.url_virtual) {
      avisos.push('Es un evento en línea y no tiene enlace de conexión.');
    }

    /* ── Boletas de pago sin cuenta de cobro ──
     *
     * Las dos pasarelas lo rechazan antes de emitir nada, así que no se pierde
     * ninguna venta a medias. Pero quien compra se lleva «el organizador aún no
     * conectó Mercado Pago» DESPUÉS de llenar el formulario entero y elegir su
     * silla, y el organizador no se entera hasta que alguien se queja. */
    const { data: dePago } = await supabase
      .from('ticket_types').select('id')
      .eq('evento_id', eventoId).eq('activo', true).gt('precio', 0).limit(1);
    if (dePago?.length && evento?.owner_id) {
      const { data: cobro } = await supabase
        .from('profiles').select('mp_access_token, wompi_public_key')
        .eq('id', evento.owner_id).maybeSingle();
      if (!cobro?.mp_access_token && !cobro?.wompi_public_key) {
        avisos.push('Hay boletas de pago y no tienes cuenta de cobro conectada: nadie podrá pagar. Conecta Mercado Pago o Wompi en Comercial → Pagos.');
      }
    }

    /* ── Sitios del plano sin precio ──
     *
     * Una unidad vendible sin localidad no la puede comprar nadie: el servidor
     * no sabe qué cobrar. El plano se ve lleno, el mapa las da libres y la
     * venta simplemente no ocurre — sin ningún error. */
    const { data: vendibles } = await supabase
      .from('espacios').select('id').eq('evento_id', eventoId).eq('modo', 'vendible');
    if (vendibles?.length) {
      const { data: conPrecio } = await supabase
        .from('ticket_type_espacios').select('espacio_id')
        .in('espacio_id', vendibles.map(e => e.id));
      const sinPrecio = vendibles.length - new Set((conPrecio || []).map(x => x.espacio_id)).size;
      if (sinPrecio > 0) {
        avisos.push(`${sinPrecio} ${sinPrecio === 1 ? 'sitio del plano no tiene' : 'sitios del plano no tienen'} tipo de boleta asignado: se ven en el mapa y no se pueden comprar.`);
      }
    }

    /* ── Sub-eventos rotos ──
     *
     * Un sub-evento se publica igual de roto que un evento, y falla igual: no
     * hay error, hay una actividad a la que nadie se puede apuntar. */
    const { data: subs } = await supabase
      .from('agenda_sessions')
      .select('id, titulo, requiere_inscripcion, formulario_modo, ticket_type_id')
      .eq('evento_id', eventoId);

    const conInscripcion = (subs || []).filter(s => s.requiere_inscripcion);

    /* «Preguntas propias» y ninguna escrita: se comporta igual que «no
       preguntar nada», y quien lo eligió cree que sí pregunta. */
    const propios = conInscripcion.filter(s => s.formulario_modo === 'propio');
    if (propios.length) {
      const { data: conCampos } = await supabase
        .from('event_form_fields').select('session_id')
        .in('session_id', propios.map(s => s.id));
      const tienen = new Set((conCampos || []).map(c => c.session_id));
      for (const s of propios.filter(x => !tienen.has(x.id))) {
        avisos.push(`«${s.titulo}» pide preguntas propias y no tiene ninguna: apuntarse será sólo un botón.`);
      }
    }

    /* Atado a una boleta pausada: la actividad se ve, no se puede entrar, y el
       motivo está en otra pantalla. */
    const conBoleta = conInscripcion.filter(s => s.ticket_type_id);
    if (conBoleta.length) {
      const { data: tipos } = await supabase
        .from('ticket_types').select('id, nombre, activo')
        .in('id', conBoleta.map(s => s.ticket_type_id));
      const porId = new Map((tipos || []).map(t => [t.id, t]));
      for (const s of conBoleta) {
        const t = porId.get(s.ticket_type_id);
        if (t && t.activo === false) {
          avisos.push(`«${s.titulo}» sólo admite la boleta «${t.nombre}», que está pausada: nadie podrá apuntarse.`);
        }
      }
    }
  } catch (e) {
    console.error(`[avisos] no se pudieron calcular los de ${eventoId}: ${e.message}`);
  }
  return avisos;
}

module.exports = { avisosDePublicacion };
