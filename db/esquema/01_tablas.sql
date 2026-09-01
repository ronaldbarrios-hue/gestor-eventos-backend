/* ═══════════════════════════════════════════════════════════════════════════
 * GESTEK · Volcado de la base de Supabase a archivo — 01 · TABLAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Origen  : proyecto Supabase `GestorEventosMarcaBlanca` (yopontbwgdybfsniqawz),
 *           Postgres 17.6, esquema `public`.
 * Destino : MySQL 8 (cPanel). Motor InnoDB, utf8mb4, colación _0900_as_ci.
 * Generado: 2026-09-01, corriendo `db/migraciones/generar-esquema-mysql.sql`
 *           contra Postgres. 71 tablas, 0 tipos sin traducir.
 *
 * Este archivo es la salida del generador. NO se edita a mano: si el esquema de
 * Postgres cambia, se vuelve a correr el generador y se compara con `git diff`.
 * El «por qué» de cada traducción de tipo está en
 * `db/migraciones/NOTAS-ESQUEMA.md`.
 *
 * ── Orden de aplicación (ver README.md de esta carpeta) ────────────────────
 *   01_tablas.sql                  ← este archivo
 *   02_indices_unicos_parciales.sql
 *   03_datos.sql
 *   04_indices.sql
 *   05_claves_foraneas.sql
 *   06_vistas.sql
 *
 * Las claves foráneas van al final (05) porque hay 148 y ciclos entre tablas:
 * no existe un orden de creación que las respete todas.
 *
 * ── Lo que este archivo NO trae, a propósito ──────────────────────────────
 *   · Las 8 claves que en Postgres apuntan a `auth.users` → quedan como
 *     CHAR(36) con índice; los usuarios viven en la base de identidad
 *     (`001_identidad.sql`). La integridad la sostiene el código.
 *   · Los 13 disparadores y las 20 funciones de Postgres → se fueron al código
 *     del backend (`modules/…`). Detalle en NOTAS-ESQUEMA.md.
 *   · Las 76 políticas RLS → el backend entra con una sola credencial; el filtro
 *     por evento/usuario lo hace `core/permisos`.
 *   · Los 6 tipos enumerados de Postgres → ninguna columna los usa; son texto.
 * ═══════════════════════════════════════════════════════════════════════════ */

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;


CREATE TABLE `agenda_favoritos` (
  `id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `agenda_sessions` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `track` TEXT NULL DEFAULT ('principal'),
  `titulo` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `inicio` DATETIME(6) NOT NULL,
  `fin` DATETIME(6) NULL,
  `ubicacion` TEXT NULL,
  `speaker_id` CHAR(36) NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `tipo` VARCHAR(255) NOT NULL DEFAULT ('charla'),
  `torneo_id` CHAR(36) NULL,
  `expositor_id` CHAR(36) NULL,
  `moderacion` TEXT NOT NULL DEFAULT ('aprobado'),
  `requiere_inscripcion` TINYINT(1) NOT NULL DEFAULT 0,
  `cupo` INT NULL,
  `inscritos` INT NOT NULL DEFAULT 0,
  `ticket_type_id` CHAR(36) NULL,
  `formulario_modo` TEXT NOT NULL DEFAULT ('ninguno'),
  `subcategoria` VARCHAR(255) NULL,
  `zona_id` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `api_tokens` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `prefix` TEXT NOT NULL,
  `scopes` JSON NOT NULL DEFAULT (CAST('["read"]' AS JSON)),
  `last_used_at` DATETIME(6) NULL,
  `revoked` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `audit_log` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `actor_id` CHAR(36) NULL,
  `actor_email` TEXT NULL,
  `accion` TEXT NOT NULL,
  `entidad` TEXT NULL,
  `entidad_id` CHAR(36) NULL,
  `detalle` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `canjes` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `organizador_id` CHAR(36) NOT NULL,
  `recompensa_id` CHAR(36) NULL,
  `audiencia` TEXT NOT NULL,
  `titulo` TEXT NOT NULL,
  `costo_puntos` INT NOT NULL,
  `codigo` VARCHAR(255) NOT NULL,
  `estado` TEXT NOT NULL DEFAULT ('entregado'),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ticket_id` CHAR(36) NULL,
  `evento_id` CHAR(36) NULL,
  `entregado_at` DATETIME(6) NULL,
  `expositor_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `catalogo_roles` (
  `id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `global` TINYINT(1) NOT NULL DEFAULT 1,
  `owner_id` CHAR(36) NULL,
  `orden` INT NULL DEFAULT 0,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `categorias` (
  `id` CHAR(36) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `nombre` TEXT NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `chat_channel_prefs` (
  `channel_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `anclado` TINYINT(1) NOT NULL DEFAULT 0,
  `archivado` TINYINT(1) NOT NULL DEFAULT 0,
  `leido_at` DATETIME(6) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`channel_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `chat_channels` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `tipo` TEXT NOT NULL DEFAULT ('general'),
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `parent_id` CHAR(36) NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `rol_ids` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `dm_users` JSON NULL,
  `dm_key` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `chat_messages` (
  `id` CHAR(36) NOT NULL,
  `channel_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `contenido` TEXT NOT NULL,
  `file_url` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `borrado_at` DATETIME(6) NULL,
  `borrado_por` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `cobros_vacantes` (
  `id` CHAR(36) NOT NULL,
  `tipo` TEXT NOT NULL,
  `evento_id` CHAR(36) NULL,
  `vacante_id` CHAR(36) NULL,
  `postulacion_id` CHAR(36) NULL,
  `owner_id` CHAR(36) NULL,
  `monto` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `moneda` TEXT NOT NULL DEFAULT ('COP'),
  `estado` TEXT NOT NULL DEFAULT ('pendiente'),
  `proveedor_ref` TEXT NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `discount_codes` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `codigo` VARCHAR(255) NOT NULL,
  `tipo` TEXT NOT NULL,
  `valor` DECIMAL(12,2) NOT NULL,
  `max_usos` INT NULL,
  `usos` INT NOT NULL DEFAULT 0,
  `expira_at` DATETIME(6) NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `email_cola` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `tipo` TEXT NOT NULL,
  `destinatario` TEXT NOT NULL,
  `ctx` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `prioridad` SMALLINT NOT NULL DEFAULT 0,
  `estado` TEXT NOT NULL DEFAULT ('pendiente'),
  `intentos` SMALLINT NOT NULL DEFAULT 0,
  `proximo_intento` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ultimo_error` TEXT NULL,
  `enviado_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `email_log` (
  `id` CHAR(36) NOT NULL,
  `ticket_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `tipo` VARCHAR(255) NOT NULL,
  `destinatario` TEXT NOT NULL,
  `status` TEXT NOT NULL DEFAULT ('sent'),
  `error` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `event_form_fields` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `tipo` TEXT NOT NULL,
  `etiqueta` TEXT NOT NULL,
  `opciones` JSON NULL,
  `requerido` TINYINT(1) NOT NULL DEFAULT 0,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ticket_type_id` CHAR(36) NULL,
  `grupo` TEXT NULL,
  `ayuda` TEXT NULL,
  `session_id` CHAR(36) NULL,
  `buscable` TINYINT(1) NULL,
  `visible_si` JSON NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `event_members` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `email` VARCHAR(255) NOT NULL,
  `nombre_invitado` TEXT NULL,
  `rol` TEXT NOT NULL DEFAULT ('staff'),
  `custom_permissions` JSON NULL DEFAULT (CAST('[]' AS JSON)),
  `status` TEXT NOT NULL DEFAULT ('invited'),
  `invited_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `accepted_at` DATETIME(6) NULL,
  `invited_by` CHAR(36) NULL,
  `rol_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `event_requests` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `autor_id` CHAR(36) NULL,
  `tipo` TEXT NOT NULL DEFAULT ('sugerencia'),
  `titulo` TEXT NULL,
  `contenido` TEXT NOT NULL,
  `estado` TEXT NOT NULL DEFAULT ('abierta'),
  `respuesta` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `event_roles` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` VARCHAR(255) NOT NULL,
  `descripcion` TEXT NULL,
  `permissions` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `event_views` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `visitor_hash` VARCHAR(255) NOT NULL,
  `referrer` TEXT NULL,
  `source` TEXT NULL,
  `user_agent` TEXT NULL,
  `pais` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `event_waitlist` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `ticket_type_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `guest_email` VARCHAR(255) NOT NULL,
  `guest_nombre` TEXT NULL,
  `posicion` INT NOT NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('active'),
  `added_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `notified_at` DATETIME(6) NULL,
  `purchased_at` DATETIME(6) NULL,
  `notification_attempts` INT NOT NULL DEFAULT 0,
  `last_contact_at` DATETIME(6) NULL,
  `oferta_token` VARCHAR(255) NULL,
  `oferta_expira` DATETIME(6) NULL,
  `oferta_enviada_at` DATETIME(6) NULL,
  `ofertas_recibidas` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_alertas` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `tipo` TEXT NOT NULL DEFAULT ('general'),
  `nivel` TEXT NOT NULL DEFAULT ('info'),
  `mensaje` TEXT NOT NULL,
  `zona` TEXT NULL,
  `resuelta` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_anuncios` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `autor_id` CHAR(36) NULL,
  `titulo` TEXT NOT NULL,
  `mensaje` TEXT NOT NULL,
  `url` TEXT NULL,
  `destinatarios` INT NOT NULL DEFAULT 0,
  `push_enviados` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_bolsa_puntos` (
  `evento_id` CHAR(36) NOT NULL,
  `total` INT NULL,
  `cuota_defecto` INT NULL,
  `nota` TEXT NULL,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`evento_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_email_envios` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `tipo` TEXT NOT NULL,
  `destinatario` TEXT NOT NULL,
  `asunto` TEXT NULL,
  `ok` TINYINT(1) NOT NULL DEFAULT 0,
  `motivo` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `smtp_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_email_plantillas` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `tipo` VARCHAR(255) NOT NULL,
  `asunto` TEXT NULL,
  `encabezado` TEXT NULL,
  `cuerpo` TEXT NULL,
  `boton_texto` TEXT NULL,
  `boton_url` TEXT NULL,
  `imagen` TEXT NULL,
  `footer` TEXT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_legal` (
  `evento_id` CHAR(36) NOT NULL,
  `terminos_texto` TEXT NULL,
  `privacidad_texto` TEXT NULL,
  `terminos_url` TEXT NULL,
  `privacidad_url` TEXT NULL,
  `responsable` TEXT NULL,
  `contacto_datos` TEXT NULL,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `version` TEXT NULL,
  PRIMARY KEY (`evento_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_motivos` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `tipo` TEXT NOT NULL DEFAULT ('positivo'),
  `puntos` INT NOT NULL DEFAULT 0,
  `color` TEXT NULL,
  `icono` TEXT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expositor_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `evento_smtp` (
  `evento_id` CHAR(36) NOT NULL,
  `host` VARCHAR(255) NOT NULL,
  `puerto` INT NOT NULL DEFAULT 465,
  `usuario` VARCHAR(255) NOT NULL,
  `pass_cifrada` TEXT NOT NULL,
  `remitente` TEXT NULL,
  `remitente_nombre` TEXT NULL,
  `responder_a` TEXT NULL,
  `verificado_at` DATETIME(6) NULL,
  `verificado_ok` TINYINT(1) NULL,
  `verificado_error` TEXT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `id` CHAR(36) NOT NULL,
  `etiqueta` TEXT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `max_por_hora` INT NULL,
  `max_por_dia` INT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `eventos` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `categoria_id` CHAR(36) NULL,
  `titulo` TEXT NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `descripcion` TEXT NULL,
  `cover_url` TEXT NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('borrador'),
  `modalidad` TEXT NOT NULL DEFAULT ('fisico'),
  `fecha_inicio` DATETIME(6) NOT NULL,
  `fecha_fin` DATETIME(6) NULL,
  `timezone` TEXT NULL DEFAULT ('America/Bogota'),
  `location_nombre` TEXT NULL,
  `location_direccion` TEXT NULL,
  `lat` DOUBLE NULL,
  `lng` DOUBLE NULL,
  `url_virtual` TEXT NULL,
  `page_json` JSON NOT NULL DEFAULT (CAST('{"blocks": []}' AS JSON)),
  `currency` TEXT NOT NULL DEFAULT ('COP'),
  `edad_minima` INT NULL,
  `aforo_total` INT NULL,
  `aforo_vendido` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `published_at` DATETIME(6) NULL,
  `deleted_at` DATETIME(6) NULL,
  `links` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `gallery` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `email_reminders` TINYINT(1) NOT NULL DEFAULT 1,
  `pago_llave` TEXT NULL,
  `pago_qr_url` TEXT NULL,
  `pago_instrucciones` TEXT NULL,
  `recordatorio_24h_at` DATETIME(6) NULL,
  `recordatorio_2h_at` DATETIME(6) NULL,
  `modo_publico` TEXT NOT NULL DEFAULT ('gestek'),
  `url_externa` TEXT NULL,
  `branding` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `paginas` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `navbar` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `missions` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `titulo` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `condition_type` TEXT NOT NULL,
  `condition_value` INT NOT NULL,
  `reward_puntos` INT NOT NULL DEFAULT 0,
  `badge_slug` TEXT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `networking_citas` (
  `id` CHAR(36) NOT NULL,
  `horario_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `estado` TEXT NOT NULL DEFAULT ('confirmada'),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `networking_expositores` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `logo_url` TEXT NULL,
  `stand` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ticket_id` CHAR(36) NULL,
  `tipo_persona` TEXT NOT NULL DEFAULT ('empresa'),
  `contacto_nombre` TEXT NULL,
  `contacto_email` TEXT NULL,
  `contacto_telefono` TEXT NULL,
  `sitio_web` TEXT NULL,
  `redes` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `categoria_negocio` TEXT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `estado_ficha` TEXT NOT NULL DEFAULT ('borrador'),
  `orden` INT NOT NULL DEFAULT 0,
  `cuota_puntos` INT NULL,
  `galeria` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `networking_horarios` (
  `id` CHAR(36) NOT NULL,
  `expositor_id` CHAR(36) NOT NULL,
  `inicio` DATETIME(6) NOT NULL,
  `fin` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `notificaciones` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `tipo` TEXT NOT NULL,
  `titulo` TEXT NOT NULL,
  `cuerpo` TEXT NULL,
  `leida` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `oauth_clients` (
  `client_id` VARCHAR(255) NOT NULL,
  `secret_hash` TEXT NULL,
  `nombre` TEXT NOT NULL,
  `redirect_uris` JSON NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ultimo_uso_at` DATETIME(6) NULL,
  PRIMARY KEY (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `oauth_codes` (
  `code_hash` VARCHAR(255) NOT NULL,
  `client_id` TEXT NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `redirect_uri` TEXT NOT NULL,
  `code_challenge` TEXT NOT NULL,
  `challenge_metodo` TEXT NOT NULL DEFAULT ('S256'),
  `scope` TEXT NULL,
  `expira_at` DATETIME(6) NOT NULL,
  `usado_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`code_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `oauth_tokens` (
  `id` CHAR(36) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `refresh_hash` VARCHAR(255) NULL,
  `client_id` TEXT NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `scope` TEXT NULL,
  `expira_at` DATETIME(6) NOT NULL,
  `revocado` TINYINT(1) NOT NULL DEFAULT 0,
  `ultimo_uso_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `organizador_conexiones` (
  `owner_id` CHAR(36) NOT NULL,
  `tipo` VARCHAR(255) NOT NULL,
  `valor_cifrado` TEXT NOT NULL,
  `pista` TEXT NULL,
  `opciones` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `verificado_at` DATETIME(6) NULL,
  `verificado_ok` TINYINT(1) NULL,
  `verificado_error` TEXT NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`owner_id`, `tipo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `payment_transactions` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `ticket_id` CHAR(36) NULL,
  `ticket_type_id` CHAR(36) NULL,
  `provider` TEXT NOT NULL DEFAULT ('mercadopago'),
  `preference_id` VARCHAR(255) NULL,
  `payment_id` VARCHAR(255) NULL,
  `status` TEXT NOT NULL DEFAULT ('pending'),
  `monto` DECIMAL(12,2) NULL,
  `currency` TEXT NULL DEFAULT ('COP'),
  `guest_email` TEXT NULL,
  `guest_nombre` TEXT NULL,
  `guest_telefono` TEXT NULL,
  `raw` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `user_id` CHAR(36) NULL,
  `kind` TEXT NOT NULL DEFAULT ('ticket'),
  `gateway` TEXT NULL DEFAULT ('mercadopago'),
  `referencia` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `perfil_talento` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `titular` TEXT NULL,
  `bio` TEXT NULL,
  `habilidades` JSON NULL DEFAULT (CAST('[]' AS JSON)),
  `experiencia` JSON NULL DEFAULT (CAST('[]' AS JSON)),
  `disponibilidad` JSON NULL DEFAULT (CAST('{}' AS JSON)),
  `ciudad` VARCHAR(255) NULL,
  `pais` TEXT NULL DEFAULT ('Colombia'),
  `telefono` TEXT NULL,
  `foto_url` TEXT NULL,
  `portfolio_url` TEXT NULL,
  `redes` JSON NULL DEFAULT (CAST('{}' AS JSON)),
  `publicado` TINYINT(1) NOT NULL DEFAULT 0,
  `verificacion_estado` TEXT NOT NULL DEFAULT ('ninguna'),
  `verificacion_ref` TEXT NULL,
  `verificado_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `cv_url` TEXT NULL,
  `cv_nombre` TEXT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `points_log` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `accion` TEXT NOT NULL,
  `puntos` INT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `organizador_id` CHAR(36) NULL,
  `audiencia` VARCHAR(255) NOT NULL DEFAULT ('cliente'),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `postulaciones` (
  `id` CHAR(36) NOT NULL,
  `vacante_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `perfil_snapshot` JSON NULL DEFAULT (CAST('{}' AS JSON)),
  `respuestas` JSON NULL DEFAULT (CAST('{}' AS JSON)),
  `etapa` TEXT NOT NULL DEFAULT ('postulado'),
  `entrevista` JSON NULL,
  `monto_contrato` DECIMAL(12,2) NULL,
  `mensaje` TEXT NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `profiles` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `nombre` TEXT NOT NULL,
  `handle` VARCHAR(255) NULL,
  `avatar_url` TEXT NULL,
  `telefono` TEXT NULL,
  `ciudad` TEXT NULL,
  `empresa` TEXT NULL,
  `ocupacion` TEXT NULL,
  `rol` TEXT NOT NULL DEFAULT ('organizador'),
  `puntos` INT NOT NULL DEFAULT 0,
  `nivel` TEXT NOT NULL DEFAULT ('bronze'),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `empresa_logo_url` TEXT NULL,
  `branding` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `mp_user_id` TEXT NULL,
  `mp_access_token` TEXT NULL,
  `mp_public_key` TEXT NULL,
  `mp_connected_at` DATETIME(6) NULL,
  `plan` TEXT NOT NULL DEFAULT ('free'),
  `plan_expires_at` DATETIME(6) NULL,
  `plan_payment_id` TEXT NULL,
  `plan_updated_at` DATETIME(6) NULL,
  `puntos_total` INT NOT NULL DEFAULT 0,
  `bio` TEXT NULL,
  `wompi_public_key` TEXT NULL,
  `wompi_private_key` TEXT NULL,
  `wompi_events_secret` TEXT NULL,
  `wompi_integrity_secret` TEXT NULL,
  `wompi_connected_at` DATETIME(6) NULL,
  `google_refresh_token` TEXT NULL,
  `google_email` TEXT NULL,
  `google_connected_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `promociones` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `codigo` VARCHAR(255) NOT NULL,
  `descripcion` TEXT NULL,
  `tipo` TEXT NOT NULL DEFAULT ('porcentaje'),
  `valor` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `ticket_id` CHAR(36) NULL,
  `min_cantidad` INT NOT NULL DEFAULT 1,
  `limite_usos` INT NULL,
  `usos` INT NOT NULL DEFAULT 0,
  `vigente_desde` DATETIME(6) NULL,
  `vigente_hasta` DATETIME(6) NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `puntos_balance` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `organizador_id` CHAR(36) NOT NULL,
  `audiencia` VARCHAR(255) NOT NULL,
  `puntos` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `push_subscriptions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `endpoint` VARCHAR(512) NOT NULL,
  `keys` JSON NOT NULL,
  `user_agent` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `last_seen_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `recompensas` (
  `id` CHAR(36) NOT NULL,
  `organizador_id` CHAR(36) NOT NULL,
  `audiencia` VARCHAR(255) NOT NULL,
  `titulo` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `costo_puntos` INT NOT NULL,
  `stock` INT NULL,
  `canjeados` INT NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `evento_id` CHAR(36) NULL,
  `expositor_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `recordatorio_inapp_log` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `scope_id` CHAR(36) NOT NULL,
  `tipo` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `referral_codes` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `codigo` VARCHAR(255) NOT NULL,
  `usos` INT NOT NULL DEFAULT 0,
  `puntos_por_uso` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `sesion_inscripciones` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `ticket_id` CHAR(36) NULL,
  `nombre` TEXT NULL,
  `email` TEXT NULL,
  `telefono` TEXT NULL,
  `respuestas` JSON NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('inscrito'),
  `asistio_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `legal_aceptado_at` DATETIME(6) NULL,
  `legal_version` TEXT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `speakers` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `bio` TEXT NULL,
  `foto_url` TEXT NULL,
  `empresa` TEXT NULL,
  `social_links` JSON NULL DEFAULT (CAST('{}' AS JSON)),
  `orden` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `sponsors` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `logo_url` TEXT NULL,
  `tier` TEXT NULL DEFAULT ('silver'),
  `url` TEXT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `sugerencias_catalogo` (
  `id` CHAR(36) NOT NULL,
  `catalogo` VARCHAR(255) NOT NULL,
  `texto` TEXT NOT NULL,
  `contexto` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `user_id` CHAR(36) NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('nueva'),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `sugerencias_dinamica` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `titulo` TEXT NOT NULL,
  `como_funciona` TEXT NOT NULL,
  `alternativa` TEXT NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('nueva'),
  `respuesta` TEXT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `talento_resenas` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `vacante_id` CHAR(36) NULL,
  `postulacion_id` CHAR(36) NULL,
  `de_user_id` CHAR(36) NOT NULL,
  `para_user_id` CHAR(36) NOT NULL,
  `rol_de` TEXT NOT NULL,
  `estrellas` INT NOT NULL,
  `comentario` TEXT NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `tarea_log` (
  `id` CHAR(36) NOT NULL,
  `tarea_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `tipo` TEXT NOT NULL,
  `contenido` JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `tareas` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `titulo` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('pendiente'),
  `prioridad` TEXT NOT NULL DEFAULT ('normal'),
  `asignado_user_id` CHAR(36) NULL,
  `asignado_rol_id` CHAR(36) NULL,
  `vence_at` DATETIME(6) NULL,
  `completed_at` DATETIME(6) NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `ticket_interacciones` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `ticket_id` CHAR(36) NOT NULL,
  `motivo_id` CHAR(36) NULL,
  `tipo` TEXT NOT NULL DEFAULT ('positivo'),
  `puntos` INT NOT NULL DEFAULT 0,
  `motivo_texto` TEXT NULL,
  `nota` TEXT NULL,
  `lugar` TEXT NULL,
  `operador_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expositor_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `ticket_movimientos` (
  `id` CHAR(36) NOT NULL,
  `ticket_id` CHAR(36) NULL,
  `evento_id` CHAR(36) NOT NULL,
  `tipo` TEXT NOT NULL,
  `acceso` TEXT NULL,
  `operador_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `zona` VARCHAR(255) NULL,
  `zona_id` VARCHAR(255) NULL,
  `cantidad` INT NOT NULL DEFAULT 1,
  `origen` TEXT NOT NULL DEFAULT ('qr'),
  `nota` TEXT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `ticket_types` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `precio` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `currency` TEXT NOT NULL DEFAULT ('COP'),
  `cupo` INT NULL,
  `vendidos` INT NOT NULL DEFAULT 0,
  `early_bird_precio` DECIMAL(12,2) NULL,
  `early_bird_hasta` DATETIME(6) NULL,
  `venta_hasta` DATETIME(6) NULL,
  `zonas_acceso` JSON NULL DEFAULT (CAST('[]' AS JSON)),
  `orden` INT NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `es_expositor` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `tickets` (
  `id` CHAR(36) NOT NULL,
  `ticket_type_id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NULL,
  `guest_email` TEXT NULL,
  `guest_nombre` TEXT NULL,
  `qr_token` VARCHAR(512) NULL,
  `codigo` VARCHAR(255) NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('emitido'),
  `pagado_at` DATETIME(6) NULL,
  `checked_in_at` DATETIME(6) NULL,
  `zona_usada` TEXT NULL,
  `discount_code_id` CHAR(36) NULL,
  `precio_pagado` DECIMAL(12,2) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `respuestas` JSON NULL,
  `acceso` TEXT NULL,
  `legal_aceptado_at` DATETIME(6) NULL,
  `legal_version` VARCHAR(255) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `torneo_categorias` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `padre_id` CHAR(36) NULL,
  `nombre` TEXT NOT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `torneo_equipos` (
  `id` CHAR(36) NOT NULL,
  `torneo_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `foto_url` TEXT NULL,
  `posicion_bracket` INT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `contacto_email` TEXT NULL,
  `contacto_user_id` CHAR(36) NULL,
  `grupo` TEXT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `torneo_partidos` (
  `id` CHAR(36) NOT NULL,
  `torneo_id` CHAR(36) NOT NULL,
  `ronda` INT NOT NULL DEFAULT 1,
  `orden` INT NOT NULL DEFAULT 0,
  `equipo_a_id` CHAR(36) NULL,
  `equipo_b_id` CHAR(36) NULL,
  `marcador_a` INT NULL,
  `marcador_b` INT NULL,
  `estado` TEXT NOT NULL DEFAULT ('pendiente'),
  `cancha` TEXT NULL,
  `fecha_hora` DATETIME(6) NULL,
  `siguiente_partido_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `fase` TEXT NOT NULL DEFAULT ('unica'),
  `grupo` TEXT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `torneos` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `nombre` TEXT NOT NULL,
  `formato` TEXT NOT NULL,
  `estado` TEXT NOT NULL DEFAULT ('armando'),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `fase_actual` TEXT NOT NULL DEFAULT ('unica'),
  `num_grupos` INT NULL,
  `avanzan_por_grupo` INT NULL DEFAULT 2,
  `disciplina` TEXT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `categoria_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `user_badges` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `badge_slug` VARCHAR(255) NOT NULL,
  `evento_id` CHAR(36) NULL,
  `earned_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `vacantes` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NULL,
  `titulo` TEXT NOT NULL,
  `descripcion` TEXT NULL,
  `rol_id` CHAR(36) NULL,
  `rol_texto` TEXT NULL,
  `requisitos` JSON NULL DEFAULT (CAST('{}' AS JSON)),
  `preguntas` JSON NULL DEFAULT (CAST('[]' AS JSON)),
  `pago_monto` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `pago_moneda` TEXT NOT NULL DEFAULT ('COP'),
  `pago_periodo` TEXT NULL DEFAULT ('evento'),
  `comision_pct` DECIMAL(12,2) NOT NULL DEFAULT 0.05,
  `ciudad` VARCHAR(255) NULL,
  `modalidad` TEXT NULL DEFAULT ('presencial'),
  `fecha_inicio` DATETIME(6) NULL,
  `fecha_fin` DATETIME(6) NULL,
  `cupos` INT NOT NULL DEFAULT 1,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('abierta'),
  `destacada_hasta` DATETIME(6) NULL,
  `created_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  `event_rol_id` CHAR(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `waitlist` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `ticket_type_id` CHAR(36) NULL,
  `guest_nombre` TEXT NOT NULL,
  `guest_email` TEXT NOT NULL,
  `guest_telefono` TEXT NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT ('esperando'),
  `posicion` INT NULL,
  `promovido_at` DATETIME(6) NULL,
  `ticket_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `webhook_deliveries` (
  `id` CHAR(36) NOT NULL,
  `webhook_id` CHAR(36) NOT NULL,
  `evento_tipo` TEXT NOT NULL,
  `payload` JSON NOT NULL,
  `status` TEXT NOT NULL DEFAULT ('pending'),
  `response_code` INT NULL,
  `intentos` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `webhooks` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `url` TEXT NOT NULL,
  `secret` TEXT NOT NULL,
  `eventos` JSON NOT NULL DEFAULT (CAST('[]' AS JSON)),
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;

CREATE TABLE `zona_cortes` (
  `id` CHAR(36) NOT NULL,
  `evento_id` CHAR(36) NOT NULL,
  `zona_id` VARCHAR(255) NULL,
  `zona` TEXT NULL,
  `motivo` TEXT NULL,
  `dentro_antes` INT NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;


SET FOREIGN_KEY_CHECKS = 1;
