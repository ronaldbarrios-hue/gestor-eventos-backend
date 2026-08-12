-- 0059 · Términos propios del evento + formulario por sub-evento.
-- YA APLICADA. Idempotente.
--
-- ── Parte 1: lo legal del evento ──
-- El checkout ya tenía terminos_activo / terminos_texto / terminos_url en
-- page_json, con tres problemas:
--
--   · Era OPCIONAL y venía apagado. Un formulario que recoge nombre, documento,
--     teléfono y —con la ficha de caracterización— etnia, discapacidad y
--     condición de víctima, no puede recogerlos sin decir bajo qué condiciones.
--   · Solo aceptaba una URL EXTERNA. Si el organizador no tiene web, no hay nada
--     que enlazar, así que en la práctica quedaba vacío.
--   · No había privacidad por evento, solo términos.
--
-- Aquí el organizador puede ESCRIBIR sus términos y su privacidad dentro de
-- GESTEK, y se sirven en una página pública del evento. Así el enlace existe
-- siempre. Si prefiere apuntar a su propia web, también: la URL gana sobre el
-- texto.
--
-- Son de GESTEK y del evento por separado, a propósito: GESTEK responde por la
-- plataforma y el organizador por su evento. Mezclarlos en un solo documento
-- deja sin saber a quién reclamar.
--
-- ── Parte 2: el formulario del sub-evento ──
-- Hoy un sub-evento que pide inscripción hereda el formulario del evento, así
-- que a alguien que ya dio todos sus datos al comprar la entrada se le vuelven a
-- pedir para apuntarse a un taller. El caso normal es NO pedir nada: la boleta ya
-- identificó a la persona.
--
-- Pero a veces el organizador sí quiere preguntar algo corto y propio de esa
-- actividad — por qué le interesa, si querría más de esto. Para eso
-- event_form_fields gana session_id: las mismas preguntas, el mismo editor y la
-- misma validación, colgadas de un sub-evento en vez del evento.

/* ── 1. Lo legal ── */
create table if not exists public.evento_legal (
  evento_id        uuid primary key references public.eventos(id) on delete cascade,
  /* Texto escrito en GESTEK. Se sirve en /explorar/:slug/legal. */
  terminos_texto   text,
  privacidad_texto text,
  /* Si el organizador tiene sus documentos en su propia web, la URL manda. */
  terminos_url     text,
  privacidad_url   text,
  /* Nombre del responsable del tratamiento de datos. Con la ficha de
     caracterización aplicada esto deja de ser un detalle. */
  responsable      text,
  contacto_datos   text,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);

alter table public.evento_legal enable row level security;

/* Lectura pública: son documentos legales, están hechos para leerse. La
   escritura la hace el backend con la service key. */
drop policy if exists evento_legal_lectura on public.evento_legal;
create policy evento_legal_lectura on public.evento_legal
  for select using (true);

drop policy if exists evento_legal_dueno on public.evento_legal;
create policy evento_legal_dueno on public.evento_legal
  for all using (
    exists (
      select 1 from public.eventos e
      where e.id = evento_legal.evento_id and e.owner_id = auth.uid()
    )
  );

/* ── 2. El formulario del sub-evento ── */
alter table public.event_form_fields
  add column if not exists session_id uuid references public.agenda_sessions(id) on delete cascade;

create index if not exists event_form_fields_session_idx
  on public.event_form_fields(session_id) where session_id is not null;

comment on column public.event_form_fields.session_id is
  'Si no es null, la pregunta es de ESE sub-evento y no del formulario del evento.';

/* Cómo se comporta la inscripción de cada sub-evento:
     ninguno → no se pide nada (la boleta ya identificó a la persona)
     propio  → las preguntas con session_id de este sub-evento
     evento  → el formulario general del evento (lo de antes) */
alter table public.agenda_sessions
  add column if not exists formulario_modo text not null default 'ninguno';

comment on column public.agenda_sessions.formulario_modo is
  'ninguno | propio | evento. Qué preguntas se piden al inscribirse a este sub-evento.';

/* Los sub-eventos que ya piden inscripción se quedan como estaban —con el
   formulario del evento— para no cambiarle el comportamiento a nadie sin avisar.
   Los nuevos nacen en 'ninguno', que es el caso normal. */
update public.agenda_sessions
   set formulario_modo = 'evento'
 where requiere_inscripcion = true
   and formulario_modo = 'ninguno';
