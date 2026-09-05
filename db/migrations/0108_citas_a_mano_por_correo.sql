-- 0108 · Sentar a alguien en la rueda con sólo su correo
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- Hay ruedas donde la agenda la arma el equipo entera: se sabe quién se
-- reunirá con quién y a qué hora, y nadie reserva ni aprueba nada. Hoy eso no
-- se puede: `networking_citas.user_id` es NOT NULL y apunta a `auth.users`, o
-- sea que sólo se puede sentar a quien YA se hizo una cuenta en GESTEK.
--
-- Y la mayoría de quien compra una boleta no tiene cuenta: la compra es
-- anónima a propósito —esa decisión ya está tomada en el checkout— y lo único
-- que queda de esa persona es su correo en la boleta.
--
-- ── Qué cambia ─────────────────────────────────────────────────────────
--
-- `user_id` pasa a ser opcional, y aparecen `guest_email` y `guest_nombre`.
-- Una cita pertenece a una persona con cuenta (user_id) O a un correo. Nunca a
-- ninguno de los dos: eso lo impide el CHECK, porque una cita sin dueño no se
-- le puede enseñar a nadie ni avisar por correo, y sería una casilla ocupada
-- por nadie.
--
-- ── Lo que NO cambia ───────────────────────────────────────────────────
--
-- Las citas que ya existen tienen su `user_id` y siguen igual. El índice único
-- sobre `horario_id` sigue siendo el que impide dos personas en la misma
-- casilla, y vale para las dos formas.
--
-- ── Por qué el correo se guarda en minúsculas ──────────────────────────
--
-- Porque es la llave con la que se cruza contra la boleta y contra el perfil.
-- «Juan@X.com» y «juan@x.com» son la misma persona, y si se guardan tal cual
-- llegan, la misma persona acaba con dos agendas. La normalización la hace el
-- servidor al escribir; esto sólo deja constancia del criterio.

alter table public.networking_citas
  alter column user_id drop not null;

alter table public.networking_citas
  add column if not exists guest_email  text,
  add column if not exists guest_nombre text;

-- Una cita es de alguien. Con cuenta o con correo, pero de alguien.
alter table public.networking_citas
  drop constraint if exists networking_citas_dueno_ck;
alter table public.networking_citas
  add  constraint networking_citas_dueno_ck
  check (user_id is not null or guest_email is not null);

-- Para cruzar «mis citas» por correo cuando no hay cuenta.
create index if not exists networking_citas_guest_email_idx
  on public.networking_citas (evento_id, guest_email)
  where guest_email is not null;

comment on column public.networking_citas.guest_email is
  'Dueño de la cita cuando no tiene cuenta en GESTEK. Siempre en minúsculas.';
comment on column public.networking_citas.guest_nombre is
  'Cómo se llama, para que la parrilla no enseñe sólo un correo.';

-- Comprobación:
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'networking_citas'
--      and column_name in ('user_id', 'guest_email', 'guest_nombre');
--   -- user_id debe quedar en YES, y las otras dos deben existir.
