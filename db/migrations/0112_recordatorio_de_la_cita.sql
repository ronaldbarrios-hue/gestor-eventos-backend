-- 0112 · Avisar de una cita antes de que empiece
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- En una rueda, la reunión a la que nadie se presenta es el peor resultado
-- posible: la mesa esperó, la casilla figuraba ocupada —así que nadie más pudo
-- pedirla— y no salió nada de ella. Desde la 0110 eso se mide («no asistió»);
-- lo que faltaba era la única cosa que mueve ese número: avisar antes.
--
-- Hoy se manda un correo al reservar y otro al confirmar, con el archivo de
-- calendario adjunto. Pero el correo de hace tres semanas no le recuerda a
-- nadie que su reunión es a las 10:15 en la mesa 12.
--
-- ── Una columna, no una tabla ──────────────────────────────────────────
--
-- `recordatorio_at` marca que ya se avisó de ESTA cita. Es el mismo patrón que
-- usan los avisos del evento (`eventos.recordatorio_24h_at`), y por la misma
-- razón: el cron corre cada quince minutos y sin la marca mandaría el mismo
-- recordatorio en cada pasada. Una persona con quince citas recibiría sesenta
-- correos por hora, y a partir del segundo dejaría de leerlos — incluidos los
-- que sí importan.
--
-- NULL = todavía no se ha avisado. Las citas que ya existen nacen así, que es
-- lo correcto: si alguna cae dentro de la ventana, se avisará una vez.

alter table public.networking_citas
  add column if not exists recordatorio_at timestamptz;

-- El cron busca las citas sin avisar cuyo horario cae en la ventana. El índice
-- es parcial porque sólo interesan las que faltan: en cuanto se avisa, la fila
-- sale del índice y no se vuelve a mirar.
create index if not exists networking_citas_sin_recordatorio_idx
  on public.networking_citas (evento_id)
  where recordatorio_at is null;

comment on column public.networking_citas.recordatorio_at is
  'Cuándo se avisó de esta cita. NULL = no se ha avisado. Impide que el cron, que corre cada 15 min, repita el aviso en cada pasada.';

-- Comprobación:
--   select column_name from information_schema.columns
--    where table_name = 'networking_citas' and column_name = 'recordatorio_at';
--
-- Vuelta atrás:
--   drop index if exists networking_citas_sin_recordatorio_idx;
--   alter table public.networking_citas drop column if exists recordatorio_at;
