-- 0060 · Cómo llega el público al evento: tres modos de publicación.
--
-- Hasta ahora sólo había un camino: /explorar/<slug> pintaba la landing que se
-- arma en el editor. Pero hay organizadores que ya tienen web propia y no
-- quieren una segunda, y otros que quieren la suya con trozos de GESTEK dentro.
-- Eso son tres decisiones distintas y no se puede adivinar cuál es:
--
--   'gestek'  — la landing de GESTEK es la página del evento. Es el default y
--               es lo que hacía todo el mundo hasta hoy.
--   'externa' — el evento vive en la web del organizador. El enlace público de
--               GESTEK lleva allí. La landing sigue existiendo como respaldo.
--   'iframe'  — el evento vive en la web del organizador, pero el contenido
--               (boletas, agenda, mapa, torneos, ranking, expositores) se sirve
--               desde GESTEK incrustado. Se distingue de 'externa' porque aquí
--               los /embed/* SON el producto y el editor los pone delante.
--
-- `url_externa` es obligatoria en los dos modos que salen de GESTEK; lo valida
-- la API con un mensaje legible en vez de un check de base que reventaría a
-- mitad de edición. Si aun así llegara vacía, la página pública cae a la
-- landing en vez de dejar al visitante en blanco.

alter table public.eventos
  add column if not exists modo_publico text not null default 'gestek',
  add column if not exists url_externa  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_modo_publico_chk') then
    alter table public.eventos
      add constraint eventos_modo_publico_chk
      check (modo_publico in ('gestek', 'externa', 'iframe'));
  end if;
end$$;

comment on column public.eventos.modo_publico is
  'gestek | externa | iframe — a dónde lleva el enlace público del evento.';
comment on column public.eventos.url_externa is
  'Web del organizador. Obligatoria cuando modo_publico no es ''gestek''.';
