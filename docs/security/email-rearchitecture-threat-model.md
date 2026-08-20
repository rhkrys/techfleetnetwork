# Threat Model — Email Rearchitecture

- **Date:** 2026-08-18 · **Owner:** mdenner
- **Method:** STRIDE per component, mapped to OWASP Cheat Sheet controls, expressed as `@security`
  BDD scenarios wired into the existing CI security gate.
- **Scope:** consent ledger, tier registry, one-click unsubscribe, inbound Ghost/EO webhooks,
  outbound sync, announcement composer, backfill/reconcile, DSAR propagation.

## Trust boundaries (where checks must live)

1. Internet → **public unsubscribe endpoint** (no auth: the token is the credential).
2. Internet → **inbound webhooks** from Ghost and Email Octopus (untrusted POST bodies).
3. Authenticated member → **consent/preference RPCs** (own data only).
4. Admin → **announcement composer** (privileged send).
5. Platform → **Ghost/EO APIs** (outbound, secret-bearing).
6. Background jobs → **backfill / reconcile / DSAR** (bulk, destructive-capable).

Most risk clusters at 1 and 2 (anonymous internet) and at 3 (the IDOR class).

## Service-role auth: verified already fixed (Step 6)

The earlier unsigned-JWT service_role bypass (audit C1, found 2026-08-08) is **fully remediated in
code, verified 2026-08-18**: `_shared/service-role-auth.ts` grants service-role only by
constant-time exact match against `SUPABASE_SERVICE_ROLE_KEY`; the unsigned-JWT-decode fallback is
gone; all ~23 callers and the four former hand-rolled copies (`email-pipeline-health`,
`resend-signup-confirmations`, `write-exploration-cache`, `refresh-community-events`) gate on the
exact-match check; and `process-freescout-events/auth.test.ts` now asserts a forged JWT is
rejected. No live instance of the pattern remains.

New email functions continue to authenticate explicitly: inbound webhooks by signature, member RPCs
by `auth.uid()`, and any internal/cron worker via `authorizeServiceRoleRequest` (the fixed helper).

**Hardening added by this work — regression guard.** The fix is correct but not structurally
protected: someone could reintroduce the pattern in a new function and only the shared helper's own
test would catch it. PR 1's CI fitness tests add a repo-wide guard that **fails the build** if any
edge function decodes a bearer/JWT payload and trusts a `role` claim for authorization instead of
calling `authorizeServiceRoleRequest` (or verifying a signature). This makes the class of bug
unrepeatable, not just currently-absent.

## Component threats and controls

### 1. One-click unsubscribe (highest-value, most-overlooked)

| STRIDE                  | Threat                                                                                                 | Control                                                                                                                                                                                                             | OWASP               |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Spoofing                | Guess/enumerate another person's unsubscribe URL and unsubscribe them                                  | Opaque per-(person,bucket) token, ≥128-bit, HMAC or random. Never the email in the URL. Token maps server-side; no enumeration                                                                                      | Authorization, IDOR |
| Tampering / repudiation | Email scanners and mail clients **prefetch links (GET)** and auto-unsubscribe people who never clicked | **RFC 8058**: `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. GET shows a confirm page and changes nothing; the state change happens only on **POST**. Preserves true one-click for the user, defeats prefetch | CSRF, API security  |
| Info disclosure         | Email in query string leaks to logs, history, Referer                                                  | Token only, never PII in the URL                                                                                                                                                                                    | Privacy/PII         |
| Elevation               | Unsubscribe accidentally suppresses critical account email                                             | Token is scoped to exactly one bucket (marketing or opportunities); it can never touch Tier 0                                                                                                                       | Business logic      |
| DoS                     | Flood the endpoint                                                                                     | Rate-limit; idempotent (re-POST is a no-op)                                                                                                                                                                         | DoS                 |

### 2. Inbound webhooks (Ghost, Email Octopus)

| STRIDE             | Threat                                                             | Control                                                                                                                                                             | OWASP           |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Spoofing           | Forged webhook: "unsubscribe everyone" / "subscribe these victims" | **Verify signature on the raw body** (EO HMAC-SHA256 with the shared secret; Ghost webhook secret), constant-time compare. Reject on mismatch before any processing | Auth, HMAC      |
| Tampering / Replay | Replay a captured valid webhook                                    | Idempotency by event id + timestamp; reject stale timestamps; store processed ids                                                                                   | API tokens      |
| DoS                | Flood of posts                                                     | Rate-limit, cap body size, buffered/batched processing                                                                                                              | DoS             |
| Elevation          | Unknown/extra fields drive unintended writes                       | Deny by default: only known event types act; the body's email is honored only within the signed scope, never as an authority to change a different account          | Mass assignment |

### 3. Consent / preference RPCs (the IDOR class)

| STRIDE                      | Threat                                                       | Control                                                                                                                                                                                                   | OWASP                |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Elevation / IDOR            | Member A flips Member B's consent by passing B's id/email    | **Subject derived from `auth.uid()` only**, never from a client-supplied id/email. RLS restricts rows to own. (This is the exact Fleety RPC IDOR pattern already seen in this codebase; do not repeat it) | IDOR, Access control |
| Tampering / Mass assignment | Payload sets `source`, `actor`, arbitrary columns, or a role | RPC accepts only the specific boolean(s); server stamps source/timestamp/actor/IP; no client-set provenance                                                                                               | Mass assignment      |
| Elevation                   | SECURITY DEFINER RPC executable by `anon`                    | `authenticated`-only EXECUTE grants; pgTAP guard asserts anon cannot execute (codebase has hit anon-executable DEFINER RPCs before)                                                                       | Access control       |
| Repudiation                 | "I never unsubscribed"                                       | Append-only `consent_event` with actor, source, IP, timestamp is the proof                                                                                                                                | Audit logging        |

### 4. Announcement composer

| STRIDE             | Threat                                                                                               | Control                                                                                                                                                                                                          | OWASP                         |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Elevation          | Non-admin calls the send endpoint directly                                                           | Server-side admin check on the endpoint, not hidden UI                                                                                                                                                           | Function-level access control |
| **Business logic** | A marketing send reaches non-consented people (compliance breach)                                    | Marketing recipients are derived **server-side** only from `consent_current.marketing = subscribed`; the composer cannot supply an arbitrary recipient list; purpose classification is mandatory and **audited** | Business logic                |
| Tampering          | Skip/flip the purpose to blast everyone                                                              | Purpose is server-validated and required; no default that silently sends marketing to all                                                                                                                        | Business logic                |
| Injection          | CRLF in subject (header injection); HTML/script in body (stored XSS in email or the `/updates` feed) | Strip CRLF from subject (already sanitized in code); escape/sanitize body; user content never in a template's instruction position                                                                               | Injection, XSS                |

### 5. Outbound sync to Ghost / EO

| STRIDE          | Threat                                                                                                                 | Control                                                                                              | OWASP               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| Info disclosure | API keys leak via logs or errors                                                                                       | Secrets only from Vault/env; never logged; redacted in errors; rotatable                             | Secrets management  |
| SSRF            | Outbound URL abused to hit internal targets                                                                            | Ghost/EO hosts are fixed config, https-only, no auto-redirect, validated against the configured host | SSRF                |
| DoS / cost      | A reconcile storm or malicious mass consent-change hammers the vendor and racks up cost or triggers vendor rate-limits | Rate-limit and bulkhead the outbound clients; idempotent upserts                                     | DoS, business logic |

### 6. Backfill, reconcile, DSAR (bulk and destructive-capable)

| STRIDE          | Threat                                                          | Control                                                                                                                                   | OWASP                        |
| --------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Tampering / DoS | A bug mass-unsubscribes or mass-deletes real people             | Reconcile **flags** unproven drift, never auto-deletes (owner decision); backfill runs dry-run first with row counts, reversible, audited | Business logic, safe changes |
| Elevation       | DSAR deletion triggered for someone else, or scoped too broadly | Only the account owner or an authorized admin can trigger; deletion is scoped to exactly one subject; completion verified and logged      | Access control, privacy      |
| Repudiation     | No record a deletion/erasure ran                                | Audit the DSAR action and its propagation to each vendor                                                                                  | Audit logging                |

## Lockout / accidental-deletion safety check (Step 0, mandatory)

This release contains permission- and deletion-affecting changes: DSAR propagation, dropping the
`notify_announcements` column, reconcile removals, and new RPC EXECUTE grants. Before each ships:

- **No bulk delete/removal without a bounded, dry-run-verified set** and an override confirmation
  for anything above a threshold.
- **Dropping `notify_announcements`** only after the fitness test proves no sender reads it (expand
  then contract); reversible until the drop.
- **New grants** default to least privilege (`authenticated` only; never `anon`); verified by pgTAP.
- Confirm none of this removes the owner's or the platform's own access.

## Key `@security` scenarios (wired into the CI gate, stored in the feature files)

```gherkin
@security
Scenario: Unsubscribe link cannot be triggered by a link prefetch
  Given a valid unsubscribe token
  When the unsubscribe URL is fetched with GET (as a mail scanner would)
  Then nothing changes, and a confirmation page is shown
  And the opt-out is applied only when the request is POSTed

@security
Scenario: Unsubscribe token for one person cannot affect another
  Given an unsubscribe token issued to person A
  When it is used
  Then only person A's state can change, and no email address is present in the URL

@security
Scenario: Forged webhook is rejected
  When an unsubscribe webhook arrives with an invalid signature
  Then it is rejected before processing and no consent state changes

@security
Scenario: Replayed webhook is ignored
  Given a webhook event that was already processed
  When the identical event is delivered again
  Then it is treated as a no-op

@security
Scenario: A member cannot change another member's consent (IDOR)
  Given member B is authenticated
  When B calls the consent RPC with member A's identifier
  Then the server uses B's own identity and A's consent is unchanged

@security
Scenario: Consent RPC ignores client-supplied provenance
  When a consent update includes a "source" or "actor" field
  Then the server sets those values itself and ignores the client's

@security
Scenario: A non-admin cannot send an announcement
  Given a non-admin is authenticated
  When they call the announcement send endpoint directly
  Then it returns 403 and nothing is sent

@security
Scenario: A marketing announcement reaches only consented people
  Given an announcement classified as Marketing
  When it is sent
  Then every recipient has consent_current.marketing = subscribed
  And the classification, actor, and time are in the audit log

@security
Scenario: Subject line cannot inject email headers
  When an announcement subject contains CR or LF characters
  Then they are stripped before the message is queued

@security @lockout-prevention
Scenario: Reconcile never bulk-removes beyond a safe threshold
  Given the reconcile finds more removals than the safety threshold
  Then it flags for review instead of executing them

@security
Scenario: Worker logs never contain a raw email address
  When any sync/webhook worker logs an event
  Then the log contains a user id or a hash, not a plaintext email
```

## CI additions (complementary to BDD)

- Keep the existing security gate; add these scenarios to it.
- Software Composition Analysis on any new dependency the Ghost/EO clients pull in (`npm audit` in
  CI already exists; ensure new deps are covered).
- The tier-registry fitness tests (no Tier-0 reads a preference; no raw-queue enqueue) are
  structural tests in the same gate.
