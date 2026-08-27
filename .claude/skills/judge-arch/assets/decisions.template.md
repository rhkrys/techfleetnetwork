# Architecture decisions — <repo name>

The standing rules for how this codebase is structured. `judge-arch` reviews every change
against this file; the mechanical `check:architecture` gate enforces the checkable subset.

**Rules of this file:** only rules live here — no aspirations, no "we should probably." Every
rule is specific, is phrased as a prohibition where it can be, and carries a ❌/✅ example drawn
from *this* codebase. Grow it one caught mistake at a time (use the `arch-encode` skill); prune
it when a rule goes stale or two rules fight. A short file of concrete rules beats a long vague
one — it loads into every session, so keep it lean.

---

## The standing lens — four questions for every change
1. **Boundary placement** — is this in the right place? (business rules out of components/handlers)
2. **Data ownership** — who else writes this data? (one owner; everyone else reads)
3. **Dependency direction** — what does this now depend on? (no web/UI concerns in domain code)
4. **Error handling** — what happens when this breaks? (every catch: recover, retry, or report)

---

## Layers & boundaries
> Where each kind of code lives, top to bottom. Fill from the repo's real structure.

- **UI (components/pages):** render and format only. No business math, no data access.
- **Boundary (route handlers / edge functions):** translate input → call one service → return a response. No workflow logic.
- **Services / domain:** where decisions live. Plain data in, plain data out.
- **Data (DB / schema):** enforces what must always be true (constraints, uniqueness, FKs).

```
❌ never
// <paste a real example of logic in the wrong layer>
✅ always
// <paste the corrected version>
```

## Data ownership
> Each fact has one owner. List the owners here as they're established.

- `<fact>` is owned by `<module/table>`. Writes go through `<the front door>`; everyone else reads.

```
❌ never   // a second copy "kept in sync", or a write into another module's table
✅ always  // <the single-owner version>
```

## Dependency direction
> What may depend on what. The grep-test enforces the mechanical part.

- Code in `<domain/service globs>` must not import from `<ui/web>` or reference `request`,
  `response`, `session`, `cookie`, `window`, `document`, `localStorage`, or `fetch` directly.

```
❌ never   // <a real leak found in this repo>
✅ always  // <the boundary-respecting version>
```

## Error handling
> Every failure path recovers, retries, or reports. No swallowing.

```
❌ never
try { await send() } catch (e) { /* nothing */ }
✅ always
try { await send() } catch (e) { report(e); /* + retry/recover as appropriate */ }
```

---

## Decision log (ADRs)
Bigger or reversible decisions go in `docs/adr/` as sequenced records (use the
`architectural-decision-records` skill). Before a structural change, check the ADRs for a prior
decision. This file holds the *standing rules*; the ADRs hold the *dated why*.
