# Drift patterns & the critic's stance

> Load this reference when you want the failure modes behind the four questions — *why* agents
> produce structural drift — and the exact prompts that make a fresh-context critic useful
> instead of flattering.

## Why agents drift

An agent reaches for what it has seen most, not what your project does. Three pulls explain most
of it:
- **Common beats custom.** Your conventions are a tiny signal next to the millions of codebases in
  training data — many of them not good examples.
- **Simple beats structured.** Every solution has a quick version and a structured version; the
  quick one gets written, because the agent is trying to make it work *now*, not designing for
  next quarter.
- **Familiar beats framework-specific.** It hand-rolls what the framework already provides,
  because the hand-rolled shape is more common than your framework's idiom.

Whatever a human tends to do wrong, an agent does faster and more consistently — so drift
compounds.

## The four drifts (backed by change-history analysis)

1. **Selective amnesia** — forgets code it already wrote and writes it again. Duplication climbs;
   architecture (which must be consistent) suffers most.
2. **Library aversion** — hand-rolls what a library or the framework already provides.
3. **Deletion phobia** — favors *adding* over deleting. Dead code accumulates; the honest fix
   (delete + refactor) is skipped in favor of one more addition.
4. **Complexity spiral** — patches rather than refactors, so complexity compounds.

The result isn't wrong code — it's *correct code written a slightly different way every time*,
until the system is hard to reason about and every fix breaks something else.

## The two directions of drift

Drift goes both ways. Watch for both:

**Over-engineering**
- An interface / factory / manager / strategy wrapper with a single implementation.
- Layers, abstractions, or indirection added for one use "in case."
- Changes nobody asked for — a small fix that snowballs into other files.

**Under-engineering** (the more common day-to-day)
- Business logic in the controller/component.
- The same block duplicated instead of extracted.
- Code piled on old code; nothing tidied.
- Error handling absent.

The governing question: **is the complexity justified by a requirement I actually have right
now** (or one that is certain and imminent)? Speculative flexibility usually never arrives. This
one is judgment, not a rule you can grep for — which is why the critic matters.

## The critic's stance

The review runs in a **fresh context** (a new session, or a separate reviewer) for a reason: the
conversation that produced the code makes you lenient and blind to what a newcomer would hit.

Two habits make the critic worth running:

- **Ask for problems, not approval.** Models affirm by default — ask "is this good?" and you get
  reassurance. Ask for what's wrong.
- **Ask for findings, not fixes.** Have it list problems with reasons; *you* decide what to act
  on. Turn the list into a checklist. Don't say "find problems and fix them."

Useful prompts (each does specific work):
- *"Challenge this design for long-term changeability. **What change does it make hardest?**"* —
  the second sentence keeps it grounded in real future changes instead of fantasy scenarios.
- *"Find the coupling and ownership problems in this change."* — surfaces question 2 and 3 fast.
- *"Propose a simpler structure that still meets the requirements. **What would we lose?**"* —
  guards against over-engineering; the "what would we lose" guards against over-simplifying.

## The critic always finds something — so filter

Asked for problems, a reviewer will produce them even when there are none. Apply one test to every
finding before you keep it:

> **What breaks later if I ignore this?**

If there's a concrete answer — two totals will disagree, the next caller must copy this, this
can't be tested — fix it, even if the fix is small. If the honest answer is "nothing, it's a
speculative nicety" (an interface that *might* help someday), drop it. Precision over volume; an
empty, honest report beats a padded one.
