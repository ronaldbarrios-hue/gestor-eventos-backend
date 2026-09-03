-- 0094 · Una puerta es una zona. (Frente Q · Q6)
-- APLICADA en producción el 2026-09-03.
--
-- ⚠️ ORDEN: va DESPUÉS de la 0092. La 0092 quita las zonas de `page_json`, y
--    esta migración da por hecho que la tabla `zonas` es la fuente. Correrla
--    antes no rompe nada —sólo añade una columna vacía— pero la mitad que
--    importa, mover las puertas, se quedaría a medias: mientras el código lea
--    el JSON, una puerta convertida en zona se ve dos veces.
--
-- ── Por qué ──────────────────────────────────────────────────────────────
--
-- Las puertas viven en `page_json.accesos` y las zonas en la tabla `zonas`.
-- Son la misma cosa —sitios del recinto— y en la reagrupación del menú ya
-- quedaron juntas bajo «Zonas del evento» porque nadie supo explicar en qué se
-- diferencian. Esto es el paso siguiente: que también sean lo mismo en el
-- modelo, y no sólo vecinas en una lista.
--
-- Y hay un tercer tipo que hoy no existe en ninguna parte: **la zona de
-- evacuación**. Un recinto de 7.000 personas tiene salidas de emergencia, y
-- ahora mismo no hay dónde declararlas. Eso no es una función que falte, es una
-- casilla de un plan de contingencia que no se puede rellenar.
--
-- ── Qué hace, y qué NO ───────────────────────────────────────────────────
--
-- Añade `zonas.tipo` con cuatro valores. **No mueve las puertas todavía**: eso
-- es el paso de datos, y va aparte porque una puerta trae consigo su conteo de
-- ingresos (`ticket_movimientos.zona_id`) y hay que mirar cada evento. Esta
-- migración sólo abre el sitio donde caben.
--
-- El valor por defecto es 'evento': las 7 zonas que existen hoy son zonas de
-- evento, y ninguna cambia de significado al correr esto.

alter table public.zonas
  add column if not exists tipo text not null default 'evento';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'zonas_tipo_check') then
    alter table public.zonas
      add constraint zonas_tipo_check check (tipo in ('evento','ingreso','evacuacion','otra'));
  end if;
end $$;

comment on column public.zonas.tipo is
  'evento (donde ocurre algo) | ingreso (puerta) | evacuacion (salida de emergencia) | otra.';

-- Buscar «las puertas de este evento» es la consulta que hará el control de
-- acceso, y va a correr con el evento en marcha.
create index if not exists idx_zonas_evento_tipo on public.zonas(evento_id, tipo);

-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   alter table public.zonas drop column if exists tipo;
