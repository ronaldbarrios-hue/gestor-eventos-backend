SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS gestek_add_col;
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

CREATE PROCEDURE gestek_add_idx(IN p_tabla VARCHAR(64), IN p_idx VARCHAR(64), IN p_cols TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
                  WHERE table_schema = DATABASE() AND table_name = p_tabla AND index_name = p_idx) THEN
    SET @s = CONCAT('CREATE INDEX `', p_idx, '` ON `', p_tabla, '` (', p_cols, ')');
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END //
DELIMITER ;

CALL gestek_add_col('torneos', 'modo_calificacion', "TEXT NULL");
CALL gestek_add_col('torneos', 'modo_rondas',       "TEXT NULL");

CREATE TABLE IF NOT EXISTS `torneo_criterios` (
  `id` CHAR(36) NOT NULL,
  `torneo_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `puntaje_maximo` DECIMAL(6,2) NOT NULL DEFAULT 10,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE IF NOT EXISTS `torneo_rondas` (
  `id` CHAR(36) NOT NULL,
  `torneo_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `avanzan` INT NULL,
  `estado` TEXT NOT NULL DEFAULT ('pendiente'),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE IF NOT EXISTS `torneo_ronda_participantes` (
  `ronda_id` CHAR(36) NOT NULL,
  `equipo_id` CHAR(36) NOT NULL,
  PRIMARY KEY (`ronda_id`, `equipo_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE IF NOT EXISTS `torneo_jurados` (
  `torneo_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`torneo_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE IF NOT EXISTS `torneo_calificaciones` (
  `id` CHAR(36) NOT NULL,
  `ronda_id` CHAR(36) NOT NULL,
  `criterio_id` CHAR(36) NOT NULL,
  `equipo_id` CHAR(36) NOT NULL,
  `jurado_id` CHAR(36) NOT NULL,
  `puntaje` DECIMAL(6,2) NOT NULL,
  `comentario` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `torneo_calificaciones_unica` (`ronda_id`, `criterio_id`, `equipo_id`, `jurado_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CALL gestek_add_idx('torneo_criterios',      'torneo_criterios_torneo_id_idx',   '`torneo_id`');
CALL gestek_add_idx('torneo_rondas',         'torneo_rondas_torneo_id_idx',      '`torneo_id`');
CALL gestek_add_idx('torneo_calificaciones', 'torneo_calificaciones_ronda_idx',  '`ronda_id`');
CALL gestek_add_idx('torneo_calificaciones', 'torneo_calificaciones_equipo_idx', '`equipo_id`');
CALL gestek_add_idx('torneo_calificaciones', 'torneo_calificaciones_jurado_idx', '`jurado_id`');
CALL gestek_add_idx('torneo_jurados', 'torneo_jurados_user_id_idx', '`user_id`');

ALTER TABLE `torneo_criterios`
  ADD CONSTRAINT `torneo_criterios_torneo_id_fkey`
  FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;

ALTER TABLE `torneo_rondas`
  ADD CONSTRAINT `torneo_rondas_torneo_id_fkey`
  FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;

ALTER TABLE `torneo_ronda_participantes`
  ADD CONSTRAINT `torneo_ronda_participantes_ronda_id_fkey`
  FOREIGN KEY (`ronda_id`) REFERENCES `torneo_rondas` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `torneo_ronda_participantes_equipo_id_fkey`
  FOREIGN KEY (`equipo_id`) REFERENCES `torneo_equipos` (`id`) ON DELETE CASCADE;

ALTER TABLE `torneo_jurados`
  ADD CONSTRAINT `torneo_jurados_torneo_id_fkey`
  FOREIGN KEY (`torneo_id`) REFERENCES `torneos` (`id`) ON DELETE CASCADE;

ALTER TABLE `torneo_calificaciones`
  ADD CONSTRAINT `torneo_calificaciones_ronda_id_fkey`
  FOREIGN KEY (`ronda_id`) REFERENCES `torneo_rondas` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `torneo_calificaciones_criterio_id_fkey`
  FOREIGN KEY (`criterio_id`) REFERENCES `torneo_criterios` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `torneo_calificaciones_equipo_id_fkey`
  FOREIGN KEY (`equipo_id`) REFERENCES `torneo_equipos` (`id`) ON DELETE CASCADE;

DROP PROCEDURE IF EXISTS gestek_add_col;
DROP PROCEDURE IF EXISTS gestek_add_idx;

SET FOREIGN_KEY_CHECKS = 1;
