<!-- Copy to src/services/AGENTS.md (and/or src/lib/AGENTS.md). Loads only when the agent works here. -->
# Rules for services & lib

- **No UI framework, no DOM.** Never import `react`/`react-router`; never touch `window`, `document`, `localStorage`, `sessionStorage`. Plain data in, plain data out — must be testable in Node.
- **Own your types.** A service's/lib's types live beside it (`*.types.ts`), never imported from a component file. The dependency arrow points down (UI → service), never up.
- **One owner per fact.** A service that writes a piece of data is its sole writer; everyone else reads via this service.
- **Every failure recovers, retries, or reports** — through the app's reporting spine, not a bare `console.error`.
