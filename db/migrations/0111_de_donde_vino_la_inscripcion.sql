-- 0111 · De dónde vino cada inscripción
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- El organizador pega el botón de registro en su web, en el correo, en el
-- Instagram de la alcaldía y en el WhatsApp del gremio. Y después no puede
-- saber cuál de los cuatro le trajo gente. Hoy una boleta no recuerda por
-- dónde entró: todas se ven iguales.
--
-- Eso convierte los botones en algo que se pega una vez y se olvida —«los
-- botones que se crean no los vuelvo a ver»—, cuando deberían ser lo contrario:
-- la forma de saber qué canal funciona antes de gastar en el que no.
--
-- ── Qué es `origen` ────────────────────────────────────────────────────
--
-- Un código corto que viaja en el enlace del botón y se guarda con la boleta.
-- Lo pone la plataforma al crear el botón, no la persona: así no hay dos
-- botones llamados igual ni espacios raros en una URL.
--
-- NULL es la mayoría y está bien: es todo lo que se registró desde la página
-- del evento, sin pasar por un botón. No es «desconocido», es «directo», y el
-- panel lo dice así.
--
-- ── Por qué texto y no una tabla de campañas ───────────────────────────
--
-- Porque un botón se borra y sus inscripciones no dejan de existir. Con una
-- clave foránea, borrar un botón obligaría a decidir qué pasa con las boletas
-- que trajo — y la respuesta correcta es «nada, se quedan». Un texto suelto lo
-- resuelve sin ceremonia: el botón desaparece y sus boletas siguen contando en
-- el histórico.

alter table public.tickets
  add column if not exists origen text;

-- Se agrupa por evento y origen para contar cuántas trajo cada botón.
create index if not exists tickets_origen_idx
  on public.tickets (evento_id, origen)
  where origen is not null;

comment on column public.tickets.origen is
  'Código corto del botón o enlace por el que entró esta inscripción. NULL = directo, desde la página del evento.';

-- Comprobación:
--   select column_name from information_schema.columns
--    where table_name = 'tickets' and column_name = 'origen';
--
-- Vuelta atrás:
--   drop index if exists tickets_origen_idx;
--   alter table public.tickets drop column if exists origen;
