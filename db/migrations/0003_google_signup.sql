/* GESTEK — Soporte completo para signup con Google.

   Problemas que arregla:
   1. El trigger handle_new_user solo leía 'nombre' y 'foto' del metadata,
      pero Google envía 'full_name', 'name', 'picture', 'avatar_url'.
   2. Los usuarios ya creados con Google tienen profile.nombre = email
      porque el trigger no encontró 'nombre' en su metadata.

   Esta migration:
   - Reescribe el trigger para leer también los campos de Google.
   - Hace un sync retroactivo de los profiles existentes.
*/

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (
    id, email, nombre, rol,
    telefono, ciudad, empresa, ocupacion, avatar_url
  )
  values (
    new.id,
    new.email,
    coalesce(
      meta->>'nombre',
      meta->>'full_name',
      meta->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(meta->>'rol', 'organizador'),
    meta->>'telefono',
    meta->>'ciudad',
    meta->>'empresa',
    meta->>'ocupacion',
    coalesce(
      meta->>'foto',
      meta->>'avatar_url',
      meta->>'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

/* Sync retroactivo: si profile.nombre == email (signal de que el trigger
   viejo no encontró nombre) o avatar_url es null, intenta rellenar desde
   el metadata. */
update public.profiles p
set
  nombre = coalesce(
    nullif(p.nombre, p.email),
    u.raw_user_meta_data->>'nombre',
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(p.email, '@', 1),
    p.nombre
  ),
  avatar_url = coalesce(
    p.avatar_url,
    u.raw_user_meta_data->>'foto',
    u.raw_user_meta_data->>'avatar_url',
    u.raw_user_meta_data->>'picture'
  )
from auth.users u
where p.id = u.id;
