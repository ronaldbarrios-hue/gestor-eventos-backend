/* GESTEK — Web push subscriptions.
   Cada dispositivo/browser que opta-in genera una PushSubscription única.
   La identificamos por endpoint. */

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,
  keys        jsonb not null, -- { p256dh, auth }
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists push_subs_endpoint_idx on public.push_subscriptions (endpoint);
create index if not exists push_subs_user_idx           on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

/* El backend usa service_role para enviar, así que las policies son simples:
   el dueño ve y borra las suyas. */
drop policy if exists push_subs_self on public.push_subscriptions;
create policy push_subs_self on public.push_subscriptions
  for all using (user_id = auth.uid());
