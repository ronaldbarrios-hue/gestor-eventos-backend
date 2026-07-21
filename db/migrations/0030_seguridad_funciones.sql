-- Endurecimiento de seguridad (linter de Supabase).
--
-- CONTEXTO (verificado): el frontend NO hace llamadas .rpc(); el backend llama
-- canjear_recompensa, generar_recordatorios_inapp y find_pending_reminders con
-- la SERVICE KEY. Por eso quitar el acceso público no rompe nada.
--
-- Riesgo principal: canjear_recompensa(p_user, p_recompensa) es SECURITY DEFINER
-- y era ejecutable por `anon` vía /rest/v1/rpc → cualquiera podía canjear las
-- recompensas de CUALQUIER usuario pasando su uuid.
--
-- OJO: en PostgreSQL el EXECUTE se concede a PUBLIC por defecto. Revocar solo a
-- anon/authenticated NO surte efecto (siguen heredando de PUBLIC); hay que
-- revocar de PUBLIC y re-conceder a service_role.

revoke execute on function public.canjear_recompensa(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.find_pending_reminders(integer) from public, anon, authenticated;
revoke execute on function public.generar_recordatorios_inapp()   from public, anon, authenticated;
revoke execute on function public.handle_new_user()               from public, anon, authenticated;
revoke execute on function public.link_event_invitations()        from public, anon, authenticated;
revoke execute on function public.seed_chat_channels()            from public, anon, authenticated;
revoke execute on function public.seed_event_roles()              from public, anon, authenticated;
revoke execute on function public.seed_page_json_v2()             from public, anon, authenticated;
revoke execute on function public.sync_profile_from_auth_update() from public, anon, authenticated;

-- El backend (service key) sí debe poder ejecutarlas.
grant execute on function public.canjear_recompensa(uuid, uuid) to service_role;
grant execute on function public.find_pending_reminders(integer) to service_role;
grant execute on function public.generar_recordatorios_inapp()   to service_role;

-- search_path fijo en funciones SECURITY DEFINER.
alter function public.set_updated_at()      set search_path = public, pg_temp;
alter function public.set_actualizado_en()  set search_path = public, pg_temp;
alter function public.default_page_blocks() set search_path = public, pg_temp;
