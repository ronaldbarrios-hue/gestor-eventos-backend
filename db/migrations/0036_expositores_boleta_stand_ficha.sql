-- EXPOSITORES: una boleta tipo "Stand" genera automáticamente la ficha de
-- expositor (reutilizando networking_expositores). La empresa la edita luego.
-- YA APLICADA en producción (Supabase).

-- 1) Marca el tipo de boleta como Stand.
alter table public.ticket_types
  add column if not exists es_expositor boolean not null default false;

-- 2) networking_expositores pasa a ser la ficha editable del expositor.
alter table public.networking_expositores
  add column if not exists ticket_id uuid references public.tickets(id) on delete set null,
  add column if not exists tipo_persona text not null default 'empresa' check (tipo_persona in ('natural','empresa')),
  add column if not exists contacto_nombre text,
  add column if not exists contacto_email text,
  add column if not exists contacto_telefono text,
  add column if not exists sitio_web text,
  add column if not exists redes jsonb not null default '{}'::jsonb,
  add column if not exists categoria_negocio text,
  add column if not exists activo boolean not null default true,
  add column if not exists estado_ficha text not null default 'borrador' check (estado_ficha in ('borrador','completa')),
  add column if not exists orden integer not null default 0;

-- Vínculo 1:1 con la boleta-Stand (clave de idempotencia del trigger). UNIQUE
-- permite múltiples NULL (expositores creados a mano por el organizador).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'networking_expositores_ticket_id_key') then
    alter table public.networking_expositores
      add constraint networking_expositores_ticket_id_key unique (ticket_id);
  end if;
end $$;

create index if not exists idx_expositores_evento_activo on public.networking_expositores(evento_id, activo);

-- 3) Trigger: cubre los 4+ caminos a 'pagado' (webhook MP, reserva gratis,
-- PATCH manual, import) desde un solo lugar; idempotente; no pisa ediciones.
create or replace function public.fn_expositor_desde_boleta() returns trigger as $$
declare v_es boolean;
begin
  select es_expositor into v_es from public.ticket_types where id = NEW.ticket_type_id;
  if not coalesce(v_es, false) then return NEW; end if;

  if NEW.estado = 'pagado' then
    insert into public.networking_expositores
      (evento_id, ticket_id, nombre, contacto_email, tipo_persona, activo, estado_ficha)
    values
      (NEW.evento_id, NEW.id, coalesce(nullif(trim(NEW.guest_nombre), ''), 'Expositor'),
       NEW.guest_email, 'empresa', true, 'borrador')
    on conflict (ticket_id) do update set activo = true;
  elsif NEW.estado in ('cancelado','reembolsado','invalido') then
    update public.networking_expositores set activo = false where ticket_id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_expositor_desde_boleta on public.tickets;
create trigger trg_expositor_desde_boleta
  after insert or update of estado on public.tickets
  for each row execute function public.fn_expositor_desde_boleta();

comment on column public.ticket_types.es_expositor is 'El comprador de esta boleta es un expositor: genera ficha de stand automáticamente.';
comment on column public.networking_expositores.ticket_id is 'Boleta-Stand que generó esta ficha (NULL = creada a mano por el organizador).';
