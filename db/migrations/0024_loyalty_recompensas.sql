/* GESTEK — Fidelidad y recompensas escopadas por organizador.

   Dos audiencias:
   - 'cliente'  : asistente con cuenta que acumula puntos con un organizador
                  asistiendo a sus eventos. Canjea recompensas que ese
                  organizador define. Canje = código automático.
   - 'empleado' : miembro del equipo que acumula puntos trabajando (tareas,
                  check-ins). Ranking global del organizador + por evento.

   points_log (0001) se extiende con organizador_id + audiencia para atribución.
*/

alter table public.points_log
  add column if not exists organizador_id uuid references public.profiles(id) on delete set null,
  add column if not exists audiencia      text not null default 'cliente';
    -- cliente | empleado

create index if not exists points_log_org_aud_idx
  on public.points_log (organizador_id, audiencia, user_id);
create index if not exists points_log_evento_aud_idx
  on public.points_log (evento_id, audiencia) where evento_id is not null;

/* Balance cacheado por (usuario, organizador, audiencia). Es la fuente para
   ranking global y para el saldo canjeable del cliente. */
create table if not exists public.puntos_balance (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  organizador_id uuid not null references public.profiles(id) on delete cascade,
  audiencia      text not null,                     -- cliente | empleado
  puntos         integer not null default 0,
  updated_at     timestamptz not null default now(),
  unique (user_id, organizador_id, audiencia)
);

create index if not exists puntos_balance_rank_idx
  on public.puntos_balance (organizador_id, audiencia, puntos desc);

/* Recompensas que define un organizador, para una audiencia. */
create table if not exists public.recompensas (
  id             uuid primary key default gen_random_uuid(),
  organizador_id uuid not null references public.profiles(id) on delete cascade,
  audiencia      text not null,                     -- cliente | empleado
  titulo         text not null,
  descripcion    text,
  costo_puntos   integer not null check (costo_puntos > 0),
  stock          integer,                           -- null = ilimitado
  canjeados      integer not null default 0,
  activo         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists recompensas_org_idx
  on public.recompensas (organizador_id, audiencia, activo);

/* Canjes realizados. Código automático (estado 'entregado' al crear). */
create table if not exists public.canjes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  organizador_id uuid not null references public.profiles(id) on delete cascade,
  recompensa_id  uuid references public.recompensas(id) on delete set null,
  audiencia      text not null,
  titulo         text not null,                     -- snapshot por si borran la recompensa
  costo_puntos   integer not null,
  codigo         text not null,
  estado         text not null default 'entregado', -- entregado | usado | cancelado
  created_at     timestamptz not null default now()
);

create unique index if not exists canjes_codigo_idx on public.canjes (codigo);
create index if not exists canjes_user_idx          on public.canjes (user_id, created_at desc);
create index if not exists canjes_org_idx           on public.canjes (organizador_id, created_at desc);

/* ── RLS ── */
alter table public.puntos_balance enable row level security;
alter table public.recompensas    enable row level security;
alter table public.canjes         enable row level security;

/* Balance: el usuario ve los suyos; el organizador ve los de su comunidad. */
drop policy if exists pb_self on public.puntos_balance;
create policy pb_self on public.puntos_balance
  for select using (user_id = auth.uid() or organizador_id = auth.uid());

/* Recompensas: el organizador gestiona las suyas; cualquiera autenticado puede
   leer las activas (para que clientes/empleados las vean). */
drop policy if exists recompensas_owner on public.recompensas;
create policy recompensas_owner on public.recompensas
  for all using (organizador_id = auth.uid());

drop policy if exists recompensas_read on public.recompensas;
create policy recompensas_read on public.recompensas
  for select using (activo = true);

/* Canjes: el usuario ve los suyos; el organizador ve los de su comunidad. */
drop policy if exists canjes_self on public.canjes;
create policy canjes_self on public.canjes
  for select using (user_id = auth.uid() or organizador_id = auth.uid());

/* Canje atómico: valida saldo, descuenta puntos, descuenta stock, registra canje.
   Devuelve el código generado o lanza excepción con mensaje claro. */
create or replace function public.canjear_recompensa(p_user uuid, p_recompensa uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec   record;
  v_saldo integer;
  v_codigo text;
begin
  select * into v_rec from public.recompensas where id = p_recompensa for update;
  if not found then raise exception 'Recompensa no encontrada.'; end if;
  if not v_rec.activo then raise exception 'Recompensa no disponible.'; end if;
  if v_rec.stock is not null and v_rec.canjeados >= v_rec.stock then
    raise exception 'Recompensa agotada.';
  end if;

  select coalesce(puntos, 0) into v_saldo
  from public.puntos_balance
  where user_id = p_user and organizador_id = v_rec.organizador_id and audiencia = v_rec.audiencia;

  if coalesce(v_saldo, 0) < v_rec.costo_puntos then
    raise exception 'Puntos insuficientes (tenés %, necesitás %).', coalesce(v_saldo,0), v_rec.costo_puntos;
  end if;

  update public.puntos_balance
    set puntos = puntos - v_rec.costo_puntos, updated_at = now()
    where user_id = p_user and organizador_id = v_rec.organizador_id and audiencia = v_rec.audiencia;

  update public.recompensas set canjeados = canjeados + 1 where id = p_recompensa;

  v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.canjes (user_id, organizador_id, recompensa_id, audiencia, titulo, costo_puntos, codigo)
  values (p_user, v_rec.organizador_id, p_recompensa, v_rec.audiencia, v_rec.titulo, v_rec.costo_puntos, v_codigo);

  return v_codigo;
end$$;
