# ADR 0012 — Frontend deploy provenance + live verification (no more silent stale deploys)

- Status: Accepted
- Date: 2026-08-18
- Deciders: TechFleet (owner)
- Related: `deploy-frontend.yml` (wrangler net), `check-no-stray-lockfiles.mjs`, the cloudflare-silent-deploy + bun.lock incidents

## Context

The frontend deploys via Cloudflare Pages' git integration. That path is **opaque**: when its build
fails or never promotes to production, it fails **silently** and keeps serving the old bundle — while
local `npm ci` + `npm run build` and the GitHub CI gate all stay green (different environment). This
has bitten repeatedly (an 11-day silent freeze from a stray `bun.lock`; and again on 2026-08-18 when
2.2-A/B/C merged but the live site kept serving a weeks-old bundle across the whole app —
Fleety UI and the Resources page alike). The lockfile class already has a CI guard
(`check-no-stray-lockfiles.mjs`); what was missing is **detection that a merged commit actually
reached production**.

## Decision

Add build **provenance** + a **tokenless live verifier**:

- **`scripts/write-build-info.mjs`** runs in the `build` script on every path (local, Cloudflare
  git-integration via `CF_PAGES_COMMIT_SHA`, GitHub Actions via `GITHUB_SHA`). It writes
  `dist/build-info.json {sha, builtAt}` and injects `<meta name="app-build-sha">` into `index.html`.
- **`.github/workflows/verify-deploy.yml`** runs on every push to `main`: it polls
  `${PROD_URL}/build-info.json` for up to ~15 min and **fails red** if the live site is not serving
  the merged commit. Needs only a public repo **variable** `PROD_URL` — **no Cloudflare secret** — so
  it verifies whatever deploy path is in use (git-integration or the wrangler `deploy-frontend.yml`).
  Until `PROD_URL` is set it is a green no-op with a notice, so merging it is safe.

## Consequences

- A silent stale deploy becomes a **loud, dated red X with a link**, minutes after merge — never
  again days of "why isn't my change live?".
- Works with the current Cloudflare git-integration as-is (no migration of the deploy mechanism, no
  new secret). If/when `deploy-frontend.yml` is armed (its own Cloudflare secrets), the same verifier
  covers it too.
- Zero runtime impact: `build-info.json` is a tiny static file; the meta tag is inert.
- Operator actions (one-time): set the `PROD_URL` Actions **variable**. Optional hardening: arm
  `deploy-frontend.yml` and then disable the Cloudflare git-integration auto-build so there is a
  single, visible deploy path.
