# ADR 0010 — Read Figma boards via the Figma REST API, not the web page

- Status: Accepted
- Date: 2026-08-18
- Deciders: TechFleet (owner)
- Related: ADR-0006 (hand-off material ingest), ADR-0007 (load-on-demand extraction), ADR-0008 (OWASP CI gate)

## Context

Members paste Figma board links into Fleety — in chat ("review my board") and in the
`fleety-review` deliverable coach. Both surfaces fetch member material through the single
SSRF-guarded fetcher `_shared/material-fetch.ts`. That fetcher does a plain `fetch(url)` and strips
HTML tags. For a Figma board URL this returns the **Figma web application's JS bundle**, not the
design — so Fleety saw "a bunch of code," not the content, and told members it could not read the
board. The capability appeared built but never worked for its main input type.

Figma design content is only available through the **Figma REST API**
(`GET https://api.figma.com/v1/files/:key`) with an `X-Figma-Token`. That is a different host, a
different auth model (a token header), and a JSON (not HTML) response — it cannot be served by the
generic page fetcher.

We had deliberately kept `FIGMA_TOKEN` off since a pre-checkpoint hand-off crash caused by an
**unbounded** Figma load (ADR-0006/0007). Any re-enablement must stay bounded.

## Decision

Add `_shared/figma-extract.ts`:

- `parseFigmaKey(url)` — pure; returns a file key only for a genuine `figma.com` (or subdomain)
  `/file|/design|/board|/proto/` URL. Rejects host-suffix spoofs (`figma.com.evil.com`).
- `figmaNodesToText(json, maxChars)` — pure; flattens the document tree to readable text
  (TEXT-node characters + container names as light headings), bounded by `maxChars`.
- `fetchFigmaContent(url, token, opts)` — calls the **constant** host `api.figma.com` over https
  with `redirect:"error"`, the token in the `X-Figma-Token` header, a shallow `depth`, a byte cap,
  a wall-clock timeout, and an output-char cap. Maps 403/404 to a "share the board with the
  integration" message; never leaks API internals or the token.

`fetchMaterialText` routes any Figma file link to `fetchFigmaContent` when a Figma token is
configured — **`FLEETY_FIGMA_TOKEN` if set, otherwise `FIGMA_TOKEN`** — and **fails closed** with a
clear "reading Figma isn't enabled — paste the content instead" message when neither is. It never
falls back to scraping the page HTML. Both chat and `fleety-review` inherit this automatically
because they share the one fetcher.

**Token choice:** `FIGMA_TOKEN` is already set in prod (the hand-off generator and its DeepSeek
Figma parsing use it), so Fleety reads it by default — zero new config. `FLEETY_FIGMA_TOKEN` is an
optional override for later, if the owner ever wants Fleety to read Figma under a distinct
personal-access-token (e.g. a separate rate-limit or scope) without touching hand-off's.

## Consequences

- Pasting a Figma board now yields real design text/structure, not code.
- Egress stays fixed (only `api.figma.com`); the member URL is used solely to parse a key.
- Bounded traversal/bytes/time/chars honor the ADR-0006/0007 no-unbounded-load lesson.
- Requires the operator to set `FLEETY_FIGMA_TOKEN` on the owned project; until then Fleety says so
  plainly rather than returning garbage. Rollback = unset the token (feature self-disables,
  fail-closed). Hand-off's `FIGMA_TOKEN` is untouched and stays independently held.
- The board is untrusted data; callers already frame fetched material as data, not instructions.
