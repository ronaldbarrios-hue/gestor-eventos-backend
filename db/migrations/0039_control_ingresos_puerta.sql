-- Control de ingresos por puerta: registra por qué acceso entró cada persona.
-- La CONFIG de puertas (nombre, tipos permitidos, staff) vive en
-- page_json.accesos; aquí solo se guarda, por ticket, qué puerta usó.
-- YA APLICADA en producción (Supabase).
alter table public.tickets
  add column if not exists acceso text;

comment on column public.tickets.acceso is 'Nombre de la puerta/acceso por la que se hizo el check-in (control de ingresos).';
