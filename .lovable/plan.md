# Fix Microsoft Clarity recording gap (with retroactive recovery)

## Goal
Make Clarity recordings match real cookie consents in real time, **including** users who already accepted CookieYes in past visits and users currently on the site right now. No new prompts, no UX regressions.

## Root cause recap
1. `CookieConsentBanner` only listens for the CookieYes `banner_load` event on `window`. CookieYes fires events on `document` and only once per page load. After a page reload (which CookieYes triggers on Accept), the app often never sees the consent → Clarity never loads.
2. Clarity uses the legacy `clarity('consent', true)` signal; Microsoft now expects `consentv2`. Without it, Clarity may suppress recording for returning visitors.
3. `record-consent` mirroring stopped because the in-app consent state never flips → backend rows haven't been written since May 7.

## Fix (one shipped change, four layers)

### 1. Reconcile CookieYes state on every page load — this is the retroactive piece
On app boot, after CookieYes script readiness (or immediately if it's already loaded from a prior visit):
- Call `window.getCkyConsent()` to read the **already-stored** consent decision (CookieYes persists it in the `cookieyes-consent` cookie across sessions and tabs).
- Also parse the cookie directly as a fallback if the API isn't ready yet.
- Map `categories.analytics === true` → our internal `ConsentState.analytics = 'granted'`, same for `advertisement`/`functional`.
- If analytics is granted and GPC is not present, **load Clarity now** — even though the user accepted hours or days ago and never saw a fresh banner interaction this session.
- Listen on **both** `document` and `window` for `cookieyes_consent_update`, `cookieyes_banner_load`, and `cookieyes_banner_loaded` so future changes are also caught.

**Effect:** Anyone who consented in the last 24 hours (or ever) and returns/refreshes will have Clarity initialize on their very next page view — no action required from them. Users currently on the site will pick it up on their next route change/refresh (which is usually within minutes given SPA navigation).

### 2. Reconcile mid-session for currently-active users
- On the existing route-change effect, re-run the reconcile (cheap idempotent check guarded by a `sessionStorage` "clarity-initialized" flag so it only injects the script once).
- Also reconcile on `visibilitychange` → `visible`, so tabs that have been backgrounded pick up consent without a hard refresh.

**Effect:** People currently using the site get Clarity attached on their next route navigation or tab focus, without needing to hit the banner again.

### 3. Fix Clarity's consent signal
- After `clarity.ms` loads, call both:
  - `window.clarity('consentv2', { ad_Storage: <granted|denied>, analytics_Storage: <granted|denied> })` (current Microsoft API)
  - `window.clarity('consent', true)` (legacy fallback)
- Send the same on every subsequent consent change.

### 4. Restore backend parity
- Every reconciled state (including the recovered-from-storage path) calls `record-consent` once.
- Dedupe by `(consent_id, state_hash)` in `sessionStorage` so SPA route changes don't spam rows.
- Backfill: a one-shot effect on app load posts the recovered state if `cookie_consents` has no row for this `consent_id` yet — closes the May 7 → today gap for any returning user.

### 5. Resilience
- All CookieYes calls wrapped in try/catch; failure never breaks the app.
- If CookieYes is blocked (ad blocker), we fall back to our own `tfn.consent.v1` localStorage state and still honor it for Clarity.
- GPC always wins → denies Clarity regardless of stored consent.

## BDD scenarios (inserted into `bdd_scenarios`)
- Returning visitor with stored CookieYes analytics=true loads Clarity on first page view of new session [UI][Code]
- Current session reconciles on route change and loads Clarity without banner interaction [UI][Code]
- Reconcile writes one `cookie_consents` row per unique `(consent_id, state)` [DB]
- GPC present blocks Clarity even when stored consent is granted [Code]
- CookieYes blocked by ad blocker → app still honors `tfn.consent.v1` and loads Clarity if granted [Code]
- `consentv2` payload sent to Clarity after script load [Code]
- Backfill writes missing `cookie_consents` row for returning user whose decision predates May 7 outage [DB]

## Files touched
- `src/lib/consent/cookieyes.ts` (new) — `readStoredCookieYesConsent()`, event binding on both targets
- `src/lib/consent/loadAnalytics.ts` — add `consentv2`, sessionStorage init guard, visibility/route reconcile
- `src/components/CookieConsentBanner.tsx` — call reconcile on mount + route change + visibilitychange
- `supabase/functions/record-consent/index.ts` — accept `source: 'reconcile' | 'banner' | 'backfill'` for observability
- BDD migration inserting the scenarios above

## Validation
- Live browser test on techfleet.network: load with existing CookieYes cookie → confirm `clarity.ms` request fires and `record-consent` call fires, without touching the banner.
- DB query: `cookie_consents` rows appear today; row count over next 24h should approach today's CookieYes accept count.
- Clarity dashboard: recording count should converge to consent count within ~30 min of deploy as returning visitors come back.

## Out of scope
- No new UX, no extra banner, no extra clicks.
- No change to consent semantics (still opt-in, GPC respected).
