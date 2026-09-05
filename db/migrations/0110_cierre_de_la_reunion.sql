-- 0110 · Qué pasó en la reunión, y qué negocio se espera de ella
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- Una rueda de negocios se organiza para poder contestar dos preguntas al
-- cerrar: **cuántas reuniones ocurrieron de verdad** y **cuánto negocio se
-- espera de ellas**. Hoy la plataforma no puede contestar ninguna de las dos:
-- agenda las citas y ahí se acaba.
--
-- Para una cámara de comercio eso no es un reporte bonito, es EL entregable:
-- es lo que se le presenta a la junta y a quien financia la rueda.
--
-- ── Por qué `resultado` y no un estado más ─────────────────────────────
--
-- `ESTADOS_CITA` ya admite 'realizada', y usarlo habría sido lo obvio. Es una
-- trampa: la disponibilidad se calcula con `estado in ('confirmada',
-- 'solicitada')`, así que una cita marcada 'realizada' dejaría su casilla
-- pintada como libre — y el índice único seguiría impidiendo reservarla. Es
-- exactamente la casilla muerta que costó arreglar esta mañana.
--
-- Son dos ejes distintos y se guardan aparte:
--
--   estado    → dónde está la cita en su ciclo (pedida, confirmada, cancelada)
--   resultado → qué pasó cuando llegó la hora (realizada, no asistió)
--
-- Una cita CANCELADA no tiene resultado: se canceló antes. Una cita sin
-- resultado no es «no ocurrió», es «nadie lo registró» — y esa diferencia es
-- justo la que un informe honesto tiene que enseñar.
--
-- ── Por qué el monto lleva su moneda ───────────────────────────────────
--
-- Guardar «5000000» sin más es una cifra que dentro de un año no se puede
-- interpretar, y en una rueda con visitantes de fuera puede no ser pesos. La
-- moneda se copia del evento al escribir: si el evento cambia de moneda
-- después, lo ya registrado no cambia de significado.

alter table public.networking_citas
  add column if not exists resultado          text,
  add column if not exists resultado_at       timestamptz,
  add column if not exists resultado_por      uuid,
  add column if not exists expectativa_monto  numeric(14,2),
  add column if not exists expectativa_moneda text,
  add column if not exists expectativa_plazo  text,
  add column if not exists hubo_acuerdo       boolean,
  add column if not exists resultado_nota     text;

-- Los dos valores que puede tomar, y nada más. Un `resultado` inventado no
-- fallaría: entraría en la base y quedaría fuera de todas las cuentas del
-- informe, que es la peor forma de perder una reunión.
alter table public.networking_citas
  drop constraint if exists networking_citas_resultado_ck;
alter table public.networking_citas
  add  constraint networking_citas_resultado_ck
  check (resultado is null or resultado in ('realizada', 'no_asistio'));

-- El plazo es una lista corta a propósito: sirve para agrupar en el informe, y
-- un campo libre acabaría con «3 meses», «tres meses» y «3m» en la misma
-- columna.
alter table public.networking_citas
  drop constraint if exists networking_citas_plazo_ck;
alter table public.networking_citas
  add  constraint networking_citas_plazo_ck
  check (expectativa_plazo is null
         or expectativa_plazo in ('inmediato', '3_meses', '6_meses', '12_meses'));

-- Un monto negativo no es una expectativa. El tope de arriba evita que un cero
-- de más convierta una cifra en el titular del informe.
alter table public.networking_citas
  drop constraint if exists networking_citas_monto_ck;
alter table public.networking_citas
  add  constraint networking_citas_monto_ck
  check (expectativa_monto is null
         or (expectativa_monto >= 0 and expectativa_monto <= 999999999999));

-- El informe agrupa por evento y resultado.
create index if not exists networking_citas_resultado_idx
  on public.networking_citas (evento_id, resultado)
  where resultado is not null;

comment on column public.networking_citas.resultado is
  'Qué pasó cuando llegó la hora: realizada | no_asistio. NULL = nadie lo registró, que no es lo mismo que no haber ocurrido.';
comment on column public.networking_citas.expectativa_monto is
  'Negocio que las partes esperan de esta reunión. Su moneda va en expectativa_moneda, copiada del evento al registrarla.';
comment on column public.networking_citas.resultado_nota is
  'Qué se acordó, en una línea. Distinta de `notas` (privada de quien asistió) y de `nota_gestor` (interna del equipo).';

-- Comprobación:
--   select column_name from information_schema.columns
--    where table_name = 'networking_citas'
--      and column_name in ('resultado','expectativa_monto','expectativa_plazo','hubo_acuerdo');
--   -- deben salir las cuatro.
--
-- Vuelta atrás (no se pierde nada que no sea de esta función):
--   alter table public.networking_citas
--     drop column if exists resultado, drop column if exists resultado_at,
--     drop column if exists resultado_por, drop column if exists expectativa_monto,
--     drop column if exists expectativa_moneda, drop column if exists expectativa_plazo,
--     drop column if exists hubo_acuerdo, drop column if exists resultado_nota;
