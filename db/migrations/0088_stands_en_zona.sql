-- 0088 · Un stand pertenece a una zona. Idempotente.
--
-- `networking_expositores.stand` es la ETIQUETA del puesto ("A-12"), no el
-- sitio donde está. Con eso no se puede contestar "qué stands hay en la Zona
-- Gamer", que es exactamente la pregunta de quien está parado delante del
-- plano. Mismo arreglo que la 0079 en los movimientos de aforo y la 0080 en
-- los sub-eventos: manda el id estable de `page_json.zonas`.
--
-- `stand` NO se toca y NO se sustituye: sigue siendo la etiqueta impresa en el
-- puesto. Son dos datos distintos —cuál es y dónde está— y confundirlos es lo
-- que hizo falta arreglar aquí.
--
-- ── Por qué esta migración NO rellena nada ──────────────────────────────────
--
-- La 0079 y la 0080 sí emparejaban, porque comparaban nombre contra nombre:
-- `ubicacion` y `track` los rellenaba la gente con el nombre de la zona (el
-- formulario de sub-eventos incluso lo autocompleta). Aquí el campo de origen
-- es un código de rejilla —el placeholder del panel dice literalmente
-- "Ej. A-12"— y no hay prefijo, separador ni tabla que lo traduzca a una zona.
--
-- Un `update` que emparejara `stand` contra el nombre de la zona no casaría
-- casi nunca, y las pocas veces que casara sería por accidente: alguien que
-- escribió "Zona Gamer" en el campo de la etiqueta. Un stand mal ubicado en el
-- plano es peor que un stand sin ubicar, porque el visitante camina hasta
-- allí. Así que nace NULL en todas las filas y lo asigna el organizador.
--
-- ── Zonas huérfanas ────────────────────────────────────────────────────────
--
-- Como en la 0079 y la 0080, no hay clave foránea posible: las zonas viven
-- dentro de un JSON, no en una tabla. Borrar una zona deja este `zona_id`
-- apuntando a un id que ya no existe, y está previsto: quien lee itera sobre
-- las zonas declaradas (`lib/aforoZonas.js`), así que una referencia huérfana
-- no encuentra zona y desaparece de las pantallas de zona sin romper nada.
--
-- La diferencia con un movimiento de aforo: un stand con la zona huérfana
-- SIGUE saliendo entero en el directorio. La ficha existe y el stand existe;
-- lo único inservible es su ubicación. Nunca se filtran stands por "tiene zona
-- válida".

begin;

alter table public.networking_expositores add column if not exists zona_id text;

create index if not exists networking_expositores_zona_idx
  on public.networking_expositores(evento_id, zona_id);

comment on column public.networking_expositores.zona_id is
  'Zona de page_json.zonas donde está montado el stand. Sin FK: las zonas viven en JSON. NULL = sin ubicar todavía.';

commit;
