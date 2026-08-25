-- 0077 — Varios buzones por evento, con relevo por cupo.
--
-- La 0071 dejó UN buzón por evento: la clave primaria era `evento_id` a secas.
-- Con un solo remitente, el tope del proveedor es el techo de todo el evento —
-- y un buzón de hosting compartido no entrega 7.000 correos.
--
-- La idea es la misma que rotar proveedores de IA: varios remitentes en orden,
-- cada uno con su cupo, y cuando el primero llega a su umbral entra el
-- siguiente en vez de pararse. Si todos están llenos, la cola ESPERA: forzar es
-- lo que bloquea la cuenta de correo, que es un daño que dura días.
--
-- La tabla está vacía en los 31 eventos, así que no hay nada que migrar ni que
-- se pueda perder al cambiarle la clave primaria.

alter table evento_smtp drop constraint if exists evento_smtp_pkey;

alter table evento_smtp
  add column if not exists id uuid primary key default gen_random_uuid(),
  -- Para distinguirlos en pantalla: «cPanel», «Hostinger». Sin esto, dos filas
  -- con host parecido son indistinguibles para quien las configura.
  add column if not exists etiqueta text,
  -- Quién va primero. El relevo respeta este orden.
  add column if not exists orden integer not null default 0,
  -- Topes del proveedor. NULL = sin límite conocido, y entonces manda el
  -- freno global de la cola (EMAIL_MAX_POR_HORA).
  add column if not exists max_por_hora integer,
  add column if not exists max_por_dia  integer;

-- Un mismo buzón no se configura dos veces en el mismo evento.
create unique index if not exists evento_smtp_unico
  on evento_smtp (evento_id, host, usuario);

create index if not exists evento_smtp_por_evento
  on evento_smtp (evento_id, orden);

-- Por cuál salió cada correo. Sin esto no hay forma de contar el cupo gastado
-- de cada buzón, que es justo lo que decide el relevo. Y de paso deja saber
-- después cuál de los dos entregó mejor.
alter table evento_email_envios
  add column if not exists smtp_id uuid references evento_smtp(id) on delete set null;

create index if not exists evento_email_envios_por_smtp
  on evento_email_envios (smtp_id, created_at desc);
