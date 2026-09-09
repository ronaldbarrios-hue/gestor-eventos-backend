-- 0121 · Qué es cada boleta
--
-- Un evento con cuatro boletas las enseña hoy en una lista plana, y nada dice
-- cuál es la entrada al evento y cuáles son actividades de dentro. Quien llega
-- ve cuatro cosas iguales: se inscribe a un taller sin entrada, o pide las
-- cuatro por si acaso. Queda a interpretación, y la interpretación equivocada
-- se descubre en la puerta.
--
-- No se puede deducir. `crea` distingue algunas —una boleta que crea un equipo
-- es una postulación— pero «Encuentro de Mujeres» y «Registro general» son las
-- dos `crea = 'nada'`. En la base son idénticas.
--
-- ── Y conste que ésta no es la forma buena de montarlo ─────────────────
--
-- La 0055 dejó escrito el modelo correcto: «no se crea otra boletería
-- paralela: la boleta del evento sigue siendo la llave; lo que se añade es la
-- INSCRIPCIÓN a un sub-evento, con su propio cupo, sin emitir tres códigos
-- más». Con inscripciones, una persona tiene UNA escarapela y se apunta a los
-- talleres que quiera.
--
-- Montar cada actividad como un tipo de boleta aparte le da tres códigos QR a
-- la misma persona, y en la puerta nadie sabe cuál enseñar.
--
-- Pero es lo que hay montado en eventos que ya vendieron cientos de boletas, y
-- remodelarlos a mitad de camino no es una opción. Esta columna hace lo segundo
-- mejor: que la lista DIGA lo que cada boleta es.

alter table public.ticket_types
  add column if not exists rol text not null default 'entrada';

-- `entrada` es el valor por defecto y es lo que hoy hacen todas: ningún evento
-- cambia de aspecto hasta que alguien marque algo a propósito.
do $$
begin
  alter table public.ticket_types
    add constraint ticket_types_rol_check
    check (rol in ('entrada', 'actividad', 'extra'));
exception
  when duplicate_object then null;
end $$;

-- ── 2 · Y qué tiene que hacer quien la compre ──────────────────────────
--
-- El evento ya podía poner un mensaje en la pantalla de confirmación
-- (`page_json.checkout.confirmacion_texto`), pero es UNO para todo el evento.
-- En cuanto hay actividades, cada una tiene sus propias instrucciones: la
-- entrada general dice «trae tu QR», la postulación de startup dice «te
-- escribiremos para la sesión de pitch», el taller dice «preséntate en el
-- laboratorio 2 a las 8».
--
-- Con un solo texto compartido, o se escribe el del caso más común y los demás
-- se enteran por otro lado, o se escriben los tres juntos y todo el mundo lee
-- instrucciones que no le tocan.

alter table public.ticket_types
  add column if not exists instrucciones text;

comment on column public.ticket_types.instrucciones is
  'Qué tiene que hacer quien compre ESTA boleta: un paso adicional, un lugar donde presentarse. Se enseña al confirmar y también en la boleta, que es donde se vuelve a mirar antes del evento.';

comment on column public.ticket_types.rol is
  'Qué papel juega en la lista de compra: entrada (da acceso al evento) | actividad (inscripción a algo de dentro; hace falta además la entrada) | extra (complemento). Sólo presentación: no cambia qué se emite.';

-- ── Comprobación ───────────────────────────────────────────────────────
--
--   select column_name from information_schema.columns
--    where table_name='ticket_types' and column_name in ('rol','instrucciones');
--
--   select rol, count(*) from public.ticket_types group by 1;
--   -- tiene que salir 'entrada' para todas: nada cambia solo.
--
-- ── Vuelta atrás ───────────────────────────────────────────────────────
--
--   alter table public.ticket_types drop constraint if exists ticket_types_rol_check;
--   alter table public.ticket_types drop column if exists rol, drop column if exists instrucciones;
--
-- Sin riesgo: una columna de presentación con valor por defecto. No cambia qué
-- se emite, ni el precio, ni el cupo, ni el aforo.
