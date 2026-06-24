# Cowork runbook — dashboard config to unblock Google, captcha & CI gates

These three are **dashboard/console tasks only** (no code). They're the real unblock
for Google sign-in, the captcha, and making the CI gates actually run. Do them in any
order. **Never paste a secret key into chat, a commit, or this file** — these all go
into dashboards.

Reference IDs:
- New Supabase project ref: `pzvqxdgoztbfikfuifix` · URL `https://pzvqxdgoztbfikfuifix.supabase.co`
- Production domain: `www.techfleet.network` (+ apex `techfleet.network`)
- Current preview: `https://techfleetnetwork.mdenner.workers.dev`
- GitHub repo: `techfleetworks/techfleetnetwork`
- Turnstile production sitekey (already in code): `0x4AAAAAADEF72dWIkFxiGOU`

---

## 1. GitHub Actions vars/secrets → new project  (unblocks the CI gates — W0.2)

Without these, `bdd-gate` / `bdd-incident-gate` skip-green and `bdd-coverage` can't run.

1. First copy the **service_role key**: Supabase → your project → **Project Settings →
   API** → under "Project API keys" copy the **`service_role`** key (the secret one).
2. GitHub → repo → **Settings → Secrets and variables → Actions**.
3. **Variables** tab → **New repository variable**, add both (these are public, safe as vars):
   - `VITE_SUPABASE_URL` = `https://pzvqxdgoztbfikfuifix.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_yKbfQNAnhEEW-9TPII5_Og_8G7gOzm2`
4. **Secrets** tab → **New repository secret**:
   - `SUPABASE_SERVICE_ROLE_KEY` = (the service_role key from step 1)
5. **Verify:** open any PR touching `src/services/**` or `src/pages/**` → the **BDD gate**
   workflow should now *run* (not show "Skipping — Supabase vars unset").

---

## 2. Google sign-in → native Supabase OAuth on the new project  (fixes the 404 — W1.4)

The code now calls native Supabase OAuth; it needs the provider + redirect URIs wired.

**A. Google Cloud Console** (the existing OAuth client — reuse it so users see the same app):
1. console.cloud.google.com → **APIs & Services → Credentials** → open your **OAuth 2.0
   Client ID** (Web application).
2. **Authorized redirect URIs** → Add: `https://pzvqxdgoztbfikfuifix.supabase.co/auth/v1/callback`
3. **Authorized JavaScript origins** → Add: `https://www.techfleet.network`,
   `https://techfleet.network`, and (to test pre-cutover) `https://techfleetnetwork.mdenner.workers.dev`
4. Save. Copy the **Client ID** and **Client Secret**.

**B. Supabase** → your project → **Authentication → Providers → Google**:
1. Toggle **Enable**. Paste the **Client ID** and **Client Secret** from step A.
2. The page shows the exact **callback URL** — confirm it matches the redirect URI you
   added in A2. Save.

**C. Supabase** → **Authentication → URL Configuration**:
1. **Site URL** = `https://www.techfleet.network`
2. **Redirect URLs** → add: `https://www.techfleet.network/**`, `https://techfleet.network/**`,
   and `https://techfleetnetwork.mdenner.workers.dev/**` (for preview testing).

**Verify:** on the preview (or prod after cutover), click "Sign in with Google" → it should
bounce to Google's account chooser → return signed in (no 404).

---

## 3. Cloudflare Turnstile domain + secret  (fixes "For testing only" — W4.2)

The code already uses the production sitekey on `techfleet.network`; it needs the domain
allowlisted and the matching secret on the edge functions.

1. Cloudflare dashboard → **Turnstile** → open the widget for sitekey
   `0x4AAAAAADEF72dWIkFxiGOU`.
2. **Hostname management / Domains** → add `techfleet.network`, `www.techfleet.network`
   (+ `techfleetnetwork.mdenner.workers.dev` if you want the real widget on the preview).
3. On the same widget page, copy the **Secret Key**.
4. Supabase → **Project Settings → Edge Functions → Secrets** (or `supabase secrets set`)
   → add `TURNSTILE_SECRET_KEY` = (the secret from step 3). The `verify-turnstile` edge
   function reads this for server-side verification.

**Verify:** on `www.techfleet.network`, the captcha shows the normal Cloudflare widget
(no "For testing only" banner) and login completes. *(On the `workers.dev` preview the
test key is by-design and harmless — it always passes.)*

---

## Also pending (Cowork, lower urgency)
- **Apply the `dormant` migration** (`supabase/migrations/20260624000000_fix_queue_dormant_status.sql`)
  to the live DB once it's committed — via the migration pipeline or SQL editor.
- **Security cleanup:** delete the public `migrate-helper` edge function; rotate the new
  Supabase **database password** (it was pasted in chat during setup).
- **apex→www 301** as a Cloudflare redirect rule (then the `enforceCanonicalHost` band-aid
  can be deleted in code).
