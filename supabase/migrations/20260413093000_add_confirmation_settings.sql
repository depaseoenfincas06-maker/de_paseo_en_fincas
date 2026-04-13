alter table if exists public.agent_settings
  add column if not exists public_app_base_url text not null default '',
  add column if not exists payment_methods_text text not null default $settings$
Bancolombia
Davivienda
Colpatria
Nequi
Daviplata
Tarjeta Crédito/Débito/PSE (+5%)
Efectivo presencial en sedes de Anapoima o Pereira
$settings$;
