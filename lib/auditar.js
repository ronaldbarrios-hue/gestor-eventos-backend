/* GESTEK — Auditoría. Helper best-effort: nunca lanza, no bloquea el request.
   Uso: auditar(req, eventoId, 'evento.editar', { entidad:'evento', entidadId, detalle:{...} }) */

const supabase = require('./supabase.js');

async function auditar(req, eventoId, accion, opts = {}) {
  if (!eventoId || !accion) return;
  try {
    await supabase.from('audit_log').insert({
      evento_id  : eventoId,
      actor_id   : req?.user?.id || null,
      actor_email: req?.user?.email || null,
      accion,
      entidad    : opts.entidad || null,
      entidad_id : opts.entidadId || null,
      detalle    : opts.detalle || {},
    });
  } catch (e) {
    console.warn('[auditar] no se pudo registrar:', e.message);
  }
}

module.exports = { auditar };
