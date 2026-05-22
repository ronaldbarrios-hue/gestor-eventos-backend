/* GESTEK — Reset de tablas legacy.
   Corre este script ANTES de 0001_init.sql.

   Borra las tablas del schema viejo (migration_v2_completa.sql) que ya no se
   usan. NO toca auth.users — los usuarios registrados se conservan.

   Si nunca corriste el schema viejo, este script no rompe nada (todo es
   "if exists").
*/

drop table if exists public.push_subscriptions cascade;
drop table if exists public.notificaciones     cascade;
drop table if exists public.asistentes         cascade;
drop table if exists public.eventos            cascade;
drop table if exists public.categorias         cascade;
drop table if exists public.usuarios           cascade;
drop table if exists public.organizaciones     cascade;

/* Por si quedó alguna función/trigger huérfano del schema viejo */
drop function if exists public.handle_new_user() cascade;
