alter table if exists public.agent_settings
  add column if not exists public_app_base_url text not null default '',
  add column if not exists global_prompt_addendum text not null default '',
  add column if not exists qualifying_prompt_addendum text not null default '',
  add column if not exists offering_prompt_addendum text not null default '',
  add column if not exists verifying_availability_prompt_addendum text not null default '',
  add column if not exists qa_prompt_addendum text not null default '',
  add column if not exists hitl_prompt_addendum text not null default '',
  add column if not exists confirming_reservation_prompt_addendum text not null default '',
  add column if not exists company_knowledge text not null default '',
  add column if not exists company_documents jsonb not null default '[]'::jsonb,
  add column if not exists payment_methods jsonb not null default '[]'::jsonb;

update public.agent_settings
set
  public_app_base_url = coalesce(public_app_base_url, ''),
  global_prompt_addendum = coalesce(global_prompt_addendum, ''),
  qualifying_prompt_addendum = coalesce(qualifying_prompt_addendum, ''),
  offering_prompt_addendum = coalesce(offering_prompt_addendum, ''),
  verifying_availability_prompt_addendum = coalesce(verifying_availability_prompt_addendum, ''),
  qa_prompt_addendum = coalesce(qa_prompt_addendum, ''),
  hitl_prompt_addendum = coalesce(hitl_prompt_addendum, ''),
  confirming_reservation_prompt_addendum = coalesce(confirming_reservation_prompt_addendum, ''),
  company_knowledge = coalesce(company_knowledge, ''),
  company_documents = coalesce(company_documents, '[]'::jsonb),
  payment_methods = coalesce(payment_methods, '[]'::jsonb)
where id = 1;
