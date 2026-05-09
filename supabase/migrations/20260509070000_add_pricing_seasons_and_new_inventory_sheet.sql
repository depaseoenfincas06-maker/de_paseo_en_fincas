-- =====================================================================
-- Migration: add pricing_seasons + switch inventory to the new Sheet
-- Date: 2026-05-09
-- =====================================================================
-- Adds the date-range categorization required by the new pricing engine
-- (standard / festivo+puente / semana santa / temporada alta) and points
-- the inventory loader to the new Google Sheet (1IHxXx_...).
--
-- Default values: Colombian 2026 holidays + Easter 2026 + Christmas/NY
-- 2026-2027. Operator must edit `pricing_seasons` per year via UPDATE
-- (or eventually via dashboard UI).
-- =====================================================================

-- 1. add the new column with a sensible default for 2026
alter table public.agent_settings
  add column if not exists pricing_seasons jsonb not null
    default jsonb_build_object(
      'festivos_y_puentes', jsonb_build_array(
        jsonb_build_object('from','2026-01-01','to','2026-01-01','label','Año Nuevo'),
        jsonb_build_object('from','2026-01-12','to','2026-01-12','label','Reyes Magos (lunes festivo)'),
        jsonb_build_object('from','2026-03-23','to','2026-03-23','label','San José (lunes festivo)'),
        jsonb_build_object('from','2026-05-01','to','2026-05-01','label','Día del trabajo'),
        jsonb_build_object('from','2026-05-18','to','2026-05-18','label','Ascensión del Señor (lunes)'),
        jsonb_build_object('from','2026-06-08','to','2026-06-08','label','Corpus Christi (lunes)'),
        jsonb_build_object('from','2026-06-15','to','2026-06-15','label','Sagrado Corazón (lunes)'),
        jsonb_build_object('from','2026-06-29','to','2026-06-29','label','San Pedro y San Pablo (lunes)'),
        jsonb_build_object('from','2026-07-20','to','2026-07-20','label','Día de la Independencia'),
        jsonb_build_object('from','2026-08-07','to','2026-08-07','label','Batalla de Boyacá'),
        jsonb_build_object('from','2026-08-17','to','2026-08-17','label','Asunción de la Virgen (lunes)'),
        jsonb_build_object('from','2026-10-12','to','2026-10-12','label','Día de la Raza (lunes)'),
        jsonb_build_object('from','2026-11-02','to','2026-11-02','label','Todos los Santos (lunes)'),
        jsonb_build_object('from','2026-11-16','to','2026-11-16','label','Independencia de Cartagena (lunes)'),
        jsonb_build_object('from','2026-12-08','to','2026-12-08','label','Día de la Inmaculada Concepción')
      ),
      'semana_santa', jsonb_build_array(
        jsonb_build_object('from','2026-03-29','to','2026-04-05','label','Semana Santa 2026 (Domingo de Ramos a Domingo de Resurrección)')
      ),
      'temporada_alta', jsonb_build_array(
        jsonb_build_object('from','2026-12-15','to','2027-01-15','label','Navidad y Año Nuevo 2026-2027'),
        jsonb_build_object('from','2026-06-15','to','2026-07-15','label','Vacaciones de mitad de año 2026')
      )
    );

-- 2. backfill any existing row that somehow has NULL (defensive — column has NOT NULL default)
update public.agent_settings
set pricing_seasons = jsonb_build_object(
  'festivos_y_puentes', '[]'::jsonb,
  'semana_santa', '[]'::jsonb,
  'temporada_alta', '[]'::jsonb
)
where pricing_seasons is null;

-- 3. point inventory to the NEW Google Sheet (47-column structure)
update public.agent_settings
set
  inventory_sheet_document_id = '1IHxXx_XneUxh_JNG12Q7r3SM1piZf0m7mmiMzGFDm6E',
  inventory_sheet_tab_name = 'fincas_inventory_v2',  -- placeholder display name; URL uses gid below
  updated_at = now()
where id = 1;

-- 4. comment for future humans
comment on column public.agent_settings.pricing_seasons is
  'JSONB with three arrays of {from,to,label}: festivos_y_puentes, semana_santa, temporada_alta. Any date NOT in these ranges is treated as standard. Ranges are inclusive on both ends. All dates ISO YYYY-MM-DD in America/Bogota.';
