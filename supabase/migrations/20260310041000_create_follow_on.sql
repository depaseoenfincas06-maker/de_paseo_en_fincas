create table if not exists public.follow_on (
  id bigint generated always as identity primary key,
  conversation_id text not null references public.conversations(wa_id) on delete cascade,
  message text not null,
  scheduled_for timestamp without time zone not null,
  status character varying not null default 'pendiente',
  sent_at timestamp without time zone,
  cancelled_at timestamp without time zone,
  cancel_reason character varying,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now(),
  constraint follow_on_status_check check (status in ('pendiente', 'enviada', 'cancelada'))
);

create index if not exists follow_on_status_scheduled_for_idx
  on public.follow_on (status, scheduled_for);

create index if not exists follow_on_conversation_id_idx
  on public.follow_on (conversation_id);
