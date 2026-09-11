-- P5 (10-sep-2026) — Videos de testimonios + CTA de Instagram en el momento de interés.
--
-- Pedido del cliente (10-sep): el agente no envía los videos de calificaciones ("los famosos")
-- ni invita a seguir el Instagram cuando el prospecto está realmente interesado. Su flujo manual:
--   pregunta por el proceso de pago → texto "Pasos para Reservar" → pedir datos → videos.
--
-- Se configura acá (no en código) para que el operador pueda cambiar videos y textos sin deploy.

alter table public.agent_settings
  add column if not exists testimonial_video_urls text,
  add column if not exists testimonial_videos_max integer not null default 0,
  add column if not exists testimonial_message_template text,
  add column if not exists instagram_cta_template text;

comment on column public.agent_settings.testimonial_video_urls is
  'CSV de URLs de Drive (formato https://drive.google.com/file/d/<id>/view) o UNA URL de carpeta de Drive. Con carpeta, el Outbound Sender la expande a todos sus archivos, pero owner_test_mode_enabled=true la recorta al primero; con CSV explícito eso no pasa.';
comment on column public.agent_settings.testimonial_videos_max is
  '0 = enviar todos. >0 = enviar solo los primeros N (solo aplica al formato CSV).';
comment on column public.agent_settings.testimonial_message_template is
  'Caption del primer video. Admite (NOMBRE).';
comment on column public.agent_settings.instagram_cta_template is
  'Texto que se envía después de los videos invitando a seguir el Instagram.';

update public.agent_settings
set
  testimonial_video_urls = coalesce(nullif(testimonial_video_urls, ''), 'https://drive.google.com/file/d/17B-8AAcNOIfX8yZLWgxEy8QNICjNn3FK/view,https://drive.google.com/file/d/1TuN9-IVViDyJRRsxBTFNvFMTPUtZ0LFJ/view,https://drive.google.com/file/d/1PeFyDPNpND8LlkH3Luw4Q4v0eZmTj6ma/view,https://drive.google.com/file/d/1_dSbZv243jFALrI2mR9-H9-ypcRCpSTH/view,https://drive.google.com/file/d/1P4DXcLAxsmA4SFCDi2XgOaaRRSq2FNIz/view,https://drive.google.com/file/d/15YNZaBbRJsU8_F4CbOHjGYa7xnoOo5L5/view,https://drive.google.com/file/d/17fPPKB8T6vtjA22jc8TLR7sYw9DFb3yP/view,https://drive.google.com/file/d/1en2kr2LBAacskJPtIMPI23vruXRRocGD/view,https://drive.google.com/file/d/1T3qWGtSwUQqUSAquguklz51eY2Bt6tmO/view,https://drive.google.com/file/d/1sQ8uHjjRfhye15rO9kbM2KpeBv2CiXxf/view,https://drive.google.com/file/d/1xNdr05qURM5xNCZxOOkVkacLtZLoNyRL/view,https://drive.google.com/file/d/1epLKb7d4LO8VYKgNstb9KgMNi69kRhbF/view,https://drive.google.com/file/d/11w7IwHML5J6e6Ai2pE6IIz1Yq2Fh4I-u/view'),
  testimonial_message_template = coalesce(nullif(testimonial_message_template, ''),
    '(NOMBRE) aprovecho para enviarte algunas de las calificaciones de nuestros huéspedes en todo Colombia!!! 👌'),
  instagram_cta_template = coalesce(nullif(instagram_cta_template, ''),
    'Te invito a que conozcas más de nosotros y todas las maravillosas propiedades que tenemos para ofrecerte a través de nuestras redes sociales. Síguenos y dale like: https://www.instagram.com/depaseoenfincascol'),
  -- El valor viejo era un placeholder inexistente (depf-assets.placeholder) que nunca entregó nada.
  -- Los videos ahora salen del bloque P5; esta columna queda libre para un video explicativo real.
  confirming_video_url = case when confirming_video_url like '%depf-assets.placeholder%' then '' else confirming_video_url end,
  updated_at = now();
