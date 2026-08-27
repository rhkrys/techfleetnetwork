# Testing a rule — the loop

> Load this reference when you've just added or changed a rule and need to confirm it actually
> works, before trusting it.

Adding a rule and assuming it works is how rule files fill with dead prose that catches nothing.
A rule is only real once you've watched a fresh agent obey it. The loop is four steps.

## The loop

1. **Revert the offending change.** Put the code back to before the mistake — `git stash` or
   `git restore` the files. You want a clean starting point identical to what a teammate would
   have.

2. **Clear the context.** Re-run the test in a **fresh** session, or hand it to a separate agent —
   *not* the conversation that just discussed the fix. This is the step people skip, and skipping
   it invalidates the test:

   > If you diagnose the problem with an agent, add the rule, then ask that same agent to redo the
   > work, it already knows the answer from the conversation. It "passes" using the discussion, not
   > the rule. You've tested nothing.

3. **Re-run the original task verbatim.** Give the fresh agent the same request that produced the
   mistake the first time. It now has only the rule set (root `AGENTS.md`, the nested file,
   `decisions.md`) to guide it — exactly what a real teammate's agent would have.

4. **Judge the result.**
   - **Held** → the agent produced the compliant version. Keep the rule; you're done.
   - **Missed** → the rule was too vague, or in the wrong place, or contradicted by another rule.
     Tighten it (more specific, a better example, or move it closer to the code) and run the loop
     again.

## Why it's worth the slowness
The loop feels slow — you're re-doing work you already did. But you're doing it while you're
*designing the architecture*: deciding where things go and where they must not. Each pass hardens a
rule so that later, when you ask the agent to build a whole feature, it already knows where
everything belongs. More time up front, far less time later — you're investing in your future self
(and your teammates, who inherit rules that actually work).

## When a rule won't hold
Sometimes a rule fails the loop repeatedly no matter how you phrase it. That usually means one of:
- **It needs judgment, not a rule.** "Don't over-engineer this" can't be a pass/fail instruction.
  Leave it to the `judge-arch` review, which applies judgment in fresh context.
- **It's actually mechanical.** If it's "pattern X must not appear in place Y," stop trying to
  teach it in prose — move it into `arch-gate.config.json` so CI enforces it deterministically
  (see the `judge-arch` skill's `references/mechanical-gate.md`). A gate check can't be overridden
  by the next prompt; a sentence can.
- **It conflicts with another rule.** The agent is obeying a different rule that fights this one.
  Reconcile them (see `references/writing-rules.md` on pruning contradictions).

## After it holds
- If the rule is greppable, wire it into the mechanical gate too, so it blocks a merge and not just
  a fresh session.
- Note in your commit / PR that the rule was tested (held after N iterations). A tested rule is a
  load-bearing part of the standard; an untested one is a hope.
