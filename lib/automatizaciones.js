/* Motor de automatizaciones — "cuando pasa X, haz Y".
   Las reglas viven en evento.page_json.automatizaciones = [{ id, activo,
   trigger, accion, mensaje }]. Se disparan desde los flujos (check-in, aforo…)
   de forma BEST-EFFORT: nunca lanza hacia el llamador ni frena el flujo. */
const supabase = require('./supabase.js');
const { notificar } = require('./notificar.js');

function interpolar(txt, ctx) {
  return String(txt || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : ''));
}

/* Llamar SIN await (fire-and-forget) para no añadir latencia al flujo. */
async function correrAutomatizaciones(eventoId, trigger, ctx = {}) {
  try {
    const { data: ev } = await supabase.from('eventos').select('page_json').eq('id', eventoId).maybeSingle();
    const reglas = Array.isArray(ev?.page_json?.automatizaciones) ? ev.page_json.automatizaciones : [];
    for (const r of reglas) {
      if (!r || r.activo === false || r.trigger !== trigger) continue;
      const mensaje = interpolar(r.mensaje, ctx).trim();
      try {
        if (r.accion === 'alerta') {
          await supabase.from('evento_alertas').insert({
            evento_id: eventoId, tipo: 'general', nivel: 'info',
            mensaje: mensaje || `Automatización: ${trigger}`, zona: ctx.zona || null,
          });
        } else if (r.accion === 'notificar_asistente' && ctx.userId) {
          const p = notificar({
            userId: ctx.userId, tipo: 'evento',
            titulo: mensaje || '¡Gracias por asistir!', cuerpo: '',
            link: `/eventos/${eventoId}`, eventoId,
          });
          if (p?.catch) p.catch(() => {});
        }
      } catch { /* una regla que falle no frena las demás */ }
    }
  } catch { /* noop: las automatizaciones nunca rompen el flujo principal */ }
}

module.exports = { correrAutomatizaciones };
