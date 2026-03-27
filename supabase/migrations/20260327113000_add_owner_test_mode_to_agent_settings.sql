alter table if exists public.agent_settings
  add column if not exists owner_test_mode_enabled boolean not null default false;

update public.agent_settings
set
  owner_test_mode_enabled = coalesce(owner_test_mode_enabled, false),
  updated_at = now()
where id = 1;
