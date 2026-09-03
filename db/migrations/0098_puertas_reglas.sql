-- 0098 · Las reglas de la puerta se mudan con ella. (Frente Q · Q6, paso 2 de 2)
--
-- ── Dónde quedó la cosa ──────────────────────────────────────────────────
--
-- La 0096 movió **el sitio**: una puerta ya es una zona de tipo `ingreso`, con
-- el mismo id. Lo que no se movió fueron sus **reglas** —qué tipos de boleta
-- admite y qué staff la atiende—, que siguen en `page_json.accesos` porque es de
-- donde las lee el control de ingreso.
--
-- Así que hoy una puerta vive en dos sitios: su nombre y su posición en la
-- tabla, y sus reglas en un JSON. Mientras eso dure, cualquiera de los dos puede
-- quedarse atrás — y el que se quede atrás será el que decide quién entra.
--
-- ── Por qué `reglas` es un jsonb y no dos columnas ───────────────────────
--
-- Porque lo que una puerta comprueba va a crecer: hoy son tipos de boleta y
-- staff; mañana será un horario («esta puerta abre a las 8»), o una zona de
-- destino, o un tope de personas. Dos columnas ahora obligan a una migración por
-- cada regla nueva, y este proyecto ya tiene bastantes.
--
-- Lo que NO va aquí es nada que haya que consultar o cruzar: para eso están las
-- columnas. `reglas` es lo que la puerta se lee a sí misma al abrirse.
--
-- ── Expand, no contract ──────────────────────────────────────────────────
--
-- `page_json.accesos` **se queda intacto**. Esta migración sólo copia. El código
-- lee de la tabla y cae al JSON si la fila no tiene reglas, así que da igual el
-- orden entre desplegar y correr esto — que es exactamente lo que faltó con la
-- 0092.

alter table public.zonas
  add column if not exists reglas jsonb not null default '{}'::jsonb;

comment on column public.zonas.reglas is
  'Lo que una puerta comprueba al abrirse: tipos (ids de ticket_types admitidos), staff (ids de perfiles). Vacío = sin restricción.';

-- Copia lo que hay en `page_json.accesos` a la zona con ese mismo id.
--
-- Se hace por id y no por nombre a propósito: la 0096 conservó el id (`acc_…`)
-- justamente para que este paso fuera una igualdad y no una adivinanza.
do $$
declare
  v record;
  v_movidas integer := 0;
begin
  for v in
    select e.id as evento_id, a as acceso
      from public.eventos e,
           lateral jsonb_array_elements(e.page_json->'accesos') a
     where e.page_json ? 'accesos'
       and nullif(a->>'id', '') is not null
  loop
    update public.zonas z
       set reglas = jsonb_strip_nulls(jsonb_build_object(
             'tipos', v.acceso->'tipos',
             'staff', v.acceso->'staff',
             'zona_destino', v.acceso->'zona_id'
           ))
     where z.id = v.acceso->>'id'
       and z.evento_id = v.evento_id
       /* Si la fila ya tiene reglas, no se pisan: puede que alguien las haya
          editado ya desde el panel nuevo, y esta migración es idempotente. */
       and (z.reglas = '{}'::jsonb or z.reglas is null);

    if found then v_movidas := v_movidas + 1; end if;
  end loop;

  raise notice 'reglas copiadas a % puerta(s)', v_movidas;
end $$;

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select id, nombre, tipo, reglas from public.zonas where tipo = 'ingreso';
--
-- La puerta «entrada inicial» debe salir con sus `tipos` y su `staff`, los
-- mismos que tiene hoy en `page_json.accesos`.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   alter table public.zonas drop column if exists reglas;
--
-- Sin pérdida: el original sigue en `page_json.accesos`, que es de donde salió.
