-- 0082 · De dónde salió cada punto.
-- PENDIENTE DE APLICAR. Sólo AÑADE columnas y una tabla de reglas: nada de lo
-- que hay hoy deja de funcionar sin ella (ver la nota del final).
--
-- ── El problema ───────────────────────────────────────────────────────────
--
-- Hay dos registros de puntos y sólo uno sabe explicarse:
--
--   · `ticket_interacciones` (escaneos en stands) guarda motivo, nota, lugar,
--     quién lo marcó y de qué expositor. Se puede leer y entender.
--   · `points_log` (asistencia, tareas, staff) guarda un slug —'asistencia'—
--     y nada más. Dice CUÁNTOS puntos y CUÁNDO, pero no de qué.
--
-- Con 100 puntos de 'asistencia' no se puede saber si fueron por entrar al
-- evento o por ir a un taller, y el asistente que mira su saldo ve un número
-- sin historia. El día que alguien reclama —"yo fui a tres talleres"— no hay
-- con qué responderle.
--
-- ── Qué se añade ──────────────────────────────────────────────────────────
--
-- `origen_tipo` + `origen_id` apuntan a la fila que causó los puntos
-- (`sesion` → agenda_sessions, `tarea` → tareas, `ticket` → tickets…), y
-- `detalle` guarda el nombre de esa cosa TAL COMO ERA ese día.
--
-- El `detalle` no es redundante con el join: un sub-evento se puede renombrar
-- o borrar, y el historial de puntos tiene que seguir diciendo "Taller de
-- robótica" aunque el taller ya no exista. Es la misma decisión que
-- `ticket_movimientos.zona`, que conserva el nombre de la zona como foto del
-- momento y por eso el reporte del día sigue leyéndose un año después.
--
-- Sin clave foránea a propósito: `origen_id` apunta a tablas distintas según
-- `origen_tipo`, y borrar un sub-evento no puede borrar los puntos que ya
-- ganó una persona.

begin;

alter table public.points_log add column if not exists origen_tipo text;
alter table public.points_log add column if not exists origen_id   uuid;
alter table public.points_log add column if not exists detalle     text;

comment on column public.points_log.origen_tipo is
  'Qué causó los puntos: sesion | tarea | ticket | evento. Null en las filas anteriores a esta migración.';
comment on column public.points_log.origen_id is
  'Id de la fila que los causó. Sin FK: apunta a tablas distintas según origen_tipo, y borrar el origen no debe borrar los puntos.';
comment on column public.points_log.detalle is
  'Nombre del origen como era ese día. Se conserva aunque el origen se renombre o se borre.';

/* Para la pantalla "mis puntos": todo lo de una persona en un evento, en
   orden. Sin este índice es un recorrido de tabla en cuanto haya historial. */
create index if not exists idx_points_log_usuario_evento
  on public.points_log(user_id, evento_id, created_at desc);

/* Para el reclamo concreto: "¿ya le di puntos a esta persona por ESTE taller?"
   Es la consulta que evita pagar dos veces el mismo sub-evento. */
create index if not exists idx_points_log_origen
  on public.points_log(origen_tipo, origen_id) where origen_tipo is not null;

commit;

-- ── Compatibilidad ────────────────────────────────────────────────────────
--
-- Las tres columnas son nullable y sin default: las filas que ya existen se
-- quedan con null y se muestran como "Sin detalle", que es exactamente lo que
-- se sabe de ellas. El código nuevo escribe la procedencia cuando la tiene y
-- funciona igual contra una base donde esta migración todavía no se aplicó
-- —lo comprueba en caliente—, porque mientras la plataforma siga corriendo
-- sobre Supabase no puede depender de que alguien haya corrido esto.
