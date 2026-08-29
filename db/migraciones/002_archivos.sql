-- 002_archivos.sql — el registro de los archivos.
--
-- ── Por qué hace falta una tabla si los archivos están en disco ───────────
--
-- Hoy no hay ninguna, y ése es exactamente el problema medido: **40 objetos
-- huérfanos y 28 MB**, más de un tercio del almacenamiento, son archivos que ya
-- no apunta ninguna fila. Pasó porque cuatro de los cinco uploaders suben el
-- archivo nuevo y dejan el viejo donde estaba. Nadie los borra porque nadie
-- sabe que existen: el disco no se puede preguntar «¿de quién es esto y quién
-- lo usa?».
--
-- Con esta tabla sí se puede. Cada archivo tiene dueño, carpeta, tamaño y fecha
-- de borrado, y con eso salen las tres cosas que hoy no se pueden hacer:
-- reemplazar borrando el anterior, cobrar una cuota por usuario, y barrer lo
-- que sobra sin adivinar.
--
-- ── Lo que NO guarda ──────────────────────────────────────────────────────
--
-- El contenido. Los bytes viven en disco, fuera de la carpeta del código y
-- fuera del repositorio, para que un despliegue no se los lleve por delante.
-- Aquí sólo está la ficha.

CREATE TABLE IF NOT EXISTS archivos (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- La ruta relativa a la raíz del almacén: `avatars/<uid>/avatar-<ts>.jpg`.
  -- Es la MISMA estructura que tienen hoy los buckets de Supabase, y no es
  -- casualidad: conservarla convierte la reescritura de las 13 columnas que
  -- llevan la URL dentro en una sustitución de prefijo y nada más.
  ruta          VARCHAR(512) NOT NULL,

  carpeta       VARCHAR(64)  NOT NULL,     -- avatars | event-media | form-uploads | hojas-de-vida
  usuario_id    CHAR(36)         NULL,     -- NULL: subida sin cuenta (el expositor con su código)
  evento_id     CHAR(36)         NULL,     -- para poder cobrar y barrer por evento

  nombre_original VARCHAR(255)   NULL,
  -- El tipo REAL, el que se dedujo de los primeros bytes. Nunca el que declaró
  -- el navegador: eso lo escribe quien sube, y un `.jpg` que dentro es otra
  -- cosa es la forma barata de colar lo que sea.
  tipo_mime     VARCHAR(128) NOT NULL,
  bytes         BIGINT UNSIGNED NOT NULL,

  -- Los públicos los sirve Nginx directamente. Los privados —las hojas de
  -- vida— sólo salen con un enlace firmado y con caducidad. Hoy están en un
  -- bucket público, que es el hallazgo (c) de SUPABASE.md §3.4: no se pueden
  -- listar, pero cada uno se lee por su URL, y son datos personales.
  publico       TINYINT(1)   NOT NULL DEFAULT 1,

  creado_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Borrado lógico: la fila se marca y el barrido se lleva los bytes después.
  -- Borrar la fila y el archivo a la vez deja huérfano lo que falle en medio,
  -- que es justo lo que se está arreglando.
  borrado_at    DATETIME         NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_archivos_ruta (ruta),
  KEY idx_archivos_usuario (usuario_id, carpeta, borrado_at),
  KEY idx_archivos_evento (evento_id, borrado_at),
  KEY idx_archivos_barrido (borrado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
