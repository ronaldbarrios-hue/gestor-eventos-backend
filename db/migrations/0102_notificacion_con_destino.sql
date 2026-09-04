-- 0102 · Una notificación que lleva a algún sitio.
--
-- ── El fallo, y la corrección anterior que se quedó a medias ────────────
--
-- `lib/notificar.js` insertaba una columna `link` que la tabla no tiene, y
-- supabase-js no lanza cuando un INSERT falla: devuelve `{ error }`. Nadie lo
-- miraba, así que durante meses **no se creó ni una sola notificación**.
--
-- Eso se arregló quitando `link` del INSERT, con este razonamiento escrito en
-- el archivo: «el frontend no lee `link` en ninguna parte, así que el destino
-- se arma del `evento_id`».
--
-- Hoy eso **ya no es verdad**. `src/components/layout/TopBar.jsx` hace:
--
--     if (n.link) navigate(n.link);
--
-- O sea: la campana muestra los avisos, se pueden marcar leídos, y al pulsar
-- uno no pasa nada. Nunca. `n.link` siempre es `undefined`.
--
-- Y catorce archivos del backend siguen pasando un `link` que se tira por el
-- desagüe: el aforo de una zona, una alerta de acceso, una solicitud
-- respondida, una tarea asignada, una postulación aceptada, una entrevista
-- agendada. Todos saben a dónde tenía que ir la persona. Ninguno llega.
--
-- ── Por qué una columna y no armarlo del `evento_id` ────────────────────
--
-- Porque el evento no basta. «Aforo: Zona Gamer» tiene que abrir la pestaña de
-- aforo, no la portada del evento; «Fuiste aceptado» va al evento y «Tu
-- postulación no avanzó» va a Mi Espacio — dos avisos del mismo evento y de la
-- misma tabla que van a sitios distintos. Quien crea el aviso es el único que
-- sabe eso, y ya lo escribe.
--
-- ── Qué se guarda aquí y qué NO ─────────────────────────────────────────
--
-- Sólo rutas **de esta aplicación**, empezando por `/`, y lo comprueba el
-- servidor antes de escribir (`lib/notificar.js`).
--
-- Con precisión, porque es fácil exagerarlo: el panel navega con react-router,
-- y ahí una URL absoluta NO redirige fuera — se convierte en la ruta
-- `/https://otro.com`, que no existe. Esto no es un agujero de seguridad hoy.
--
-- Se comprueba igual por dos motivos que sí son reales: un aviso que lleva a
-- una pantalla en blanco es un aviso roto, y el día que alguien pinte el enlace
-- con un `<a href>` en vez de `navigate` —que es lo natural— la validación
-- tiene que estar ya puesta. Escribirla después es escribirla cuando duele.

alter table public.notificaciones
  add column if not exists link text;

comment on column public.notificaciones.link is
  'A dónde lleva el aviso al pulsarlo. Ruta interna que empieza por "/" — nunca una URL absoluta: el panel navega a esto sin mirar.';

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select tipo, count(*) filter (where link is not null) as con_destino, count(*)
--     from public.notificaciones group by tipo;
--
-- Las 62 que ya hay se quedan sin `link` y seguirán sin llevar a ningún sitio:
-- son de antes y no se puede adivinar a dónde iban. Las nuevas sí.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   alter table public.notificaciones drop column if exists link;
--
-- Sin pérdida de nada que existiera antes.
