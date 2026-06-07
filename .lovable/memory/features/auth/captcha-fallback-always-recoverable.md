---
name: Captcha fallback always recoverable
description: TurnstileChallenge must surface magic-link recovery on persistent network errors, not only when the script never loads
type: feature
---

# Captcha fallback — no stranded members

## Rule
`src/components/auth/TurnstileChallenge.tsx` MUST render the magic-link
recovery UI (Retry + "Email me a sign-in link") for BOTH:

1. `loadFailed` (6s watchdog with no widget id), AND
2. Persistent challenge errors on the login surface — i.e.
   `action === "login"` AND `transientError ∈ {network, unknown}` AND
   `consecutiveFailuresRef.current >= 2`.

The recovery UI MUST NOT be gated solely on `loadFailed`. Brave Shields,
ad-blockers, corporate proxies, and transient Cloudflare incidents let the
script load but error out the challenge — telemetry shows this is the
dominant failure mode (1,128 `network`-class failures / 7 days vs. only a
handful of true load failures).

## Why
Without the inline fallback, members get stuck on "Retrying…" indefinitely
with no path forward. The magic-link edge function
(`send-magic-link`, `@edge-auth required`, pinned) is the supported escape
hatch and is per-IP rate-limited to 3/hr server-side.

## BDD AUTH-CAPTCHA-FALLBACK-001..003
- 001 Turnstile script never loads → fallback after 6s watchdog.
- 002 Turnstile script loads but errors with code `300xxx` twice → fallback
  appears immediately (no 30s wait).
- 003 Magic-link CTA disabled until email field has a value; clicking
  invokes `send-magic-link` and shows generic "if account exists" copy.
