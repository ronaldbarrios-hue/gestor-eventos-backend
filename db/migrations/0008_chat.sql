/* GESTEK — Chat interno por evento.

   Las tablas chat_channels y chat_messages ya existen (0001_init.sql).
   Esto agrega:
   - Trigger que siembra 4 canales default al crear evento
   - Backfill para eventos existentes
   - Habilita Realtime sobre chat_messages
*/

create or replace function public.seed_chat_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_channels (evento_id, nombre, tipo, created_by) values
    (new.id, 'General',   'general', new.owner_id),
    (new.id, 'Acceso',    'staff',   new.owner_id),
    (new.id, 'Logística', 'staff',   new.owner_id),
    (new.id, 'Atención',  'staff',   new.owner_id);
  return new;
end;
$$;

drop trigger if exists trg_seed_chat_channels on public.eventos;
create trigger trg_seed_chat_channels
  after insert on public.eventos
  for each row execute function public.seed_chat_channels();

/* Backfill */
do $$
declare e record;
begin
  for e in select id, owner_id from public.eventos where deleted_at is null loop
    if not exists (select 1 from public.chat_channels where evento_id = e.id) then
      insert into public.chat_channels (evento_id, nombre, tipo, created_by) values
        (e.id, 'General',   'general', e.owner_id),
        (e.id, 'Acceso',    'staff',   e.owner_id),
        (e.id, 'Logística', 'staff',   e.owner_id),
        (e.id, 'Atención',  'staff',   e.owner_id);
    end if;
  end loop;
end$$;

/* Habilitar Realtime sobre chat_messages (idempotente) */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end$$;
