-- 0085 · La base de datos de eventos anteriores, para no volver a preguntarlo todo.
-- APLICADA. Verificado contra produccion el 2026-09-02 (information_schema, solo lectura).
--
-- ── Qué resuelve ──────────────────────────────────────────────────────────
--
-- Quien ya se registró en un evento anterior vuelve a llenar el formulario
-- entero. El organizador tiene esos datos en una hoja, pero no hay dónde
-- ponerlos: se sube el padrón, y al escribir la cédula el formulario se
-- rellena solo con lo que ya se sabía.
--
-- ── Por qué una tabla y no reusar `tickets` ───────────────────────────────
--
-- Porque son datos de OTROS eventos, muchas veces de otra plataforma, y no
-- tienen boleta ni cuenta. Meterlos en `tickets` los contaría como asistentes
-- de este evento —en el aforo, en el reporte, en el ranking— y el número más
-- importante del día empezaría mintiendo.
--
-- ── La privacidad es el diseño, no un añadido ─────────────────────────────
--
-- Esto responde con datos personales a partir de un número de cédula. Sin
-- cuidado es un extractor: se prueban documentos en serie y se cosecha. Tres
-- cosas lo evitan, y las tres van juntas:
--
--   1. El padrón es POR EVENTO (`evento_id`). Sólo se puede consultar contra
--      el evento que lo subió, no contra todo GESTEK.
--   2. `documento_hash` y no el documento en claro. Se busca por el hash, así
--      que la columna no sirve para listar cédulas ni aunque alguien lea la
--      tabla. Es SHA-256 con la sal del evento: sin la sal, un diccionario de
--      cédulas colombianas —que son pocas cifras— se precalcula en un rato.
--   3. La ruta que la consulta lleva limitador y devuelve SÓLO los campos que
--      el formulario de ese evento pregunta. Lo que el organizador subió de
--      más no sale nunca.
--
-- Y no devuelve «existe / no existe» como respuesta útil por sí sola: si no
-- hay coincidencia, contesta igual que si el padrón estuviera vacío.

begin;

create table if not exists public.padron_previo (
  id              uuid primary key default gen_random_uuid(),
  evento_id       uuid not null references public.eventos(id) on delete cascade,
  /* SHA-256 de (documento normalizado + sal del evento). Nunca el documento. */
  documento_hash  text not null,
  /* Lo que se sabe de esa persona: { "<etiqueta normalizada>": "valor" }.
     Por etiqueta y no por id de campo porque el padrón viene de FUERA: sus
     columnas no conocen los ids de este formulario. El emparejamiento se hace
     al consultar, contra las etiquetas de las preguntas de hoy. */
  datos           jsonb not null default '{}'::jsonb,
  origen          text,                     -- de qué archivo/evento salió
  created_at      timestamptz not null default now()
);

/* Una persona, una fila por evento. Volver a subir el padrón actualiza en vez
   de duplicar — subirlo dos veces es lo normal, no la excepción. */
create unique index if not exists padron_previo_unico
  on public.padron_previo(evento_id, documento_hash);

alter table public.padron_previo enable row level security;

comment on table public.padron_previo is
  'Datos de asistentes de eventos anteriores, para prellenar el formulario. Se busca por hash del documento; el documento en claro no se guarda.';

commit;
