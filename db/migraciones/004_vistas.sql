-- 004 · Las 4 vistas, traducidas a MySQL 8.
-- Va DESPUÉS de 003_esquema.sql y sus índices. PENDIENTE DE APLICAR.
--
-- ── Por qué a mano y no con el generador ─────────────────────────────────
--
-- El generador traduce tipos y estructura, que es mecánico. Una vista es una
-- consulta, y aquí hay tres cosas que Postgres escribe de una forma y MySQL de
-- otra:
--
--   1. `count(x) FILTER (WHERE cond)` no existe en MySQL. Se hace con
--      `COUNT(CASE WHEN cond THEN x END)`, que cuenta sólo los no nulos. Es la
--      traducción exacta, no una aproximación: en las dos, una fila que no
--      cumple la condición no suma.
--   2. `sum(...) FILTER` igual, pero con `SUM(CASE WHEN cond THEN x ELSE 0 END)`
--      — con ELSE 0 y no ELSE NULL, para que un grupo sin filas dé 0 y no NULL.
--      Es lo que el original consigue con su COALESCE.
--   3. Los `::integer` de Postgres se caen: MySQL ya devuelve el tipo que
--      corresponde y un CAST aquí sólo añade ruido.
--
-- ── El orden importa ─────────────────────────────────────────────────────
--
-- `v_bolsa_evento` lee de `v_consumo_puntos_stand`, así que ésta va primero.
-- MySQL no reordena vistas por dependencias como sí hace con las tablas.

-- ── 1 · perfiles_publicos ────────────────────────────────────────────────
--
-- La más pequeña y la que MÁS importa: es la que cerró la lectura anónima de
-- datos personales (fase 3, aplicada en producción el 28 de agosto). Antes, el
-- navegador leía `profiles` entera y ahí van correo, teléfono, empresa y
-- ciudad de todo el mundo; esta vista expone tres columnas y nada más.
--
-- Si se queda fuera de la migración, la aplicación no se rompe —vuelve a
-- consultar `profiles`— y ese agujero se reabre en silencio. Por eso es la
-- primera de este archivo y no la última.
CREATE OR REPLACE VIEW perfiles_publicos AS
  SELECT id, nombre, avatar_url
    FROM profiles;

-- ── 2 · v_consumo_puntos_stand ───────────────────────────────────────────
--
-- Cuánto ha repartido cada stand de su cuota. La lee el panel del expositor y
-- el reporte del evento.
--
-- `cuota_puntos NULL` significa «sin tope», y entonces `disponibles` también
-- es NULL: cero diría «no le queda nada», que es lo contrario.
CREATE OR REPLACE VIEW v_consumo_puntos_stand AS
  SELECT
    x.evento_id,
    x.id            AS expositor_id,
    x.nombre,
    x.stand,
    x.cuota_puntos,
    COALESCE(SUM(CASE WHEN i.puntos > 0 THEN i.puntos ELSE 0 END), 0) AS otorgados,
    COUNT(CASE WHEN i.puntos > 0 THEN i.id END)                       AS veces,
    COUNT(DISTINCT i.ticket_id)                                       AS asistentes_distintos,
    CASE WHEN x.cuota_puntos IS NULL THEN NULL
         ELSE GREATEST(0, x.cuota_puntos - COALESCE(SUM(CASE WHEN i.puntos > 0 THEN i.puntos ELSE 0 END), 0))
    END AS disponibles
  FROM networking_expositores x
  LEFT JOIN ticket_interacciones i ON i.expositor_id = x.id
  GROUP BY x.evento_id, x.id, x.nombre, x.stand, x.cuota_puntos;

-- ── 3 · v_bolsa_evento ───────────────────────────────────────────────────
--
-- La bolsa de puntos del evento entero: cuánto hay, cuánto se repartió en
-- cuotas y cuánto se otorgó de verdad. `sin_asignar` es lo que queda por
-- repartir entre stands, y es NULL cuando no hay bolsa declarada.
--
-- Ojo con `stands_sin_cuota`: cuenta los que NO tienen tope. Son los que se
-- pueden pasar de la bolsa sin que nada los frene, así que ese número es el
-- que hay que mirar antes del evento.
CREATE OR REPLACE VIEW v_bolsa_evento AS
  SELECT
    e.id            AS evento_id,
    b.total         AS bolsa_total,
    b.cuota_defecto,
    COALESCE(SUM(c.cuota_puntos), 0) AS repartido_en_cuotas,
    COALESCE(SUM(c.otorgados), 0)    AS otorgado_real,
    CASE WHEN b.total IS NULL THEN NULL
         ELSE b.total - COALESCE(SUM(c.cuota_puntos), 0)
    END AS sin_asignar,
    COUNT(c.expositor_id)                                    AS stands,
    COUNT(CASE WHEN c.cuota_puntos IS NULL THEN c.expositor_id END) AS stands_sin_cuota
  FROM eventos e
  LEFT JOIN evento_bolsa_puntos b ON b.evento_id = e.id
  LEFT JOIN v_consumo_puntos_stand c ON c.evento_id = e.id
  WHERE e.deleted_at IS NULL
  GROUP BY e.id, b.total, b.cuota_defecto;

-- ── 4 · v_participacion_sesiones ─────────────────────────────────────────
--
-- Cuánta gente fue a cada sub-evento, separando «se apuntó» de «fue». Esa
-- distinción es el punto entero de la tabla de inscripciones, así que la vista
-- la conserva en columnas distintas en vez de dar un solo total.
--
-- `sin_boleta` cuenta a quien se inscribió sin pasar por la entrada general.
-- Existe a propósito: en un taller siempre aparece alguien así, y si no se
-- pudiera registrar el conteo mentiría.
CREATE OR REPLACE VIEW v_participacion_sesiones AS
  SELECT
    s.evento_id,
    s.id      AS session_id,
    s.titulo,
    s.inicio,
    s.cupo,
    s.inscritos,
    COUNT(CASE WHEN i.estado = 'asistio'   THEN i.id END) AS asistentes,
    COUNT(CASE WHEN i.estado = 'inscrito'  THEN i.id END) AS solo_inscritos,
    COUNT(CASE WHEN i.estado = 'cancelada' THEN i.id END) AS canceladas,
    COUNT(CASE WHEN i.ticket_id IS NULL AND i.estado <> 'cancelada' THEN i.id END) AS sin_boleta
  FROM agenda_sessions s
  LEFT JOIN sesion_inscripciones i ON i.session_id = s.id
  GROUP BY s.evento_id, s.id, s.titulo, s.inicio, s.cupo, s.inscritos;

-- ── Cómo comprobar que quedaron bien ─────────────────────────────────────
--
-- No basta con que se creen sin error: una vista mal traducida devuelve filas,
-- sólo que con los números cambiados. Contra la copia de prueba, y ANTES del
-- corte, comparar cada una con su original en Postgres:
--
--   SELECT COUNT(*) FROM v_consumo_puntos_stand;      -- mismo número en las dos
--   SELECT SUM(otorgados), SUM(veces) FROM v_consumo_puntos_stand;
--   SELECT SUM(asistentes), SUM(sin_boleta) FROM v_participacion_sesiones;
--
-- Si los totales cuadran, los CASE WHEN están bien. Si cuadra el COUNT pero no
-- las sumas, el fallo está en un FILTER traducido con ELSE NULL en vez de 0.
