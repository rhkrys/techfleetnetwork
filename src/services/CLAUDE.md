# Rules for services (scoped — loads when working here)

- **No UI framework, no DOM.** Never import `react`/`react-router`; never touch `window`, `document`, `localStorage`, `sessionStorage`. Plain data in, plain data out — must be testable in Node. (Route last-known-good caches through `src/lib/memory-cache.ts` / `src/lib/cached-session.ts`, not `window` directly.)
- **Own your types.** A service's types live beside it (`*.types.ts`), never imported from a component file — the dependency arrow points UI → service, never up.
- **One owner per fact.** The service that writes a piece of data is its sole writer; everyone else reads via it. Mirror the Gumroad ledger model (one writer, derive the rest).
- **Every failure reports** via `reportError`/`handleServiceError` — a bare `console.error`/`log.error` is not reporting (the logger only writes to the browser console).
