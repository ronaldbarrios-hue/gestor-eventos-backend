/* GESTEK — Chat: subgrupos + permisos consistentes en roles default. */

/* 1. Subgrupos en chat_channels */
alter table public.chat_channels
  add column if not exists parent_id uuid references public.chat_channels(id) on delete cascade,
  add column if not exists orden integer not null default 0;

create index if not exists chat_channels_parent_idx on public.chat_channels(parent_id);

/* 2. Actualizar permisos de los roles default existentes para que usen las
   keys del nuevo catálogo. Los roles existentes pueden tener permisos viejos. */
update public.event_roles set permissions = '["editar_evento","editar_pagina_publica","ver_clientes","crear_canales"]'::jsonb
  where is_system and nombre = 'Editor';
update public.event_roles set permissions = '["editar_evento","invitar_staff","ver_clientes","crear_canales","gestionar_tickets","ver_pagos"]'::jsonb
  where is_system and nombre = 'Coordinador';
update public.event_roles set permissions = '["checkin","ver_clientes"]'::jsonb
  where is_system and nombre = 'Staff · Acceso';
update public.event_roles set permissions = '["ver_clientes"]'::jsonb
  where is_system and nombre = 'Staff · Logística';
update public.event_roles set permissions = '["ver_clientes","gestionar_clientes"]'::jsonb
  where is_system and nombre = 'Staff · Atención';
update public.event_roles set permissions = '["vip_zone","ver_clientes"]'::jsonb
  where is_system and nombre = 'VIP host';

/* 3. Actualizar el trigger seed_event_roles para futuros eventos */
create or replace function public.seed_event_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_roles (evento_id, nombre, descripcion, permissions, is_system, orden) values
    (new.id, 'Editor',           'Edita información, agenda y página pública',
       '["editar_evento","editar_pagina_publica","ver_clientes","crear_canales"]'::jsonb,                          true, 1),
    (new.id, 'Coordinador',      'Coordina al staff y al evento completo',
       '["editar_evento","invitar_staff","ver_clientes","crear_canales","gestionar_tickets","ver_pagos"]'::jsonb,  true, 2),
    (new.id, 'Staff · Acceso',   'Controla entrada y hace check-in con QR',
       '["checkin","ver_clientes"]'::jsonb,                                                                       true, 3),
    (new.id, 'Staff · Logística','Montaje, técnica y escenario',
       '["ver_clientes"]'::jsonb,                                                                                 true, 4),
    (new.id, 'Staff · Atención', 'Atiende asistentes durante el evento',
       '["ver_clientes","gestionar_clientes"]'::jsonb,                                                            true, 5),
    (new.id, 'VIP host',         'Anfitrión de zona VIP',
       '["vip_zone","ver_clientes"]'::jsonb,                                                                      true, 6);
  return new;
end;
$$;
