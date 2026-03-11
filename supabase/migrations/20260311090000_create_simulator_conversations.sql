create table if not exists public.simulator_conversations (
  id text primary key,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists simulator_conversations_updated_at_idx
  on public.simulator_conversations (updated_at desc, created_at desc);
