-- 0061 · La lista de espera deja de ser una libreta.
--
-- Hasta ahora `event_waitlist` guardaba gente, posiciones y estados, y no
-- disparaba nada: cuando se liberaba un cupo, el primero de la fila pasaba a
-- 'contacted' y como mucho recibía un push. Sin correo, sin enlace, y sin
-- forma de pasar al siguiente si no lo usaba. La plantilla `cupo_liberado`
-- llevaba escrita desde la 0052 sin que nadie la llamara.
--
-- Lo que faltaba en la tabla:
--
--   oferta_token     Cada oferta es de UNA persona. El enlace del correo lleva
--                    este token y es lo único que permite comprar el cupo
--                    liberado mientras la oferta esté viva.
--   oferta_expira    Cuándo caduca. Sin caducidad la fila se atasca en el
--                    primero que no abre el correo y nadie más avanza.
--   oferta_enviada_at Cuándo salió la oferta vigente. `notified_at` ya existía
--                    pero lo pisa cualquier aviso manual del organizador.
--   ofertas_recibidas Cuántas veces le ha tocado. Sirve para no castigar a
--                    quien perdió una por estar durmiendo y para poder mirar
--                    después si el plazo elegido es razonable.
--
-- El estado 'expired' se suma a los cuatro que ya había (active, contacted,
-- purchased, cancelled). No hay check constraint sobre la columna, así que no
-- hace falta tocar nada más: se documenta y ya. 'cancelled' NO vale para esto
-- —quien deja pasar una oferta no se ha dado de baja— y confundirlos haría
-- imposible saber cuánta gente sigue esperando de verdad.

alter table public.event_waitlist
  add column if not exists oferta_token      text,
  add column if not exists oferta_expira     timestamptz,
  add column if not exists oferta_enviada_at timestamptz,
  add column if not exists ofertas_recibidas integer not null default 0;

/* Único, pero sólo entre los tokens vivos: las filas sin oferta son la mayoría
   y un unique normal las haría chocar entre sí por el NULL en algunos motores.
   Parcial además es más pequeño. */
create unique index if not exists waitlist_oferta_token_uidx
  on public.event_waitlist (oferta_token)
  where oferta_token is not null;

/* Lo que consulta el barrido cada quince minutos: "dame las ofertas vencidas".
   Sin este índice recorrería la tabla entera cada vez. */
create index if not exists waitlist_oferta_expira_idx
  on public.event_waitlist (oferta_expira)
  where oferta_expira is not null;

comment on column public.event_waitlist.estado is
  'active | contacted | purchased | cancelled | expired. '
  '"expired" = se le ofreció el cupo y se le pasó el plazo; sigue en la lista. '
  '"cancelled" = se dio de baja por su cuenta.';
comment on column public.event_waitlist.oferta_token is
  'Llave del enlace del correo cupo_liberado. Sólo con ella se puede tomar el cupo reservado.';
comment on column public.event_waitlist.oferta_expira is
  'Hasta cuándo vale la oferta. Pasado esto, el barrido la marca expired y ofrece al siguiente.';
