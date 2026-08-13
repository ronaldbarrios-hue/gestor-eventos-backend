-- 0069 — Constancia de aceptación de los términos del evento
--
-- El formulario de inscripción pide documento, teléfono y —con la ficha de
-- caracterización— etnia, discapacidad o condición de víctima. Enlazar los
-- términos no basta: si alguien reclama, hay que poder decir QUÉ aceptó y
-- CUÁNDO, y hoy no queda rastro de ninguna de las dos cosas.
--
-- Decisión de diseño: NO se guarda una copia del texto por inscripción. Con
-- 7.000 asistentes serían 7.000 copias del mismo documento. Se guarda una
-- huella (`version`) del documento vigente, y en la inscripción esa huella
-- más la fecha. Si el organizador edita sus términos después, la huella
-- cambia y las aceptaciones viejas siguen apuntando a la versión que de
-- verdad se aceptó.
--
-- Se usa `md5` a propósito, no `digest` de pgcrypto: md5 es del núcleo de
-- Postgres y no depende de en qué esquema esté instalada la extensión. Aquí
-- no es una función de seguridad, sólo distingue versiones de un texto.

begin;

-- ── 1 · Huella del documento legal vigente ──────────────────────────────

alter table public.evento_legal
  add column if not exists version text;

create or replace function public.evento_legal_version()
returns trigger
language plpgsql
as $$
begin
  new.version := md5(
    coalesce(new.terminos_texto, '')    || '|' ||
    coalesce(new.terminos_url, '')      || '|' ||
    coalesce(new.privacidad_texto, '')  || '|' ||
    coalesce(new.privacidad_url, '')
  );
  return new;
end;
$$;

drop trigger if exists trg_evento_legal_version on public.evento_legal;
create trigger trg_evento_legal_version
  before insert or update on public.evento_legal
  for each row execute function public.evento_legal_version();

-- Rellena la huella de lo que ya existe. El update dispara el trigger.
update public.evento_legal set updated_at = updated_at where version is null;

-- ── 2 · La constancia en cada inscripción ───────────────────────────────
--
-- Las dos puertas por donde entra gente: la boleta del evento y la
-- inscripción a un sub-evento. Las dos piden datos, las dos necesitan rastro.

alter table public.tickets
  add column if not exists legal_aceptado_at timestamptz,
  add column if not exists legal_version     text;

alter table public.sesion_inscripciones
  add column if not exists legal_aceptado_at timestamptz,
  add column if not exists legal_version     text;

comment on column public.tickets.legal_aceptado_at is
  'Cuándo aceptó los términos DEL EVENTO. Null = se emitió antes de la 0069, o el evento no tenía documentos propios.';
comment on column public.tickets.legal_version is
  'Huella (evento_legal.version) del documento que estaba vigente al aceptar.';

-- Para responder «quién aceptó qué versión» sin recorrer la tabla entera.
create index if not exists idx_tickets_legal_version
  on public.tickets (evento_id, legal_version)
  where legal_version is not null;

commit;

-- ── Nota para quien lo aplique ──────────────────────────────────────────
--
-- Esta migración es aditiva: todas las columnas son nullable y ningún camino
-- existente las exige. El backend anterior sigue funcionando sin tocarlas, y
-- el nuevo las rellena sólo cuando el evento tiene documentos propios.
--
-- Lo que NO hace, a propósito: marcar retroactivamente como aceptado nada de
-- lo ya emitido. Una constancia inventada es peor que ninguna — si mañana hay
-- un reclamo sobre una boleta anterior a esto, la respuesta honesta es «no
-- teníamos registro», no una fecha fabricada por un UPDATE.
