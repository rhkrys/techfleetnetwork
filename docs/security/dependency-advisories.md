# Dependency advisories — status & accepted risks

Tracks how the open Dependabot / `npm audit` advisories were resolved. Updated
2026-08-16 (the 22-alert sweep). Re-check with `npm audit` after any dependency
change; keep this file honest.

## Fixed

| Advisory package                                                                              | Severity              | Ships to users? | Resolution                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-router`, `react-router-dom`                                                            | medium (runtime)      | yes             | Upgraded v6.30.4 → **v7.18.2** (SSR-hydration constructor injection is N/A to this SPA; the open-redirect / open-redirect→XSS are the real fixes). React 18 retained (v8 would require React 19).                                                                                                     |
| `js-yaml` ×3                                                                                  | high/medium (runtime) | yes             | Override bumped `4.1.1` → **`^4.3.1`** (quadratic-CPU DoS on `!!omap` / merge-key chains).                                                                                                                                                                                                            |
| `undici` ×5                                                                                   | high/medium (dev)     | no              | Override → **`^7.29.0`**.                                                                                                                                                                                                                                                                             |
| `fast-uri`                                                                                    | high (dev)            | no              | Override → **`^3.1.5`**.                                                                                                                                                                                                                                                                              |
| `brace-expansion`                                                                             | high (dev)            | no              | `npm audit fix` (patched within each major present in the tree).                                                                                                                                                                                                                                      |
| `ip-address` ×3                                                                               | high/medium (dev)     | no              | `npm audit fix`; remaining puppeteer path removed (below).                                                                                                                                                                                                                                            |
| `extract-zip`, `puppeteer-core`, `@puppeteer/browsers`, `find-chrome-bin`, `nanoid`, `estimo` | high (dev)            | no              | **Removed the dependency chain**: swapped `@size-limit/preset-app` → `@size-limit/file`. The `size-limit` config only measures file size, so the puppeteer-based `@size-limit/time` timing preset (which pulled `extract-zip`, for which there is _no_ upstream fix) was unused. 55 packages removed. |

react-router v7 adds ~18 KB gz to the total bundle, so the `size-limit` "Total
initial JS" budget was raised 1500 KB → 1600 KB (main entry is unchanged at
~238 KB / 350 KB budget). This is the only user-facing side effect of the sweep.

Proof: `npm audit` clears all of the above; `tsc --noEmit`, `npm run build`, and
the full `vitest` suite (1642 tests, incl. all react-router-wrapped UI/auth tests)
pass; `npm run size` passes.

## Accepted (with rationale)

These remain in `npm audit` by design — each has no non-breaking fix and is not
exploitable in this app. Revisit on the next major-tool upgrade.

### `vite` + `esbuild` — dev-server only, NOT in production

- Advisories: vite `server.fs.deny` bypass, path traversal in optimized-deps
  `.map` handling, `launch-editor` NTLM disclosure; esbuild dev-server request
  reflection.
- **Why accepted:** every one of these is a vulnerability in the **Vite dev
  server** (`vite dev`). This app ships a **static `dist/`** built bundle served
  by Cloudflare/Nginx — the dev server never runs in production, so none of these
  is reachable by an end user. The only fix is `vite@8` (a major build-tool
  upgrade requiring vitest / plugin-react-swc realignment), deferred to a
  dedicated, separately-tested build-tooling PR.
- **Compensating control:** developers run the dev server on localhost only.

### `quill` / `react-quill-new` — low, mitigated by DOMPurify

- Advisory: Quill XSS via its **HTML export** feature (GHSA-v3m3-f69x-jf25), low.
- **Why accepted:** the only "fix" `npm audit` offers is `react-quill-new@3.7.0`,
  a **downgrade** with no real patch (Quill 2.0.3 is the latest and still
  affected). All user-authored HTML rendered by this app is sanitized through the
  central DOMPurify sanitizer (`src/lib/security.ts`, enforced by
  `SAST-NO-DANGEROUS-DOM-SINKS` / the DOMPurify guards), so exported/rendered
  content cannot inject script.
- **Revisit:** when Quill ships a patched release.
