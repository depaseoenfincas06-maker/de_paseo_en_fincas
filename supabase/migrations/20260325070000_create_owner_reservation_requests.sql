create table if not exists public.owner_reservation_requests (
  id bigserial primary key,
  conversation_id text not null references public.conversations (wa_id) on delete cascade,
  chatwoot_id text,
  selected_finca_id text not null,
  selected_finca_name text not null,
  selected_finca_snapshot jsonb not null default '{}'::jsonb,
  recipient_phone text,
  phone_source text,
  template_name text not null default 'solicitud_reserva',
  reminder_template_name text not null default 'solicitud_reserva_reminder',
  template_language text not null default 'es_CO',
  status text not null default 'pending_send',
  send_after_at timestamptz,
  initial_sent_at timestamptz,
  initial_provider_message_id text,
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  reminder_provider_message_id text,
  error_message text,
  cancelled_at timestamptz,
  cancel_reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'owner_reservation_requests_status_check'
  ) then
    alter table public.owner_reservation_requests
      add constraint owner_reservation_requests_status_check
      check (status in ('pending_send', 'initial_sent', 'failed', 'cancelled', 'reminder_sent'));
  end if;
end $$;

create unique index if not exists owner_reservation_requests_unique_active_idx
  on public.owner_reservation_requests (conversation_id, selected_finca_id, recipient_phone)
  where recipient_phone is not null
    and status in ('pending_send', 'initial_sent', 'reminder_sent');

create index if not exists owner_reservation_requests_conversation_idx
  on public.owner_reservation_requests (conversation_id, created_at desc);

create index if not exists owner_reservation_requests_status_idx
  on public.owner_reservation_requests (status, created_at desc);
