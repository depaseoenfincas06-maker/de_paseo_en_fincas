-- =====================================================================
-- Migration: confirming-flow message templates + video URL placeholder
-- Date: 2026-05-09
-- =====================================================================
-- Adds 4 text columns to agent_settings so the confirming-flow messages
-- (Pasos para Reservar intro, document-ready prompt, post-approval handoff)
-- are editable from the dashboard without prompt changes.
--
-- The VIDEO URL is a placeholder until the operator provides the real one.
-- =====================================================================

alter table public.agent_settings
  add column if not exists confirming_intro_message_template text not null default
'(NOMBRE) te comparto los pasos para reservar la propiedad:

Pasos para Reservar 🏡

Al elegir la propiedad que te enamoró, me brindas por favor los siguientes datos:

•  Nombre Completo
•  Tipo y Número de Documento
•  Número de Celular
•  Correo Electrónico
•  Dirección

Los anteriores se tomarán para generarte la Confirmación de Reserva, una vez emitida y aceptada procedemos a realizar el abono del 50% del total de tu reserva o en su defecto la totalidad de la misma.

Nuestros Medios de Pago son los siguientes:

•  Bancolombia
•  Davivienda
•  Colpatria
•  Nequi
•  Daviplata
•  Tarjeta Crédito - Débito - PSE o presencial en Anapoima, todas ellas + 4% o Efectivo';

alter table public.agent_settings
  add column if not exists confirming_video_url text default
    'https://depf-assets.placeholder/video-pasos-reserva.mp4';

alter table public.agent_settings
  add column if not exists confirming_document_ready_message_template text not null default
'(NOMBRE) te comparto la confirmación de reserva, por favor me autorizas la información con un ok.';

alter table public.agent_settings
  add column if not exists reservation_approved_message_template text not null default
'Perfecto (NOMBRE), en minutos te comparto la información bancaria para que generemos el bloqueo de la propiedad ☀️';

comment on column public.agent_settings.confirming_intro_message_template is
  'First message sent when state transitions to CONFIRMING_RESERVATION. Use (NOMBRE) as placeholder for client name (or empty). The video at confirming_video_url is appended automatically as a second message.';

comment on column public.agent_settings.confirming_video_url is
  'URL of the explainer video sent right after the "Pasos para Reservar" intro. Empty/null = no video.';

comment on column public.agent_settings.confirming_document_ready_message_template is
  'Sent alongside the reservation confirmation PDF when intent=DOCUMENT_READY. Use (NOMBRE) as placeholder.';

comment on column public.agent_settings.reservation_approved_message_template is
  'Sent right before the bot hands off to a human after the client says "ok / listo / aprobado" on the PDF. Use (NOMBRE) as placeholder.';
