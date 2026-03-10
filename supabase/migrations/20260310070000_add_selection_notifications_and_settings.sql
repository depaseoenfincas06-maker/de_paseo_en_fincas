alter table if exists public.agent_settings
  add column if not exists selection_notification_enabled boolean not null default true,
  add column if not exists selection_notification_recipients text,
  add column if not exists selection_notification_template_name text not null default 'staff_finca_selected_v1',
  add column if not exists selection_notification_template_language text not null default 'es_CO';

update public.agent_settings
set
  selection_notification_enabled = coalesce(selection_notification_enabled, true),
  selection_notification_template_name = coalesce(nullif(trim(selection_notification_template_name), ''), 'staff_finca_selected_v1'),
  selection_notification_template_language = coalesce(nullif(trim(selection_notification_template_language), ''), 'es_CO'),
  updated_at = now()
where id = 1;

create table if not exists public.selection_notifications (
  id bigserial primary key,
  conversation_id text not null references public.conversations (wa_id) on delete cascade,
  selected_finca_id text not null,
  recipient_phone text not null,
  template_name text not null,
  template_language text not null,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp without time zone not null default now(),
  sent_at timestamp without time zone
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'selection_notifications_status_check'
  ) then
    alter table public.selection_notifications
      add constraint selection_notifications_status_check
      check (status in ('pending', 'sent', 'failed', 'skipped_duplicate'));
  end if;
end $$;

create unique index if not exists selection_notifications_unique_active_idx
  on public.selection_notifications (conversation_id, selected_finca_id, recipient_phone)
  where status in ('pending', 'sent');

create index if not exists selection_notifications_conversation_idx
  on public.selection_notifications (conversation_id, created_at desc);

create index if not exists selection_notifications_status_idx
  on public.selection_notifications (status, created_at desc);
