# Threat model — Get Help (Freescout)

Scope: `/community/get-help` UI, edge functions `freescout-proxy`, `freescout-webhook`, `freescout-provision-admin`, `freescout-sync-customer`, `support-monthly-report`, `support-provisioning-retry`, and the `support_*` schema.

## Assets

- Member ticket contents (PII; stored only in Freescout, mirrored as pointers locally).
- Freescout admin API key and webhook secret (Lovable Cloud secrets).
- Member ↔ Freescout customer identity binding (`profiles.freescout_customer_id`).
- Admin ↔ Freescout user identity binding (`profiles.freescout_user_id`).

## Trust boundaries

- Browser ↔ Edge function: Supabase JWT (verified inside fn for proxy/provision; verify_jwt=true).
- Edge function ↔ Freescout: HTTPS + admin API key (server-side only, never returned to client).
- Freescout ↔ webhook: HMAC-SHA256 signed payload + 5-minute date window.

## Threats and mitigations

| # | Threat | Mitigation |
|---|--------|------------|
| T1 | IDOR — Member A reads Member B's ticket by guessing conversation id | Ownership re-verify in `freescout-proxy` before every member read/write: fetched `conversation.customer.id` must equal `profiles.freescout_customer_id`. RLS on `support_ticket_pointers` is a second gate. |
| T2 | Privilege escalation — Member calls admin actions (`listAll`, `assign`, `setPrivate`) | `has_role(admin) + is_elevated` gate inside the fn; unknown action → 400 via Zod discriminated union. |
| T3 | Webhook spoofing | HMAC-SHA256 constant-time compare on every request; missing/invalid signature → 401. |
| T4 | Webhook replay | `support_webhook_events.event_id` PK enforces single processing; `Date` header ±5 min window. |
| T5 | Provisioning race (double-tab, retry storm) | Advisory lock `freescout_customer:<user_id>` inside `ensureCustomer`; existing customer adopted (no duplicates). |
| T6 | Identity hijack via email change | `profiles.email` is immutable (existing constraint); identity is bound to `auth.uid()` from verified JWT, never request body. |
| T7 | SSRF via Freescout URL manipulation | `FREESCOUT_API_URL` pinned at boot; host allowlist enforced inside `freescoutFetch`; non-`https://` rejected at boot. |
| T8 | XSS via Freescout HTML rendered in the thread view | DOMPurify with strict allowlist on every render; `javascript:` URIs stripped; `target=_blank rel=noopener noreferrer` forced. |
| T9 | Injection via ticket subject/body | Zod validation: subject ≤200 + control-char allowlist; body ≤10,000; size cap 256 KB on request body. |
| T10 | Secret leak in logs | Shared `logger` redacts `FREESCOUT_API_KEY`, `FREESCOUT_WEBHOOK_SECRET`, `Authorization` headers, and customer email body fields. |
| T11 | DoS via ticket flooding | Per-user rate limit (`support_rate_limits`): members 10 creates/hr + 60 replies/hr, admins 600 actions/hr; 429 with `Retry-After`. |
| T12 | Cascade failure when Freescout is down | CircuitBreaker opens after 5×5xx in 60s; auto-probe every 30s; UI banner. `external_api_recovered` self-heal event on success. |
| T13 | TOCTOU — Member changes status of a ticket they no longer own | Status-changing actions re-fetch conversation from Freescout before writing local pointer. |
| T14 | Backfill amplification | `support_backfill_provisioning` paces at 1/sec; admin-only; only `mode=admins` creates, `mode=members` resolves existing only. |
| T15 | Stolen API key | Documented rotation runbook (`docs/runbooks/freescout-secrets-rotation.md`); webhook supports dual-secret 24-hour window. |

## Non-goals

- We do not mirror ticket bodies. Freescout remains source of truth.
- We do not accept inbound email directly — Freescout's own inbox handles that.
- We do not store Freescout passwords; admin password setup goes through Freescout's invite flow.

## Review cadence

Re-review this document whenever a new action is added to `freescout-proxy`, a new edge function in the `freescout-*` / `support-*` family is added, or a new column on `support_*` tables is added.
