// @edge-auth required
// P0 observability — environment-readiness (edge secrets half).
//
// Companion to the DB-side public.environment_readiness() (migration
// 20260708030000). SQL cannot read the Deno edge runtime's env, so this
// function reports the PRESENCE (never the value) of the edge-function secrets
// the app depends on — the class of thing that was silently unset after the
// cutover (LOVABLE_API_KEY, RESEND_API_KEY, DISCORD_*, FREESCOUT_*, etc.).
//
// Auth: admin JWT OR service-role bearer. Returns booleans only — no secret
// values ever leave the function (EMAIL_PROVIDER's value is returned because it
// is a non-secret mode flag and is the single most useful diagnostic).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeServiceRoleRequest } from '../_shared/service-role-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// name → { category, required }. Presence only; never the value.
const SECRETS: Array<{ name: string; category: string; required: boolean }> = [
  { name: 'SUPABASE_URL', category: 'core', required: true },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', category: 'core', required: true },
  { name: 'SUPABASE_ANON_KEY', category: 'core', required: false },
  // Email (Resend / v2)
  { name: 'RESEND_API_KEY', category: 'email', required: true },
  { name: 'EMAIL_FROM_ADDRESS', category: 'email', required: false },
  { name: 'AUTH_EMAIL_HOOK_SECRET', category: 'email', required: true },
  // Captcha
  { name: 'TURNSTILE_SECRET_KEY', category: 'auth', required: true },
  // Support desk
  { name: 'FREESCOUT_API_KEY', category: 'support', required: true },
  { name: 'FREESCOUT_WEBHOOK_SECRET', category: 'support', required: false },
  // Discord
  { name: 'DISCORD_BOT_TOKEN', category: 'discord', required: true },
  { name: 'DISCORD_GUILD_ID', category: 'discord', required: true },
  // Integrations
  { name: 'AIRTABLE_API_KEY', category: 'integrations', required: false },
  // Legacy (should be UNSET once fully off Lovable)
  { name: 'LOVABLE_API_KEY', category: 'legacy', required: false },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  // Authorize: service-role bearer OR an admin JWT.
  let authorized = authorizeServiceRoleRequest(req).ok;
  if (!authorized) {
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token) {
      try {
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
          authorized = isAdmin === true;
        }
      } catch { /* fall through to 403 */ }
    }
  }
  if (!authorized) return json({ error: 'Forbidden' }, 403);

  const provider = (Deno.env.get('EMAIL_PROVIDER') ?? 'lovable').toLowerCase();
  const secrets = SECRETS.map((s) => {
    const present = (Deno.env.get(s.name) ?? '').trim().length > 0;
    return {
      name: s.name,
      category: s.category,
      present,
      required: s.required,
      status: present ? 'ok' : (s.required ? 'missing' : 'unset'),
    };
  });

  const missingRequired = secrets.filter((s) => s.required && !s.present).map((s) => s.name);
  return json({
    ok: missingRequired.length === 0,
    email_provider: provider, // non-secret mode flag; should be 'resend'
    missing_required: missingRequired,
    secrets,
    checked_at: new Date().toISOString(),
  });
});
