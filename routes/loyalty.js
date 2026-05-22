/* GESTEK — Fidelidad (lectura + canje), cliente y empleado.
   GET  /me/loyalty/cliente             — mis puntos por organizador + recompensas + canjes
   GET  /me/loyalty/empleado            — mis puntos como empleado + ranking global por org
   POST /me/loyalty/canjear             — canjear recompensa (código automático)
   GET  /me/loyalty/badges              — insignias plataforma (capa secundaria)
   GET  /eventos/:eventoId/ranking-equipo — ranking de empleados por evento (equipo lo ve)
*/

const express = require('express');
const supabase = require('../lib/supabase.js');
const { verifySupabaseJWT } = require('../middleware/auth.js');
const { BADGES } = require('../lib/gamificacion.js');

const router = express.Router();
router.use(verifySupabaseJWT);

/* Helper: trae perfiles (id→{nombre,empresa,avatar}) en una sola query */
async function perfilesPorIds(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return {};
  const { data } = await supabase
    .from('profiles').select('id, nombre, empresa, avatar_url').in('id', unicos);
  return Object.fromEntries((data || []).map(p => [p.id, p]));
}

/* ─────────── CLIENTE ─────────── */
router.get('/me/loyalty/cliente', async (req, res) => {
  const { data: balances, error } = await supabase
    .from('puntos_balance')
    .select('organizador_id, puntos')
    .eq('user_id', req.user.id)
    .eq('audiencia', 'cliente')
    .order('puntos', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const orgs = await perfilesPorIds((balances || []).map(b => b.organizador_id));

  /* Recompensas activas de esos organizadores (audiencia cliente) */
  const orgIds = (balances || []).map(b => b.organizador_id);
  let recompensas = [];
  if (orgIds.length) {
    const { data: recs } = await supabase
      .from('recompensas')
      .select('id, organizador_id, titulo, descripcion, costo_puntos, stock, canjeados')
      .in('organizador_id', orgIds)
      .eq('audiencia', 'cliente')
      .eq('activo', true);
    recompensas = recs || [];
  }

  const comunidades = (balances || []).map(b => ({
    organizador: orgs[b.organizador_id] || { id: b.organizador_id, nombre: 'Organizador' },
    puntos: b.puntos,
    recompensas: recompensas
      .filter(r => r.organizador_id === b.organizador_id)
      .map(r => ({
        ...r,
        agotada: r.stock != null && r.canjeados >= r.stock,
        alcanzable: b.puntos >= r.costo_puntos,
      }))
      .sort((a, b2) => a.costo_puntos - b2.costo_puntos),
  }));

  const { data: canjes } = await supabase
    .from('canjes')
    .select('id, titulo, costo_puntos, codigo, estado, created_at, organizador_id')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  res.json({ comunidades, canjes: canjes || [] });
});

/* ─────────── EMPLEADO ─────────── */
router.get('/me/loyalty/empleado', async (req, res) => {
  const { data: balances, error } = await supabase
    .from('puntos_balance')
    .select('organizador_id, puntos')
    .eq('user_id', req.user.id)
    .eq('audiencia', 'empleado')
    .order('puntos', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const orgIds = (balances || []).map(b => b.organizador_id);
  const orgs = await perfilesPorIds(orgIds);

  /* Recompensas de empleado de esos organizadores */
  let recompensas = [];
  if (orgIds.length) {
    const { data: recs } = await supabase
      .from('recompensas')
      .select('id, organizador_id, titulo, descripcion, costo_puntos, stock, canjeados')
      .in('organizador_id', orgIds)
      .eq('audiencia', 'empleado')
      .eq('activo', true);
    recompensas = recs || [];
  }

  /* Ranking global del equipo por cada organizador (top 10) */
  const comunidades = [];
  for (const b of balances || []) {
    const { data: top } = await supabase
      .from('puntos_balance')
      .select('user_id, puntos')
      .eq('organizador_id', b.organizador_id)
      .eq('audiencia', 'empleado')
      .order('puntos', { ascending: false })
      .limit(10);
    const topPerfiles = await perfilesPorIds((top || []).map(t => t.user_id));
    const { count: mejores } = await supabase
      .from('puntos_balance')
      .select('id', { count: 'exact', head: true })
      .eq('organizador_id', b.organizador_id)
      .eq('audiencia', 'empleado')
      .gt('puntos', b.puntos);

    comunidades.push({
      organizador: orgs[b.organizador_id] || { id: b.organizador_id, nombre: 'Organizador' },
      puntos: b.puntos,
      mi_posicion: (mejores ?? 0) + 1,
      ranking: (top || []).map((t, i) => ({
        posicion: i + 1,
        nombre: topPerfiles[t.user_id]?.nombre || 'Usuario',
        avatar_url: topPerfiles[t.user_id]?.avatar_url || null,
        puntos: t.puntos,
        es_yo: t.user_id === req.user.id,
      })),
      recompensas: recompensas
        .filter(r => r.organizador_id === b.organizador_id)
        .map(r => ({
          ...r,
          agotada: r.stock != null && r.canjeados >= r.stock,
          alcanzable: b.puntos >= r.costo_puntos,
        }))
        .sort((a, b2) => a.costo_puntos - b2.costo_puntos),
    });
  }

  res.json({ comunidades });
});

/* ─────────── CANJE ─────────── */
router.post('/me/loyalty/canjear', async (req, res) => {
  const { recompensa_id } = req.body;
  if (!recompensa_id) return res.status(400).json({ error: 'recompensa_id requerido.' });

  const { data, error } = await supabase.rpc('canjear_recompensa', {
    p_user: req.user.id,
    p_recompensa: recompensa_id,
  });
  if (error) return res.status(400).json({ error: error.message });

  res.json({ ok: true, codigo: data });
});

/* ─────────── BADGES (capa plataforma) ─────────── */
router.get('/me/loyalty/badges', async (req, res) => {
  const { data: ganadas } = await supabase
    .from('user_badges').select('badge_slug, earned_at').eq('user_id', req.user.id);
  const set = new Set((ganadas || []).map(b => b.badge_slug));
  res.json({
    badges: BADGES.map(b => ({
      ...b,
      obtenida: set.has(b.slug),
      earned_at: (ganadas || []).find(g => g.badge_slug === b.slug)?.earned_at || null,
    })),
  });
});

/* ─────────── RANKING EQUIPO POR EVENTO ───────────
   Visible para owner + miembros activos del evento. Suma points_log de
   audiencia 'empleado' filtrado por evento_id. */
router.get('/eventos/:eventoId/ranking-equipo', async (req, res) => {
  const { eventoId } = req.params;

  const { data: ev } = await supabase
    .from('eventos').select('id, owner_id').eq('id', eventoId).maybeSingle();
  if (!ev) return res.status(404).json({ error: 'Evento no encontrado.' });

  const esOwner = ev.owner_id === req.user.id;
  if (!esOwner) {
    const { data: m } = await supabase
      .from('event_members').select('id')
      .eq('evento_id', eventoId).eq('user_id', req.user.id).eq('status', 'active')
      .maybeSingle();
    if (!m) return res.status(403).json({ error: 'No autorizado.' });
  }

  const { data: logs, error } = await supabase
    .from('points_log')
    .select('user_id, puntos')
    .eq('evento_id', eventoId)
    .eq('audiencia', 'empleado');
  if (error) return res.status(500).json({ error: error.message });

  const acum = {};
  for (const l of logs || []) acum[l.user_id] = (acum[l.user_id] || 0) + l.puntos;
  const ids = Object.keys(acum);
  const perfiles = await perfilesPorIds(ids);

  const ranking = ids
    .map(uid => ({
      user_id: uid,
      nombre: perfiles[uid]?.nombre || 'Usuario',
      avatar_url: perfiles[uid]?.avatar_url || null,
      puntos: acum[uid],
      es_yo: uid === req.user.id,
    }))
    .sort((a, b) => b.puntos - a.puntos)
    .map((r, i) => ({ ...r, posicion: i + 1 }));

  res.json({ ranking });
});

module.exports = router;
