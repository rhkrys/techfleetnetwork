# TechFleet Network — Adversarial Security & Quality Audit

**Date started:** 2026-08-08
**Status:** ✅ COMPLETE — Round 1 + full-system pass (16 clusters, 17 agents, 119 findings) merged
**Scope:** Entire system — 117 edge functions, 620 migrations, 866 frontend files, `_shared` libs, `config.toml`, CI/CD, dependencies
**Method:** Independent adversarial subagent auditors, each reading the mapped skill file(s) in full, verified against the source. `VERIFIED` = confirmed in code by the lead; `REPORTED` = auditor-reported, pending confirmation.
**Lenses (6 skills):** owasp-secure-coding-bdd · enterprise-architecture-standards · comprehensive-test-strategy · compliance-data-lifecycle · release-deployment-safety · sre-operational-readiness

> ⚠️ **HANDLING:** This document contains details of a **live, unfixed P0 auth bypass**. Do **not** commit/push to the remote or share externally until the P0 is remediated. Keep internal (or gitignore).

---

## Severity legend

🔴 Critical/P0 · 🟠 High · 🟡 Medium · 🔵 Low · ✅ Verified-good

---

# PART 1 — Round 1: Fleety + Freescout (complete)

## Executive summary (Round 1)

- **2 P0/Critical**, **8 High**, ~10 Medium, ~13 Low.
- **Dominant systemic theme:** hand-rolled auth that trusts an **unsigned** `service_role` JWT — one shared helper + 4 copies, ~19 functions.
- **Second theme:** the **response cache** (permanent, shared) amplifies latent correctness/privacy bugs.
- **Third theme:** **tests don't test behavior** — source-grep smoke tests; `migration-smoke` disabled; the one auth test enshrines the bypass.

---

## 🔴 P0 — Systemic (NOT limited to Fleety)

### S1. Unsigned-JWT `service_role` auth bypass — **VERIFIED**

- **Where:** `supabase/functions/_shared/service-role-auth.ts:47-49` (`authorizeServiceRoleRequest` → `parseJwtClaims`). After the safe exact-key match, it falls back to base64-decoding the JWT payload and trusting `claims.role === "service_role"` **with no signature verification**.
- **Hand-rolled copies of the same flaw:** `fleety-embed/index.ts:104-105`, `notify-critical-fix/index.ts:36-39`, `triage-digest-builder/index.ts:47-50`, `refresh-community-events/index.ts:355-356`.
- **Enabled by:** `config.toml` sets `verify_jwt = false` on these functions, so this code is the _only_ gate.
- **Blast radius (~19 fns):** `process-email-queue`, `replay-email-dlq`, `email-dispatcher`, `reconcile-stuck-emails`, `send-application-confirmation`, `process-freescout-events`, `freescout-sync-customer`, `freescout-provision-customer`, `support-provisioning-retry`, `support-monthly-report`, `gumroad-backfill-all`, `environment-readiness`, `edge-deploy-smoke`, `auth-prober`, `auth-reset-smoke`, + the 4 copies.
- **Failure scenario:** unauthenticated attacker sends `Authorization: Bearer <hdr>.<base64 of {"role":"service_role"}>.<anything>` → `isService = true` → drains queues, replays/sends email, processes Freescout events, triggers billing backfills.
- **Tested-in:** `process-freescout-events/auth.test.ts:41` asserts `ok:true` for a token signed with the literal string `"sig"` — the fix must flip this test.
- **Fix direction:** remove the unsigned-JWT fallback; accept service-role **only** by exact key match. **Lockout caveat (owasp Step 0 / release-safety):** first confirm pg_cron/Vault invokes these with the exact `SUPABASE_SERVICE_ROLE_KEY`, not a legacy JWT, or removal 401-storms the email pipeline. Add a real signature-verifying (or exact-match-only) test.
- **Skills:** owasp (authentication-session, access-control) · comprehensive-test-strategy (test asserts the wrong thing).
- **Not this bug (legit `atob`):** `admin-step-up.ts` / `finalize-password-reset` / `sign-out-all-devices` decode only `aal`/`iat` _after_ a real check; `idempotency.ts` reads `sub`.

---

## 🔴 Critical — Fleety

### F1. SSE stream sanitizer bypass at chunk boundaries — REPORTED

- **Where:** `techfleet-chat/index.ts:1663-1711` (`sanitizeStream.transform`).
- **Defect:** decodes each network chunk and `split("\n")`, assuming whole `data:` lines. A `data:` line split across chunks fails `JSON.parse` and is forwarded **raw/unsanitized** (script/PII/canary evade `sanitizeAIOutput`); also `TextDecoder().decode(chunk)` without `{stream:true}` corrupts multibyte UTF-8 split across chunks.
- **Failure scenario:** Groq streams `data: {"choices":[{"delta":{"content":"<scri` then `pt>…</script>"}}]}` → neither half parses → both forwarded verbatim; the cache buffer also drops the content.
- **Fix direction:** buffer partial SSE lines across chunks (mirror the existing `pendingTail` sentinel logic); use streaming decode; sanitize the reassembled text.
- **Skills:** owasp (api-web-security-headers/XSS, ai-llm-agent-security).

---

## 🟠 High

### F2. Cross-user PII leak via cache key — **VERIFIED** (partial fix applied, needs refinement)

- **Where:** cache key `techfleet-chat/index.ts:1635` = `sha256(audience|question)` with **no `user.id`**; `userContext` (name/project/quest) injected at `:1452`.
- **Defect:** a personalized, grounded answer cached under a user-agnostic key is replayed to the next member asking the same question → PII leak; the permanent cache makes it indefinite.
- **Status:** guard added (`isCacheable` now requires `!userContext` + single-turn). **But the fix is over-broad** — `userContext` also holds a non-PII "Currently viewing: <page>" line sent on nearly every request, so `!userContext` disables the cache almost entirely. **Refine to a precise "contains PII" signal** (name/project/quest), not "has any context."
- **Skills:** owasp (access-control) · compliance (privacy-gdpr, data-classification).

### F3. KB semantic search has no similarity floor → honesty gate never fires — REPORTED

- **Where:** RPC `fleety_kb_semantic_search` (`20260503202421_*.sql:26-38`) returns top-K with no min-similarity; caller `techfleet-chat/index.ts:809-824` applies none (unlike playbooks/examples/canned which do).
- **Defect:** `hasGrounding` is almost always true → `NO_KNOWLEDGE_DIRECTIVE` (UC-04) almost never fires → **the deeper cause of the original fabrication.**
- **Fix direction:** add a distance/similarity threshold to the RPC and caller; only count real hits toward grounding.
- **Skills:** owasp (ai-llm-agent-security) · comprehensive-test-strategy.

### F4. Untrusted KB/RAG content injected raw into the system prompt — REPORTED

- **Where:** KB `:851`, playbooks `:1263`, examples `:1333`, few-shot (prior users' queries) `:1147` → system role `:1575`. `wrapUntrusted`/`defangSentinels` **do not exist on `main`** (were only in the un-merged PR #143).
- **Defect:** indirect prompt injection (LLM01) — a malicious/ingested KB row can countermand system instructions or exfiltrate.
- **Fix direction:** merge/land the neutralization layer (fence retrieved content as data; defang sentinels/canary); screen retrieved content, not just the user message.
- **Skills:** owasp (ai-llm-agent-security, injection).

### F5. Per-delta output sanitization defeated by token splits — REPORTED

- **Where:** `sanitizeAIOutput(content)` applied per `delta.content` fragment (`:1679`, defs `:105-132`).
- **Defect:** PII/canary/script regexes never see reassembled text → split tokens pass through (and into the cache).
- **Fix direction:** sanitize the reassembled visible text, not per-fragment; add a `<think>`/reasoning stripper + a canary-leak tripwire that aborts the turn.
- **Skills:** owasp (ai-llm-agent-security).

### F6. Cache permanently shadows admin canned overrides — **VERIFIED**

- **Where:** cache lookups return before `fleety_match_canned_answers` (`:1079`); `bump_kb_version` trigger fires **only** on `knowledge_base` (`20260504041534_*.sql:27-30`), not on canned/playbook/example edits; cache is now permanent (no TTL).
- **Defect:** an admin's corrected canned answer is never served for a question already cached.
- **Fix direction:** check canned before cache, OR bump `kb_version` on canned/playbook/example/synonym writes (add triggers).
- **Skills:** owasp (access-control) · compliance.

### FS1. `customer_user_id` PK-vs-auth-uid contradiction — REPORTED

- **Where:** column `REFERENCES profiles(id)` (`20260601175315_*.sql:15`) but RLS filters `= auth.uid()` (`:34`); `profiles.id` ≠ `profiles.user_id`. Writers disagree: `process-freescout-events:46` writes `prof.id`; `freescout-proxy:344`/`support-ticket.ts:151` write `auth.uid()` (FK-violates, error swallowed).
- **Defect:** drain/webhook-created tickets **invisible** to the owning member; duplicate-submit idempotency **dead** on both create paths.
- **Fix direction:** pick one identity convention; align writers + RLS + FK; stop swallowing the pointer-write error.
- **Skills:** owasp (access-control) · comprehensive-test-strategy (needs DB-backed integration test).

### FS2. In-app support notification never delivered — REPORTED

- **Where:** `process-freescout-events/index.ts:93-101` inserts `notifications` with columns `body/link/category` (table has `body_html/link_url/notification_type`, `20260319225720_*.sql:2-11`); also `user_id = prof.id` vs RLS `auth.uid()`; error swallowed.
- **Defect:** HELP-DESK-028 broken in prod; no test catches it (scenario is `manual`).
- **Fix direction:** correct columns + user id; add integration coverage.
- **Skills:** comprehensive-test-strategy · sre (silent failure).

### F7. Follow-up cache poisoning — **VERIFIED** (fix applied)

- **Where:** cache key ignores conversation history; a context-dependent follow-up ("how long does it take?") could be served to an unrelated fresh session.
- **Status:** guard added (`isCacheable` requires single-turn). Keep.
- **Skills:** owasp · comprehensive-test-strategy.

---

## 🟡 Medium (condensed)

| ID  | Finding                                                                                                                                                             | Where                               | Skill                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------- |
| M1  | Permanent-cache migration **non-idempotent & destructive** (`ALTER…USING NULL` re-wipes embeddings on any replay/`db reset`; ACCESS EXCLUSIVE rewrite; no rollback) | `20260807130000_*.sql:42-43`        | release-safety, compliance   |
| M2  | **No eviction / unbounded growth** + global `kb_version` invalidation churn (one KB edit dumps whole cache); stores `query_text` indefinitely                       | `20260807130000_*.sql:27-90`        | compliance (retention), perf |
| M3  | `fleety-embed` Mode A (arbitrary-text embed) is an **unrate-limited cost sink**, reachable by any authenticated user (+ via S1)                                     | `fleety-embed/index.ts:142-147`     | owasp (dos), sre             |
| M4  | **Mixed vector-space** during backfill — search never filters `embedding_model`                                                                                     | `20260503202421_*.sql:32-37`        | correctness                  |
| M5  | Prompt-injection scan is a **logging no-op** (never adds the promised defense; scans only user msg)                                                                 | `techfleet-chat/index.ts:475-483`   | owasp (ai-llm)               |
| M6  | Webhook **dedupe row committed before enqueue** → transient enqueue failure permanently drops event                                                                 | `freescout-webhook/index.ts:60-79`  | sre, correctness             |
| M7  | Body-size cap **bypassable** (~4×; trusts `content-length`)                                                                                                         | `techfleet-chat/index.ts:409-419`   | owasp (dos)                  |
| M8  | Cache distance **loosens under cost guard** (0.05→0.08) → serves less-similar answers                                                                               | `techfleet-chat/index.ts:709`       | correctness                  |
| M9  | High-confidence canned short-circuit **skips turn-signal** + replays markdown **unsanitized**                                                                       | `techfleet-chat/index.ts:1096-1122` | sre, owasp                   |
| M10 | Cache/cost RPCs pin `search_path=public` not `''` (inconsistent with 08-04 hardening)                                                                               | `20260807130000_*.sql:68,109,151`   | owasp (access-control)       |

## 🔵 Low (condensed)

Duplicate SHA-256/turn (`:628` vs `:1635`) · no `<think>` strip (reasoning defense-in-depth) · `extractSourceUrls` surfaces attacker-controlled URLs as authoritative citations (`prompt.ts:152-165`) · sentinel/canary reproducible from KB content · zero-vector on empty ingest text (`fleety-embed:41`) · orphaned IVFFlat + HNSW coexist on `knowledge_base` · audience detection fail-opens to `member` (`:615-620`) · follow-up JSON extraction regex truncation (`:1726`) · fabricated cost accounting (output hardcoded `4096*0.4`, `:1519-1525`) · unreliable cache-hit accounting · no single-flight (thundering herd) · L2 lookup fails silently (`:634-643`) · upstream Freescout error body returned to client (`freescout-proxy:448-449`) · `safeEventId` fallback can collapse distinct events.

---

## ✅ Verified-good (Round 1)

- **Freescout HMAC** uses constant-time compare, supports hex/base64 + rotation, and **fails closed** when the secret is unset (`freescout.ts:266-317`).
- **SSRF well-contained:** base URL env-only (not request-influenced), `https://` enforced, host-allowlisted, `encodeURIComponent` on path ids (`resolveFreescoutBaseUrl`, `freescoutFetch:144-147`).
- `FREESCOUT_API_KEY` only sent as header, **never logged**.
- Support **queue RPCs service_role-only**; support tables RLS deny-by-default; support SECURITY DEFINER RPCs hardened `search_path=''` (`20260804170000_*.sql`).
- `freescout-proxy` authz **triple-gated** (JWT → isAdmin → ownsConversation); assign restricted to admin UUIDs.
- **Fleety tables RLS deny-by-default**; `fleety_turn_signals` own-user/admin read only; grants correct after `CREATE OR REPLACE`; quota views `security_invoker=true`.

---

## 🧪 Test-adequacy throughline (Round 1)

- All Fleety tests are **source-grep smoke tests** (`readFileSync` + regex) — they verify the code _reads_ right, not that it _behaves_ right.
- `migration-smoke` is **hard-disabled** (`.github/workflows/ci.yml:376 && false`) → **620 migrations never execute in CI**.
- The one service-role auth test **encodes the bypass as expected behavior**.
- **None** of the High/Critical findings would be caught by the current suite.

---

## Per-skill scorecard (Round 1, provisional)

| Skill                             | Verdict         | Evidence                                                                              |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| owasp-secure-coding-bdd           | 🔴 Fail         | S1 unsigned-JWT bypass; F1 SSE bypass; F2 PII leak; F4/F5 injection & output handling |
| comprehensive-test-strategy       | 🔴 Fail         | source-grep-only; migration-smoke off; bypass tested-in                               |
| compliance-data-lifecycle         | 🟠 Partial→Fail | permanent PII cache, no retention/eviction (M2); FS1/FS2                              |
| release-deployment-safety         | 🟠 Partial      | destructive non-idempotent migration (M1), no rollback; migrations not executed in CI |
| sre-operational-readiness         | 🟠 Partial      | silent failures (FS2, L2, M6); fabricated cost metering; no cache-hit SLO             |
| enterprise-architecture-standards | 🟠 Partial      | ~90-line inline block in a 1,800-line handler; otherwise single-client discipline OK  |

---

## Prioritized remediation sequence (Round 1)

1. **S1** — fix `_shared/service-role-auth.ts` + 4 copies (exact-match only) + flip the auth test + verify cron-auth path (P0).
2. **F1** — SSE cross-chunk buffering + streaming decode + reassembled sanitization.
3. **F3 + F4** — KB similarity floor + land the untrusted-content neutralization (fixes the fabrication root cause + injection).
4. **F2 refine** — precise PII signal; **F6** — canned precedence / kb_version triggers.
5. **FS1 + FS2** — identity convention + notification columns, with DB-backed integration tests.
6. **M1/M2** — idempotent+guarded migration, eviction + retention.
7. **Testing** — enable `migration-smoke`; add behavioral/pgTAP tests for every fix above.

---

# PART 2 — Full-system audit (16 clusters) — ✅ COMPLETE

_Workflow `wf_94cf5b4c-1b6`: 17 agents, 0 errors, 119 raw findings, 2.17M subagent tokens. Deduped + severity-ranked below (the systemic unsigned-JWT bypass merged from 8 separate reports into C1). This section supersedes Part 1 where they overlap; Part 1 is retained as the first-pass record._

# Consolidated Full-System Security & Quality Audit — TechFleet Network

**Scope:** 16 cluster auditors + Round-1 system findings, mapped to 6 skills (owasp-secure-coding-bdd, enterprise-architecture-standards, comprehensive-test-strategy, compliance-data-lifecycle, release-deployment-safety, sre-operational-readiness). Production Supabase + React app, ~767 users, mid-cutover to a new Supabase project.

---

## 1. Executive Summary

### Counts by severity (after dedup/merge)

| Severity          | Count   | Note                                   |
| ----------------- | ------- | -------------------------------------- |
| **Critical (P0)** | **3**   | One is systemic across ~19 functions   |
| **High**          | **15**  |                                        |
| **Medium**        | **~30** | Heavily thematic (7 recurring classes) |
| **Low**           | **~16** |                                        |
| **Info**          | **3**   |                                        |

Raw auditors emitted ~90 findings; the systemic unsigned-JWT bypass alone accounted for 8 separate reports (Round-1 + 7 cluster corroborations), now merged into one P0.

### Top 5 systemic themes

1. **Unverified / substring-matched service-role auth (P0).** `authorizeServiceRoleRequest` (`_shared/service-role-auth.ts:47`) trusts an _unsigned_ JWT `role` claim; `fleety-learning-digest` uses a `.includes()` substring match on the _public_ anon key. Both hand full `SUPABASE_SERVICE_ROLE_KEY` execution to unauthenticated callers. **A test (`auth.test.ts:41-46`) actively encodes the forged token as correct**, so CI is green on the bypass.

2. **`profiles.id` vs `auth.uid()` (`profiles.user_id`) confusion.** The random-UUID PK is repeatedly used where the auth uid belongs. Breaks Freescout support ticketing end-to-end (C3), silently drops consent timestamps (`record_policy_ack`), makes support notifications invisible under RLS, and no-ops GDPR anonymize-on-delete. This is a codebase-wide correctness/security defect, not one bug.

3. **Migrations & schema drift are never validated.** `migration-smoke` is force-disabled (`ci.yml:376`, `&& false`) and the gate counts the skip as pass; `try_write_audit_log` has no `CREATE FUNCTION` anywhere, so `supabase db reset` cannot rebuild the DB — fatal for the in-progress cutover/DR. Multiple functions write to **columns that do not exist** (`notifications.body/link/category`, `audit_log.action/metadata`) and swallow the error, so support notifications and the silent-deploy alarm are permanent no-ops.

4. **Untrusted input reaches the LLM instruction position and the RAG index.** KB rows, prior-user Q&A, and externally-scraped Figma/CSV content are concatenated raw into Fleety's system prompt with no untrusted-wrapping, no similarity floor, and injection detection that only logs. SSE output sanitization is per-chunk, so PII/canaries split across deltas leak.

5. **Client-controlled headers trusted for security decisions.** `X-Forwarded-For[0]` is used for rate-limit bucketing and audit-log `ip_address` across `waf.ts`, `compliance.ts`, and `get-community-events`; `Content-Length` is trusted before buffering bodies on public endpoints. Both defeat their controls and (for XFF) let an attacker forge the forensic "where."

---

## 2. P0 / Critical

### C1 — Systemic: unsigned-JWT service_role bypass

**`supabase/functions/_shared/service-role-auth.ts:47-49`** (`parseJwtClaims` base64-decodes payload, never verifies signature). Inline copies of the same pattern in **`fleety-embed:99`**, **`triage-digest-builder:47`**, **`notify-critical-fix:36`**, **`refresh-community-events:353-356`**.
**Blast radius (~19 `verify_jwt=false` fns)** confirmed reachable in-scope: `process-email-queue`, `email-dispatcher`, `replay-email-dlq`, `reconcile-stuck-emails`, `send-application-confirmation`, `gumroad-backfill-all:88`, `freescout-sync-customer`/`-provision-customer`, `process-freescout-events`, `environment-readiness`, `edge-deploy-smoke`, `auth-prober`, `auth-reset-smoke`, `fleety-embed`.
**Exploit:** `Authorization: Bearer x.<base64url {"role":"service_role"}>.x` → `{ok:true, mode:'legacy_jwt'}`. Real impact demonstrated: anonymize/destroy a member's Freescout identity, drain DLQ/confirmation outboxes (email spam), drive full Gumroad crawl + `reproject_membership_drift()`, mass Gemini/LLM spend, force critical pushes.
**Fix:** Verify the JWT signature (use the GoTrue JWKS / `SUPABASE_JWT_SECRET`) OR restrict to strict constant-time equality against `SUPABASE_SERVICE_ROLE_KEY` — the pattern the _correct_ callers already use (`send-transactional-email:23`, `resend-signup-confirmations`, etc.). Delete the `legacy_jwt` mode. **Fix `auth.test.ts:41-46` in the same PR** — it currently asserts the vulnerability is correct behavior; it must assert the forged token is _rejected_.

### C2 — `fleety-learning-digest` anon-key substring bypass

**`supabase/functions/fleety-learning-digest/index.ts:95-98`**. Guard is `!auth.includes(SERVICE_KEY) && !auth.includes(ANON_KEY)` — the anon key is a **public** value shipped in the frontend bundle. Any user sending `Bearer <anon_key>` skips the admin block and runs with the service role: wipe `fleety_topic_insights`, insert arbitrary `fleety_proposed_relationships`, trigger unbounded paid playbook drafting + auto-promotion of canned answers.
**Fix:** Require a verified admin JWT (`has_role`) or strict service-key equality; never gate on `.includes()` of a public key.

### C3 — Freescout `customer_user_id` FK ↔ RLS contradiction (support ticketing is broken _and_ leaks)

**`supabase/migrations/20260601175315_...sql:15` (FK → `profiles(id)`) vs `:34` (RLS `= auth.uid()`).** `profiles.id` never equals `auth.uid()` for any of the ~628 rows.

- `freescout-proxy` create writes `auth.uid()` → **23503 FK violation** → HTTP 500 _after_ the Freescout ticket already exists; no pointer row → ticket invisible in "My tickets" → idempotency query never matches → **retries create duplicate tickets**.
- `process-freescout-events:60` writes `profiles.id` → satisfies FK but **fails RLS** → webhook-created pointers invisible to the owner.
- `support_backfill_provisioning` mis-joins `p.id = ur.user_id` (migration :157) — same confusion.
  **Fix:** Pick one identity. Recommended: store `auth.uid()` in `customer_user_id`, change FK to `profiles(user_id)` (or drop FK to the PK), and make every writer/reader consistent. Add a BDD scenario proving create→list round-trips for a real profile.

---

## 3. High

**Auth / access control**

- **H1 — Turnstile "always-passes" test-secret bypass.** `login-with-captcha:148` + `verify-turnstile:41`. `isProductionOrigin()` derives from the omittable Origin/Referer; a request with _no_ Origin makes `isProd=false`, so the real verify fails then re-verifies with Cloudflare's documented always-pass test secret → `success:true`. Defeats server-side CAPTCHA for all scripted (non-browser) login/register/reset/resend flows. **Fix:** gate the test secret on an explicit env flag (e.g. `ENV=test`), never on request headers; treat missing origin as production.
- **H11 — `resolve-discord-id:268` identity binding without ownership proof.** Confirm branch writes any guild member's `discord_user_id`+`has_discord_account=true` onto the caller's profile; only guard is "not already linked." Attacker claims a mentor/admin's snowflake and locks the real owner out. **Fix:** require the OAuth connect-discord ownership proof; never bind identity from a caller-supplied snowflake.
- **H12 — `confirm-admin-role:58` promotion token never expires.** No `expires_at`, no time filter. Highest-privilege grant outlives a leaked/forwarded email indefinitely (invitations use 7d, passkeys 15m). **Fix:** add `expires_at`, single-use consumption.
- **H13 — `confirm-teacher-role:47` plaintext, forever-valid token.** Copies the admin table's `token_hash` column but reads/writes plaintext `.eq('token', ...)`; regression of the `20260418032018` hardening. **Fix:** hash-at-rest + expiry, mirror the admin path.

**RLS / data exposure**

- **H2 — `project_roster` RLS `USING(true) TO authenticated`** (`migration 20260322043547:56`). Every one of 767 users can read all members' email, free-text `performance_notes`, `hours_contributed`, mentor — Confidential/Restricted eval data. **Fix:** ownership/role predicate; expose aggregates via SECURITY DEFINER only.
- **H5 — `withIdempotency` cross-user cache replay** (`_shared/idempotency.ts:86`). `requestHash = method:path:body` with no user identity; RPC `claim_idempotency_key` filters `WHERE key = p_key` only (`p_user_id` stored, never used, confirmed in `20260603000800`). Any caller reusing another's `X-Request-Id` + same body gets the cached private response. Latent (no importer yet) but the docstring advertises the vulnerable usage. **Fix:** include `auth.uid()` in the hash and the RPC predicate before any function adopts it.

**Fleety / LLM**

- **H6 — Untrusted RAG concatenated into the system prompt** (`techfleet-chat:1135`, `prompt.ts:202-217`). KB rows, few-shot prior-user Q&A, framework/worked-example rows placed after base instructions with no untrusted delimiter → persistent cross-user prompt injection (thumbs-up or `fleety-learning-digest` auto-promotion makes it durable). **Fix:** wrap all retrieved content in an untrusted block; never place it in the instruction position.
- **H7 — Fleety cross-user PII cache leak** (Round-1). Response cache not keyed per user. **Fix:** per-user cache key; verify no PII crosses users.

**Email / billing / compliance**

- **H8 — `send-announcement-email:203` non-idempotent mass duplicate blast.** Fresh `crypto.randomUUID()` messageId per recipient per run + announcements exempt from the per-recipient cap (`BROADCAST_TEMPLATES`). A retry/timeout re-blasts all 767. Compounded by **unbounded serial fan-out with no cursor** (:170, tracked as medium). **Fix:** deterministic messageId (`announcement-<id>-<recipient>`), resumable cursor, remove the cap exemption or add a per-run dedup.
- **H9 — `transactional-email.ts:557` writes full rendered email + PII into `email_send_log.metadata`** (`queue_payload.html/.text/.subject` + `templateData`). Long-lived, broadly-read, no retention; survives GDPR erasure. **Fix:** log a record id/hash, not contents; add retention + erasure propagation.
- **H10 — `gumroad-webhook:161` lifecycle events silently dropped.** refund/dispute/cancel `UPDATE...eq(subscription_id)` returns 200 on 0 rows → Gumroad never retries → refunded/cancelled buyer keeps "Early Career Membership" forever. Contradicts the file's "no refund fraud" claim. **Fix:** treat 0-row lifecycle match as a retryable error (non-2xx) or upsert a tombstone; reconcile ordering.

**Observability / release / CI**

- **H14 — `edge-deploy-smoke:68` alert writes to non-existent `audit_log` columns** (`action/resource_type/resource_id/metadata`; `changed_fields` object vs `text[]`), error unchecked → the silent-deploy safety net is a no-op, and `notify-critical-fix` scans a different table anyway. The exact "function silently removed" incident class in memory is unmonitored. **Fix:** correct the schema, check the insert result, wire to the alert path that actually pages.
- **H3 — `try_write_audit_log` has no `CREATE FUNCTION` in any migration** (`20260430021350:1` REVOKEs it). Fresh `supabase db reset` aborts → DB unbuildable from source → DR and the cutover are broken; every audited RLS/trigger/RPC is unprovable on clean apply. **Fix:** add the missing `CREATE FUNCTION` migration; get a clean apply passing.
- **H4 — `ci.yml:376` migration-smoke force-disabled (`&& false`), gate counts skip as pass (:255).** No migration/RLS change is ever executed before merge; the comment admits `db reset` "has never passed." **Fix:** enable the job on a clean ephemeral DB, make skip ≠ pass in the aggregator. (Pairs with H3.)
- **H15 — `translate-strings:49` unauth LLM spend.** `verify_jwt=false`, only checks header starts with `Bearer `, no token validation, no rate limit/spend cap → uncapped Gemini spend can drain the shared `LOVABLE_API_KEY` (breaks Fleety + triage). **Fix:** real auth + per-caller rate limit + spend ceiling. (`translate-bundle:28` is the medium-severity twin.)

---

## 4. Medium (grouped by theme)

**T-A · `profiles.id` vs `auth.uid()` confusion (correctness + security)**

- `record_policy_ack` `UPDATE profiles ... WHERE id = auth.uid()` matches 0 rows → `electronic_comms_consent_at` never persisted (`migration 20260508041349:131`). Consent record understated.
- `process-freescout-events:93/46/60` — notifications keyed to `prof.id` are invisible under RLS even if columns were right (see T-D).
- `freescout-sync-customer:38` / `-provision-customer:42` look up `.eq(id, userId)`; any caller passing an auth uid no-ops → GDPR anonymize-on-delete silently skipped _(low, listed here for theme cohesion)_.
  **Fix:** codebase sweep; standardize on `user_id` for auth identity; add a lint/test that flags `WHERE id = auth.uid()`.

**T-B · Schema drift → silent-failure writes**

- `process-freescout-events:93` + `freescout-provision-admin:74` insert `notifications.{body,link,category}` — real columns are `title,body_html,notification_type,link_url` → PGRST204 swallowed → members never get "New reply", new admins never get "account ready".
- (H14 `edge-deploy-smoke` is the same class.)
  **Fix:** correct columns; stop wrapping compliance/notification writes in silent best-effort try/catch; add contract tests against the live schema.

**T-C · Client-controlled headers trusted for security (systemic)**

- **XFF spoofing** (`waf.ts:38/39`, `compliance.ts:15`, `get-community-events` rateLimited): leftmost `X-Forwarded-For` used for rate-limit bucket + `security_events.ip_address`/compliance "where." Rotating the header defeats every per-IP limit and forges the audit trail. **Fix:** prefer `cf-connecting-ip`; treat XFF as untrusted.
- **Content-Length trusted before buffering** (`freescout-webhook:26`, `record-web-vital:100`, `techfleet-chat:409`): omit/understate the header → `req.text()`/`req.json()` buffers an arbitrarily large body on public endpoints (memory-exhaustion; for the webhook, before HMAC). **Fix:** bounded reader enforcing the cap while streaming.

**T-D · Stored XSS / HTML injection into notifications**

- `mark-interview-scheduled:189` — `notifTitle` interpolates raw `applicantName` into `p_title` + email `alertTitle` (body was escaped, title missed).
- `quest-nudge:73` — raw `path_title` into `notifications.body_html` (sibling `send-project-blast` sanitizes the same table).
  **Fix:** escape before insert on every writer to `body_html`/title; the render path trusts stored HTML.

**T-E · RAG / prompt-injection hardening (Fleety)**

- `techfleet-chat:475` injection detection logs only; promised defense instruction never appended; only last user message scanned. `:811` no similarity/distance floor → off-topic queries always get 6 "SOURCE" rows → defeats UC-04 honesty gate (Round-1). `:1663` per-chunk `sanitizeAIOutput` → PII/canary split across SSE deltas evades regex (Round-1). `scrape-figma-workshops:282` writes unsanitized public Figma content to `reference_workshops.description` → embedded into KB. `ingest-csv-knowledge:178` upserts unsanitized cells into `knowledge_base` (sibling `ingest-workshop-docs` sanitizes).
  **Fix:** add a max-distance floor; append/enforce the defense instruction (or drop the false-assurance log); sanitize output across a buffered window; run `sanitizeMarkdown` on _every_ ingest door.

**T-F · Reliability / idempotency / silent loss**

- `freescout-webhook:60` dedupe row committed before enqueue → enqueue failure permanently drops the event on redelivery. **Fix:** write dedupe only after successful enqueue (or make atomic).
- `resume-application-reminder:83` `invoke` returns `{error}` (not thrown) → unconditionally stamps one-shot `resume_reminder_sent_at` → reminder silently lost. `quest-nudge:100` stamps `last_nudged_at` even when insert+email both failed → 7-day suppression of an undelivered nudge.
- `freescout.ts:189` retries POST (create customer/conversation) on network/5xx with no idempotency key → duplicate tickets after upstream commit.
- `support-ticket.ts:110` TOCTOU read-then-upsert on `support_rate_limits` (last-writer-wins, not atomic increment) → concurrent `/support` bypasses the 10/hr cap.
- `auth-prober:179` counts the just-inserted failure row as a "prior" failure → two-strike debounce never happens → pages on first transient blip (alert fatigue).
- `dlp.ts:85` `containsSensitive()` calls `.test()` on shared `/g` regexes → `lastIndex` persists → stochastically returns false for payloads that contain a JWT/key → DLP gate leaks.
- `waf.ts:139` unguarded `decodeURIComponent(url)` throws `URIError` on `%`/`%zz` → `applyWaf` rejects → unhandled 500 and the SQLi check is skipped.
- `screen-sanctions:51` export-control audit write result never checked → allow/deny returned even if the mandatory tamper-evident record failed to persist.
  **Fix (per):** check error returns; atomic SQL increments; idempotency keys on non-idempotent POSTs; exclude current-run rows from debounce; per-call regex or `.replace`-based check; wrap `decodeURIComponent` in try/catch and fail closed; make compliance audit a verified hard-to-bypass write.

**T-G · Account enumeration & auth-flow weaknesses**

- `check-account-identity:198` public endpoint returns distinguishable `{has_password,has_google}`; rate-limit keyed per-email so cross-email sweeps aren't bounded. `auth-broker:604` identity/check has no rate limit/captcha and leaks Google-linked vs password. **Fix:** generic response or authenticated-only; rate-limit per IP, not per email.
- `delete-account:75` self-serve delete has no last-admin guard (unlike `admin-purge-auth-user`) → sole admin can orphan the system. **Fix:** replicate the last-admin guard.
- `auth-broker:451` password-reset/complete doesn't revoke other sessions (sibling `finalize-password-reset` does). **Fix:** insert `revoked_sessions` + `admin.signOut(userId,'others')`.
- `promote-to-teacher:44` / `revoke-teacher-role` lack the fresh-admin-2FA step-up that `promote-to-admin` enforces → stolen bearer mints teachers. **Fix:** add `requireFreshAdmin2fa`.
- `confirm-admin-role:30` (+teacher) state-changing role grant on bare **GET** → SafeLinks/AV/unfurler prefetch auto-confirms silently (compounds H12/H13). **Fix:** POST + CSRF + require target-user auth.

**T-H · Unauth abuse / cost / DoS on public & privileged endpoints**

- `submit-dispute:20` unauth, unrated insert of a legal dispute on an arbitrary email → impersonation + starts §20 clock + admin-tab flood. `record-web-vital:184` unauth service-role INSERT of ≤50 rows/req, no throttle → write-amplification DoS. `get-i18n-bundle:34` unauth service-role query + SHA-256 per miss, cache bypassed by varying locale → connection-pool/compute exhaustion. `translate-bundle:28` unauth full-bundle LLM translation per novel locale (junk-locale table bloat + AI cost). `refresh-email-health:105` (+ `send-announcement-email:396`) outbound Discord `fetch()` with no timeout → hung webhook stalls the health/auto-pause cron. `sync-airtable:79` IDOR — `application_id` from body used as Airtable merge key with no ownership check → overwrite another user's record. `record-web-vital:31` reflects Origin + `Allow-Credentials: true` (CORS anti-pattern; bounded today). `resolve-discord-id:233` PostgREST `.or()` filter built by string-interpolating a Discord username → LIKE-wildcard weakening of the duplicate-account check. `process-freescout-events:40` binds inbound support mail to any member by spoofable From address. `gumroad-webhook:216` (+backfill :265/:177) stores full raw payload + email indefinitely, no retention, no DSAR propagation.
  **Fix:** add WAF/rate-limit/spend caps; ownership checks (IDOR); bound-reader + timeouts (AbortController); allow-list CORS origins; bound PostgREST filters; verify identity via authenticated link not email; minimize + propagate erasure into `gumroad_sales`.

---

## 5. Low (grouped)

- **Error-detail leakage (A09/A05):** `dsar-submit:60`, `submit-dispute:46`, `get-i18n-bundle:48/88`, `discord-project-update:238` (+`manage-discord-roles:403`, `resolve-discord-id:619`, `generate-discord-invite:236`, `register-fleety/support-command` leak raw Discord error). → Return generic message + correlation id; log detail server-side.
- **Non-constant-time secret compares:** `send-transactional-email:23` (+preview/refresh-email-health/bump-email-warmup/resume-application-reminder/email-pipeline-health), `service-role-auth:43`, `seed-content:31` (`includes()`). → `timingSafeEqual`.
- **Spoofable/attacker-forgeable audit IP:** `compliance.ts:15` (duplicate of T-C at low severity for the audit angle).
- **Isolate-local in-memory rate limits:** `record-auth-recovery:56`, `record-auth-wedge`, `send-magic-link` → effective limit × N isolates. → shared/Postgres-backed limiter.
- **Sensitive-data logging:** `login-with-captcha:262` persists raw email+IP for arbitrary failed attempts. `record-auth-event:77` writes client-supplied `actor` UUID unverified → forged attribution.
- **Unbounded fan-out (growth risk):** `backfill-discord-usernames:69` (no LIMIT, serial per-row Discord calls, no resume cursor).
- **PII over-exposure:** `public-project-detail:61` returns `primary_contact` + coordinator real name to anon (DLP scrubs emails/UUIDs, not names). `announcement_views` SELECT `USING(true)` exposes per-user view activity (aggregate RPC already exists).
- **Latent duplicate send:** `replay-dlq-emails:341` casing mismatch (mixed-case transactional rows vs lowercased compare) — dormant until project-blast/digest replay is enabled.
- **Input validation:** `handle-email-suppression:85` casts payload without asserting `email` is a string → 500 → provider retries/drops a suppression event. `dsar-submit:40` no size cap on forwarded jsonb `payload`.
- **Discord replay:** `discord-interactions:253` verifies Ed25519 over timestamp+body but never checks freshness → captured signed interaction replayable indefinitely. → reject if `|now - timestamp| > 300s`.
- **CORS wildcard on privileged Discord endpoints** (`manage-discord-roles:15` + 6 others): `ACAO:*`; `isAllowedUiOrigin` gate bypassed by omitting Origin. Bounded by bearer-token auth. → allow-list origins.

**Info:** `process-freescout-events:127` unsanitized ticket subject into email templateData (contingent on renderer escaping); `discord-interactions:84` `loadKnowledgeBase()` loads entire KB per `/fleety` call (cost scales with KB, detection advisory-only). `service-role-auth:47` corroboration for workers cluster (folded into C1).

---

## 6. Per-Skill Compliance Scorecard

| Skill                                 | Verdict          | Evidence (1-line)                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **owasp-secure-coding-bdd**           | **FAIL**         | Unsigned-JWT service_role bypass (C1) + anon-key bypass (C2) grant unauth service-role across ~19 fns; CAPTCHA bypassable; and `auth.test.ts` encodes the bypass as _correct_.                                                                     |
| **enterprise-architecture-standards** | **FAIL**         | Systemic `profiles.id` vs `auth.uid()` confusion breaks ticketing/consent/notifications; writes to non-existent columns; unbounded serial fan-outs with no cursor; TOCTOU rate limits.                                                             |
| **comprehensive-test-strategy**       | **FAIL**         | `migration-smoke` force-disabled and skip counts as pass; `db reset` "has never passed"; a security test asserts the auth bypass is correct — the suite actively protects the defect.                                                              |
| **compliance-data-lifecycle**         | **FAIL**         | GDPR erasure incomplete (full emails in `email_send_log`, raw Gumroad payloads, no DSAR propagation); consent timestamp never persisted; sanctions audit write unchecked; `try_write_audit_log` not in source → DR broken.                         |
| **release-deployment-safety**         | **FAIL**         | DB unbuildable from migrations (H3); no migration validation gate (H4); non-idempotent announcement/POST retries cause duplicate blasts/tickets; seed-content subtractive-before-additive can zero out all legal policies.                         |
| **sre-operational-readiness**         | **PARTIAL→FAIL** | Silent-deploy alarm is a no-op (wrong `audit_log` columns, H14); prober pages on first blip (no debounce); nudges/reminders stamp one-shot flags on failure (silent loss); outbound calls lack timeouts. Probers/digests exist but are unreliable. |

Net: **6/6 fail or effectively fail.** The testing/CI failures are the force multiplier — they let the others reach production unchallenged.

---

## 7. Verified-Good (controls confirmed correct — do not regress)

- **Strict service-key equality callers** (NOT vulnerable to C1): `send-transactional-email:23`, `refresh-email-health:25`, `bump-email-warmup:25`, `resume-application-reminder:27`, `email-pipeline-health:49`, `preview-transactional-email:34`, and `resend-signup-confirmations` (direct `token === serviceRoleKey`).
- `admin-purge-auth-user` **does** guard the last-admin case ("Cannot delete the last remaining admin account") — the correct pattern `delete-account` is missing.
- `finalize-password-reset` **does** revoke other sessions (`revoked_sessions` + `admin.signOut(...,'others')`) — the model for fixing `auth-broker`.
- `promote-to-admin` **does** enforce fresh-admin-2FA step-up (`requireFreshAdmin2fa:69`) — the model for teacher role mutations.
- `confirm-admin-role` token path was hardened (hash + expiry, `migration 20260418032018`) — the model for `confirm-teacher-role`.
- `ingest-workshop-docs` **does** run `sanitizeMarkdown` on `knowledge_base` writes — the model for CSV/Figma ingest.
- `send-project-blast` **does** sanitize before inserting `notifications.body_html` — the model for `quest-nudge`/`mark-interview-scheduled`.
- `techfleet-chat` **does** call `applyWaf` + `check_chat_system_rate_limit` — the model for `firecrawl-search`/translate/i18n.
- Passwords are **never** logged in the auth telemetry paths (email+IP is the only PII concern).
- `discord-notify` returns a **generic** error (not raw) — the model for the other Discord handlers.
- `scrub()` in `dlp.ts` is unaffected by the `/g lastIndex` bug (only `.test()`-based `containsSensitive` is broken).

---

## 8. Prioritized Remediation Sequence

**Wave 0 — Stop the unauth bypasses (days, blocks everything else)**

1. Fix C1 in `_shared/service-role-auth.ts` (verify signature or strict equality; delete `legacy_jwt` mode) + the 4 inline copies. **Simultaneously fix `auth.test.ts:41-46`** to assert rejection.
2. Fix C2 `fleety-learning-digest` anon-key guard.
3. Re-enable `migration-smoke` (H4) + add the missing `try_write_audit_log` `CREATE FUNCTION` (H3) so a clean `db reset` passes — this is the gate that keeps Wave 0 from regressing and is a hard prerequisite for the cutover.

**Wave 1 — Fix the broken feature + top data-exposure (this sprint)** 4. C3 Freescout identity contradiction (unbreaks ticketing; stops duplicate tickets + invisible pointers). 5. H2 `project_roster` RLS; H5 `withIdempotency` user-scoping (before any adopter ships). 6. H1 CAPTCHA test-secret gating; H12/H13 promotion-token expiry + hashing; T-G GET→POST confirm. 7. H10 Gumroad lifecycle 0-row handling (refund fraud); H8 announcement idempotency. 8. H14 deploy-smoke alert schema + T-B notification-column fixes (restore observability + member notifications).

**Wave 2 — Systemic themes (next sprint)** 9. T-A `profiles.id`/`auth.uid()` sweep + lint rule. 10. T-C XFF/Content-Length hardening in shared libs (fixes many findings at once). 11. T-E Fleety RAG/prompt-injection hardening (untrusted wrap, similarity floor, buffered output sanitization, uniform ingest sanitization) — pairs with H6/H7. 12. H9 + T-H retention: stop logging rendered emails/raw payloads; wire DSAR erasure propagation. 13. T-F reliability fixes (dedupe-after-enqueue, checked error returns, atomic increments, POST idempotency keys, prober debounce, DLP regex, WAF decode guard).

**Wave 3 — Lows + defense-in-depth** 14. Generic error responses, constant-time compares, shared rate limiters, CORS allow-lists, Discord signature freshness, PII-name scrubbing, remaining unauth cost caps.

**Cross-cutting (every wave):** each fix ships with a failing-before/passing-after BDD scenario wired into the (now-enabled) CI gate — the testing failures in the scorecard are what let all of this reach production, so the tests are part of the fix, not an afterthought.
