-- 0116 · Dos índices que hoy no hacen falta y el día del evento sí
--
-- ── Por qué sólo dos ───────────────────────────────────────────────────
--
-- Hay 60 claves foráneas sin índice en esta base. NO se indexan todas, y no es
-- pereza: un índice cuesta en cada escritura y ocupa disco, y la mayoría de
-- esas columnas son de auditoría —`created_by`, `updated_by`, `invited_by`—
-- que se escriben siempre y no se consultan nunca. Indexarlas sería pagar en
-- cada inserción por una búsqueda que nadie hace.
--
-- Y medido hoy: la tabla más grande tiene 274 filas. A ese tamaño Postgres
-- recorre entero más rápido de lo que abre un índice, así que **esto no
-- arregla nada hoy**. Se hace ahora porque FESTECH son 7.000 personas en diez
-- días, y las dos consultas de abajo corren UNA VEZ POR PERSONA.
--
-- ── 1 · Las actividades de una boleta ──────────────────────────────────
--
-- Existe `sesion_inscripciones (session_id, ticket_id)`, pero `ticket_id` es la
-- SEGUNDA columna: para buscar por `ticket_id` a secas ese índice no sirve, y
-- Postgres recorre la tabla entera.
--
-- Y por ahí pasan dos cosas que ocurren por persona:
--   · La página de la boleta, que ahora lista a qué actividades está inscrita.
--     7.000 personas abriendo su boleta = 7.000 recorridos completos.
--   · El escáner de la puerta de cada taller, que busca la inscripción por la
--     boleta escaneada — con una fila de gente esperando delante.

create index if not exists sesion_inscripciones_ticket_idx
  on public.sesion_inscripciones (ticket_id)
  where ticket_id is not null;

-- Parcial porque una inscripción sin boleta —quien llega directo al taller— no
-- se busca nunca por este camino: se busca por su id o por su correo, que ya
-- tienen lo suyo.

-- ── 2 · Las boletas de un tipo ─────────────────────────────────────────
--
-- `tickets.ticket_type_id` es la clave foránea más consultada de la base y no
-- tenía índice. Por ella pasan el conteo de vendidas, el aforo, la exportación
-- de asistentes y la búsqueda de las boletas que se quedaron sin equipo.
--
-- Va junto a `evento_id` porque nunca se pregunta por un tipo sin decir de qué
-- evento: un índice por la columna sola serviría igual para esto, pero éste
-- sirve además para contar por evento sin tocar la tabla.

create index if not exists tickets_evento_tipo_idx
  on public.tickets (evento_id, ticket_type_id);

-- Comprobación:
--   select indexname from pg_indexes where schemaname='public'
--    and indexname in ('sesion_inscripciones_ticket_idx', 'tickets_evento_tipo_idx');
--
-- Vuelta atrás:
--   drop index if exists sesion_inscripciones_ticket_idx;
--   drop index if exists tickets_evento_tipo_idx;
--
-- Sin riesgo: crear un índice no toca ni una fila de datos. En una tabla de
-- 274 filas tarda milisegundos y no bloquea nada apreciable.
