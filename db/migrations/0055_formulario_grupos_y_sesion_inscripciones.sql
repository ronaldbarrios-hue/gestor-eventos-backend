-- 0055 · Grupos en el formulario + inscripción por sub-evento. SIN APLICAR. Idempotente.
--
-- ── Parte 1: grupos y ayuda en los campos del formulario ──
-- Una ficha de caracterización son ~22 preguntas. Sin agrupar es un muro, y la
-- gente abandona a mitad. `grupo` es solo para pintar: no cambia cómo se
-- guardan las respuestas.
--
-- ── Parte 2: inscripción por sub-evento ──
-- Hoy la boleta da acceso al evento entero y no queda registro de a qué
-- sub-evento entró cada quien. Eso deja sin responder la pregunta que importa
-- para reportar: cuánta gente asistió al evento y cuánta participó en cada
-- taller, charla o competencia.
--
-- No se crea otra boletería paralela: la boleta del evento sigue siendo la
-- llave. Lo que se añade es la inscripción a un sub-evento, colgada de esa
-- boleta, con su propio cupo. Así un asistente con una entrada puede inscribirse
-- a tres talleres y cada uno lleva su conteo, sin emitir tres códigos más.
--
-- También se permite inscribir a alguien sin boleta (ticket_id nulo, con sus
-- datos), porque en la práctica siempre aparece quien llega al taller sin haber
-- pasado por la entrada general.

/* ── 1. Campos del formulario ── */
alter table public.event_form_fields
  add column if not exists grupo text,
  add column if not exists ayuda text;

comment on column public.event_form_fields.grupo is
  'Título del bloque en el que se pinta el campo (Datos generales, Discapacidad…). Solo presentación.';
comment on column public.event_form_fields.ayuda is
  'Texto de apoyo bajo la pregunta. Opcional.';

/* ── 2. El sub-evento puede exigir inscripción y tener cupo ── */
alter table public.agenda_sessions
  add column if not exists requiere_inscripcion boolean not null default false,
  add column if not exists cupo integer,
  add column if not exists inscritos integer not null default 0,
  /* Formulario propio: si es null, se usa el del evento. */
  add column if not exists ticket_type_id uuid references public.ticket_types(id) on delete set null;

comment on column public.agenda_sessions.requiere_inscripcion is
  'Si es true, la gente se inscribe al sub-evento aparte de tener boleta del evento.';
comment on column public.agenda_sessions.cupo is
  'Aforo del sub-evento. Null = sin límite.';
comment on column public.agenda_sessions.ticket_type_id is
  'Tipo de boleta cuyo formulario se usa para inscribirse. Null = el general del evento.';

/* ── 3. Las inscripciones ── */
create table if not exists public.sesion_inscripciones (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  session_id  uuid not null references public.agenda_sessions(id) on delete cascade,
  /* La boleta del evento, cuando la persona ya la tiene. */
  ticket_id   uuid references public.tickets(id) on delete set null,
  /* Y si no la tiene, sus datos aquí. */
  nombre      text,
  email       text,
  telefono    text,
  respuestas  jsonb,
  /* inscrito → se apuntó · asistio → se le marcó la entrada · cancelada */
  estado      text not null default 'inscrito',
  /* Cuándo se le marcó la asistencia, para separar "se apuntó" de "fue". */
  asistio_at  timestamptz,
  created_at  timestamptz not null default now()
);

/* Una boleta no se puede inscribir dos veces al mismo sub-evento. El índice es
   parcial porque ticket_id puede ser nulo (inscritos sin boleta), y en SQL dos
   nulos no chocan entre sí. */
create unique index if not exists sesion_inscripciones_ticket_uidx
  on public.sesion_inscripciones(session_id, ticket_id)
  where ticket_id is not null;

/* Lo mismo por correo, para los que no traen boleta. Normalizado a minúsculas
   porque si no, Ana@x.com y ana@x.com cuentan como dos personas. */
create unique index if not exists sesion_inscripciones_email_uidx
  on public.sesion_inscripciones(session_id, lower(email))
  where ticket_id is null and email is not null;

create index if not exists sesion_inscripciones_evento_idx
  on public.sesion_inscripciones(evento_id, session_id);
create index if not exists sesion_inscripciones_sesion_idx
  on public.sesion_inscripciones(session_id, estado);

alter table public.sesion_inscripciones enable row level security;

/* El backend escribe con la service key. Estas políticas son para que nada
   quede legible desde el cliente: son datos personales, y con la ficha de
   caracterización aplicada incluyen etnia, discapacidad y condición de víctima. */
drop policy if exists sesion_inscripciones_owner on public.sesion_inscripciones;
create policy sesion_inscripciones_owner on public.sesion_inscripciones
  for select using (
    exists (
      select 1 from public.eventos e
      where e.id = sesion_inscripciones.evento_id and e.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.event_members m
      join public.event_roles r on r.id = m.rol_id
      where m.evento_id = sesion_inscripciones.evento_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and (r.permissions ? 'ver_clientes' or r.permissions ? 'gestionar_clientes')
    )
  );

/* ── 4. El contador de inscritos, al día sin que nadie se acuerde ──
   `inscritos` en agenda_sessions se mantiene con trigger. Contar con un
   count(*) en cada lectura es correcto pero se paga en cada carga de la agenda
   pública; y actualizarlo a mano desde el código es lo que hace que un día no
   cuadre. Las canceladas no cuentan. */
create or replace function public.fn_sync_inscritos_sesion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  objetivo uuid;
begin
  objetivo := coalesce(new.session_id, old.session_id);
  update public.agenda_sessions s
     set inscritos = (
       select count(*) from public.sesion_inscripciones i
       where i.session_id = objetivo and i.estado <> 'cancelada'
     )
   where s.id = objetivo;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_inscritos_sesion on public.sesion_inscripciones;
create trigger trg_sync_inscritos_sesion
  after insert or update or delete on public.sesion_inscripciones
  for each row execute function public.fn_sync_inscritos_sesion();

/* Deja el contador cuadrado con lo que ya hubiera. */
update public.agenda_sessions s
   set inscritos = coalesce((
     select count(*) from public.sesion_inscripciones i
     where i.session_id = s.id and i.estado <> 'cancelada'
   ), 0);

/* ── 5. Resumen de participación ──────────────────────────────────────
   La pregunta que hay que poder responder de un tiro: cuánta gente entró al
   evento y cuánta pasó por cada sub-evento. */
create or replace view public.v_participacion_sesiones as
select
  s.evento_id,
  s.id            as session_id,
  s.titulo,
  s.inicio,
  s.cupo,
  s.inscritos,
  count(i.id) filter (where i.estado = 'asistio')                as asistentes,
  count(i.id) filter (where i.estado = 'inscrito')               as solo_inscritos,
  count(i.id) filter (where i.estado = 'cancelada')              as canceladas,
  count(i.id) filter (where i.ticket_id is null
                        and i.estado <> 'cancelada')             as sin_boleta
from public.agenda_sessions s
left join public.sesion_inscripciones i on i.session_id = s.id
group by s.evento_id, s.id, s.titulo, s.inicio, s.cupo, s.inscritos;
