/* Los ocho índices ÚNICOS parciales, uno por uno.
 *
 * Postgres puede decir «esto es único, pero sólo en las filas que cumplan
 * esta condición». MySQL no. Y no es un detalle de rendimiento: quitar la
 * condición convierte un índice que PERMITÍA repetidos en uno que los
 * PROHÍBE, y eso no se ve al migrar — se ve el día que una inscripción
 * legítima empieza a fallar con «duplicate entry».
 *
 * Por eso van a mano y no los emite el generador. Cada uno es una decisión.
 *
 * ── La regla que resuelve la mitad ────────────────────────────────────────
 *
 * MySQL, igual que Postgres, deja repetir los NULL en un índice único. Así
 * que cuando la condición es «esta columna no es nula» Y esa columna está en
 * la clave, un UNIQUE normal se comporta EXACTAMENTE igual: las filas que la
 * condición excluía son justo las que tienen el NULL, y ésas nunca chocan.
 * Cuatro de los ocho caen aquí — pero uno de esos cuatro
 * (`torneo_categorias_unica_hija`) va sobre una columna TEXT y necesita igual
 * una columna generada, no por la condición sino porque MySQL no indexa TEXT.
 *
 * Los otros cuatro tienen condiciones que no se dejan reescribir así —
 * «cuando global es cierto», «cuando NO hay boleta», «cuando el estado es uno
 * de estos dos»—. Para ésos se añade una columna generada que vale NULL
 * cuando la condición no se cumple, y el único va sobre ella. El NULL vuelve
 * a hacer el trabajo de la condición.
 *
 * Las columnas generadas son VIRTUAL: no ocupan espacio en la fila, se
 * calculan al leer, y MySQL 8 sí las indexa. Al ser generadas tampoco se
 * pueden escribir por error desde el código.
 */

SET NAMES utf8mb4;
SET time_zone = '+00:00';

/* ══ Los cuatro que se traducen solos ════════════════════════════════════ */

/* WHERE dm_key IS NOT NULL — y dm_key está en la clave. */
CREATE UNIQUE INDEX `chat_channels_dm_uidx`
  ON `chat_channels` (`evento_id`, `dm_key`);

/* WHERE oferta_token IS NOT NULL — y es la clave entera. */
CREATE UNIQUE INDEX `waitlist_oferta_token_uidx`
  ON `event_waitlist` (`oferta_token`);

/* WHERE ticket_id IS NOT NULL — y ticket_id está en la clave. */
CREATE UNIQUE INDEX `sesion_inscripciones_ticket_uidx`
  ON `sesion_inscripciones` (`session_id`, `ticket_id`);

/* WHERE padre_id IS NOT NULL — y padre_id está en la clave, así que el NULL
   hace solo el trabajo de la condición parcial. Pero un UNIQUE sobre `nombre`
   no compila: `torneo_categorias.nombre` es TEXT y MySQL no indexa un TEXT sin
   prefijo de longitud (error 1170), y un prefijo no garantiza unicidad real
   para nombres largos. Por eso este índice —aunque su condición se traduzca
   sola— necesita una columna generada VARCHAR, igual que el caso raíz de
   abajo. El lower(nombre) del original va explícito en el LOWER(): así la
   unicidad no distingue mayúsculas ni siquiera con una colación _bin (con la
   colación por defecto utf8mb4_0900_as_ci daría igual, pero sí distingue
   acentos, que es lo que se quiere). */
ALTER TABLE `torneo_categorias`
  ADD COLUMN `nombre_hija` VARCHAR(255)
    AS (IF(`padre_id` IS NOT NULL, LOWER(`nombre`), NULL)) VIRTUAL;

CREATE UNIQUE INDEX `torneo_categorias_unica_hija`
  ON `torneo_categorias` (`evento_id`, `padre_id`, `nombre_hija`);


/* ══ Los cuatro que necesitan una columna generada ═══════════════════════ */

/* 1 · catalogo_roles: UNIQUE (slug) WHERE global = true
 *
 * Un slug puede repetirse entre los roles de cada organizador; sólo los
 * globales tienen que ser únicos entre sí. */
ALTER TABLE `catalogo_roles`
  ADD COLUMN `slug_global` VARCHAR(255)
    AS (IF(`global` = 1, `slug`, NULL)) VIRTUAL;

CREATE UNIQUE INDEX `catalogo_roles_slug_global_uidx`
  ON `catalogo_roles` (`slug_global`);


/* 2 · sesion_inscripciones: UNIQUE (session_id, lower(email))
 *                           WHERE ticket_id IS NULL AND email IS NOT NULL
 *
 * La condición está INVERTIDA respecto a la del índice de arriba: aquí lo
 * único es lo que NO tiene boleta. Quien entra con boleta se controla por
 * ticket_id; quien entra sólo con correo, por el correo. Sin la columna
 * generada, un UNIQUE normal impediría que la misma persona se inscribiera
 * con boleta y sin ella, que hoy es legal.
 *
 * El `email IS NOT NULL` de la condición sale gratis: LOWER(NULL) es NULL. */
ALTER TABLE `sesion_inscripciones`
  ADD COLUMN `email_sin_boleta` VARCHAR(255)
    AS (IF(`ticket_id` IS NULL, LOWER(`email`), NULL)) VIRTUAL;

CREATE UNIQUE INDEX `sesion_inscripciones_email_uidx`
  ON `sesion_inscripciones` (`session_id`, `email_sin_boleta`);


/* 3 · torneo_categorias: UNIQUE (evento_id, lower(nombre)) WHERE padre_id IS NULL
 *
 * El par del de arriba: dos categorías raíz del mismo evento no pueden
 * llamarse igual. Aquí la condición es «padre_id ES nulo», que es lo contrario
 * de lo que el NULL hace solo, así que hace falta la columna. */
ALTER TABLE `torneo_categorias`
  ADD COLUMN `nombre_raiz` VARCHAR(255)
    AS (IF(`padre_id` IS NULL, LOWER(`nombre`), NULL)) VIRTUAL;

CREATE UNIQUE INDEX `torneo_categorias_unica_raiz`
  ON `torneo_categorias` (`evento_id`, `nombre_raiz`);


/* 4 · waitlist: UNIQUE (evento_id, ticket_type_id, lower(guest_email))
 *               WHERE estado IN ('esperando', 'promovido')
 *
 * Un correo no puede estar dos veces en la lista de espera del mismo tipo de
 * boleta MIENTRAS espera. Cuando sale de la lista —comprada, vencida,
 * cancelada— la fila se queda como historial y tiene que poder repetirse: sin
 * la columna generada, alguien que se apuntó, no compró y vuelve a apuntarse
 * meses después chocaría con su propia fila vieja. */
ALTER TABLE `waitlist`
  ADD COLUMN `email_en_espera` VARCHAR(255)
    AS (IF(`estado` IN ('esperando', 'promovido'), LOWER(`guest_email`), NULL)) VIRTUAL;

CREATE UNIQUE INDEX `waitlist_uniq_email`
  ON `waitlist` (`evento_id`, `ticket_type_id`, `email_en_espera`);
