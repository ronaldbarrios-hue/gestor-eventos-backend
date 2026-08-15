-- 0076 — El CHECK de event_form_fields.tipo se quedó con seis de los once tipos.
--
-- El catálogo del servidor (lib/formularioCampos.js) ofrece once tipos de
-- pregunta, el panel los muestra, la plantilla de Excel los acepta y el
-- renderizador público sabe pintarlos. La base sólo admitía seis, y
-- `filaCampo` guarda `tipo` tal cual, así que guardar una pregunta de tipo
-- correo, teléfono, documento, texto largo o selección múltiple reventaba
-- contra este CHECK.
--
-- O sea que el trabajo de formularios quedó a medias: se arregló el panel para
-- que ofreciera los once y nunca se ensanchó la columna. Se nota ahora porque
-- la ficha de caracterización —veintidós preguntas con documento, teléfono,
-- correo y selección múltiple— no se podía aplicar a ningún evento.
--
-- Sólo AÑADE valores permitidos: las filas que existen usan los seis viejos y
-- ninguna se invalida. El código va por delante y ya está desplegado, que es
-- el orden que evitó el incidente de las páginas públicas vacías.

alter table event_form_fields drop constraint if exists event_form_fields_tipo_check;

alter table event_form_fields add constraint event_form_fields_tipo_check
  check (tipo = any (array[
    'texto',      -- una línea
    'parrafo',    -- varias líneas
    'numero',
    'fecha',
    'email',      -- texto con verificación de correo
    'telefono',   -- texto con verificación de teléfono
    'documento',  -- texto con verificación de documento
    'seleccion',  -- elegir una
    'multiple',   -- elegir varias (se guarda como lista)
    'checkbox',
    'foto'
  ]));
