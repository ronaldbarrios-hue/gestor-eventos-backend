-- 0113 · La rueda la decide quien organiza, no la categoría del evento
--
-- Tres cosas pequeñas que van juntas porque las tres son «ajustes de la rueda»
-- y separarlas serían tres pausas de despliegue para tres columnas.
--
-- ── 1 · De qué eventos puede haber rueda ────────────────────────────────
--
-- Hoy la rueda está permitida sólo en eventos de categoría negocios, marketing
-- o tecnología, y esa lista está escrita DOS veces: en `routes/networking.js`
-- y en `EventWorkspace.jsx`. Dos copias de la misma regla acaban separándose.
--
-- Pero el problema de fondo no es la duplicación: es que la categoría no manda
-- aquí. Una cámara de comercio organiza ruedas de agroindustria, de turismo o
-- de salud, y ninguna de esas categorías existe siquiera en el catálogo — un
-- evento así cae en «Otros» y se queda sin rueda. Al revés también falla: un
-- evento de tecnología que es un taller no tiene rueda ninguna y la pestaña le
-- sale igual.
--
-- La rueda pasa a ser un interruptor del evento. La categoría, como mucho,
-- decide cómo nace ese interruptor — y eso se hace aquí, una vez:
--   · los eventos de las tres categorías de siempre nacen con la rueda puesta,
--     para que nadie pierda lo que ya tenía;
--   · y cualquier evento que YA tenga expositores también, sea de la categoría
--     que sea. Ese dato vale más que la categoría: si alguien montó mesas, la
--     rueda existe.

alter table public.eventos
  add column if not exists networking_activo boolean not null default false;

update public.eventos e
   set networking_activo = true
 where e.networking_activo = false
   and (
     exists (
       select 1 from public.categorias c
        where c.id = e.categoria_id
          and c.slug in ('negocios', 'marketing', 'tecnologia')
     )
     or exists (
       select 1 from public.networking_expositores x where x.evento_id = e.id
     )
   );

comment on column public.eventos.networking_activo is
  'Si este evento tiene rueda de negocios. Lo decide quien organiza; la categoría sólo decidió el valor inicial en la 0113.';

-- ── 2 · Tope de reuniones por empresa ───────────────────────────────────
--
-- Nada impide hoy que una empresa acapare quince citas y deje a otras sin
-- ninguna. En una rueda con cupo eso se limita, y es un ajuste del evento —no
-- de cada mesa—: la regla es la misma para todos o no es una regla.
--
-- NULL = sin tope, que es como funciona hoy y como debe seguir funcionando
-- para quien no lo necesite. Cero no significa nada útil («ninguna cita») y por
-- eso el CHECK empieza en 1.

alter table public.eventos
  add column if not exists networking_tope_por_empresa integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.eventos'::regclass
       and conname = 'eventos_networking_tope_chk'
  ) then
    alter table public.eventos
      add constraint eventos_networking_tope_chk
      check (networking_tope_por_empresa is null or networking_tope_por_empresa between 1 and 200);
  end if;
end $$;

comment on column public.eventos.networking_tope_por_empresa is
  'Máximo de citas que puede tener una misma persona/empresa en la rueda. NULL = sin tope.';

-- ── 3 · Bloquear una franja sin borrarla ────────────────────────────────
--
-- «Esta empresa no está de 11 a 12» sólo se podía decir borrando esos horarios.
-- Borrar pierde la información: nadie sabe luego si esa hora no existió o si se
-- quitó, y si la persona vuelve hay que recrearla a mano y adivinando.
--
-- Marcar es reversible y se ve en la parrilla como lo que es: una casilla que
-- existe y no se puede pedir. El motivo es opcional y sale en la parrilla —«en
-- el almuerzo», «llega a las 11:30»— para que quien coordina no tenga que
-- acordarse de por qué la bloqueó.

alter table public.networking_horarios
  add column if not exists bloqueado boolean not null default false,
  add column if not exists bloqueo_motivo text;

-- El índice sirve al listado de la parrilla, que pide las franjas libres de un
-- expositor. Parcial porque las bloqueadas son la minoría y son las que se
-- descartan.
create index if not exists networking_horarios_bloqueados_idx
  on public.networking_horarios (expositor_id)
  where bloqueado;

comment on column public.networking_horarios.bloqueado is
  'La franja existe pero no se puede pedir. Se marca en vez de borrarla para no perder por qué, y para poder devolverla.';

-- Comprobación:
--   select networking_activo, networking_tope_por_empresa from public.eventos limit 5;
--   select count(*) filter (where bloqueado) as bloqueadas from public.networking_horarios;
--   select count(*) from public.eventos where networking_activo;   -- debería ser > 0
--
-- Vuelta atrás:
--   drop index if exists networking_horarios_bloqueados_idx;
--   alter table public.networking_horarios
--     drop column if exists bloqueo_motivo, drop column if exists bloqueado;
--   alter table public.eventos drop constraint if exists eventos_networking_tope_chk;
--   alter table public.eventos
--     drop column if exists networking_tope_por_empresa, drop column if exists networking_activo;
