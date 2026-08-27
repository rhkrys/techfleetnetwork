---
name: arch-encode
description: Turn an architectural mistake into a durable, enforceable rule. Use right after catching drift, a repeated bad pattern, or a review finding you want to stop recurring — or whenever someone says "add a rule so this never happens again." Writes the rule as a specific negative code example in the correct file (the nearest scoped AGENTS.md, or the repo's decisions.md), wires it into the mechanical gate when it is mechanically checkable, then proves the rule holds by reverting the bad change, clearing context, and re-running the original task. Also prunes bloated or contradictory rule files.
---

# arch-encode — write rules that actually hold

A stored rule *influences*, it does not *enforce*. It makes a violation less likely, not
impossible. So write rules that are hard to misread and, where possible, back them with a
mechanical check. A vague rule is worse than none — it costs context every session and catches
nothing.

## 1. State the rule as a specific negative code example
The example beats the principle. Convert the mistake into the smallest concrete rule, phrased as
a prohibition with a ❌ / ✅ pair drawn from *this* codebase:

```
### Data access never lives in a component
// ❌ never — inside a UI component
const { data } = await db.from('orders').select()
// ✅ always — go through the owning hook/service
const orders = useOrders()
```

Rules to avoid: "prefer thin controllers", "keep layers separate", "try to reuse" — they match
nothing. Good rules split/fail cleanly: *"files in `services/` must not import from the UI
framework or reference `window`/`document`."*

## 2. Put the rule where the code lives
Don't dump everything in the root file. Place it at the right altitude:
- A rule about one folder/kind of file → a nested `AGENTS.md` in that folder (loads only when the
  agent works there; costs nothing elsewhere).
- A cross-cutting architectural decision → the repo's **`decisions.md`**.
- A truly universal engineering rule → the root `AGENTS.md`. Keep it lean; it loads every session.

Never auto-generate a rules file from the codebase or a prompt. Add one line at a time; review and
prune what you add.

## 3. Wire it into the mechanical gate if it's checkable
If the rule can be expressed as "pattern X must not appear in glob Y," add it to the repo's
architecture-gate config (`arch-gate.config.json`, run by `scripts/arch-gate.mjs`) so CI enforces
it, not just prose. A rule that *can* be mechanical *should* be — that's the difference between
"less likely" and "cannot merge."

## 4. Prove the rule holds (the test loop — do not skip)
Adding a rule and assuming it works is how rule files fill with dead prose. Test it:
1. **Revert** the offending change so the code is back to before the mistake.
2. **Clear context.** Re-test in a fresh session, not the one that just discussed the fix — an
   agent that just talked it through with you will "pass" from the conversation, not the rule.
3. **Re-run the original task verbatim** against the new rule set.
4. If the agent now gets it right, keep the rule. If not, the rule is too vague or mis-placed —
   tighten it (more specific, better example, or move it closer to the code) and repeat.

## 5. Prune while you're here
Before finishing, scan the file you edited:
- **Contradictions** — e.g. "keep controllers thin" vs "don't create extra classes." Two rules
  that fight get resolved arbitrarily. Reconcile them.
- **Bloat / duplication** — merge overlapping rules; delete ones no longer true. More rules =
  less attention on each. A short file of concrete, tested rules beats a long vague one.

## Output
Report the exact rule text added, which file it went in (and why that altitude), whether it was
wired into the mechanical gate, and the result of the test loop (held / needed tightening).

## Bundled resources
- `references/writing-rules.md` — example-beats-principle, negative rules, altitude, pruning.
- `references/testing-a-rule.md` — the revert → fresh-context → re-run loop in detail.

## Credits and attribution

The rule-authoring guidance here — "the example beats the principle," negative/specific rules,
placing a rule at the right altitude, and the revert → clear-context → re-run test loop — is
adapted from the workshop **"Who's Designing Your System? You, or Your Agent?"** — a
certificates.dev / TechFleet workshop presented by Alex.

Recording: https://www.youtube.com/live/b-Pom28zv7M
