-- 0071 — Cada organizador pone el correo con el que sale su evento
--
-- Hasta ahora el remitente era uno solo para toda la plataforma
-- (CPANEL_SMTP_* en el .env). Esto deja que cada organizador conecte SU
-- buzón: el correo sale literalmente de su cuenta, así que la autenticación
-- ya es correcta y no hace falta tocar el DNS de nadie.
--
-- Lo que NO resuelve, y conviene tenerlo escrito: los topes del proveedor
-- del organizador. Gmail gratis ~500/día, Workspace ~2.000/día, un buzón de
-- cPanel 200/hora. Para un evento de 7.000 asistentes esto NO alcanza — sirve
-- para eventos medianos y para que el correo se vea suyo. El envío masivo
-- sigue necesitando la cola con freno (0070) y, en su día, dominio propio.
--
-- La contraseña se guarda CIFRADA (AES-256-GCM, llave en SMTP_CRYPTO_KEY del
-- servidor). La base nunca ve el texto plano, y la API nunca la devuelve.

begin;

create table if not exists public.evento_smtp (
  evento_id    uuid primary key references public.eventos(id) on delete cascade,

  host         text not null,
  puerto       integer not null default 465,
  usuario      text not null,

  -- Cifrado: iv:tag:datos, los tres en hex. Nunca sale de aquí en claro.
  pass_cifrada text not null,

  -- Lo que ve quien recibe. `remitente` debe ser una dirección del mismo
  -- dominio que `usuario`, o el proveedor rechaza el envío.
  remitente        text,
  remitente_nombre text,
  responder_a      text,

  -- Última comprobación real de conexión, para no descubrir en la venta que
  -- la contraseña cambió. La rellena el botón «Probar conexión».
  verificado_at    timestamptz,
  verificado_ok    boolean,
  verificado_error text,

  activo     boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.evento_smtp is
  'Buzón propio del organizador para los correos de su evento. La contraseña va cifrada con SMTP_CRYPTO_KEY; el backend es el único que la descifra.';
comment on column public.evento_smtp.pass_cifrada is
  'AES-256-GCM en formato iv:tag:datos (hex). NUNCA se devuelve por la API.';
comment on column public.evento_smtp.verificado_at is
  'Cuándo se probó la conexión de verdad (login SMTP), no cuándo se guardó.';

-- RLS: esto no se toca nunca desde el navegador. El backend entra con la
-- service key y decide con sus propios permisos.
alter table public.evento_smtp enable row level security;

commit;

-- ── Antes de aplicarla ───────────────────────────────────────────────────
--
-- Hace falta SMTP_CRYPTO_KEY en el servidor: 32 bytes en hexadecimal.
--
--   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
--
-- Si esa llave cambia o se pierde, las contraseñas guardadas **dejan de
-- poder descifrarse** y cada organizador tiene que volver a escribir la suya.
-- Es del mismo tipo que QR_JWT_SECRET: se guarda una vez y no se rota a la
-- ligera.
