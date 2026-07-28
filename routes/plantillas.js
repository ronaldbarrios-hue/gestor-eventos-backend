/* Plantillas de evento — presets reutilizables. El organizador guarda un
   evento como plantilla (config + boletas, sin personas ni ventas) y luego
   crea eventos nuevos a partir de ella. Complementa "duplicar" con presets
   con nombre que no ensucian la lista de eventos.

   Montado en '/' con verifySupabaseJWT global (define rutas completas). */
const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { uniqueEventoSlug } = require('../lib/slug.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Campos de evento que viajan en la plantilla (los mismos que clona duplicar). */
const CAMPOS = [
  'descripcion', 'cover_url', 'modalidad', 'timezone',
  'location_nombre', 'location_direccion', 'lat', 'lng', 'url_virtual',
  'links', 'gallery', 'currency', 'edad_minima', 'aforo_total',
  'categoria_id', 'page_json', 'email_reminders',
  'pago_llave', 'pago_qr_url', 'pago_instrucciones',
];

/* POST /eventos/:id/guardar-plantilla { nombre, descripcion } */
router.post('/eventos/:id/guardar-plantilla', async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Ponle un nombre a la plantilla.' });
  try {
    const { data: ev } = await supabase.from('eventos').select('*')
      .eq('id', req.params.id).is('deleted_at', null).maybeSingle();
    if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });
    if (String(ev.owner_id) !== String(req.user.id)) return res.status(403).json({ error: 'Solo el dueño puede guardar el evento como plantilla.' });

    const evento = { titulo: ev.titulo };
    for (const k of CAMPOS) if (ev[k] !== undefined) evento[k] = ev[k];
    if (evento.page_json) { evento.page_json = { ...evento.page_json }; delete evento.page_json.documentos; }

    const { data: tipos } = await supabase.from('ticket_types').select('*').eq('evento_id', ev.id);
    const ticket_types = (tipos || []).map(t => {
      const c = { ...t }; delete c.id; delete c.evento_id; delete c.created_at; delete c.updated_at; c.vendidos = 0; return c;
    });

    const { data, error } = await supabase.from('event_templates').insert({
      owner_id: req.user.id, nombre, descripcion: req.body?.descripcion || null,
      snapshot: { evento, ticket_types },
    }).select('id, nombre, descripcion, created_at').single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ plantilla: data });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* GET /me/plantillas */
router.get('/me/plantillas', async (req, res) => {
  const { data, error } = await supabase.from('event_templates')
    .select('id, nombre, descripcion, created_at, snapshot')
    .eq('owner_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  // No mandamos el snapshot entero a la lista (puede ser grande): solo un resumen.
  const plantillas = (data || []).map(p => ({
    id: p.id, nombre: p.nombre, descripcion: p.descripcion, created_at: p.created_at,
    titulo: p.snapshot?.evento?.titulo || null,
    boletas: (p.snapshot?.ticket_types || []).length,
  }));
  res.json({ plantillas });
});

/* POST /me/plantillas/:id/usar { titulo? } → crea un evento borrador */
router.post('/me/plantillas/:id/usar', async (req, res) => {
  try {
    const { data: pl } = await supabase.from('event_templates').select('*')
      .eq('id', req.params.id).maybeSingle();
    if (!pl || String(pl.owner_id) !== String(req.user.id)) return res.status(404).json({ error: 'Plantilla no encontrada.' });

    const snap = pl.snapshot || {};
    const titulo = String(req.body?.titulo || '').trim() || snap.evento?.titulo || pl.nombre;
    const insert = { owner_id: req.user.id, estado: 'borrador', titulo, aforo_vendido: 0 };
    for (const k of CAMPOS) if (snap.evento?.[k] !== undefined) insert[k] = snap.evento[k];
    insert.slug = await uniqueEventoSlug(supabase, titulo);

    const { data: nuevo, error } = await supabase.from('eventos').insert(insert)
      .select('*, categoria:categorias(slug, nombre)').single();
    if (error) return res.status(500).json({ error: error.message });

    // Boletas de la plantilla (best-effort).
    let boletas = 0;
    try {
      const tipos = (snap.ticket_types || []).map(t => ({ ...t, evento_id: nuevo.id, vendidos: 0 }));
      if (tipos.length) {
        const { error: eT } = await supabase.from('ticket_types').insert(tipos);
        if (!eT) boletas = tipos.length;
      }
    } catch { /* best-effort */ }

    res.status(201).json({ evento: nuevo, boletas });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* DELETE /me/plantillas/:id */
router.delete('/me/plantillas/:id', async (req, res) => {
  const { error } = await supabase.from('event_templates')
    .delete().eq('id', req.params.id).eq('owner_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
