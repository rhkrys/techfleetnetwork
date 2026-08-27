# The four questions — in depth

> Load this reference when running a `judge-arch` review, or whenever you need the full red-flag
> list and ✅/❌ examples for one of the four questions. `SKILL.md` has the summary; this is the
> depth behind it.

Reviewing a change has two halves. "Does this work?" — bugs, edge cases, security — announces
itself: a failing test, a type error, a customer complaint. "Does this **belong** here?" —
architecture — is silent. Nothing fails, the tests are green, the feature ships. These four
questions make the silent half visible. Ask them **before** writing code and again **before**
calling it done.

---

## 1. Boundary placement — *is this in the right place?*

Business rules — calculations, checks, multi-step workflows — must live where any part of the app
can reach them, not wherever the change happened to land.

**Red flags**
- A business rule (a price calc, an eligibility check, a state machine) written inside a
  controller, route handler, or UI component.
- Calculation mixed with display: the math and the markup in the same function.
- A whole workflow living in one caller, so a second caller (an admin screen, a webhook, a CLI)
  would have to copy it.
- Code that went "wherever the agent was" — logic dropped into the file currently open rather
  than the file that should own it.

**Litmus test:** *if another part of the app needed this rule tomorrow, could it find it?* If not,
it's in the wrong place.

```
❌ never — the workflow lives inside the handler
function refundController(req) {
  payment.refund(req.orderId)
  loyalty.subtract(order.points)          // business rule trapped in a controller
  email.send(order.customer, 'refunded')  // next caller must copy all of this
}
✅ always — handler translates input → calls one service → returns
function refundController(req) {
  refundService.refund(req.orderId)       // the whole workflow lives in one reusable place
  return ok()
}
```

**Where each layer's job ends:** views/components format and display; handlers translate the
request, call a service, and return a response; services/domain own the decisions; the database
enforces what must always be true (uniqueness, required, one-active-row) as the last line of
defense.

---

## 2. Data ownership — *who else writes this data?*

Every fact has exactly one owner. Writes go through the owner; everyone else reads.

**Red flags**
- The change writes data that another part of the app already writes (via a different mechanism).
- The same value stored in two places, "kept in sync" by hand (an actual `// keep in sync`
  comment is a confession).
- A stored total sitting next to the rows it should be computed from.
- A flag mirroring another system's state (an `is_premium` that mirrors a subscription; a status
  copied into a second table; a value cached in one store *and* the database).
- Writing straight into another module's table instead of through its front door.

**Why it bites:** two copies always disagree eventually. When they do, nobody can tell which is
correct, and the bug shows up far from the write.

```
❌ never — a derived value stored as if it were a fact, mirrored by hand
account.post_count = account.post_count + 1   // drifts from the actual row count
✅ always — one owner; everyone else derives/reads
count = posts.where(accountId).count()        // one source of truth
```

**Fix:** give the fact one owner. Writes route through it; the second copy becomes either a
computed read or a clearly-labeled cache (never a fact). Mirrors of external systems get one
idempotent writer keyed on an immutable id.

---

## 3. Dependency direction — *what does this now depend on?*

Business/domain code must not know about the web. The request stops at the boundary and becomes
plain data before it reaches a service.

**Red flags**
- Domain/service code that references `request`, `response`, `session`, `cookie`, HTTP headers,
  or view/rendering.
- A data model that suddenly knows about the request or session.
- A module reaching into another module's internals (its tables, its cache keys, its private
  helpers) instead of its public interface.

**The grep-test:** search your core business/service/domain code for words that shouldn't appear
there — `request`, `response`, `session`, `cookie`, HTTP-client calls, view/render imports. Any
hit is a dependency-direction violation (outside the boundary layer, where they're expected).

**Why it bites:** a rule that needs a request can't be tested without faking the whole request,
and can't be reused elsewhere — so the agent copies it, and now there are two. It also breaks for
unrelated reasons: someone changes a web concern and a business rule fails.

```
❌ never — a service that reads the request
function priceService(request) {
  const qty = request.body.qty            // business code coupled to HTTP
}
✅ always — plain data in, plain data out
function priceService(qty) { /* testable, reusable, web-free */ }
```

---

## 4. Error handling — *what happens when this breaks?*

Every `catch` / failure check does exactly one of three things: **recover**, **retry**, or
**report** (a mix is fine). A catch that does none is *hiding* a failure.

**Red flags**
- An empty catch, or a catch that's only a comment.
- Swallowing the error and returning `null` / `false` / `[]`, so the failure surfaces somewhere
  else, later, with no cause attached.
- A catch that shows the user a toast but never reports to operators — the failure is invisible
  to the people who could fix it.
- A floating promise whose rejection vanishes.
- A brand-new error type that nothing upstream knows how to catch.

```
❌ never — the failure is swallowed
try { await sendReceipt(user) } catch (e) { /* probably fine */ }
✅ always — recover / retry / report (here: retry then report)
await queue.dispatch(() => sendReceipt(user), { retries: 3, onFinalFailure: report })
```

**Note:** a `console.error` is not "report" if those logs are never collected. Reporting means the
failure reaches somewhere an operator will actually see it.

---

## Putting all four on one change

A single change usually touches more than one question. Take "refund an order, remove loyalty
points, email the customer":
- **Boundary:** is the refund workflow trapped in the controller? (any other caller must copy it)
- **Ownership:** who owns loyalty points — is the controller reversing them with its own guessed
  rate, or is the loyalty service the sole writer?
- **Dependency:** does the loyalty code now depend on the order's tables, or reach it through an
  interface?
- **Error handling:** if the email fails, does anyone ever find out?

The code "works" in all versions. The four questions are what separate the version that stays
maintainable from the one that quietly rots.
