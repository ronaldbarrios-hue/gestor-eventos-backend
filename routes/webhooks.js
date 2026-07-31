/* Webhooks PÚBLICOS de proveedores externos (sin auth de usuario).
   Se montan antes del grupo con auth global. Cada uno valida su origen. */
const express = require('express');
const supabase = require('../lib/supabase.js');
const { estadoDesde } = require('../lib/truora.js');

const router = express.Router();

/* POST /webhooks/truora — resultado de una verificación KYC. Actualiza el
   perfil de talento cuyo `verificacion_ref` coincide con la validación.
   (El validation_id es no-adivinable; al integrar con la cuenta real se
   añade la verificación de firma que provea Truora.) */
router.post('/webhooks/truora', async (req, res) => {
  res.status(200).json({ received: true });
  try {
    const b = req.body || {};
    const validationId = b.validation_id || b.validation?.validation_id || b.data?.validation_id;
    if (!validationId) return;
    const resultado = b.validation_status || b.status || b.validation?.validation_status || b.result || b.data?.validation_status;
    const estado = estadoDesde(resultado);
    if (estado === 'pendiente') return;
    const patch = { verificacion_estado: estado, updated_at: new Date().toISOString() };
    if (estado === 'verificado') patch.verificado_at = new Date().toISOString();
    await supabase.from('perfil_talento').update(patch).eq('verificacion_ref', String(validationId));
  } catch (e) {
    console.error('[webhook truora] error:', e.message);
  }
});

module.exports = router;
