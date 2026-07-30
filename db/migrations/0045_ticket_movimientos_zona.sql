-- 0045 · Aforo por zonas: columna zona en movimientos. YA APLICADA. Idempotente.
alter table public.ticket_movimientos add column if not exists zona text;
create index if not exists ticket_movimientos_zona_idx on public.ticket_movimientos(evento_id, zona);
