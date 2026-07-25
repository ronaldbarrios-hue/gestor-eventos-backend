-- Formulario por tipo de entrada: un campo puede aplicar a TODAS las boletas
-- (ticket_type_id NULL) o solo a un tipo concreto (VIP pide datos que General no).
-- YA APLICADA en producción (Supabase).
alter table public.event_form_fields
  add column if not exists ticket_type_id uuid references public.ticket_types(id) on delete cascade;

create index if not exists idx_form_fields_ticket_type on public.event_form_fields(ticket_type_id);

comment on column public.event_form_fields.ticket_type_id is 'NULL = aplica a todas las boletas; si no, solo a ese tipo de entrada.';
