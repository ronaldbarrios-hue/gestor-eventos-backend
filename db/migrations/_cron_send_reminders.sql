-- GESTEK — Programar el Edge Function send-reminders cada hora (pg_cron).
-- Reemplaza <TU_PROJECT_REF> y <TU_ANON_KEY> y pega TODO en Supabase → SQL Editor.
-- Requisito previo: haber desplegado la función:
--   supabase functions deploy send-reminders --no-verify-jwt
-- y cargado sus secrets (RESEND_API_KEY, RESEND_FROM, PUBLIC_FRONTEND_URL).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Evita duplicar el job si ya existía
select cron.unschedule('send-reminders-hourly')
where exists (select 1 from cron.job where jobname = 'send-reminders-hourly');

select cron.schedule(
  'send-reminders-hourly',
  '5 * * * *',                              -- cada hora en el minuto :05
  $$
  select net.http_post(
    url := 'https://<TU_PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <TU_ANON_KEY>',
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verificar:  select jobname, schedule, active from cron.job;
-- Quitar:     select cron.unschedule('send-reminders-hourly');
