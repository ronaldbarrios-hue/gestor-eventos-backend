-- 001_identidad.sql — las cuatro tablas de la identidad propia.
--
-- Motor: MySQL 8.0.46 (el medido en el cPanel de destino).
--
-- ── Antes de esto ─────────────────────────────────────────────────────────
--
-- La base hay que crearla en utf8mb4 desde el principio. El servidor viene en
-- utf8mb3 y una base creada sin decir nada la hereda; cambiarla después de
-- tener datos es un ALTER por tabla y por columna que hay que hacer con la app
-- parada. En cPanel la base se crea sin elegir juego de caracteres, así que:
--
--   ALTER DATABASE `cuenta_gestek` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--
-- ── Por qué CHAR(36) y no BINARY(16) ──────────────────────────────────────
--
-- Los UUID ocupan la mitad en binario y ordenan mejor. Pero estos UUID no son
-- nuestros: son los que ya tiene Supabase, referenciados por claves ajenas en
-- todo el esquema y por `profiles.id`. Durante la convivencia, las mismas
-- cadenas viajan entre las dos bases en cada petición. Guardarlos como texto
-- hace que un `SELECT` se pueda comparar a ojo con lo que devuelve Supabase,
-- y esa comprobación vale más que los 20 bytes por fila que se ahorrarían.

CREATE TABLE IF NOT EXISTS usuarios (
  id                  CHAR(36)     NOT NULL,
  email               VARCHAR(255) NOT NULL,
  -- NULL a propósito: 22 de los 29 usuarios entran sólo con Google y no tienen
  -- contraseña. Una cadena vacía aquí sería una contraseña que bcrypt rechaza
  -- siempre, pero que se puede confundir con «no configurada».
  password_hash       VARCHAR(255)     NULL,
  email_confirmado_at DATETIME         NULL,
  -- Lo que Supabase llamaba `user_metadata`: nombre, avatar, teléfono. Se
  -- guarda tal cual para que el frontend no note el cambio.
  metadata            JSON             NULL,
  intentos_fallidos   INT          NOT NULL DEFAULT 0,
  bloqueado_hasta     DATETIME         NULL,
  ultimo_acceso_at    DATETIME         NULL,
  creado_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- El correo distingue mayúsculas en algunas configuraciones y en otras no.
  -- Con esta collation, `Ana@x.com` y `ana@x.com` son la misma cuenta, que es
  -- lo que espera cualquiera que se registre. El servicio además normaliza a
  -- minúsculas antes de escribir, para no depender sólo de esto.
  UNIQUE KEY uk_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Identidades externas ───────────────────────────────────────────────────
--
-- Una fila por proveedor y cuenta. Hoy sólo hay `google`, con 22 filas, pero la
-- tabla admite más sin migración.
--
-- El `proveedor_id` es el `sub` de Google: un número estable que NO cambia
-- aunque la persona cambie de correo. Emparejar por correo en vez de por `sub`
-- es el fallo clásico: quien cambia su dirección en Google pierde su cuenta y
-- se le crea otra vacía.

CREATE TABLE IF NOT EXISTS usuario_identidades (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id    CHAR(36)     NOT NULL,
  proveedor     VARCHAR(32)  NOT NULL,
  proveedor_id  VARCHAR(255) NOT NULL,
  email         VARCHAR(255)     NULL,
  creado_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_identidad (proveedor, proveedor_id),
  KEY idx_identidad_usuario (usuario_id),
  CONSTRAINT fk_identidad_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Sesiones ───────────────────────────────────────────────────────────────
--
-- Una fila por refresco vivo. Es lo que Supabase no dejaba hacer: cerrar la
-- sesión de un dispositivo perdido sin cambiar la contraseña.
--
-- Se guarda el SHA-256 del refresco, nunca el refresco. Si alguien se lleva un
-- volcado de esta tabla, no puede entrar con nada de lo que hay dentro. Es la
-- misma decisión que ya tomó `lib/oauth.js` para los tokens del conector.
--
-- `reemplazada_por` es la cadena de rotación: cada refresco usado apunta al que
-- lo sustituyó. Sirve para detectar el robo — si aparece un refresco ya
-- reemplazado, o lo tiene un ladrón o lo tiene el dueño, y no se puede saber
-- cuál, así que se corta la cadena entera.

CREATE TABLE IF NOT EXISTS sesiones (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id      CHAR(36)    NOT NULL,
  refresh_hash    CHAR(64)    NOT NULL,
  creado_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at       DATETIME    NOT NULL,
  usado_at        DATETIME        NULL,
  revocado_at     DATETIME        NULL,
  reemplazada_por BIGINT UNSIGNED NULL,
  -- Para que el panel pueda decir «Chrome en Windows, hace 3 días» en vez de
  -- una fila sin cara que nadie se atreve a cerrar.
  user_agent      VARCHAR(255)    NULL,
  ip              VARCHAR(45)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sesiones_refresh (refresh_hash),
  KEY idx_sesiones_usuario (usuario_id, revocado_at),
  KEY idx_sesiones_expira (expira_at),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tokens de un solo uso ──────────────────────────────────────────────────
--
-- Confirmar el correo y recuperar la contraseña. Otra vez sólo el hash: el
-- enlace de recuperación es, durante una hora, equivalente a la contraseña.
--
-- `usado_at` en vez de borrar la fila, por lo mismo que en `oauth_codes`: un
-- segundo intento con el mismo enlace se puede distinguir de un enlace que
-- nunca existió, y eso es información que sirve.

CREATE TABLE IF NOT EXISTS tokens_un_uso (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id CHAR(36)   NOT NULL,
  tipo       VARCHAR(24) NOT NULL,       -- 'confirmacion' | 'recuperacion'
  token_hash CHAR(64)   NOT NULL,
  creado_at  DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_at  DATETIME   NOT NULL,
  usado_at   DATETIME       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_token_un_uso (token_hash),
  KEY idx_token_usuario (usuario_id, tipo),
  KEY idx_token_expira (expira_at),
  CONSTRAINT fk_token_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
