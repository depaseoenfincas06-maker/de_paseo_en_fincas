-- =====================================================================
-- Update confirming_intro_message_template — May 2026
-- =====================================================================
-- 1) Drop the lead-in "(NOMBRE) te comparto los pasos para reservar la propiedad:"
--    The warm ack from CLIENT_CHOSE ("Excelente elección, JD. Dale, ya te paso
--    el detalle...") already telegraphed this — repeating it here was redundant.
-- 2) Bold "*Pasos para Reservar 🏡*" (single asterisks = WhatsApp markdown for bold)
-- 3) Bold "*Confirmación de Reserva*" + "*Nuestros Medios de Pago son los siguientes:*"
-- =====================================================================

UPDATE public.agent_settings
SET confirming_intro_message_template = E'*Pasos para Reservar 🏡*\n\nAl elegir la propiedad que te enamoró, me brindas por favor los siguientes datos:\n\n•  Nombre Completo\n•  Tipo y Número de Documento\n•  Número de Celular\n•  Correo Electrónico\n•  Dirección\n\nLos anteriores se tomarán para generarte la *Confirmación de Reserva*, una vez emitida y aceptada procedemos a realizar el abono del 50% del total de tu reserva o en su defecto la totalidad de la misma.\n\n*Nuestros Medios de Pago son los siguientes:*\n\n•  Bancolombia\n•  Davivienda\n•  Colpatria\n•  Nequi\n•  Daviplata\n•  Tarjeta Crédito - Débito - PSE o presencial en Anapoima, todas ellas + 4% o Efectivo'
WHERE id = 1;
