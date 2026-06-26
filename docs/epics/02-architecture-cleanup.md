# Epic 02 — Relaunch Cleanup: kill accreted residue + finish SES

**Status:** in progress (relaunch blocker)
**Owner:** Morgan · engineering by Claude Code
**Goal in one line:** make the platform clean enough to relaunch on the owned stack —
remove Lovable-migration residue, unify the dependency drift, decommission the
duplicated pipelines, and retire the boot-time band-aids _behind tests_ — without
touching the frozen auth layer except through its regression suite.

> Honest framing: "bug-free" is not a one-shot. This is a sequenced program. Some items
> are **Cowork** (dashboard/AWS/secrets), some are **frozen-auth** (only behind the
> auth-flow lockdown suite — see epic 01 W1/W3), and some are **blocked** on soak gates.
> The achievable relaunch bar: no migration residue shipping, one set of pinned deps,
> SES sending, and the known band-aids removed as their real fixes land.

---

## 1. How this was audited (and a caveat)

Four read-only Explore agents swept boot band-aids, frontend architecture, edge/DB, and
security/deps. **One agent died on an org spend-limit**, so the _frontend architecture-rot_
dimension (god components, useEffect-fetching, duplicate query logic) is **not yet covered —
TODO**. Agent claims were treated as leads and verified; corrections found:

- ❌ "`src/integrations/lovable/index.ts` is dead" — **false**, referenced by auth-invariant
  lint rules + OAuth tests + a CI guard (auth-adjacent → frozen).
- ❌ "`use-announcement-realtime.ts` is dead" — **false**, still imported by `AppLayout.tsx`.
- ❌ "hardcoded publishable key = CRITICAL" — **overstated**; the publishable/anon key is
  public by design (ships in the bundle). Real issue is only the misleading `LOVABLE_CLOUD_*`
  naming + the fallback existing at all.
- ✅ "`migrate-helper` is a removable service-role leak" — **confirmed** (zero app refs).

---

## 2. Ranked backlog

Legend: ✅ done · 🟡 in flight · ⬜ planned · ☁️ Cowork · 🔒 frozen-auth (behind suite) · ⛔ blocked

### 🔴 CRITICAL — security (relaunch blockers)

- ✅ **C1** Delete `migrate-helper` (public edge fn that returned `service_role` for header
  `x-access-key: accesscode`). Source + config + manifests removed (commit on `main`).
  ☁️ **Cowork still required:** remove the **live** function on the project AND **rotate the
  service-role key** — it must be treated as compromised. The old DB password (pasted in chat
  during setup) should be rotated too.
- ⬜ **C2** Resolve the **41 Dependabot vulns** (2 critical, 13 high). Needs the `npm audit`
  output (no network here) → then dependency bumps. ☁️ run audit / give me the report.

### 🟠 HIGH — maintainability / stability

- ⬜ **H1** Edge-function **dependency unification**. Measured drift: `@supabase/supabase-js`
  in 8 specs (incl. floating `@2` and ancient `2.39.7`); **`zod` split across v3 and v4**
  (~33 fns, breaking-incompatible); `std` 0.168 vs 0.224; **no shared `deno.json`**. → add one
  import map, pin once, migrate in verified batches (`deno check` in CI). ⚠️ **High collision
  risk with the `fleety-rearchitecture` branch — must be sequenced with the other instance.**
- 🟡 **H2** **SES email** — see §3 (code done; Cowork to activate).
- ⬜ **H3** **Lovable decoupling** (off-platform now): `@lovable.dev/email-js`+`webhooks-js`
  (email path — strangler, see ⛔B1), `ai.gateway.lovable.dev`+`LOVABLE_API_KEY` in ~8 AI
  functions (Fleety) → migrate to a direct LLM provider (Claude API); `@lovable.dev/cloud-auth-js`
  (🔒 auth-adjacent), `lovable-tagger` (dev-only), `lovable.app` fallback origins (🔒 auth-hosts),
  `@lovable-dev` CODEOWNERS + CI workflows pointing at `lovable.app` (✅ safe to fix now).

### 🟡 MEDIUM

- 🔒 **M1** Boot-time band-aid pile (`main.tsx`, `src/lib/auth/**`). Inventory ready
  (oauth-origin apex→www, oauth-ui-marker, captcha cross-tab sync are removal candidates now
  that the edge owns apex→www). Execution is **epic 01 W3** — behind the auth regression suite.
- ⬜ **M2** CORS `*` on ~60 functions → phased origin allowlist (tracked as M-05). Bearer-auth
  mitigates today.
- ⬜ **M3** Standardize edge entrypoints (`serve` → `Deno.serve`) + auth helper
  (`authorizeServiceRoleRequest`); fix the timing-unsafe bearer compare in `fleety-weekly-digest`.
  Add a lint rule.
- ⬜ **M4** Telemetry table consolidation (~46 tables; `ops_events`/`ops_metrics`,
  `email_send_log`/`email_outbox`, `security_events`/`audit_log` overlap) → **epic 01 W2**.
- ⬜ **M5** Non-auth Lovable references: update `.github/CODEOWNERS` (`@lovable-dev`),
  `lighthouse.yml` / `preview-comment.yml` (point at `techfleet.network`), rename
  `LOVABLE_CLOUD_*` in `vite.config.ts`. Safe, low-risk quick wins.

### ⛔ BLOCKED / SCHEDULED

- ⛔ **B1** Decommission the **legacy pgmq email pipeline** (`process-email-queue`,
  `reconcile-stuck-emails`, `replay-*`, pgmq queues) that duplicates the v2 outbox — only after
  the documented gates (v2 `pipeline_v2_lanes_bitmask=7` + 72h soak), which depend on SES being
  live. See `docs/runbooks/email-subsystem-v2.md` §"Decommission gates".

### TODO — coverage gap

- ⬜ **T1** Re-run the **frontend architecture-rot** audit (the agent that died): god
  components, `useEffect`+`useState` fetching vs React Query, duplicate query logic, dead
  components.

---

## 3. SES email workstream (H2)

- ✅ Code: `_shared/email/infrastructure/ses-provider.ts` (SES SMTP via denomailer) +
  `composition.ts` provider selection on `EMAIL_PROVIDER`. On `main`. Default = Lovable, so
  it's a no-op until configured.
- ☁️ Cowork to activate: SES **production access** (out of sandbox); SES SMTP creds + verified
  sender; secrets `SES_SMTP_HOST/PORT/USERNAME/PASSWORD` + `EMAIL_PROVIDER=ses`; **Auth → Custom
  SMTP** → SES for the auth lane (no auth-code change); set `SUPABASE_ACCESS_TOKEN` so the
  edge-function deploy runs (epic 01 W0.2); flip the v2 transactional/bulk lane bitmask; test.

---

## 4. Sequenced path to relaunch

1. **Security first:** C1 (✅ source; ☁️ rotate key + remove live fn), C2 (Dependabot).
2. **SES live:** H2 Cowork steps → emails actually send.
3. **Safe quick wins:** M5 (non-auth Lovable refs), M3 (entrypoint/auth standardization + lint).
4. **Dependency unification:** H1 — _coordinate branch ownership with the other instance first._
5. **Lovable decoupling:** H3 (AI gateway → Claude API; finish email swap).
6. **Behind the auth suite (epic 01 W1/W3):** M1 band-aids, the auth-adjacent Lovable bits.
7. **After soak gates:** B1 legacy email decommission. **Then:** M4 telemetry consolidation, T1 gap.

---

## 5. Coordination (two Claude Code instances)

A second instance is actively on **`fleety-rearchitecture`** (the big refactor; has uncommitted
work in the tree). To avoid collisions, isolated relaunch fixes here land on **`main`**
(C1 done there). Anything that touches many edge functions (H1) or the same files the refactor
edits must be **divided by file/area between the two instances** before starting.

## 6. What only Cowork can do

Rotate the service-role key + DB password (C1); run/relay `npm audit` (C2); all SES dashboard
setup (H2); set `SUPABASE_ACCESS_TOKEN` + repo vars (epic 01 W0.2); flip the email v2 bitmask.
