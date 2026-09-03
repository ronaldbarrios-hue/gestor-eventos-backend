const express = require('express');
const { exige, sesion, publica } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');
const router = express.Router();

/* ── Promociones del evento (Rework Comercial) ─────────────────────
   Cupones y descuentos creados por el organizador: porcentaje o monto
   fijo, por boleta o generales, con mínimo de cantidad, límite de usos
   y vigencia. La validación pública permite aplicarlos en el checkout. */

/* El dueño, o quien tenga `gestionar_descuentos`.
 *
 * ── Por qué cambia ─────────────────────────────────────────────
 *
 * Estas rutas eran sólo del dueño, y el permiso `gestionar_descuentos` existía
 * en el catálogo, se podía conceder desde el panel y la semilla ya se lo daba al
 * rol Comercial… **sin que hiciera nada**. El dueño creía haber delegado los
 * cupones y la persona se encontraba un 403.
 *
 * Eso es peor que no tener el permiso: la pantalla dice que sí y el servidor
 * dice que no, y el que se equivoca no es quien tiene que averiguarlo.
 *
 * Sí, esto **amplía** el acceso respecto a ayer. A propósito y sin sorpresa:
 * sólo entra quien el dueño marcó a mano en el equipo. El comentario anterior
 * decía que declararlo con `exige()` dejaría entrar «a los editores», y eso
 * habría sido cierto con un permiso genérico —`editar_evento`—; con el suyo
 * propio, entra exactamente a quien se le dio. */
async function puedeDescuentos(eventoId, userId) {
  try {
    await assertPermiso(eventoId, userId, ['gestionar_descuentos'], 'id, owner_id');
    return true;
  } catch { return false; }
}

/* GET /eventos/:id/promociones — listar (owner) */
router.get('/eventos/:id/promociones', verifySupabaseJWT, sesion('El dueño, o el miembro con `gestionar_descuentos`: lo comprueba `puedeDescuentos` con assertPermiso antes de tocar nada.'), async (req, res) => {
  if (!(await puedeDescuentos(req.params.id, req.user.id))) return res.status(403).json({ error: 'No autorizado.' });
  const { data, error } = await supabase.from('promociones')
    .select('*').eq('evento_id', req.params.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ promociones: data || [] });
});

/* POST /eventos/:id/promociones — crear */
router.post('/eventos/:id/promociones', verifySupabaseJWT, sesion('El dueño, o el miembro con `gestionar_descuentos`: lo comprueba `puedeDescuentos` con assertPermiso antes de tocar nada.'), async (req, res) => {
  if (!(await puedeDescuentos(req.params.id, req.user.id))) return res.status(403).json({ error: 'No autorizado.' });
  const { codigo, descripcion, tipo, valor, ticket_id, min_cantidad, limite_usos, vigente_desde, vigente_hasta } = req.body || {};
  if (!codigo?.trim()) return res.status(400).json({ error: 'codigo requerido.' });
  if (!['porcentaje', 'fijo'].includes(tipo)) return res.status(400).json({ error: "tipo debe ser 'porcentaje' o 'fijo'." });
  const v = Number(valor);
  if (!(v > 0)) return res.status(400).json({ error: 'valor debe ser mayor a 0.' });
  if (tipo === 'porcentaje' && v > 100) return res.status(400).json({ error: 'porcentaje máximo 100.' });

  const { data, error } = await supabase.from('promociones').insert({
    evento_id: req.params.id,
    codigo: codigo.trim().toUpperCase(),
    descripcion: descripcion || null,
    tipo, valor: v,
    ticket_id: ticket_id || null,
    min_cantidad: Math.max(1, Number(min_cantidad) || 1),
    limite_usos: limite_usos ? Number(limite_usos) : null,
    vigente_desde: vigente_desde || null,
    vigente_hasta: vigente_hasta || null,
  }).select('*').single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una promoción con ese código.' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ promocion: data });
});

/* PATCH /eventos/:id/promociones/:pid — editar / activar / desactivar */
router.patch('/eventos/:id/promociones/:pid', verifySupabaseJWT, sesion('El dueño, o el miembro con `gestionar_descuentos`: lo comprueba `puedeDescuentos` con assertPermiso antes de tocar nada.'), async (req, res) => {
  if (!(await puedeDescuentos(req.params.id, req.user.id))) return res.status(403).json({ error: 'No autorizado.' });
  const permitidos = ['descripcion', 'tipo', 'valor', 'ticket_id', 'min_cantidad', 'limite_usos', 'vigente_desde', 'vigente_hasta', 'activo'];
  const updates = {};
  for (const k of permitidos) if (k in (req.body || {})) updates[k] = req.body[k];
  const { data, error } = await supabase.from('promociones')
    .update(updates).eq('id', req.params.pid).eq('evento_id', req.params.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ promocion: data });
});

/* DELETE /eventos/:id/promociones/:pid */
router.delete('/eventos/:id/promociones/:pid', verifySupabaseJWT, sesion('El dueño, o el miembro con `gestionar_descuentos`: lo comprueba `puedeDescuentos` con assertPermiso antes de tocar nada.'), async (req, res) => {
  if (!(await puedeDescuentos(req.params.id, req.user.id))) return res.status(403).json({ error: 'No autorizado.' });
  const { error } = await supabase.from('promociones').delete().eq('id', req.params.pid).eq('evento_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* POST /eventos/publicos/slug/:slug/promocion/validar — checkout público
   body: { codigo, ticket_id, cantidad } → { valida, descuento, tipo, valor } */
router.post('/eventos/publicos/slug/:slug/promocion/validar', publica('Validar un código de descuento pasa ANTES de comprar, y comprar no pide cuenta.'), async (req, res) => {
  const { codigo, ticket_id, cantidad } = req.body || {};
  if (!codigo?.trim()) return res.status(400).json({ error: 'codigo requerido.' });

  const { data: ev } = await supabase.from('eventos').select('id').eq('slug', req.params.slug).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  const { data: p } = await supabase.from('promociones')
    .select('*').eq('evento_id', ev.id).eq('codigo', codigo.trim().toUpperCase()).eq('activo', true).maybeSingle();

  const ahora = new Date();
  const valida = p
    && (!p.vigente_desde || new Date(p.vigente_desde) <= ahora)
    && (!p.vigente_hasta || new Date(p.vigente_hasta) >= ahora)
    && (!p.limite_usos || p.usos < p.limite_usos)
    && (!p.ticket_id || String(p.ticket_id) === String(ticket_id))
    && ((Number(cantidad) || 1) >= (p.min_cantidad || 1));

  if (!valida) return res.json({ valida: false });
  res.json({ valida: true, promocion_id: p.id, tipo: p.tipo, valor: Number(p.valor), descripcion: p.descripcion || null, min_cantidad: p.min_cantidad });
});

module.exports = router;
