const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { assertPermiso } = require('../lib/acceso.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Owner o miembro con permiso 'editar_evento' (gestiona contenido del evento). */
function assertOwner(eventoId, userId) {
  return assertPermiso(eventoId, userId, ['editar_evento'], 'id, owner_id');
}

/* ─────────── SPEAKERS ─────────── */

/* GET /eventos/:eventoId/speakers */
router.get('/:eventoId/speakers', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('speakers').select('*').eq('evento_id', eventoId)
      .order('orden', { ascending: true }).order('nombre', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ speakers: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.post('/:eventoId/speakers', async (req, res) => {
  const { eventoId } = req.params;
  const { nombre, bio, foto_url, empresa, social_links } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido.' });
  try {
    await assertOwner(eventoId, req.user.id);
    const { data: max } = await supabase
      .from('speakers').select('orden').eq('evento_id', eventoId)
      .order('orden', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from('speakers').insert({
        evento_id: eventoId,
        nombre: nombre.trim(),
        bio: bio || null,
        foto_url: foto_url || null,
        empresa: empresa || null,
        social_links: social_links || {},
        orden: (max?.orden || 0) + 1,
      }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ speaker: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.patch('/:eventoId/speakers/:speakerId', async (req, res) => {
  const { eventoId, speakerId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const allowed = ['nombre', 'bio', 'foto_url', 'empresa', 'social_links', 'orden'];
    const updates = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });
    const { data, error } = await supabase
      .from('speakers').update(updates).eq('id', speakerId).eq('evento_id', eventoId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ speaker: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.delete('/:eventoId/speakers/:speakerId', async (req, res) => {
  const { eventoId, speakerId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { error } = await supabase
      .from('speakers').delete().eq('id', speakerId).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

/* ─────────── SESSIONS ─────────── */

router.get('/:eventoId/sessions', async (req, res) => {
  const { eventoId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('agenda_sessions')
      .select(`*, speaker:speakers!speaker_id(id, nombre, foto_url, empresa)`)
      .eq('evento_id', eventoId)
      .order('inicio', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sessions: data || [] });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.post('/:eventoId/sessions', async (req, res) => {
  const { eventoId } = req.params;
  const { titulo, descripcion, inicio, fin, track, ubicacion, speaker_id } = req.body;
  if (!titulo?.trim()) return res.status(400).json({ error: 'Título requerido.' });
  if (!inicio) return res.status(400).json({ error: 'Hora de inicio requerida.' });
  try {
    await assertOwner(eventoId, req.user.id);
    const { data, error } = await supabase
      .from('agenda_sessions').insert({
        evento_id  : eventoId,
        titulo     : titulo.trim(),
        descripcion: descripcion || null,
        inicio,
        fin        : fin || null,
        track      : track || 'principal',
        ubicacion  : ubicacion || null,
        speaker_id : speaker_id || null,
      }).select(`*, speaker:speakers!speaker_id(id, nombre, foto_url, empresa)`).single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ session: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.patch('/:eventoId/sessions/:sessionId', async (req, res) => {
  const { eventoId, sessionId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const allowed = ['titulo', 'descripcion', 'inicio', 'fin', 'track', 'ubicacion', 'speaker_id', 'orden'];
    const updates = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios.' });
    const { data, error } = await supabase
      .from('agenda_sessions').update(updates)
      .eq('id', sessionId).eq('evento_id', eventoId)
      .select(`*, speaker:speakers!speaker_id(id, nombre, foto_url, empresa)`).single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ session: data });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

router.delete('/:eventoId/sessions/:sessionId', async (req, res) => {
  const { eventoId, sessionId } = req.params;
  try {
    await assertOwner(eventoId, req.user.id);
    const { error } = await supabase
      .from('agenda_sessions').delete().eq('id', sessionId).eq('evento_id', eventoId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'No autorizado.' ? 403 : 400).json({ error: e.message });
  }
});

module.exports = router;
