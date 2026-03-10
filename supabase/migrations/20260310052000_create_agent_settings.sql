create table if not exists public.agent_settings (
  id integer primary key default 1 check (id = 1),
  tone_preset text not null default 'calido_profesional',
  tone_guidelines_extra text not null default '',
  initial_message_template text not null,
  handoff_message text not null,
  owner_contact_override text,
  global_bot_enabled boolean not null default true,
  followup_enabled boolean not null default true,
  followup_window_start time without time zone not null default time '08:00',
  followup_window_end time without time zone not null default time '22:00',
  followup_message_qualifying text not null,
  followup_message_offering text not null,
  followup_message_verifying_availability text not null,
  inventory_sheet_enabled boolean not null default true,
  inventory_sheet_document_id text not null,
  inventory_sheet_tab_name text not null,
  coverage_zones_text text not null,
  max_properties_to_show integer not null default 3 check (max_properties_to_show between 1 and 10),
  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now()
);

insert into public.agent_settings (
  id,
  tone_preset,
  tone_guidelines_extra,
  initial_message_template,
  handoff_message,
  owner_contact_override,
  global_bot_enabled,
  followup_enabled,
  followup_window_start,
  followup_window_end,
  followup_message_qualifying,
  followup_message_offering,
  followup_message_verifying_availability,
  inventory_sheet_enabled,
  inventory_sheet_document_id,
  inventory_sheet_tab_name,
  coverage_zones_text,
  max_properties_to_show
)
values (
  1,
  'calido_profesional',
  '',
  'Excelente día!🤩🌅
Mi nombre es Santiago Gallego
Depaseoenfincas.com, estaré frente a tu reserva!⚡
Por favor indícame:
*Fechas exactas?
*Número de huéspedes?
*Localización?
*Tarifa aproximada por noche

🌎 En el momento disponemos de propiedades en Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio.',
  'Te voy a pasar con un asesor humano para continuar con tu solicitud.',
  null,
  true,
  true,
  time '08:00',
  time '22:00',
  'Hola, sigo atento para ayudarte con la búsqueda de tu finca. Si quieres, compárteme fechas, número de personas y zona y retomamos.',
  'Hola, sigo atento. Si quieres, te comparto más opciones o ajustamos la búsqueda por zona, capacidad o presupuesto.',
  'Hola, sigo atento con tu solicitud. Si quieres, también puedo ayudarte a revisar otra opción similar.',
  true,
  '1AHeDsZin_U5ZzfAB50i7JZvOoJcP9uAM71RRZgnDlgo',
  'fincas_inventory_ajustada_real',
  'Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio',
  3
)
on conflict (id)
do nothing;
