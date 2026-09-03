-- 0095 · Un equipo de torneo no cabe en la tabla: que lo diga el organizador.
-- APLICADA en producción el 2026-09-03.
--        (Frente Q · Q2)
--
-- ── El problema, y por qué no se arregla añadiendo columnas ──────────────
--
-- `torneo_equipos` tiene `nombre`, `foto_url`, `posicion_bracket`,
-- `contacto_email`, `contacto_user_id` y `grupo`. Y nada más: ni jugadores, ni
-- roles dentro del equipo, ni rango, ni nickname, ni país. «Todo el flujo está
-- hecho para un torneo de fútbol», y es literal.
--
-- Añadir `dorsal` y `posicion` arreglaría el fútbol y dejaría fuera al de
-- esports, que pide nick, rango y servidor; y el de ajedrez, que pide ELO. Cada
-- disciplina tendría su columna y todas estarían vacías menos una.
--
-- ── Lo que se hace, que es apuntar algo que YA existe a otra tabla ───────
--
-- `event_form_fields` resuelve exactamente este problema desde hace tiempo para
-- el registro de asistentes: campos que define el organizador, con tipo,
-- opciones, ayuda, orden y condicionales (`visible_si`). Ya sabe colgarse de un
-- tipo de boleta (`ticket_type_id`) y de un sub-evento (`session_id`).
--
-- Le falta el tercer dueño: el torneo. Eso es esta migración.
--
-- **No hay mecanismo nuevo.** El editor de campos, el renderizado del
-- formulario, la validación y el guardado en `respuestas` son los mismos que
-- llevan tiempo funcionando con 47 campos en producción. Inventar un sistema de
-- campos propio para torneos sería mantener dos.

alter table public.event_form_fields
  add column if not exists torneo_id uuid references public.torneos(id) on delete cascade;

-- `on delete cascade` y no `set null`, al revés que en otras partes: un campo
-- «Rango en el ladder» sin su torneo no es un campo huérfano recuperable, es
-- basura que aparecería en el formulario general del evento.

create index if not exists idx_form_fields_torneo on public.event_form_fields(torneo_id, orden);

-- Un campo pertenece a UN sitio. Los tres dueños son excluyentes: un campo del
-- torneo no es también del formulario de una boleta. Sin esto, un campo con dos
-- dueños se pintaría dos veces y se guardaría una.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_form_fields_un_dueno_check') then
    alter table public.event_form_fields
      add constraint event_form_fields_un_dueno_check
      check ((ticket_type_id is not null)::int
           + (session_id     is not null)::int
           + (torneo_id      is not null)::int <= 1);
  end if;
end $$;

comment on column public.event_form_fields.torneo_id is
  'Campo propio de la inscripción a ESTE torneo (dorsal y posición en fútbol; nick, rango y servidor en esports).';

-- ── Dónde se guarda lo que se responde ───────────────────────────────────
--
-- En `respuestas`, igual que `tickets` y que `sesion_inscripciones`. Es el
-- mismo patrón en las tres tablas a propósito: el mismo editor escribe los
-- campos y el mismo código lee lo respondido.

alter table public.torneo_equipos
  add column if not exists respuestas jsonb not null default '{}'::jsonb;

comment on column public.torneo_equipos.respuestas is
  'Lo que el equipo contestó al formulario del torneo, por id de campo.';

-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   alter table public.event_form_fields
--     drop constraint if exists event_form_fields_un_dueno_check,
--     drop column if exists torneo_id;
--   alter table public.torneo_equipos drop column if exists respuestas;
--
-- Ojo: borrar `torneo_id` borra los campos que se hubieran definido, porque van
-- en esa misma fila. Las respuestas quedan en `respuestas` hasta que se quite
-- también esa columna.
