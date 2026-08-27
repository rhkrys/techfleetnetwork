# Architecture decisions — React + Supabase

Standing rules for a React + Supabase codebase. `judge-arch` reviews every change against this
file; `arch-gate.config.json` enforces the checkable subset. Replace the `<...>` placeholders with
your repo's real modules, and grow the file one caught mistake at a time (use `arch-encode`).

**The intended shape:** `UI (components/pages) → data hooks → services → lib / integrations`.
Data flows down through owners; UI never reaches past the hooks/services layer to the database.

---

## The standing lens — four questions for every change
1. Boundary placement — is business logic out of components and route handlers?
2. Data ownership — does each fact have one writer?
3. Dependency direction — is domain code free of React/DOM/web concerns?
4. Error handling — does every failure recover, retry, or report?

## Layers & boundaries
```
❌ never — data access + business logic in a component
function Cart() {
  const { data } = await supabase.from('orders').select()   // UI touching the DB
  const total = data.reduce((s, o) => s + o.price * 1.2, 0) // business math in the view
}
✅ always — component renders; the hook/service owns data + rules
function Cart() {
  const { orders, total } = useCart()   // useCart → cartService.getTotals()
}
```

## Data ownership
```
❌ never — a value stored in one place and derived in another, "kept in sync" by hand
profiles.is_premium = true            // mirrors the subscription system's truth
✅ always — one owner derives it; everyone else reads
// the billing webhook writes only the ledger; one trigger/derivation computes membership
```
Mirrors of external systems (a payment provider, a chat platform, a CRM) have **one** idempotent
writer keyed on an immutable id; any local copy of a display field is a labeled cache, not a fact.

## Dependency direction
```
❌ never — a service that imports the UI framework or the DOM
// src/services/stats.service.ts
import { useMemo } from 'react'
const cached = window.localStorage.getItem('stats')
✅ always — pure data in, plain data out; storage injected at the edge
export function computeStats(input: StatsInput): Stats { /* no react, no window */ }
```
Exactly one Supabase client (`src/integrations/supabase/client.ts`). Never a second `createClient`.

## Error handling
```
❌ never — swallowed, or reported only to the user
try { await invokeEdge('promote-user') } catch { toast.error('failed') }  // operators see nothing
✅ always — recover/retry AND report through the app's reporting spine
try { await auditedInvoke('promote-user') } catch (e) { report(e); toast.error('failed') }
```
Privileged/imperative calls go through the audited invoke wrapper; a `console.error` is not
reporting if the logger only writes to the browser console.

## Edge functions
Compose the shared layer — do not hand-roll per function:
```
❌ never — inline auth + CORS + client in each function
const supabase = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
const cors = { 'Access-Control-Allow-Origin': '*' }
✅ always — import the shared helpers
import { getAdminClient } from '../_shared/admin-client.ts'
import { requireAdminRequest } from '../_shared/request-auth.ts'
import { handleCors, jsonResponse } from '../_shared/http.ts'
```

---

## Decision log (ADRs)
Bigger or reversible decisions (which pipeline is canonical, who owns a mirrored field) go in
`docs/adr/` as sequenced records — use the `architectural-decision-records` skill. This file holds
the *standing rules*; the ADRs hold the *dated why*.
