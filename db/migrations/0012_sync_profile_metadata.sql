/* GESTEK — Sincroniza profiles.avatar_url y profiles.nombre cuando el
   usuario actualiza su user_metadata vía Supabase Auth.

   Sin esto, cuando el usuario sube una foto nueva via Settings, el
   user_metadata se actualiza pero el avatar_url del profile queda viejo —
   por eso los avatares no aparecen en chat/equipo/clientes. */

create or replace function public.sync_profile_from_auth_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  old_meta jsonb := coalesce(old.raw_user_meta_data, '{}'::jsonb);
begin
  if new_meta is distinct from old_meta then
    update public.profiles set
      nombre = coalesce(
        new_meta->>'nombre',
        new_meta->>'full_name',
        new_meta->>'name',
        profiles.nombre
      ),
      avatar_url = coalesce(
        new_meta->>'foto',
        new_meta->>'avatar_url',
        new_meta->>'picture',
        profiles.avatar_url
      ),
      telefono  = coalesce(new_meta->>'telefono',  profiles.telefono),
      empresa   = coalesce(new_meta->>'empresa',   profiles.empresa),
      ocupacion = coalesce(new_meta->>'ocupacion', profiles.ocupacion),
      ciudad    = coalesce(new_meta->>'ciudad',    profiles.ciudad),
      updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function public.sync_profile_from_auth_update();

/* Backfill: sincroniza avatares y nombres desde el metadata actual */
update public.profiles p
set
  nombre = coalesce(
    u.raw_user_meta_data->>'nombre',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    p.nombre
  ),
  avatar_url = coalesce(
    u.raw_user_meta_data->>'foto',
    u.raw_user_meta_data->>'avatar_url',
    u.raw_user_meta_data->>'picture',
    p.avatar_url
  )
from auth.users u
where p.id = u.id;
