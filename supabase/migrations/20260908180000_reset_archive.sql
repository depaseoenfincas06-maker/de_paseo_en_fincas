-- Fase 0 (informe cliente 8-sep-2026): el comando RESET del bot archiva la
-- conversación en vez de perderla. Snapshot jsonb de conversations + messages +
-- follow_on para poder auditar conversaciones exactas después de un Reset.
create table if not exists public.conversations_archive (
  id            bigserial primary key,
  wa_id         text        not null,
  archived_at   timestamptz not null default now(),
  reason        text        not null default 'reset',
  conversation  jsonb       not null,
  messages      jsonb       not null default '[]'::jsonb,
  follow_on     jsonb       not null default '[]'::jsonb
);
create index if not exists conversations_archive_wa_id_idx
  on public.conversations_archive (wa_id, archived_at desc);
comment on table public.conversations_archive is
  'Snapshots de conversaciones borradas por el comando RESET del customer agent (n8n nodo "Archive RESET conversation").';
