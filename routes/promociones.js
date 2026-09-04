const express = require('express');
const { exige, sesion, publica } = require('../core/permisos');
const supabase = require('../lib/supabase.js');
const { precioDeCompra } = require('../lib/precioTicket.js');
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
/* Lo que ve quien compra ANTES de pagar.
 *
 * Contesta con `precioDeCompra`, que es la MISMA función con la que se cobra
 * un minuto después. Antes esta ruta tenía su propia copia de las condiciones
 * —vigencia, límite, tipo de boleta, mínimo— y el cobro no tenía ninguna:
 * literalmente nadie llamaba a esta ruta y el precio se cobraba entero.
 *
 * Con dos copias, un día una diría que el código vale y la otra cobraría como
 * si no. Con una sola no puede pasar. */
router.post('/eventos/publicos/slug/:slug/promocion/validar', publica('Validar un código de descuento pasa ANTES de comprar, y comprar no pide cuenta.'), async (req, res) => {
  const { codigo, ticket_id, cantidad } = req.body || {};
  if (!codigo?.trim()) return res.status(400).json({ error: 'codigo requerido.' });

  const { data: ev } = await supabase.from('eventos').select('id').eq('slug', req.params.slug).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  /* `ticket_id` en el cuerpo es en realidad el id del TIPO de boleta —así lo
     manda la pantalla y así se llama la columna `promociones.ticket_id`, que
     apunta a `ticket_types` desde la 0029. Se deja el nombre de fuera y se
     traduce aquí, que romper el contrato de una ruta pública cuesta más que
     esta línea. */
  const { data: tipo } = await supabase.from('ticket_types')
    .select('id, precio, early_bird_precio, early_bird_hasta')
    .eq('id', ticket_id || '00000000-0000-0000-0000-000000000000')
    .maybeSingle();

  const cotiz = await precioDeCompra({
    eventoId: ev.id, tipo: tipo || { id: ticket_id }, codigo, cantidad,
  });

  if (!cotiz.promocion) return res.json({ valida: false, motivo: cotiz.motivo });

  res.json({
    valida      : true,
    promocion_id: cotiz.promocion.id,
    tipo        : cotiz.promocion.tipo,
    valor       : cotiz.promocion.valor,
    descripcion : cotiz.promocion.descripcion,
    /* Lo que de verdad se quiere saber: cuánto queda por pagar. Antes se
       devolvía el `valor` crudo y la cuenta la hacía—o no— quien llamara. */
    precio_lista: cotiz.lista,
    precio      : cotiz.precio,
    ahorro      : cotiz.promocion.ahorro,
  });
});

module.exports = router;
