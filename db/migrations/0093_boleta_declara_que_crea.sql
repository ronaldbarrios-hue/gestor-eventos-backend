-- 0093 · Un tipo de boleta dice QUÉ CREA al venderse. (Frente Q · Q1)
--
-- ── El problema, medido antes de escribir nada ───────────────────────────
--
-- El camino «vendo una boleta y aparece el stand» existe desde la 0036 y
-- **nunca ha corrido**: 0 stands creados desde una boleta, 5 a mano. Hay un
-- tipo de boleta marcado `es_expositor` con 0 vendidas.
--
-- Así que el enganche no falta: lo que falta es que se pueda DECIR. Un tipo de
-- boleta no declara lo que es; se adivina por el nombre, y el único indicio es
-- una casilla booleana que además sólo sabe hablar de stands.
--
-- Un torneo tiene exactamente el mismo caso —comprar la inscripción debería
-- crear el equipo, y el capitán completa sus datos por su enlace— y con un
-- booleano por cada cosa que se pueda crear acabaríamos con `es_expositor`,
-- `es_equipo`, `es_lo_que_venga`, tres columnas que se contradicen entre sí en
-- cuanto alguien marque dos.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────
--
-- `crea` es UNA columna con UN valor: 'nada', 'stand' o 'equipo'. Dos cosas no
-- se pueden crear a la vez porque la boleta la compra una persona y acaba
-- siendo una ficha.
--
-- `crea_torneo_id` dice EN QUÉ torneo, y sólo tiene sentido con 'equipo'. Va
-- con una restricción que lo obliga: un tipo que crea equipos sin decir de qué
-- torneo no es un dato incompleto, es un dato que no significa nada.
--
-- ── Expand, no contract ──────────────────────────────────────────────────
--
-- `es_expositor` SE QUEDA y se mantiene sincronizada. Cinco sitios del backend
-- la leen —`avisoExpositor.js`, `derivados.js`, dos consultas públicas y el
-- trigger de la 0036— y producción sirve hoy ese código. Quitarla ahora es
-- apagar el portal del expositor a mitad de despliegue.
--
-- Se sincroniza con un trigger y no a mano: mientras las dos columnas existan,
-- la única forma de que no se separen es que nadie tenga que acordarse.
-- La contract —dejar de leer `es_expositor` y borrarla— va en otra migración,
-- cuando el código nuevo lleve tiempo desplegado.

-- ── 1 · La columna ───────────────────────────────────────────────────────

alter table public.ticket_types
  add column if not exists crea text not null default 'nada',
  add column if not exists crea_torneo_id uuid references public.torneos(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_types_crea_check') then
    alter table public.ticket_types
      add constraint ticket_types_crea_check check (crea in ('nada','stand','equipo'));
  end if;

  -- Un tipo que crea equipos sin decir de qué torneo no significa nada.
  if not exists (select 1 from pg_constraint where conname = 'ticket_types_crea_torneo_check') then
    alter table public.ticket_types
      add constraint ticket_types_crea_torneo_check
      check ((crea = 'equipo' and crea_torneo_id is not null)
          or (crea <> 'equipo' and crea_torneo_id is null));
  end if;
end $$;

-- Lo que ya estaba marcado como stand lo sigue estando. Es 1 fila hoy, pero se
-- escribe como una copia y no como un UPDATE a mano porque esta migración se
-- corre también en las bases de otros despliegues.
update public.ticket_types set crea = 'stand' where es_expositor and crea = 'nada';

comment on column public.ticket_types.crea is
  'Qué se crea al pagarse una boleta de este tipo: nada | stand (ficha de expositor) | equipo (de torneo).';
comment on column public.ticket_types.crea_torneo_id is
  'Torneo al que entra el equipo. Obligatorio con crea = equipo, prohibido en el resto.';

-- ── 2 · Las dos columnas no se separan ───────────────────────────────────

create or replace function public.fn_ticket_type_crea_sync() returns trigger as $$
begin
  -- Quien escriba `crea` manda; quien todavía escriba `es_expositor` —código
  -- viejo aún desplegado— sigue funcionando y actualiza `crea`.
  if TG_OP = 'INSERT' then
    if NEW.crea = 'nada' and NEW.es_expositor then NEW.crea := 'stand'; end if;
  elsif NEW.crea is distinct from OLD.crea then
    NEW.es_expositor := (NEW.crea = 'stand');
  elsif NEW.es_expositor is distinct from OLD.es_expositor then
    NEW.crea := case when NEW.es_expositor then 'stand'
                     when NEW.crea = 'stand' then 'nada'
                     else NEW.crea end;
  end if;
  NEW.es_expositor := (NEW.crea = 'stand');
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_ticket_type_crea_sync on public.ticket_types;
create trigger trg_ticket_type_crea_sync
  before insert or update on public.ticket_types
  for each row execute function public.fn_ticket_type_crea_sync();

-- ── 3 · El equipo que nace de una boleta ─────────────────────────────────
--
-- Copia deliberada de la forma de la 0036, incluida su clave de idempotencia:
-- `ticket_id` con UNIQUE, que permite muchos NULL —los equipos que el
-- organizador crea a mano, que son los 16 que hay hoy— y como mucho uno por
-- boleta. El trigger cubre así los cuatro caminos a 'pagado' sin repetirse.

alter table public.torneo_equipos
  add column if not exists ticket_id uuid references public.tickets(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'torneo_equipos_ticket_id_key') then
    alter table public.torneo_equipos add constraint torneo_equipos_ticket_id_key unique (ticket_id);
  end if;
end $$;

comment on column public.torneo_equipos.ticket_id is
  'Boleta de inscripción que generó este equipo (NULL = creado a mano por el organizador).';

create or replace function public.fn_equipo_desde_boleta() returns trigger as $$
declare
  v_crea   text;
  v_torneo uuid;
begin
  select crea, crea_torneo_id into v_crea, v_torneo
    from public.ticket_types where id = NEW.ticket_type_id;

  if coalesce(v_crea, 'nada') <> 'equipo' or v_torneo is null then return NEW; end if;

  if NEW.estado = 'pagado' then
    insert into public.torneo_equipos (torneo_id, ticket_id, nombre, contacto_email, contacto_user_id)
    values (v_torneo, NEW.id,
            coalesce(nullif(trim(NEW.guest_nombre), ''), 'Equipo por confirmar'),
            NEW.guest_email, NEW.user_id)
    on conflict (ticket_id) do nothing;

  -- Un equipo cancelado NO se borra: puede tener partidos jugados, y borrarlo
  -- dejaría un cuadro con resultados que no cuadran. Se marca en el nombre para
  -- que el organizador lo vea y decida, que es lo único que puede decidirse
  -- desde fuera del torneo.
  elsif NEW.estado in ('cancelado','reembolsado','invalido') then
    update public.torneo_equipos
       set nombre = case when nombre like '(baja) %' then nombre else '(baja) ' || nombre end
     where ticket_id = NEW.id;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_equipo_desde_boleta on public.tickets;
create trigger trg_equipo_desde_boleta
  after insert or update of estado on public.tickets
  for each row execute function public.fn_equipo_desde_boleta();

-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   drop trigger if exists trg_equipo_desde_boleta on public.tickets;
--   drop trigger if exists trg_ticket_type_crea_sync on public.ticket_types;
--   drop function if exists public.fn_equipo_desde_boleta();
--   drop function if exists public.fn_ticket_type_crea_sync();
--   alter table public.ticket_types drop column if exists crea,
--                                   drop column if exists crea_torneo_id;
--
-- `es_expositor` queda intacta en todo momento, así que el código desplegado
-- sigue funcionando con o sin esta migración.
