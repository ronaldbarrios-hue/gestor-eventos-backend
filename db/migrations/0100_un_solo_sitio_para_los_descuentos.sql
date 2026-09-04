-- 0100 · Los descuentos del agente se mudan a donde se cobran.
--
-- ── El fallo, y es el mismo de la 0099 pero por la otra puerta ───────────
--
-- Hay DOS tablas de descuentos y nunca se conocieron:
--
--   · `promociones`    — la que llena el panel (pestaña Promociones) y la que
--                        lee el cobro desde la 0099. Funciona.
--   · `discount_codes` — la que llena **el agente**. Sus tres herramientas
--                        (`crear_codigo_descuento`, `listar_…`,
--                        `cambiar_estado_…`) escriben aquí, y **nadie aplica
--                        nunca lo que hay dentro**.
--
-- Así que hoy: le pides a Gestbot «crea el código FESTECH20 del 20 %», te
-- contesta que está creado —y lo está, en una tabla— y quien compra escribe
-- FESTECH20 y le dicen que no existe. La plataforma se contradice a sí misma
-- según por dónde entres.
--
-- En producción hay **2 filas** en `discount_codes`: dos códigos que alguien
-- creó por el chat y que no descuentan nada.
--
-- ── Por qué se queda `promociones` y no la otra ─────────────────────────
--
-- Porque `discount_codes` es un subconjunto estricto: todo lo que sabe decir,
-- `promociones` también, y además tiene `descripcion`, `ticket_id` (para atarlo
-- a un tipo de boleta), `min_cantidad` y `vigente_desde`. Migrar en el otro
-- sentido perdería columnas.
--
--   tipo       percent | fixed   →  porcentaje | fijo
--   max_usos                     →  limite_usos
--   expira_at                    →  vigente_hasta
--
-- ── Expand, no contract ─────────────────────────────────────────────────
--
-- `discount_codes` **no se borra aquí**. Se copia lo que tenga y la tabla se
-- queda: si el despliegue del código va por detrás —que es lo de siempre— el
-- agente viejo sigue escribiendo en ella sin reventar. Se tira en una
-- migración posterior, cuando lleve semanas vacía de novedades.

insert into public.promociones (evento_id, codigo, tipo, valor, limite_usos, usos, vigente_hasta, activo, descripcion)
select d.evento_id,
       upper(trim(d.codigo)),
       case d.tipo when 'fixed' then 'fijo' else 'porcentaje' end,
       d.valor,
       d.max_usos,
       coalesce(d.usos, 0),
       d.expira_at,
       coalesce(d.activo, true),
       'Creado desde el asistente'
  from public.discount_codes d
 where not exists (
   /* `promociones` tiene unique (evento_id, codigo): si el mismo código ya se
      creó desde el panel, el del panel manda — es el que ya estaba cobrando. */
   select 1 from public.promociones p
    where p.evento_id = d.evento_id
      and p.codigo = upper(trim(d.codigo))
 );

comment on table public.discount_codes is
  'OBSOLETA desde la 0100. Los descuentos viven en `promociones`, que es la que lee el cobro. Esta tabla se conserva sólo mientras el despliegue del agente pueda ir por detrás; no escribir aquí.';

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select codigo, tipo, valor, limite_usos, vigente_hasta, descripcion
--     from public.promociones order by created_at desc;
--
-- Los códigos que estaban en `discount_codes` tienen que salir aquí, con
-- `porcentaje`/`fijo` en vez de `percent`/`fixed`.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   delete from public.promociones where descripcion = 'Creado desde el asistente';
--
-- Sin pérdida: los originales siguen en `discount_codes`, que no se toca.
