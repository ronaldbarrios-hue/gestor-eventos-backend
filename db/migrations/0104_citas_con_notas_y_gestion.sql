-- 0104 · Las citas de la rueda de negocios: notas, estados y quién las creó.
--
-- ── Qué falta hoy ────────────────────────────────────────────────────────
--
-- Una cita es hoy tres cosas: un horario, una persona y la palabra
-- «confirmada». Eso deja fuera casi todo lo que pasa alrededor de una rueda de
-- negocios:
--
--  · **Nadie puede anotar nada.** Se tienen quince reuniones de veinte minutos
--    y al día siguiente no hay forma de saber cuál era cuál. La libreta que
--    todo el mundo saca es exactamente el hueco que esto tapa.
--  · **Quien organiza no puede tocarlas.** El formato real es una compradora y
--    vendedores que rotan por hora; si una empresa no llega, la casilla se
--    queda muerta y sólo la puede soltar quien la reservó.
--  · **Sólo hay autogestión.** Reservar confirma en el acto. En muchas ruedas
--    la cita se PIDE y alguien la aprueba, porque las agendas se cruzan.
--
-- ── Lo que se añade ─────────────────────────────────────────────────────
--
-- `notas` es de quien asiste y `nota_gestor` de quien organiza. Separadas a
-- propósito: son de dueños distintos y se leen en momentos distintos, y una
-- sola columna acabaría con las dos personas pisándose el texto.
--
-- `creada_por` dice si la cita la puso la propia persona o el equipo. Sin eso,
-- una agenda armada a mano por el gestor y una reservada por el asistente se
-- ven idénticas — y al reclamar «yo no pedí esto» no hay a qué mirar.
--
-- ── Los estados, y por qué no hay CHECK ─────────────────────────────────
--
--   solicitada → pedida, esperando aprobación (modo «solicitud»)
--   confirmada → en pie
--   cancelada  → se cayó
--   realizada  → ocurrió (es la que da sentido a `notas`)
--
-- La lista se valida en `routes/networking.js` y no con una restricción de
-- columna, igual que el resto de estados del proyecto: añadir uno no debería
-- pedir una migración, y quien lee el código quiere ver la lista donde se usa.
-- Lo que hay hoy —4 filas, todas `confirmada`— no se toca.

alter table public.networking_citas
  add column if not exists notas       text,
  add column if not exists nota_gestor text,
  add column if not exists creada_por  uuid;

comment on column public.networking_citas.notas is
  'Lo que anotó quien asistió. Suya: el equipo no la escribe.';
comment on column public.networking_citas.nota_gestor is
  'Lo que anotó quien organiza. Aparte de `notas` porque son de dueños distintos.';
comment on column public.networking_citas.creada_por is
  'Quién la creó: el propio asistente, o alguien del equipo armando la agenda.';

-- ── El modo de la rueda ──────────────────────────────────────────────────
--
-- `auto` es lo de hoy y sigue siendo el valor por omisión: reservar confirma.
-- `solicitud` hace que reservar deje la cita en `solicitada` y que alguien del
-- equipo la apruebe.
--
-- Va como columna del evento y no dentro de `page_json` porque **es una regla
-- que gobierna una escritura**, no una preferencia de cómo se pinta algo: el
-- servidor la consulta en cada reserva.

alter table public.eventos
  add column if not exists networking_modo text not null default 'auto';

comment on column public.eventos.networking_modo is
  'auto = reservar confirma en el acto. solicitud = la cita queda pendiente de que el equipo la apruebe.';

-- La agenda del gestor se mira siempre igual: las de este evento, por hora.
create index if not exists networking_citas_evento_idx
  on public.networking_citas (evento_id, estado);

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select estado, count(*) from public.networking_citas group by estado;
--     -- confirmada 4, y nada más: lo que había no se toca.
--   select slug, networking_modo from public.eventos limit 5;
--     -- todos en 'auto'.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   drop index if exists public.networking_citas_evento_idx;
--   alter table public.networking_citas
--     drop column if exists notas, drop column if exists nota_gestor,
--     drop column if exists creada_por;
--   alter table public.eventos drop column if exists networking_modo;
--
-- Se pierden las notas que se hayan escrito. Nada de lo anterior a esto.
