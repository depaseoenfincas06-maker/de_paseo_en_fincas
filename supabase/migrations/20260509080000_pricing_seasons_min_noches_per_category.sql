-- =====================================================================
-- Migration: per-category minimum nights inside pricing_seasons
-- Date: 2026-05-09
-- =====================================================================
-- Extends each range entry in pricing_seasons with an optional `min_noches`
-- field. Splits the previous combined "Navidad y Año Nuevo" range into two
-- separate ranges so each can carry its own minimum:
--
--   • Festivos / puentes: 2 noches mínimo
--   • Semana Santa: 3 noches mínimo
--   • Navidad: 3 noches mínimo
--   • Año Nuevo: 5 noches mínimo
--   • Temporada alta general (mitad de año): 3 noches mínimo
--
-- The `min_noches` from the Sheet (per finca) keeps applying ONLY for nights
-- classified as `standard`. The pricing engine inside Code in JavaScript1
-- computes the effective minimum as max(applicable range min_noches,
-- finca.min_noches if any standard night present in booking).
-- =====================================================================

update public.agent_settings
set
  pricing_seasons = jsonb_build_object(
    'festivos_y_puentes', jsonb_build_array(
      jsonb_build_object('from','2026-01-01','to','2026-01-01','label','Año Nuevo','min_noches',2),
      jsonb_build_object('from','2026-01-12','to','2026-01-12','label','Reyes Magos (lunes festivo)','min_noches',2),
      jsonb_build_object('from','2026-03-23','to','2026-03-23','label','San José (lunes festivo)','min_noches',2),
      jsonb_build_object('from','2026-05-01','to','2026-05-01','label','Día del trabajo','min_noches',2),
      jsonb_build_object('from','2026-05-18','to','2026-05-18','label','Ascensión del Señor (lunes)','min_noches',2),
      jsonb_build_object('from','2026-06-08','to','2026-06-08','label','Corpus Christi (lunes)','min_noches',2),
      jsonb_build_object('from','2026-06-15','to','2026-06-15','label','Sagrado Corazón (lunes)','min_noches',2),
      jsonb_build_object('from','2026-06-29','to','2026-06-29','label','San Pedro y San Pablo (lunes)','min_noches',2),
      jsonb_build_object('from','2026-07-20','to','2026-07-20','label','Día de la Independencia','min_noches',2),
      jsonb_build_object('from','2026-08-07','to','2026-08-07','label','Batalla de Boyacá','min_noches',2),
      jsonb_build_object('from','2026-08-17','to','2026-08-17','label','Asunción de la Virgen (lunes)','min_noches',2),
      jsonb_build_object('from','2026-10-12','to','2026-10-12','label','Día de la Raza (lunes)','min_noches',2),
      jsonb_build_object('from','2026-11-02','to','2026-11-02','label','Todos los Santos (lunes)','min_noches',2),
      jsonb_build_object('from','2026-11-16','to','2026-11-16','label','Independencia de Cartagena (lunes)','min_noches',2),
      jsonb_build_object('from','2026-12-08','to','2026-12-08','label','Día de la Inmaculada Concepción','min_noches',2)
    ),
    'semana_santa', jsonb_build_array(
      jsonb_build_object('from','2026-03-29','to','2026-04-05','label','Semana Santa 2026','min_noches',3)
    ),
    'temporada_alta', jsonb_build_array(
      jsonb_build_object('from','2026-12-22','to','2026-12-26','label','Navidad 2026','min_noches',3),
      jsonb_build_object('from','2026-12-27','to','2027-01-04','label','Año Nuevo 2026-2027','min_noches',5),
      jsonb_build_object('from','2026-06-15','to','2026-07-15','label','Vacaciones de mitad de año 2026','min_noches',3)
    )
  ),
  updated_at = now()
where id = 1;

-- Update column comment to reflect the new shape
comment on column public.agent_settings.pricing_seasons is
  'JSONB with three arrays of {from,to,label,min_noches?}: festivos_y_puentes, semana_santa, temporada_alta. Any date NOT in these ranges is treated as standard. Ranges are inclusive on both ends. min_noches is optional and overrides the finca-level min_noches when the booking covers that range. Sheet-level min_noches (per finca) only applies when the booking includes at least one standard night. All dates ISO YYYY-MM-DD in America/Bogota.';
