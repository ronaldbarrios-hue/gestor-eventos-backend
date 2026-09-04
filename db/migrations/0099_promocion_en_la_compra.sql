-- 0099 · Que el código de descuento llegue al cobro.
--
-- ── Qué estaba roto ──────────────────────────────────────────────────────
--
-- La tabla `promociones` existe desde la 0029 y el panel la usa: se crean
-- códigos, se activan, se desactivan. Lo que no existía era el otro extremo.
-- El cobro salía siempre de `early_bird_precio ?? precio`, y la ruta pública
-- `/promocion/validar` —la que dice si un código sirve— no la llamaba **ni un
-- solo archivo** del frontend.
--
-- Resultado: el organizador anuncia «FESTECH20» y la plataforma cobra el precio
-- entero. La promesa se hace y no se cumple.
--
-- Esta migración pone las dos cosas que faltaban en la base:
--
--   1. **Dónde queda escrito** qué código se usó en cada compra. Sin esto no se
--      puede contestar «¿cuánto nos costó la promo?», que es la única pregunta
--      que se hace después.
--   2. **Cómo se cuenta un uso** sin que dos compras a la vez se pisen.
--
-- Expand, no contract: sólo se añaden columnas con default y una función. El
-- código que hay hoy sigue funcionando igual si esto no se ha corrido — lo que
-- pasa es que no descuenta, que es exactamente lo de ahora.

-- ── 1 · Qué promoción se aplicó ──────────────────────────────────────────
--
-- En las dos tablas, y no es duplicar:
--
--  · `tickets.promocion_id` es el hecho: esta boleta se vendió con este código.
--    Sobrevive aunque la pasarela cambie y es lo que se cruza para el informe.
--  · `payment_transactions.promocion_id` es el intento: alguien abrió el
--    checkout con ese código. Los que no acaban en pago son justo los que dicen
--    si un código atrae o no.
--
-- `on delete set null`: borrar una promoción vieja no puede llevarse por
-- delante la boleta que se vendió con ella.

alter table public.tickets
  add column if not exists promocion_id uuid references public.promociones(id) on delete set null;

alter table public.payment_transactions
  add column if not exists promocion_id uuid references public.promociones(id) on delete set null;

comment on column public.tickets.promocion_id is
  'La promoción con la que se vendió esta boleta, si hubo. `precio_pagado` ya dice cuánto se cobró; esto dice por qué.';

create index if not exists tickets_promocion_idx on public.tickets (promocion_id) where promocion_id is not null;

-- ── 2 · Contar un uso sin carreras ───────────────────────────────────────
--
-- `usos = usos + 1` desde la aplicación son dos viajes —leer y escribir— y dos
-- compras simultáneas escriben el mismo número. Aquí es un solo `update`, que
-- toma el bloqueo de la fila, y el límite se comprueba DENTRO.
--
-- Devuelve `true` si se contó y `false` si el código ya estaba agotado. Quien
-- llama no deshace nada con el `false`: para cuando esto se ejecuta el pago ya
-- entró, y el `false` es un aviso para el log, no un rechazo.
--
-- `security definer` porque quien paga no está autenticado: la RPC la llama el
-- servidor con su llave, pero se deja explícito para el día en que RLS mande.

create or replace function public.promocion_consumir(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  update public.promociones
     set usos = usos + 1
   where id = p_id
     and (limite_usos is null or usos < limite_usos);

  /* `row_count` es un entero, no un booleano: cuántas filas tocó el update.
     Cero significa que el `where` no encajó, y con este `where` eso sólo puede
     ser una cosa: el límite ya estaba lleno. */
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end $$;

comment on function public.promocion_consumir(uuid) is
  'Suma un uso a la promoción si aún queda cupo. true = contado, false = ya estaba en el límite.';

revoke all on function public.promocion_consumir(uuid) from public, anon;

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select public.promocion_consumir('<id de una promo con limite_usos>');
--   select codigo, usos, limite_usos from public.promociones;
--
-- Repetirlo hasta pasar el límite: la llamada de más devuelve `false` y `usos`
-- se queda quieto.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   drop function if exists public.promocion_consumir(uuid);
--   alter table public.tickets drop column if exists promocion_id;
--   alter table public.payment_transactions drop column if exists promocion_id;
