-- 0091 · Las zonas dejan de vivir dentro de un JSON. PASO 1 de 3 (expand).
-- APLICADA el 2026-09-02. Comprobado después: 7 zonas en la tabla y las MISMAS
-- 7 siguen en `page_json` — que es lo que hace que revertir siga siendo gratis
-- hasta el paso 2. Las dos claves foráneas puestas, y las 2 sesiones que tenían
-- zona la conservan.
--
-- ── El problema ──────────────────────────────────────────────────────────
--
-- Una zona vive hoy en `eventos.page_json.zonas`, un array. Cuatro tablas la
-- referencian por `zona_id` —`agenda_sessions`, `networking_expositores`,
-- `zona_cortes` y `ticket_movimientos`— y **ninguna referencia está
-- garantizada**, porque una clave foránea no puede apuntar dentro de un jsonb.
--
-- Lo que se paga por eso, medido hoy contra producción:
--
--   · `routes/networking.js` tiene `zonaInvalida()`, una función que lee
--     `page_json` en CADA escritura para hacer a mano el trabajo de una FK.
--   · `ticket_movimientos` ya tiene **4 filas huérfanas**: apuntan a zonas que
--     alguien borró del plano. La 0079 y la 0080 no validaban, así que las
--     dejaron entrar.
--   · «Qué hay en esta zona» no se puede preguntar con un join: hay que leer
--     el JSON, leer las sesiones, leer los stands y cruzar en memoria. Eso es
--     lo que hace `mapa/vivo`, y es la única puerta que existe.
--
-- ── Por qué esta migración NO cambia quién lee ───────────────────────────
--
-- Expand/contract, y de verdad: este archivo sólo CREA y COPIA. `page_json`
-- sigue siendo la fuente de la que todo el mundo lee, y el código no cambia.
-- Los tres pasos, en migraciones distintas y en sesiones distintas:
--
--   0091 (esto)  crear la tabla, copiar, poner las claves foráneas.
--   0092         el código escribe en las dos y lee de la tabla.
--   0093         dejar de escribir el JSON, y sólo entonces borrarlo.
--
-- Partirlo así no es ceremonia: mientras el JSON siga ahí, revertir es borrar
-- una tabla que nadie lee todavía. En cuanto el código lea de la tabla, ya no.
--
-- ── Lo que se decidió mirando los datos, no el diseño ────────────────────
--
-- · **`id` es `text`, no `uuid`.** Los ids que ya existen son `acc_jzgcn7b` y
--   parecidos, y las cuatro columnas que los referencian son `text`. Con un PK
--   de texto, las FK casan **sin reescribir una sola fila** de las tablas que
--   apuntan. Un `uuid` bonito habría obligado a migrar cuatro tablas.
-- · **Sin `x` / `y`.** Las coordenadas no son de la zona: viven en
--   `page_json.mapa.marcadores`, porque una zona puede existir sin estar
--   colocada en el plano. Meterlas aquí habría mezclado «qué es» con «dónde
--   se dibuja».
-- · Los 7 ids que hay son únicos entre todos los eventos, así que el PK puede
--   ser sólo `id`. Comprobado antes de escribirlo.
--
-- Reversible: `drop table public.zonas` y ya. Nada lee de ella todavía.
-- Idempotente.

create table if not exists public.zonas (
  id          text primary key,
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  nombre      text not null,
  aforo_max   integer,
  orden       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists zonas_evento_idx on public.zonas (evento_id, orden);

/* Copiar lo que hay en el JSON.
   Se filtran las que no tienen id o no tienen nombre: las dos existen de forma
   legítima y transitoria mientras alguien está creando una zona, y son las
   mismas que `zonasDelEvento()` ya descarta al leer. Meterlas aquí crearía
   filas que la aplicación considera inexistentes. */
insert into public.zonas (id, evento_id, nombre, aforo_max, orden)
select el->>'id',
       e.id,
       trim(el->>'nombre'),
       nullif(el->>'aforo_max','')::integer,
       (el_idx - 1)::integer
  from public.eventos e,
       lateral jsonb_array_elements(coalesce(e.page_json->'zonas','[]'::jsonb))
         with ordinality as t(el, el_idx)
 where nullif(el->>'id','') is not null
   and nullif(trim(el->>'nombre'),'') is not null
on conflict (id) do nothing;

/* ── Las claves foráneas ─────────────────────────────────────────────────
 *
 * `on delete set null` en las dos tablas VIVAS: si se borra una zona, la
 * charla y el stand siguen existiendo, sólo dejan de estar ubicados. Es lo que
 * ya pasaba de hecho —quedaban apuntando a nada— pero ahora queda dicho.
 */
alter table public.agenda_sessions
  drop constraint if exists agenda_sessions_zona_id_fkey;
alter table public.agenda_sessions
  add constraint agenda_sessions_zona_id_fkey
  foreign key (zona_id) references public.zonas(id) on delete set null;

alter table public.networking_expositores
  drop constraint if exists networking_expositores_zona_id_fkey;
alter table public.networking_expositores
  add constraint networking_expositores_zona_id_fkey
  foreign key (zona_id) references public.zonas(id) on delete set null;

/* ── Las dos tablas de HISTORIAL no llevan clave foránea ─────────────────
 *
 * `zona_cortes` y `ticket_movimientos` son registros de algo que pasó. Una FK
 * les dejaría dos salidas y las dos son malas: `on delete set null` borraría
 * de la historia en qué zona ocurrió, y `restrict` impediría borrar una zona
 * que alguna vez tuvo movimiento — es decir, cualquiera.
 *
 * Y hay una razón medida: `ticket_movimientos` tiene YA 4 filas apuntando a
 * zonas borradas. Son ingresos reales a una zona que después desapareció del
 * plano; el dato es cierto aunque la zona no exista. Borrarlos o vaciarlos
 * para que entre una FK sería falsear el historial por una regla de forma.
 *
 * `zona_cortes` guarda además el NOMBRE de la zona (`zona`) junto al id, que es
 * exactamente cómo se resuelve esto bien: el historial se queda con su copia y
 * no depende de que la fila siga existiendo.
 */

alter table public.zonas enable row level security;

/* Sin políticas a propósito: la tabla la escribe y la lee el backend con la
   llave de servicio, igual que el resto del panel. Las zonas llegan al público
   por `eventos.publicos`, ya filtradas — abrir aquí una lectura anónima sería
   dar el plano interno del recinto a quien pregunte, y es justo lo que la
   Fase 3 de INDEPENDENCIA vino a cerrar. */

-- ── Rollback ─────────────────────────────────────────────────────────────
--   alter table public.agenda_sessions drop constraint if exists agenda_sessions_zona_id_fkey;
--   alter table public.networking_expositores drop constraint if exists networking_expositores_zona_id_fkey;
--   drop table if exists public.zonas;
-- `page_json.zonas` sigue intacto, así que no se pierde nada.
