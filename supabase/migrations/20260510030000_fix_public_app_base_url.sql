-- Fix public_app_base_url to point to the production Vercel alias.
-- Was set to a preview deployment URL ('-7cky87fp2-...') that's
-- protected by Vercel preview auth (returns 401 to anonymous callers).
-- The Outbound Sender couldn't download the PDF for upload to Chatwoot,
-- so it fell back to sending the URL as text — and the customer got a
-- broken (auth-walled) link.
--
-- Production alias 'de-paseo-en-fincas.vercel.app' auto-tracks main and
-- is publicly accessible.
UPDATE public.agent_settings
SET public_app_base_url = 'https://de-paseo-en-fincas.vercel.app'
WHERE id = 1;
