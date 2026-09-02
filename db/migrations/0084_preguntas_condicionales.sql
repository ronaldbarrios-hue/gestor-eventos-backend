-- 0084 · Una pregunta puede depender de la respuesta de otra.
-- APLICADA — verificado contra producción el 2026-09-02 (`information_schema`,
-- sólo lectura): existe `event_form_fields.visible_si`.
--
-- Sólo añade una columna nullable: sin ella todo sigue funcionando igual, y el
-- código lo comprueba en caliente.
--
-- ── Qué resuelve ──────────────────────────────────────────────────────────
--
-- «Si vive en zona rural, se abren estas opciones; si urbana, estas otras.»
-- Hoy no hay forma de decirlo: todas las preguntas se enseñan siempre, así que
-- el organizador acaba poniendo las de los dos casos y pidiendo que se dejen
-- en blanco las que no apliquen. Eso convierte «obligatorio» en algo que no se
-- puede usar, y ensucia los datos con vacíos que no se distinguen de un olvido.
--
-- ── La forma ──────────────────────────────────────────────────────────────
--
--   visible_si = { "campo": "<uuid>", "op": "=", "valor": "rural" }
--
-- Un solo antecedente y no una lista de condiciones, a propósito. Con «y/o»
-- anidados hace falta un editor de reglas, y la pregunta que la gente hace de
-- verdad es «esta depende de aquella». Cuando se necesite más, se amplía el
-- JSON sin migrar nada — por eso es jsonb y no tres columnas.
--
-- Operadores: '=' , '!=' , 'incluye' (para las de opción múltiple, donde la
-- respuesta es una lista).
--
-- ── Lo que NO puede pasar ─────────────────────────────────────────────────
--
-- Un campo oculto por su condición no puede seguir siendo obligatorio: el
-- formulario quedaría imposible de enviar y quien lo rellena no vería por qué.
-- Ése es el fallo clásico de esta función y va resuelto en el servidor
-- (`camposVisibles` en lib/formularioCampos.js), que es donde tiene que estar:
-- el navegador puede mentir sobre qué se enseñó.
--
-- Tampoco puede haber ciclos (A depende de B y B de A). Se cortan al evaluar,
-- no al guardar, porque una lista a medio editar puede pasar por un estado
-- circular legítimo mientras el organizador la reordena.

begin;

alter table public.event_form_fields
  add column if not exists visible_si jsonb;

comment on column public.event_form_fields.visible_si is
  'Condición para mostrar la pregunta: { campo: uuid, op: "="|"!="|"incluye", valor: any }. Null = siempre visible. Un campo oculto nunca se exige aunque sea requerido.';

commit;
