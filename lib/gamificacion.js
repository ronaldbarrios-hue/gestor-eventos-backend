/* GESTEK — Motor de gamificación escopado.

   Modelo: los puntos siempre pertenecen a una tripleta
     (user_id, organizador_id, audiencia)
   audiencia ∈ { 'cliente', 'empleado' }.

   - Cliente: asiste a eventos de un organizador → acumula puntos CON ese
     organizador. Canjea recompensas que ese organizador definió.
   - Empleado: trabaja para un organizador (tareas, check-ins) → acumula
     puntos. Ranking global del organizador + ranking por evento.

   points_log guarda el detalle (con organizador_id + audiencia + evento_id).
   puntos_balance cachea el total por tripleta (hot path de ranking y canje).

   Badges = capa "plataforma" secundaria (logros globales del usuario),
   se mantiene del diseño anterior. */

const supabase = require('./supabase.js');
const { notificar } = require('./notificar.js');

/* ── Puntos por acción ── */
const PUNTOS = {
  /* cliente */
  asistencia      : 100,  // check-in de un asistente con cuenta
  /* empleado */
  tarea_completada: 25,
  checkin_operado : 5,    // staff que escanea/valida una boleta
};

/* ── Badges (capa plataforma, global, secundaria) ── */
const BADGES = [
  { slug: 'perfil_completo', nombre: 'Identidad',       desc: 'Completaste tu perfil',     icon: '🪪' },
  { slug: 'primer_evento',   nombre: 'Primer evento',   desc: 'Creaste tu primer evento',  icon: '🎉' },
  { slug: 'organizador_pro', nombre: 'Organizador Pro', desc: 'Creaste 5 eventos',         icon: '🏆' },
  { slug: 'fiel',            nombre: 'Fiel',            desc: 'Asististe a 5 eventos del mismo organizador', icon: '💜' },
  { slug: 'trabajador',      nombre: 'Trabajador',      desc: 'Completaste 20 tareas',     icon: '🛠️' },
];
const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.slug, b]));

/**
 * otorgarPuntos({ userId, organizadorId, audiencia, eventoId?, accion, puntos? })
 * Registra en points_log y actualiza puntos_balance (upsert manual).
 * Best-effort: nunca rompe el flujo principal.
 */
async function otorgarPuntos({ userId, organizadorId, audiencia, eventoId = null, accion, puntos = null }) {
  if (!userId || !organizadorId || !audiencia || !accion) return;
  /* Un usuario no acumula puntos consigo mismo (ej. owner se hace check-in) */
  if (userId === organizadorId && audiencia === 'cliente') return;

  const pts = puntos != null ? puntos : (PUNTOS[accion] || 0);
  if (pts <= 0) return;

  try {
    await supabase.from('points_log').insert({
      user_id: userId, evento_id: eventoId, organizador_id: organizadorId,
      audiencia, accion, puntos: pts,
    });

    /* Upsert manual del balance (no usamos onConflict para mantener compat) */
    const { data: bal } = await supabase
      .from('puntos_balance')
      .select('id, puntos')
      .eq('user_id', userId)
      .eq('organizador_id', organizadorId)
      .eq('audiencia', audiencia)
      .maybeSingle();

    if (bal) {
      await supabase.from('puntos_balance')
        .update({ puntos: bal.puntos + pts, updated_at: new Date().toISOString() })
        .eq('id', bal.id);
    } else {
      await supabase.from('puntos_balance').insert({
        user_id: userId, organizador_id: organizadorId, audiencia, puntos: pts,
      });
    }
  } catch (e) {
    console.warn('[gamificacion] otorgarPuntos error:', e.message);
  }
}

async function otorgarBadge(userId, badgeSlug) {
  if (!BADGE_MAP[badgeSlug]) return;
  try {
    const { data: existing } = await supabase
      .from('user_badges').select('id')
      .eq('user_id', userId).eq('badge_slug', badgeSlug).is('evento_id', null)
      .maybeSingle();
    if (existing) return;

    await supabase.from('user_badges').insert({ user_id: userId, badge_slug: badgeSlug, evento_id: null });
    const b = BADGE_MAP[badgeSlug];
    notificar({
      userId, tipo: 'sistema',
      titulo: `🏅 Insignia: ${b.nombre}`, cuerpo: b.desc,
      link: '/configuracion?tab=logros',
    });
  } catch (e) {
    console.warn('[gamificacion] otorgarBadge error:', e.message);
  }
}

module.exports = { PUNTOS, BADGES, BADGE_MAP, otorgarPuntos, otorgarBadge };
