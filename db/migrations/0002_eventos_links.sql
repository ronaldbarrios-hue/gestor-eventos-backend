/* GESTEK — Agregar columna `links` a eventos.
   Guarda links de streaming + redes sociales como arreglo dinámico de
   { tipo, url, label? } definidos por el organizador.

   Ejemplo:
     [
       { "tipo": "youtube",   "url": "https://youtube.com/live/..." },
       { "tipo": "zoom",      "url": "https://zoom.us/j/..." },
       { "tipo": "instagram", "url": "https://instagram.com/evento" },
       { "tipo": "custom",    "url": "https://...", "label": "Web del evento" }
     ]
*/

alter table public.eventos
  add column if not exists links jsonb not null default '[]'::jsonb;

/* url_virtual queda como compatibilidad — los eventos viejos se migran al
   array en el primer save desde la UI.  No se borra para no romper datos. */
