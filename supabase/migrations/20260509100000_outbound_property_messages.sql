-- =====================================================================
-- Migration: outbound_property_messages — link Chatwoot message IDs to fincas
-- Date: 2026-05-09
-- =====================================================================
-- When the customer replies (on WhatsApp) to a specific image or card from
-- a property listing, Chatwoot forwards content_attributes.in_reply_to with
-- the message ID being replied to. We need to map that ID back to the
-- finca, so the agent has context even if the customer never typed the code.
--
-- This table is filled by the Chatwoot Outbound Sender workflow each time
-- it pushes a property card or media-group to a customer. Reads happen in
-- the Chatwoot Inbound workflow's Normalize step.
-- =====================================================================

create table if not exists public.outbound_property_messages (
  chatwoot_message_id bigint primary key,
  chatwoot_conversation_id bigint not null,
  finca_id text not null,
  property_title text,
  attachment_id bigint,                              -- if media: the Chatwoot attachment ID
  message_kind text not null check (message_kind in ('card', 'media', 'document')),
  sent_at timestamptz not null default now()
);

create index if not exists outbound_property_messages_conv_sentat_idx
  on public.outbound_property_messages (chatwoot_conversation_id, sent_at desc);

create index if not exists outbound_property_messages_finca_idx
  on public.outbound_property_messages (finca_id);

comment on table public.outbound_property_messages is
  'Maps Chatwoot message IDs (sent by the bot for a property card/image) to the finca_id, so when the customer replies to a specific card/photo we can recover which finca they meant. Filled by Outbound Sender workflow, read by Chatwoot Inbound normalize step. Records older than ~60 days can be pruned.';
