<!--
  AGENTS.baseline.md — the always-on architectural rules, vendor-neutral and stack-agnostic.
  Copy this into your repo as AGENTS.md (or append it to an existing one), then add your
  stack/preset specifics below the line. It is read at the start of every session, so keep it
  lean. The heavy detail lives in the judge-arch / arch-encode skills, not here.

  Adapted from the certificates.dev / TechFleet workshop "Who's Designing Your System? You, or
  Your Agent?" (https://www.youtube.com/live/b-Pom28zv7M).
-->

# Engineering rules

Every change passes the architecture gate before it is "done." "Done" means you claim the work is
complete, you open/update a pull request, or you hand back for review.

## The architecture gate — mandatory, no exceptions
Every change that **adds, moves, deletes, or restructures code or schema** must pass both halves:

1. **Mechanical gate.** `check:architecture` (the `arch-gate.mjs` scanner) exits `0` — locally
   before you say done, and in CI before merge.
2. **Judge review.** The `judge-arch` review returns PASS (no unresolved violations), or every
   remaining finding is explicitly waived.

The **only** bypass is an explicit human waiver ("waive the arch gate for X because Y"), recorded
in the waivers file. **Never self-waive by deciding a change is "trivial."** Trivial changes pass
the gate in seconds; that is not the same as being exempt.

## Read every change through four questions
Ask these before you write code, and again before you call it done:

1. **Boundary placement — is this in the right place?** Business rules (calculations, checks,
   workflows) do not live in route handlers, controllers, or UI components. If another part of the
   app needed this tomorrow, could it find it? If not, move it to a shared owner and call that.
2. **Data ownership — who else writes this data?** Every fact has one owner. Writes go through the
   owner; everyone else reads. No second copy "kept in sync"; no writing into another module's
   tables.
3. **Dependency direction — what does this now depend on?** Business/domain code must not know
   about `request`, `response`, `session`, `cookie`, HTTP, or view/rendering. The request stops at
   the boundary and becomes plain data before it reaches a service.
4. **Error handling — what happens when this breaks?** Every `catch` / failure check does exactly
   one of: **recover**, **retry**, or **report**. A catch that does none is hiding a failure.

## Fight the four drifts
- **Search before you write.** Grep for an existing implementation or pattern first; reuse or
  extend it. Never create a second way to do something that already has a way.
- **Match the surrounding code.** Follow the nearest existing example of this kind of thing.
- **Prefer editing and deleting over adding.** Leave no dead code. If the honest fix is a refactor,
  refactor.
- **Don't build for a future you don't have.** No interface/factory/manager for a single use.

## When you write a rule, write it as a negative code example
A concrete counter-example beats a stated principle. Not "prefer thin controllers" but a ❌/✅ pair
from this codebase. Specific, negative rules can be enforced; vague preferences match everything
and nothing. Use the `arch-encode` skill to add a rule and prove it holds.

<!-- ─────────────────────────────────────────────────────────────────────────────
     Below this line: YOUR stack + repo specifics. Drop in a preset (e.g.
     react-supabase) and point at your real modules. See decisions.md for the
     standing rules with ✅/❌ examples from your own code.
     ───────────────────────────────────────────────────────────────────────────── -->
