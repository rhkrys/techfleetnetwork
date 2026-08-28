# Architecture decisions — TechFleet Network

Standing rules for how this codebase is structured. `judge-arch` reviews every change against this
file; `arch-gate.config.json` (run by `scripts/ci/arch-gate.mjs`, wired as `check:architecture`)
enforces the checkable subset. Grow it one caught mistake at a time with `arch-encode`; keep it
lean — it loads every session.

**The intended shape:** `UI (src/pages, src/components) → data hooks (src/hooks, React Query) →
services (src/services/*.service.ts) → lib / integrations (src/lib, src/integrations)`. Data flows
down through owners; the UI never reaches past hooks/services to Supabase.

---

## The standing lens — four questions for every change

1. Boundary placement — is business logic out of components and route handlers?
2. Data ownership — does each fact have one writer?
3. Dependency direction — is domain code free of React/DOM/web concerns?
4. Error handling — does every failure recover, retry, or **report** (to operators, not just the user)?

## 1 · UI never touches Supabase directly

```
❌ never — inside src/components/** or src/pages/**
const { data } = await supabase.from('projects').select()
✅ always — go through the hook that owns this data
const projects = useProjects()      // useProjects → projectService
```

Writes to `profiles` go through **`ProfileService`** (it centralizes `deepSanitize` + the
mass-assignment allow-list). A raw `supabase.from('profiles').update(...)` in the UI is a security
regression (A03/A04), not just a layering smell.

## 2 · One fact, one owner

The **Gumroad membership** model is the template: the webhook writes only the `gumroad_sales`
ledger and one trigger (`compute_membership()`) derives every `membership_*` field — one writer,
one truth. Apply the same everywhere:

```
❌ never — a mirror kept in sync by hand, or two writers for one field
profiles.freescout_customer_id  // written by 3 functions on 2 different keys
✅ always — one idempotent writer keyed on an immutable id; display copies are labeled caches
```

Mirrors of Discord / Freescout / Airtable / Gumroad get a single sync path; `discord_user_id`
(immutable) is the identity key, not `discord_username` (a display cache).

## 3 · Domain code is web-free; one Supabase client

```
❌ never — a service importing React or touching the DOM
// src/services/*.service.ts
import { useMemo } from 'react'
window.localStorage.getItem(...)
✅ always — plain data in, plain data out; storage injected via src/lib/*
```

Exactly one client, at `src/integrations/supabase/client.ts`. Never a second `createClient`.
(The frozen auth area — `src/lib/auth/**`, `src/features/auth/**`, `main.tsx` boot, the client —
follows `06-auth-flow-lockdown`; do not touch without the auth regression suite.)

## 4 · Every failure reports

```
❌ never — visible to the user, invisible to operators
try { await supabase.functions.invoke('promote-teacher') } catch { toast.error('failed') }
✅ always — route privileged calls through the audited wrapper
try { await auditedInvoke('promote-teacher') } catch (e) { report(e); toast.error('failed') }
```

`invokeEdge`/`auditedInvoke` report + retry; a bare `console.error` is not reporting (the logger
only writes to the browser console). Prefer flipping `no-raw-functions-invoke` to `error`.

## 5 · Edge functions compose `_shared`

```
❌ never — hand-rolled per function (auth, client, CORS all drift)
const supabase = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors = { 'Access-Control-Allow-Origin': '*' }
✅ always — import the shared helpers
import { getAdminClient }        from '../_shared/admin-client.ts'
import { requireAdminRequest }   from '../_shared/request-auth.ts'   // has_role RPC, one admin predicate
import { handleCors, jsonResponse } from '../_shared/http.ts'        // includes the x-trace-id preflight headers
```

## 6 · Gate integrity — a check must fail closed, never pass falsely

The checks that guard this architecture must themselves never report a false green.

```
❌ never — a swallowed error or missing input becomes a silent pass
try { walk(ROOT) } catch { console.error(e); process.exit(0) }        // green forever if ROOT moves
✅ always — fail closed + prove what you inspected
try { files = walk(ROOT) } catch (e) { console.error(e); process.exit(2) }
if (files.length === 0) { console.error('scanned 0 files — path moved?'); process.exit(2) }
console.log(`OK — ${files.length} files scanned`)                     // evidence: what + how much
```

Every CI guard (`scripts/ci/*`) must (a) **emit a substantial evidence line** on success (what it
inspected + a count/paths), (b) **fail closed** — a missing input, internal error, or zero-scan
exits non-zero, never a silent `exit 0`, (c) never pass vacuously on a diff-based no-op.
`check-owasp-coverage` / `check-triage-actionable-parity` are the models. The meta-guard
`check-ci-guard-integrity.mjs` (wired into the required gate) enforces the worst case — no
`exit(0)` inside a `catch`; a deliberate fail-open opts out with a `// ci-guard-integrity-ok: <reason>`
marker. Broader fleet hardening (evidence counts + zero-scan asserts on the remaining guards) is
tracked in `docs/architecture/audit-2026-08/review-followups.md`.

---

## Decision log (ADRs)

Bigger or reversible decisions (which email pipeline is canonical, who owns `freescout_customer_id`,
Discord role-state ownership, the network-stats RPC) go in `docs/adr/` — use the
`architectural-decision-records` skill. This file holds the standing rules; the ADRs hold the dated why.

_The `judge-arch` / `arch-encode` skills live in `.claude/skills/`, sourced from
[techfleetworks/enterprise-software-AI-skills](https://github.com/techfleetworks/enterprise-software-AI-skills)._
