/* GESTEK — Pago manual / simple por evento.
   El organizador pega su llave/alias MP y/o sube imagen de QR. El asistente paga
   off-platform y el organizador verifica manualmente desde el panel.
   No reemplaza la integración MP completa (vía profiles.mp_access_token); coexiste. */

alter table public.eventos
  add column if not exists pago_llave         text,
  add column if not exists pago_qr_url        text,
  add column if not exists pago_instrucciones text;
