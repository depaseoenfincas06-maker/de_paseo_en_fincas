alter table if exists public.conversations
  add column if not exists pending_burst_version integer not null default 0,
  add column if not exists pending_burst_last_message_at timestamptz,
  add column if not exists last_processed_inbound_at timestamptz,
  add column if not exists active_burst_claim text,
  add column if not exists active_burst_claimed_at timestamptz;

update public.conversations c
set last_processed_inbound_at = latest_inbound.latest_created_at
from (
  select
    m.conversation_id,
    max(m.created_at) as latest_created_at
  from public.messages m
  where m.direction = 'INBOUND'
  group by m.conversation_id
) as latest_inbound
where c.wa_id = latest_inbound.conversation_id
  and c.last_processed_inbound_at is null;

create index if not exists conversations_pending_burst_last_message_idx
  on public.conversations (pending_burst_last_message_at desc nulls last);

create index if not exists conversations_last_processed_inbound_idx
  on public.conversations (last_processed_inbound_at desc nulls last);
