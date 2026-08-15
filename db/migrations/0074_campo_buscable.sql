/* 0074 — Listas largas: que el campo se pueda buscar.

   Un desplegable con los 300 barrios de una ciudad es inservible, y como
   casillas de selección múltiple es peor. Lo que hace falta es escribir tres
   letras y que se filtre.

   Deliberadamente NO se añade un tipo de campo nuevo. Un barrio sigue siendo
   una selección: lo único que cambia es cómo se pinta. Un tipo aparte
   obligaría al organizador a elegir entre «selección» y «búsqueda» sin saber
   por qué, y duplicaría una validación que no cambia —el valor tiene que
   seguir estando entre las opciones—.

   Por eso esto es UNA COLUMNA, no una tabla:

     null   → decide la plataforma por el tamaño de la lista (lo normal)
     true   → siempre con buscador, aunque haya pocas opciones
     false  → nunca, aunque haya muchas

   Nullable a propósito: los campos que ya existen no tienen que migrarse ni
   decidir nada, y siguen comportándose igual hasta superar el umbral. */

alter table event_form_fields
  add column if not exists buscable boolean;

comment on column event_form_fields.buscable is
  'null = automático según cuántas opciones tenga; true/false = lo fuerza el organizador.';
