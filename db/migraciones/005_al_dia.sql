/* 005_al_dia.sql — lo que le pasó al esquema desde que se generó el volcado.
 *
 * ══ LÉEME ANTES DE CORRER NADA ══════════════════════════════════════════
 *
 * `db/esquema/` es un volcado del **30 de agosto de 2026**. Desde entonces se
 * aplicaron diez migraciones en Supabase (0092–0101) y el volcado se quedó
 * atrás. Este archivo es la diferencia, medida contra producción el **4 de
 * septiembre de 2026**.
 *
 * Va en `gestek_datos`, y en este orden:
 *
 *   1. `003_esquema.sql`  (las tablas del volcado)
 *   2. sus índices y sus claves foráneas
 *   3. **este archivo**
 *   4. los datos
 *
 * El paso 3 va antes del 4 a propósito: aquí se añaden columnas obligatorias,
 * y si los datos entraran primero, la carga fallaría fila por fila.
 *
 * ── Por qué esto importa más de lo que parece ───────────────────────────
 *
 * El volcado **no tiene la tabla `zonas`**, y `zonas` es de donde comen cuatro
 * pantallas: el plano del evento, el selector de zona de un sub-evento, el
 * escáner de ingreso y el bloque de mapa de la página pública.
 *
 * Ya pasó una vez, con la migración 0092: el código leía las zonas del sitio
 * nuevo y el servidor todavía servía el viejo. Resultado: **cuatro pantallas en
 * blanco durante horas, sin un solo error en ninguna parte**. Ése es el síntoma
 * de este proyecto — cuando el dato no está donde alguien lo busca, no falla
 * nada; simplemente no hay nada.
 *
 * Si se carga el volcado tal cual y se arranca contra él, se repite.
 *
 * ── Se puede correr dos veces ───────────────────────────────────────────
 *
 * MySQL 8 **no tiene** `ADD COLUMN IF NOT EXISTS` — eso es de MariaDB, y
 * escribirlo aquí habría reventado en la primera línea. Así que las columnas se
 * añaden con un procedimiento que mira `information_schema` antes. Importa
 * porque phpMyAdmin corre el archivo entero: una sentencia que falla a la
 * mitad deja el esquema a medio aplicar, que es peor que no haber empezado.
 */

SET FOREIGN_KEY_CHECKS = 0;

/* ── Los ayudantes ───────────────────────────────────────────────────────
 * Tres procedimientos de usar y tirar. Se borran al final del archivo. */

DROP PROCEDURE IF EXISTS gestek_add_col;
DROP PROCEDURE IF EXISTS gestek_drop_col;
DROP PROCEDURE IF EXISTS gestek_add_idx;
DELIMITER //

CREATE PROCEDURE gestek_add_col(IN p_tabla VARCHAR(64), IN p_col VARCHAR(64), IN p_def TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = DATABASE() AND table_name = p_tabla AND column_name = p_col) THEN
    SET @s = CONCAT('ALTER TABLE `', p_tabla, '` ADD COLUMN `', p_col, '` ', p_def);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //

CREATE PROCEDURE gestek_drop_col(IN p_tabla VARCHAR(64), IN p_col VARCHAR(64))
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = DATABASE() AND table_name = p_tabla AND column_name = p_col) THEN
    SET @s = CONCAT('ALTER TABLE `', p_tabla, '` DROP COLUMN `', p_col, '`');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //

CREATE PROCEDURE gestek_add_idx(IN p_tabla VARCHAR(64), IN p_idx VARCHAR(64), IN p_cols TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
                  WHERE table_schema = DATABASE() AND table_name = p_tabla AND index_name = p_idx) THEN
    SET @s = CONCAT('CREATE INDEX `', p_idx, '` ON `', p_tabla, '` (', p_cols, ')');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //

DELIMITER ;

/* ═══ 1 · La tabla que falta entera ═══════════════════════════════════════
 *
 * `id` es VARCHAR y no CHAR(36) **a propósito**, y esto no se puede cambiar
 * sin romper datos: los ids de zona no son uuid. Son `acc_jzgcn7b`,
 * `zona_vaz1ed7` — los que tenían dentro de `page_json` antes de la 0092, y se
 * conservaron tal cual para que la mudanza fuera una igualdad y no una
 * adivinanza. Las cuatro columnas que la apuntan (`zona_cortes.zona_id`,
 * `agenda_sessions.zona_id`, `networking_expositores.zona_id`,
 * `ticket_movimientos.zona_id`) ya son VARCHAR(255) en el volcado: encajan.
 *
 * `tipo` (0094) dice qué es la zona: `evento` es un sitio con aforo, `ingreso`
 * es una PUERTA — una puerta es una zona desde la 0096, con el mismo id que
 * tenía como acceso.
 *
 * `reglas` (0098) es lo que una puerta comprueba al abrirse: qué tipos de
 * boleta admite y qué staff la atiende. Es JSON y no dos columnas porque lo que
 * una puerta comprueba va a crecer —un horario, un tope— y dos columnas
 * obligarían a una migración por cada regla nueva.
 *
 * Los DEFAULT de `tipo` y `reglas` van entre paréntesis: MySQL no admite un
 * default literal en TEXT ni en JSON, sólo una expresión (8.0.13+). El volcado
 * ya lo hace así en otras tablas — mismo estilo.
 */

CREATE TABLE IF NOT EXISTS `zonas` (
  `id` VARCHAR(255) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `aforo_max` INT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `tipo` TEXT NOT NULL DEFAULT ('evento'),
  `reglas` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

/* `tipo(20)` y no `tipo`: MySQL no indexa una columna TEXT sin decirle cuántos
   caracteres. Veinte sobran para 'evento', 'ingreso', 'evacuacion' y 'otra'. */
CALL gestek_add_idx('zonas', 'zonas_evento_idx',      '`evento_id`, `orden`');
CALL gestek_add_idx('zonas', 'idx_zonas_evento_tipo', '`evento_id`, `tipo`(20)');

/* Las 12 zonas de producción, medidas el 2026-09-04. La última es la puerta:
   sale con `tipo = 'ingreso'` y con sus reglas dentro. */
INSERT IGNORE INTO `zonas` (`id`, `evento_id`, `nombre`, `aforo_max`, `orden`, `tipo`, `reglas`) VALUES
('acc_jzgcn7b',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Auditorio 01',            200,    0, 'evento',  '{}'),
('acc_xdiqkl7',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Auditorio 02',             70,    1, 'evento',  '{}'),
('acc_bhduayf',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Museo Tecnológico',        30,    2, 'evento',  '{}'),
('acc_7cktm9c',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Universidad Cooperativa', NULL,   3, 'evento',  '{}'),
('acc_eys498h',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Zona Gamer',               30,    4, 'evento',  '{}'),
('acc_oixs38x',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Zona de CoWorking',        60,    5, 'evento',  '{}'),
('acc_kwyj6t8',  '7826f5fb-80a0-453d-b6b9-0a2834e11656', 'Panóptico de Ibagué',     NULL,   6, 'evento',  '{}'),
('zona_vaz1ed7', 'f0259473-af92-42ed-bc77-52e7200112f2', 'Zona gamer',              200,    0, 'evento',  '{}'),
('zona_lwo6j2i', 'f0259473-af92-42ed-bc77-52e7200112f2', 'Zona Cupular',            200,    1, 'evento',  '{}'),
('zona_5yfr06o', 'f0259473-af92-42ed-bc77-52e7200112f2', 'Zona anime',              200,    2, 'evento',  '{}'),
('zona_ujs9zrh', 'f0259473-af92-42ed-bc77-52e7200112f2', 'Zona parqueadero',       1000,    3, 'evento',  '{}'),
('acc_1bt62w4',  'f0259473-af92-42ed-bc77-52e7200112f2', 'entrada inicial',        NULL, 1000, 'ingreso',
 '{"staff": ["34b3e353-e9e4-4f63-996a-00e674ccec59"], "tipos": ["7c9ae9c6-4dae-44ec-a880-50c48c4de624"]}');

/* ═══ 2 · Once columnas que faltaban ══════════════════════════════════════ */

/* 0093 — un tipo de boleta declara qué crea al pagarse: nada, un stand, o un
   equipo de torneo. Antes se adivinaba por el nombre del tipo. */
CALL gestek_add_col('ticket_types', 'crea',           "TEXT NOT NULL DEFAULT ('nada')");
CALL gestek_add_col('ticket_types', 'crea_torneo_id', 'CHAR(36) NULL');

/* 0095 — cada torneo declara qué le pide a un equipo, y el equipo guarda lo
   que respondió. `torneo_id` en el formulario separa las preguntas del torneo
   de las del evento: sin él, guardar unas borraba las otras. */
CALL gestek_add_col('event_form_fields', 'torneo_id',  'CHAR(36) NULL');
CALL gestek_add_col('torneo_equipos',    'respuestas', "JSON NOT NULL DEFAULT (CAST('{}' AS JSON))");
CALL gestek_add_col('torneo_equipos',    'ticket_id',  'CHAR(36) NULL');

/* 0099 — con qué promoción se vendió cada boleta. En las dos tablas, y no es
   duplicar: en `tickets` es el HECHO —esta boleta se vendió con este código— y
   en `payment_transactions` es el INTENTO, que es lo que dice si un código
   atrae o no. */
CALL gestek_add_col('tickets',              'promocion_id', 'CHAR(36) NULL');
CALL gestek_add_col('payment_transactions', 'promocion_id', 'CHAR(36) NULL');
CALL gestek_add_idx('tickets', 'tickets_promocion_idx', '`promocion_id`');

/* Recordatorios ya enviados. Sin estas dos, el proceso que manda los avisos no
   sabe cuáles ya mandó y los repite en cada pasada. */
CALL gestek_add_col('eventos', 'recordatorio_24h_at', 'DATETIME(6) NULL');
CALL gestek_add_col('eventos', 'recordatorio_2h_at',  'DATETIME(6) NULL');

/* Cortes de aforo: por qué se puso a cero una zona, con foto y nota. */
CALL gestek_add_col('zona_cortes', 'tipo',     "TEXT NOT NULL DEFAULT ('reset')");
CALL gestek_add_col('zona_cortes', 'contexto', 'JSON NULL');
CALL gestek_add_col('zona_cortes', 'foto_url', 'TEXT NULL');
CALL gestek_add_col('zona_cortes', 'nota',     'TEXT NULL');

/* ═══ 3 · Tres columnas que ya no existen ═════════════════════════════════
 *
 * `ciudad`, `foto_url` y `telefono` se fueron de `perfil_talento` a `profiles`:
 * son de la PERSONA, no de su faceta de talento. Alguien que además organiza
 * eventos las tenía escritas dos veces, y las dos podían discrepar.
 */
CALL gestek_drop_col('perfil_talento', 'ciudad');
CALL gestek_drop_col('perfil_talento', 'foto_url');
CALL gestek_drop_col('perfil_talento', 'telefono');

/* ═══ 4 · Las claves foráneas nuevas ══════════════════════════════════════
 *
 * Van juntas y al final: una clave foránea sólo se puede crear cuando existen
 * las dos columnas, y arriba se acaban de crear.
 *
 * Las dos primeras existen en Postgres desde antes; en el volcado no están
 * porque la tabla a la que apuntan —`zonas`— no estaba.
 *
 * `ON DELETE SET NULL` en las de promoción: borrar una promoción vieja no
 * puede llevarse por delante la boleta que se vendió con ella.
 */
ALTER TABLE `zonas`
  ADD CONSTRAINT `zonas_evento_id_fkey`
  FOREIGN KEY (`evento_id`) REFERENCES `eventos` (`id`) ON DELETE CASCADE;

ALTER TABLE `agenda_sessions`
  ADD CONSTRAINT `agenda_sessions_zona_id_fkey`
  FOREIGN KEY (`zona_id`) REFERENCES `zonas` (`id`) ON DELETE SET NULL;

ALTER TABLE `networking_expositores`
  ADD CONSTRAINT `networking_expositores_zona_id_fkey`
  FOREIGN KEY (`zona_id`) REFERENCES `zonas` (`id`) ON DELETE SET NULL;

ALTER TABLE `ticket_types`
  ADD CONSTRAINT `ticket_types_crea_torneo_id_fkey`
  FOREIGN KEY (`crea_torneo_id`) REFERENCES `torneos` (`id`) ON DELETE SET NULL;

ALTER TABLE `event_form_fields`
  ADD CONSTRAINT `event_form_fields_torneo_id_fkey`
  FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;

ALTER TABLE `torneo_equipos`
  ADD CONSTRAINT `torneo_equipos_ticket_id_fkey`
  FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE SET NULL;

ALTER TABLE `tickets`
  ADD CONSTRAINT `tickets_promocion_id_fkey`
  FOREIGN KEY (`promocion_id`) REFERENCES `promociones` (`id`) ON DELETE SET NULL;

ALTER TABLE `payment_transactions`
  ADD CONSTRAINT `payment_transactions_promocion_id_fkey`
  FOREIGN KEY (`promocion_id`) REFERENCES `promociones` (`id`) ON DELETE SET NULL;

/* Si esto se corre por segunda vez, las ocho de arriba fallan con
   «Duplicate foreign key constraint name». No pasa nada y no hay que arreglar
   nada: significa que ya estaban. Todo lo demás del archivo sí es idempotente. */

/* ═══ 5 · Cuatro tablas que el volcado crea y nunca se usaron ═════════════
 *
 * Vacías no basta como prueba —una tabla puede estar vacía porque se limpió—.
 * La prueba está en `pg_stat_user_tables`: las cuatro tienen `n_tup_ins = 0`,
 * cero inserciones en toda su historia. Nunca entró una fila.
 *
 *   missions, referral_codes  — gamificación que nunca se escribió.
 *   waitlist                  — DUPLICADA. La que funciona es `event_waitlist`,
 *                               y es la que usa el código. Ojo con no
 *                               confundirlas: se parecen y sólo una sirve.
 *   recordatorio_inapp_log    — sólo la usaría una función SQL que nunca ha
 *                               funcionado (inserta una columna `link` que
 *                               `notificaciones` no tiene).
 */
DROP TABLE IF EXISTS `missions`;
DROP TABLE IF EXISTS `referral_codes`;
DROP TABLE IF EXISTS `waitlist`;
DROP TABLE IF EXISTS `recordatorio_inapp_log`;

DROP PROCEDURE IF EXISTS gestek_add_col;
DROP PROCEDURE IF EXISTS gestek_drop_col;
DROP PROCEDURE IF EXISTS gestek_add_idx;

SET FOREIGN_KEY_CHECKS = 1;

/* ═══ COMPROBACIÓN ════════════════════════════════════════════════════════
 *
 *   SELECT COUNT(*) FROM information_schema.tables
 *    WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
 *   -- 69
 *
 *   SELECT tipo, COUNT(*) FROM `zonas` GROUP BY tipo;
 *   -- evento 11 · ingreso 1
 *
 *   SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE();
 *   -- 830
 *
 *   SELECT table_name FROM information_schema.tables
 *    WHERE table_schema = DATABASE()
 *      AND table_name IN ('missions','referral_codes','waitlist','recordatorio_inapp_log');
 *   -- vacío
 *
 * ═══ LO QUE ESTE ARCHIVO NO TRAE ═════════════════════════════════════════
 *
 * `promocion_consumir(uuid)`, la función que suma un uso a una promoción sin
 * que dos compras a la vez se pisen. En Postgres es una RPC; aquí **se va al
 * código**, como el resto de funciones (ver NOTAS-ESQUEMA.md). El equivalente
 * es un solo UPDATE con el límite dentro del WHERE:
 *
 *   UPDATE promociones SET usos = usos + 1
 *    WHERE id = ? AND (limite_usos IS NULL OR usos < limite_usos);
 *
 * y mirar `affectedRows`: 0 significa que el código ya estaba agotado. Lo que
 * NO se puede hacer es leer y luego escribir — son dos viajes, y dos compras
 * simultáneas escriben el mismo número.
 */
