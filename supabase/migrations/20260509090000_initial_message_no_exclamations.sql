-- =====================================================================
-- Migration: refresh initial_message_template (no exclamations, friendlier)
-- Date: 2026-05-09
-- =====================================================================
-- Replaces the v1 default template with the user-approved wording: drops
-- the "¡Excelente día!" header (the LLM was adding ¡! everywhere), uses a
-- numbered list of friendly short questions, and keeps the lightning bolt.
-- =====================================================================

update public.agent_settings
set
  initial_message_template = E'Mi nombre es Santiago Gallego de Depaseoenfincas.com, estaré al tanto de tu reserva.⚡\n\nPara ayudarte a encontrar la finca ideal, por favor cuéntame:\n\n1. ¿Para qué fechas buscas?\n2. ¿Cuántas personas te acompañan?\n3. ¿En qué zona o municipio te gustaría?',
  updated_at = now()
where id = 1;
