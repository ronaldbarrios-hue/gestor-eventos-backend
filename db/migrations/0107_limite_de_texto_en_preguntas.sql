-- 0107 · Cuánto puede escribirse en una pregunta de texto
--
-- ── Por qué ────────────────────────────────────────────────────────────
--
-- Un formulario pide «cuéntanos tu propuesta en máximo 10 palabras» y hoy la
-- plataforma no tiene dónde guardar ese «10». El organizador lo escribe en el
-- enunciado y no lo hace cumplir nadie: llegan respuestas de un párrafo, y el
-- recorte lo acaba haciendo una persona a mano cuando toca leerlas o
-- imprimirlas. Peor si la respuesta va a una escarapela o a un listado, donde
-- lo que no cabe se corta a la mitad de una palabra.
--
-- ── Dos límites y no uno ───────────────────────────────────────────────
--
-- Se piden de las dos maneras y no son intercambiables: «100 caracteres» es
-- una restricción de espacio —cabe en la etiqueta, cabe en la columna—, y
-- «10 palabras» es una restricción de forma —sé breve—. Convertir una en otra
-- obliga a adivinar cuánto mide una palabra.
--
-- Los dos son opcionales e independientes: se puede poner uno, el otro, o los
-- dos. NULL = sin límite, que es como está todo lo que ya existe, así que
-- ninguna pregunta cambia de comportamiento al aplicar esto.
--
-- ── Por qué no se recorta lo ya guardado ───────────────────────────────
--
-- Poner un límite hoy no puede borrar lo que alguien respondió ayer. Lo
-- guardado se queda como está; el límite se aplica a lo que se responda desde
-- ahora. Si el organizador necesita recortar lo viejo, eso es una decisión
-- suya sobre SUS datos, no un efecto silencioso de guardar un ajuste.

alter table public.event_form_fields
  add column if not exists max_caracteres integer,
  add column if not exists max_palabras   integer;

-- Un límite de 0 o negativo no es un límite: es una pregunta que no se puede
-- responder. Y el tope de arriba evita que un dedo de más («1000000») acabe
-- guardando textos que revientan cualquier listado.
alter table public.event_form_fields
  drop constraint if exists event_form_fields_max_caracteres_ck;
alter table public.event_form_fields
  add  constraint event_form_fields_max_caracteres_ck
  check (max_caracteres is null or (max_caracteres between 1 and 10000));

alter table public.event_form_fields
  drop constraint if exists event_form_fields_max_palabras_ck;
alter table public.event_form_fields
  add  constraint event_form_fields_max_palabras_ck
  check (max_palabras is null or (max_palabras between 1 and 2000));

comment on column public.event_form_fields.max_caracteres is
  'Máximo de caracteres de la respuesta. NULL = sin límite. Sólo aplica a texto y párrafo.';
comment on column public.event_form_fields.max_palabras is
  'Máximo de palabras de la respuesta. NULL = sin límite. Sólo aplica a texto y párrafo.';

-- Comprobación (debe devolver dos filas):
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'event_form_fields'
--      and column_name in ('max_caracteres', 'max_palabras');
