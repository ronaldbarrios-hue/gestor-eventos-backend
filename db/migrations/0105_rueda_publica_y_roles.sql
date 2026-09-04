-- 0105 · La rueda de negocios, con sus tres papeles y una parte pública.
--
-- ── El modelo que faltaba ────────────────────────────────────────────────
--
-- En una rueda hay tres papeles y hasta ahora la base sólo conocía uno:
--
--   · **gestionador** — arma la rueda. Ya existe: es el equipo del evento, con
--     sus permisos. No necesita nada nuevo.
--   · **comprador** — se sienta en una mesa y recibe. Es quien tiene horarios.
--   · **vendedor** — pasa por las mesas. NO se registra solo: lo sienta el
--     gestionador, o contacta por fuera.
--
-- `networking_expositores` ya era «el que está en la mesa con sus horarios y su
-- contacto», que es exactamente el comprador. Lo que faltaba era decirlo: sin
-- un papel escrito, una rueda con las dos figuras mezcladas no se puede pintar.
--
-- Por eso `rol` nace en `comprador`: lo que hay hoy son los que reciben.
--
-- ── Y la parte pública ───────────────────────────────────────────────────
--
-- Lo pedido: que sin entrar a ninguna cuenta se vea la rueda —quién recibe, en
-- qué mesa, a qué horas queda sitio— y un contacto para quien esté interesado.
--
-- ── `contacto_publico`, y por qué por defecto es NO ─────────────────────
--
-- Aquí hay correos y teléfonos de personas. Publicarlos es tratamiento de
-- datos personales (Ley 1581), y **el defecto tiene que ser no publicarlos**:
-- una migración que encienda la publicación de 6 contactos que nadie autorizó
-- es exactamente lo que no se puede hacer, y no se deshace — una vez indexado,
-- ya está fuera.
--
-- Así que se enciende uno por uno, desde el panel, por quien tenga potestad de
-- decirlo. Sin encender, la rueda pública enseña la mesa y los horarios, que no
-- son datos de nadie.

alter table public.networking_expositores
  add column if not exists rol text not null default 'comprador',
  add column if not exists contacto_publico boolean not null default false;

comment on column public.networking_expositores.rol is
  'comprador = recibe en una mesa (tiene horarios). vendedor = pasa por las mesas. El gestionador es el equipo del evento y no vive aquí.';
comment on column public.networking_expositores.contacto_publico is
  'Si su contacto se enseña en la rueda pública. Por defecto NO: son datos personales y publicarlos no se deshace.';

-- La rueda pública se pide siempre igual: los compradores de este evento.
create index if not exists networking_expositores_rueda_idx
  on public.networking_expositores (evento_id, rol);

-- ── Comprobación ─────────────────────────────────────────────────────────
--
--   select rol, contacto_publico, count(*)
--     from public.networking_expositores group by rol, contacto_publico;
--
-- Las 6 filas que hay quedan en `comprador` y `contacto_publico = false`: se
-- ven en la rueda pública con su mesa y sus horas, y sin datos de contacto
-- hasta que alguien los encienda a mano.
--
-- ── Rollback ─────────────────────────────────────────────────────────────
--
--   drop index if exists public.networking_expositores_rueda_idx;
--   alter table public.networking_expositores
--     drop column if exists rol, drop column if exists contacto_publico;
