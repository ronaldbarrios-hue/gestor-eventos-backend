-- 0052 · Plantillas de correo del evento y registro de envíos. SIN APLICAR. Idempotente.
--
-- Las plantillas vivían dentro de eventos.page_json, en la clave `emails`. Ese
-- campo lo escriben también la marca, las páginas del editor y el navbar, cada
-- uno partiendo de su propia copia del evento en memoria — así fue como la
-- marca se borraba sola. Guardar ahí las plantillas era heredar el mismo
-- problema: editar un correo podía pisar la marca y al contrario.
--
-- Aquí salen a su propia tabla, una fila por evento y tipo.
--
-- `evento_email_envios` es el registro de lo que se mandó. Hoy los envíos
-- fallan en silencio cuando no hay proveedor configurado, y no queda rastro de
-- si un asistente recibió o no su boleta.
--
-- El backfill copia lo que ya hubiera en page_json.emails. NO borra la clave:
-- lib/emailPlantillas.js la sigue leyendo como respaldo, así que aplicar esta
-- migración no puede perder nada de lo ya escrito.

create table if not exists public.evento_email_plantillas (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  /* Los ids de TIPOS en lib/emailPlantillas.js. Sin FK ni check para que
     añadir un tipo nuevo no necesite migración. */
  tipo        text not null,
  asunto      text,
  encabezado  text,
  cuerpo      text,
  boton_texto text,
  boton_url   text,
  imagen      text,
  footer      text,
  /* Un automático se puede apagar sin borrar lo escrito. */
  activo      boolean not null default true,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (evento_id, tipo)
);

create index if not exists evento_email_plantillas_evento_idx
  on public.evento_email_plantillas(evento_id);

create table if not exists public.evento_email_envios (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references public.eventos(id) on delete cascade,
  tipo         text not null,
  destinatario text not null,
  asunto       text,
  ok           boolean not null default false,
  /* Por qué no salió: no_provider, sin_destinatario, el error del SMTP… */
  motivo       text,
  created_at   timestamptz not null default now()
);

create index if not exists evento_email_envios_evento_idx
  on public.evento_email_envios(evento_id, created_at desc);
create index if not exists evento_email_envios_fallidos_idx
  on public.evento_email_envios(evento_id) where ok = false;

/* ── RLS ──────────────────────────────────────────────────────────────
   El backend escribe con la service key y salta estas políticas; existen para
   que nada quede legible por accidente desde el cliente. Las plantillas las ve
   el dueño o quien pueda editar la página pública. Los envíos, solo el dueño:
   son direcciones de correo de terceros. */
alter table public.evento_email_plantillas enable row level security;
alter table public.evento_email_envios     enable row level security;

drop policy if exists evento_email_plantillas_rw on public.evento_email_plantillas;
create policy evento_email_plantillas_rw on public.evento_email_plantillas
  for all using (
    exists (
      select 1 from public.eventos e
      where e.id = evento_email_plantillas.evento_id and e.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.event_members m
      join public.event_roles r on r.id = m.rol_id
      where m.evento_id = evento_email_plantillas.evento_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and r.permissions ? 'editar_pagina_publica'
    )
  );

drop policy if exists evento_email_envios_owner on public.evento_email_envios;
create policy evento_email_envios_owner on public.evento_email_envios
  for select using (
    exists (
      select 1 from public.eventos e
      where e.id = evento_email_envios.evento_id and e.owner_id = auth.uid()
    )
  );

/* updated_at al día, para saber cuándo se tocó una plantilla. */
create or replace function public.fn_touch_email_plantilla()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_email_plantilla on public.evento_email_plantillas;
create trigger trg_touch_email_plantilla
  before update on public.evento_email_plantillas
  for each row execute function public.fn_touch_email_plantilla();

/* ── Backfill desde page_json.emails ──────────────────────────────────
   Solo se copian las claves cuyo valor es un objeto JSON. `on conflict do
   nothing` hace que reaplicar la migración no pise lo que el organizador haya
   editado después. */
insert into public.evento_email_plantillas
  (evento_id, tipo, asunto, encabezado, cuerpo, boton_texto, boton_url, imagen, footer)
select
  e.id,
  t.key,
  nullif(t.value->>'asunto', ''),
  nullif(t.value->>'encabezado', ''),
  nullif(t.value->>'cuerpo', ''),
  nullif(t.value->>'boton_texto', ''),
  nullif(t.value->>'boton_url', ''),
  nullif(t.value->>'imagen', ''),
  nullif(t.value->>'footer', '')
from public.eventos e
cross join lateral jsonb_each(coalesce(e.page_json->'emails', '{}'::jsonb)) as t(key, value)
where e.deleted_at is null
  and jsonb_typeof(coalesce(e.page_json->'emails', '{}'::jsonb)) = 'object'
  and jsonb_typeof(t.value) = 'object'
on conflict (evento_id, tipo) do nothing;
