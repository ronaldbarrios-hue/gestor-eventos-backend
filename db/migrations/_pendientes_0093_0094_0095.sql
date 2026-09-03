-- GESTEK — Migraciones 0093, 0094 y 0095 (combinadas) · Frente Q
--
-- Pega TODO esto en Supabase → SQL Editor → Run. Es idempotente: correrlo dos
-- veces no hace daño.
--
-- ⚠️ LA 0094 VA DESPUÉS DE LA 0092, y la 0092 va después de desplegar el
--    código que lee las zonas de la tabla. Si todavía no has aplicado la 0092,
--    puedes correr igualmente este archivo: la 0094 sólo añade una columna con
--    valor por defecto y no toca `page_json`. Lo que no se puede es mover las
--    puertas a zonas antes de eso, y ese paso no está aquí.
--
-- Qué hace cada una, en una línea:
--
--   0093  un tipo de boleta declara qué crea al pagarse (nada / stand / equipo)
--   0094  una zona declara qué es (evento / ingreso / evacuación / otra)
--   0095  cada torneo declara qué le pide a un equipo además del nombre
--
-- Ninguna borra nada ni cambia lo que ya existe: las tres añaden. Los eventos
-- que hay hoy siguen viendo exactamente lo mismo hasta que alguien use lo
-- nuevo. El código funciona con y sin ellas —sin ellas, lo nuevo no aparece—,
-- así que el orden entre desplegar y correr esto da igual.

begin;


-- ════════════════════════════════════════════════════════════════════
-- 0093 · la boleta dice qué crea
-- ════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════
-- 0094 · la zona dice qué es
-- ════════════════════════════════════════════════════════════════════
-- 0094 · Una puerta es una zona. (Frente Q · Q6)
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


-- ════════════════════════════════════════════════════════════════════
-- 0095 · el torneo dice qué pide
-- ════════════════════════════════════════════════════════════════════
-- 0095 · Un equipo de torneo no cabe en la tabla: que lo diga el organizador.
--        (Frente Q · Q2)
--
-- ── El problema, y por qué no se arregla añadiendo columnas ──────────────
--
-- `torneo_equipos` tiene `nombre`, `foto_url`, `posicion_bracket`,
-- `contacto_email`, `contacto_user_id` y `grupo`. Y nada más: ni jugadores, ni
-- roles dentro del equipo, ni rango, ni nickname, ni país. «Todo el flujo está
-- hecho para un torneo de fútbol», y es literal.
--
-- Añadir `dorsal` y `posicion` arreglaría el fútbol y dejaría fuera al de
-- esports, que pide nick, rango y servidor; y el de ajedrez, que pide ELO. Cada
-- disciplina tendría su columna y todas estarían vacías menos una.
--
-- ── Lo que se hace, que es apuntar algo que YA existe a otra tabla ───────
--
-- `event_form_fields` resuelve exactamente este problema desde hace tiempo para
-- el registro de asistentes: campos que define el organizador, con tipo,
-- opciones, ayuda, orden y condicionales (`visible_si`). Ya sabe colgarse de un
-- tipo de boleta (`ticket_type_id`) y de un sub-evento (`session_id`).
--
-- Le falta el tercer dueño: el torneo. Eso es esta migración.
--
-- **No hay mecanismo nuevo.** El editor de campos, el renderizado del
-- formulario, la validación y el guardado en `respuestas` son los mismos que
-- llevan tiempo funcionando con 47 campos en producción. Inventar un sistema de
-- campos propio para torneos sería mantener dos.

alter table public.event_form_fields
  add column if not exists torneo_id uuid references public.torneos(id) on delete cascade;

-- `on delete cascade` y no `set null`, al revés que en otras partes: un campo
-- «Rango en el ladder» sin su torneo no es un campo huérfano recuperable, es
-- basura que aparecería en el formulario general del evento.

create index if not exists idx_form_fields_torneo on public.event_form_fields(torneo_id, orden);

-- Un campo pertenece a UN sitio. Los tres dueños son excluyentes: un campo del
-- torneo no es también del formulario de una boleta. Sin esto, un campo con dos
-- dueños se pintaría dos veces y se guardaría una.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_form_fields_un_dueno_check') then
    alter table public.event_form_fields
      add constraint event_form_fields_un_dueno_check
      check ((ticket_type_id is not null)::int
           + (session_id     is not null)::int
           + (torneo_id      is not null)::int <= 1);
  end if;
end $$;

comment on column public.event_form_fields.torneo_id is
  'Campo propio de la inscripción a ESTE torneo (dorsal y posición en fútbol; nick, rango y servidor en esports).';

-- ── Dónde se guarda lo que se responde ───────────────────────────────────
--
-- En `respuestas`, igual que `tickets` y que `sesion_inscripciones`. Es el
-- mismo patrón en las tres tablas a propósito: el mismo editor escribe los
-- campos y el mismo código lee lo respondido.

alter table public.torneo_equipos
  add column if not exists respuestas jsonb not null default '{}'::jsonb;

comment on column public.torneo_equipos.respuestas is
  'Lo que el equipo contestó al formulario del torneo, por id de campo.';

-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   alter table public.event_form_fields
--     drop constraint if exists event_form_fields_un_dueno_check,
--     drop column if exists torneo_id;
--   alter table public.torneo_equipos drop column if exists respuestas;
--
-- Ojo: borrar `torneo_id` borra los campos que se hubieran definido, porque van
-- en esa misma fila. Las respuestas quedan en `respuestas` hasta que se quite
-- también esa columna.

commit;
