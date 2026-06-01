# Get Help — Freescout-powered support center

New **Community → Get Help** wrapping self-hosted Freescout. Members manage their own tickets; admins triage every ticket. On-demand fetch + Freescout webhook for freshness.

## Architecture

```text
Browser (Supabase JWT)
  → edge fns (freescout-proxy, provision-*)  → Freescout (FREESCOUT_API_KEY)
                                                    │  HMAC webhook
                                                    ▼
                                            freescout-webhook → notifications + realtime
```

- Auth: single admin API key in secrets (`FREESCOUT_API_URL`, `FREESCOUT_API_KEY`, `FREESCOUT_WEBHOOK_SECRET`, `FREESCOUT_DEFAULT_MAILBOX_ID`).
- Identity: `profiles.freescout_customer_id` (members) + `profiles.freescout_user_id` (admins).
- Resilience: CircuitBreaker + exponential backoff; 15s edge cache + 30s React Query staleTime.

## Provisioning

**Members (Freescout customers — lazy on first ticket)** via `ensureCustomer()` inside `freescout-proxy action=create`: check profile → `GET /customers?email=` → else `POST /customers`. Webhook backfills from inbound email. Advisory lock `freescout_customer:<user_id>` prevents race; `freescout-sync-customer` on profile change/deletion.

**Admins (Freescout users — auto on promotion confirm)** via `freescout-provision-admin` after `user_roles` insert: `GET /users?email=` → attach if exists, else `POST /users` with `sendInvite:true`, attach mailbox, store `freescout_user_id`, in-app "Your help desk account is ready". Idempotent on demote/re-promote. Resend invite + deactivate from System Health.

**Backfill** via `support_backfill_provisioning(mode)` RPC (admin-only): `admins` provisions all existing admins at 1/sec; `members` only resolves existing customers (no auto-create). Progress + failure CSV in System Health → Help Desk.

**Observability**: `support_provisioning_log` (user_id, kind, freescout_id, status, attempts, last_error). Failures → `agent_fix_queue`.

## Data model

- `profiles.freescout_customer_id` + `profiles.freescout_user_id` (nullable, unique-when-not-null, indexed).
- `support_ticket_pointers` (conv id, customer_user_id, last_status, is_private, last_synced_at) — fast "my tickets" + RLS scoping.
- `support_ticket_events` append-only webhook feed.
- `support_provisioning_log`.
- `support_webhook_events` (event_id PK) — webhook idempotency.
- `support_rate_limits` (subject, action, window_start, count).
- `support_categories_monthly_mv` for admin monthly report.

RLS: members `SELECT` own rows; admins full via `has_role`; no client writes — service-role only.

## Edge functions

1. `freescout-proxy` (verify_jwt=true) — actions `listMine|listAll|get|create|reply|close|reopen|assign|setPrivate|categories`.
2. `freescout-webhook` (verify_jwt=false; HMAC + replay window).
3. `freescout-provision-admin` (admin-only) — `provision|resend_invite|deactivate|sync_mailboxes`.
4. `freescout-sync-customer` (service role).
5. `support-monthly-report` (cron) — MV refresh.
6. `support-provisioning-retry` (cron 6h).

## UI — `/community/get-help`

**Member**: header + "New ticket", Open/Closed/All tabs, default Card list (View Preferences) + Table (AG Grid) toggle, detail drawer (DOMPurify-sanitized thread + reply + close/reopen), new-ticket modal.

**Admin**: extra "All tickets" tab — AG Grid server-paginated, filters (status/assignee/category/date), saved views, row actions (Assign me, Assign admin, Mark Private, Reply, Change status). Reports panel (Recharts from MV, month picker, CSV). Personal "My tickets" tab.

Sidebar: **Community → Get Help** (`LifeBuoy`). System Health → **Help Desk** tab.

## Notifications

In-app: `ticket_created|admin_replied|assigned_to_you|assigned_self|status_changed|closed|freescout_account_ready`. Deep-link to ticket. Email via React Email templates (Reply-To = Freescout mailbox so email replies thread). Realtime via Supabase channels.

## Security & hardening — OWASP-aligned

Every layer ships in phase 1, matching the rest of the platform.

**A01 Broken Access Control** — Triple-gated: (1) RLS on every table; (2) `has_role` re-check inside every edge fn before any Freescout call; (3) ownership re-verification (`conversation.customer.id === profile.freescout_customer_id`) before any member read/write — never trust client-supplied conversation id. Admin-only actions (`listAll`, `assign`, `setPrivate`, `deactivate`, backfill) gated by `has_role + is_elevated` (MFA). No client writes anywhere.

**A02 Cryptographic Failures** — HTTPS-only Freescout URL (rejected at boot if not `https://`). Secrets only in Supabase secrets, redacted in shared logger, never returned to client. HMAC-SHA256 webhook verify with constant-time compare + `Date` header ±5 min window. Admin TOTP/MFA already enforced project-wide (`is_elevated`).

**A03 Injection** — Zod discriminated-union on every edge-fn input (body + query + headers we read); unknown action → 400. All Freescout calls use parameterized JSON / `encodeURIComponent` on path params. Postgres only via Supabase client — no raw SQL on user input. Input limits (subject ≤200, body ≤10 000) + subject character allowlist. DOMPurify strict allowlist on every Freescout HTML render; `target=_blank rel=noopener noreferrer` forced; `javascript:` URIs stripped.

**A04 Insecure Design** — `docs/threat-model.md` covers ticket-takeover, IDOR, email spoofing, webhook replay, rate-limit bypass, provisioning races. Freescout stays source of truth — we mirror only pointers, limiting breach blast radius. Advisory locks guard provisioning races; idempotency keys guard webhook replays. Private-ticket flag stored server-side as Freescout custom field, not a client toggle.

**A05 Security Misconfiguration** — New edge fns enumerated in `validate-edge-functions.mjs`; CI fails if any new public endpoint lacks JWT or HMAC verify. `supabase/config.toml` change limited to `freescout-webhook` (`verify_jwt=false`) — lint-checked. Every new public-schema table ships GRANTs + RLS + deny-by-default policies in the same migration (no `using (true)`). No new third-party iframes — CSP unchanged.

**A06 Vulnerable Components** — No new client deps beyond existing (DOMPurify, AG Grid, Recharts). Existing Dependabot grouped PRs + CycloneDX SBOM cover the new edge-fn imports.

**A07 Identification & Authentication** — Member identity bound to `auth.uid()` from `supabase.auth.getClaims()` — never email from request body. Profile email is immutable (existing constraint) → cannot hijack a Freescout customer by changing email. Admin provisioning derived from `user_roles + has_role + is_elevated`; no plaintext invite token in our DB — Freescout's own invite flow handles password set. Session revocation + idle timeout cover help-desk sessions.

**A08 Software & Data Integrity** — `support_webhook_events(event_id PK)` for HMAC-verified idempotency; duplicate → 200 no-op. `support_provisioning_log` + `support_ticket_events` append-only (no UPDATE/DELETE policies). Status-changing edge fns re-fetch conversation from Freescout before writing local pointer (TOCTOU defense).

**A09 Security Logging & Monitoring** — Structured logs via existing `logger.service` per action: actor user_id, role, action, conversation_id, latency_ms, outcome. PII redacted by shared redactor. Failures route to `agent_fix_queue` (warn for 3rd-party flakiness, error for auth/RLS failure) → Triage Daily Digest + Critical Push. Admin actions (`assign`, `setPrivate`, `deactivate`, backfill) also write to hash-chained `audit_log` (SOC 2 retention carve-out).

**A10 SSRF** — Freescout base URL pinned via env at boot; allowlist rejects non-`https://` or wrong host. Attachment downloads proxied through edge fn with 10 MB cap + content-type allowlist; client never follows arbitrary Freescout URLs. Webhook handler never fetches user-supplied URLs.

**Cross-cutting**
- **Rate limiting** in `support_rate_limits`: members 10 creates/hr, 60 replies/hr; admins 600 actions/hr. 429 with `Retry-After`; sustained breach → triage warn.
- **CSRF**: JWT in `Authorization` header (not cookies) — no CSRF surface.
- **CircuitBreaker** opens after 5 consecutive Freescout 5xx in 60s; auto-probe 30s; `external_api_recovered` self-heal event on success (Lane-2 logging).
- **Idempotency keys** on `create|reply|assign` from client — safe retries.
- **Edge limits**: 256 KB max body; `application/json` only on proxy; webhook validated against schema.
- **Attachments**: dedicated bucket, `application/*|image/*|text/*` allowlist, 10 MB cap; Freescout pulls via URL — no inline ticket-body storage.
- **Secrets rotation** runbook: dual-secret window in webhook verifier for 24h zero-downtime rotation of `FREESCOUT_API_KEY` + `FREESCOUT_WEBHOOK_SECRET`.
- **Pentest gates**: `scripts/pentest/edge-functions.mjs` extended with anonymous, member-as-other-member, and member-as-admin probes per new action; CI blocks on regression.

## BDD (tri-layer in `bdd_scenarios`)

Tags `GH-MEM-*`, `GH-ADM-*`, `GH-PROV-*`, `GH-SEC-*`. Covers: member create/reply/close, admin assign/private/monthly report, email-in path, admin promotion → user created, existing-user attach, demote/re-promote, backfill, plus security: GH-SEC-001 cross-member fetch blocked; -002 member denied admin actions; -003 bad HMAC rejected; -004 stale-timestamp webhook rejected; -005 duplicate webhook no-op; -006 unknown action rejected; -007 oversized body rejected; -008 DOMPurify strips script/javascript URIs; -009 rate-limit 429 + triage warn; -010 CircuitBreaker opens + recovery emits self-heal; -011 API key never logged; -012 pentest probes return 401/403 on every new action.

## Phased delivery (one shipment)

1. Secrets + schema (incl. webhook idempotency + rate-limit tables) + RLS + GRANTs + sidebar entry.
2. `freescout-proxy` + `freescout-webhook` (HMAC + replay + idempotency) + DOMPurify + CircuitBreaker + rate-limit helper + Zod schemas.
3. Provisioning: admin auto on confirm + lazy member + advisory locks + `support_provisioning_log` + retry cron + System Health Help Desk tab + backfill RPC + initial backfill run.
4. Member UI.
5. Admin UI + monthly report MV/cron.
6. Notifications + realtime + `freescout_account_ready`.
7. BDD seed + pentest probes + a11y audit + secrets-rotation runbook + threat-model doc.

## Open items

- Freescout base URL + API-key scopes.
- `FREESCOUT_DEFAULT_MAILBOX_ID`.
- Category source (custom field vs tag).
- Recommend Freescout custom field `private_assignee_user_id` for Private Ticket.

Approve to ship all 7 phases in one shipment.
