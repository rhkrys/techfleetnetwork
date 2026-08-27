# Writing rules that hold

> Load this reference when turning a caught mistake into a rule — how to phrase it, where to put
> it, and how to keep the rule file from rotting.

A stored rule *influences*; it does not *enforce*. It makes a violation less likely, not
impossible, because an agent always weights the most recent thing it saw most heavily. So two
things matter: write rules an agent can't misread, and back the checkable ones with the mechanical
gate.

## The example beats the principle
This is the single highest-leverage habit. A code block showing exactly what to reject or accept
does far more than a paragraph describing it.

```
❌ vague principle — matches everything and nothing
"Keep controllers thin and respect separation of concerns. Business logic belongs in the service
 layer and services should not be constructed with request-specific state."

✅ concrete example — an agent understands this instantly
### Controllers don't own workflows
// ❌ never
class OrderController {
  refund(req) { payment.refund(req.id); loyalty.subtract(...); email.send(...) }
}
// ✅ always
class OrderController {
  refund(req) { return refundService.refund(req.id) }
}
```

One real snippet of the structure you want to enforce (or reject) beats the paragraph every time.
Prefer examples drawn from *this* codebase — real, current, never out of date.

## Negative and specific beats positive and vague
A rule an agent can pass or fail is worth ten it can interpret.

```
❌ "Prefer thin controllers."                         // a preference; matches nothing concrete
✅ "Don't call the DB or the model layer inside a controller."   // passes or fails
❌ "Keep the app's layers separate."
✅ "Files in `domain/` must not import from `http/` or the web framework."   // greppable, testable
```

If a rule can be written as *"pattern X must not appear in place Y,"* it can also go into the
mechanical gate (see the `judge-arch` skill's `references/mechanical-gate.md`). Do that — a rule
that can be mechanical *should* be.

## Put the rule at the right altitude
Not everything belongs in the root file.

| The rule is about… | Put it in… | Why |
|---|---|---|
| one folder / one kind of file | a nested `AGENTS.md` in that folder | loads only when the agent works there; costs nothing elsewhere |
| a cross-cutting architectural decision | the repo's `decisions.md` | the standing rulebook the review reads |
| a truly universal engineering rule | the root `AGENTS.md` | applies everywhere — keep it lean, it loads every session |
| a checkable "pattern X in place Y" | also `arch-gate.config.json` | so CI blocks it, not just prose |

Nested rule files are the most overlooked lever: when the agent opens that folder, it gets exactly
the rules that apply there, in context, and nothing else.

## Don't auto-generate; grow and prune
- **Never auto-generate a rules file** from the codebase or a prompt. It feels like a time-saver
  and produces vague, repetitive rules that dilute attention. Add rules one caught mistake at a
  time — but *do* have the agent draft the line, then review and prune it (don't hand-write from
  scratch either).
- **Prune regularly.** Every session loads the whole root file. Watch for:
  - **Contradictions** — "keep controllers thin" vs "don't create extra classes." The agent
    resolves the conflict arbitrarily; reconcile them into one rule.
  - **Bloat** — more rules means less attention on each. A short file of concrete, tested rules
    beats a long vague one.

## The trap: the task can outrank the rule
Even a good rule loses to a conflicting instruction in the current prompt — the agent follows what
you *just said* over what the file says. That's expected. It's also why the mechanical gate exists:
prose can be overridden mid-conversation; a CI check that exits 1 cannot. Encode the important ones
both ways.

Once you've written the rule, **prove it holds** — see `references/testing-a-rule.md`.
