-- 0070 — Cola de correo con freno por hora
--
-- El problema, medido: cPanel corta en 200 correos por hora de fábrica y
-- pasarse BLOQUEA la cuenta. Con la venta repartida en cuatro semanas la media
-- son ~250/día, que cabe de sobra, pero hay dos picos que no:
--
--   · El día que abren los registros. Cientos de inscripciones en unas horas.
--   · Cualquier envío masivo (recordatorio, campaña): 7.000 de golpe son 35
--     horas al tope, y a mitad de camino el host corta el correo de TODOS,
--     incluidos los que compraron después.
--
-- La cola desacopla «hay que mandar esto» de «mándalo ahora». Un worker la
-- drena a un ritmo configurable, así que un pico se convierte en una fila que
-- avanza sola en vez de en una cuenta bloqueada.
--
-- La prioridad importa: una boleta recién comprada tiene que salir antes que
-- un recordatorio masivo encolado hace una hora. Si no, el primer envío grande
-- deja a los compradores esperando su QR detrás de 7.000 correos.

begin;

create table if not exists public.email_cola (
  id             uuid primary key default gen_random_uuid(),
  evento_id      uuid references public.eventos(id) on delete cascade,
  tipo           text not null,
  destinatario   text not null,
  -- El contexto del render (nombre, código, etc). Se guarda en vez del HTML
  -- ya montado para que un cambio de plantilla afecte a lo que aún no salió.
  ctx            jsonb not null default '{}'::jsonb,
  -- 0 = transaccional (boleta): sale primero. 5 = masivo: espera.
  prioridad      smallint not null default 0,
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'enviado', 'fallido', 'cancelado')),
  intentos       smallint not null default 0,
  proximo_intento timestamptz not null default now(),
  ultimo_error   text,
  enviado_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- El índice que usa el worker en cada pasada. Parcial a propósito: sólo le
-- interesan los pendientes, y con 7.000 enviados detrás no hay que recorrerlos.
create index if not exists idx_email_cola_pendientes
  on public.email_cola (prioridad, proximo_intento)
  where estado = 'pendiente';

create index if not exists idx_email_cola_evento
  on public.email_cola (evento_id, created_at desc);

-- Para el panel: cuánto falta por salir de un evento.
comment on table public.email_cola is
  'Cola de correo. Un worker la drena respetando el tope por hora del proveedor (cPanel corta en 200/h).';
comment on column public.email_cola.prioridad is
  '0 = transaccional (boleta, sale primero). 5 = masivo (recordatorio, campaña).';

-- RLS: nadie entra aquí desde el navegador. El backend usa la service key.
alter table public.email_cola enable row level security;

commit;

-- ── Nota ────────────────────────────────────────────────────────────────
-- Aditiva y aislada: ninguna tabla existente se toca. Si el worker no corre,
-- la cola simplemente se llena y no sale nada — por eso el envío directo
-- sigue siendo el camino por defecto hasta que se encienda con
-- EMAIL_COLA_ACTIVA=1. Encender y apagar no requiere despliegue.
