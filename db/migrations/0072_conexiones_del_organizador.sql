-- 0072 — Conexiones propias del organizador (empezando por su cuenta de IA)
--
-- El asistente del panel corría con la llave de Anthropic de la PLATAFORMA:
-- cada evento que lo usara nos costaba dinero, y eso no escala — es el mismo
-- razonamiento por el que Mercado Pago y Wompi los conecta cada organizador
-- con SU cuenta, no con la nuestra.
--
-- Esta tabla es genérica a propósito (`tipo`): hoy guarda la llave de
-- Anthropic, mañana la de otro proveedor, sin una migración por cada uno. El
-- valor va cifrado con AES-256-GCM (lib/secretos.js) y no se devuelve nunca
-- por la API: el panel enseña una pista («sk-ant-…4f2a») y la fecha de la
-- última comprobación, no el secreto.

begin;

create table if not exists public.organizador_conexiones (
  owner_id   uuid not null references auth.users(id) on delete cascade,

  -- 'anthropic' hoy. El check se amplía cuando aparezca otro proveedor, en vez
  -- de dejar el campo libre y descubrir tipos inventados meses después.
  tipo       text not null check (tipo in ('anthropic')),

  valor_cifrado text not null,

  -- Lo que sí se puede enseñar: los últimos caracteres, para que el dueño
  -- reconozca cuál de sus llaves puso.
  pista      text,

  -- Ajustes del proveedor que no son secretos (p. ej. qué modelo usar).
  opciones   jsonb not null default '{}'::jsonb,

  activo     boolean not null default true,

  -- Comprobación REAL contra el proveedor, no «las variables están puestas».
  verificado_at    timestamptz,
  verificado_ok    boolean,
  verificado_error text,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  primary key (owner_id, tipo)
);

comment on table public.organizador_conexiones is
  'Credenciales que el organizador conecta con SU cuenta (IA, y lo que venga). Cifradas con SMTP_CRYPTO_KEY; el backend es el único que las descifra.';
comment on column public.organizador_conexiones.pista is
  'Fragmento visible del secreto para que su dueño lo reconozca. Nunca el valor completo.';
comment on column public.organizador_conexiones.verificado_at is
  'Cuándo se comprobó de verdad contra el proveedor, no cuándo se guardó.';

-- RLS: esto no se toca desde el navegador. El backend entra con la service key
-- y decide con sus propios permisos.
alter table public.organizador_conexiones enable row level security;

commit;

-- ── Antes de aplicarla ───────────────────────────────────────────────────
--
-- Necesita SMTP_CRYPTO_KEY en el servidor (la misma que usa la 0071):
--
--   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--
-- Sin ella la tabla se crea, pero guardar una llave devuelve un error claro en
-- vez de escribirla en texto plano.
