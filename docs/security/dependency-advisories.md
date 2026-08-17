# Dependency advisories — status & accepted risks

Tracks how the open Dependabot / `npm audit` advisories were resolved. Updated
2026-08-16 (the 22-alert sweep, then the vite 7 follow-up). Re-check with
`npm audit` after any dependency change; keep this file honest.

**Current state:** `npm audit` reports only the quill low-severity item below,
which has no upstream fix and is mitigated at the app layer. Zero high/moderate,
zero production-shipped high/critical.

## Fixed

| Advisory package                                                                              | Severity              | Ships to users? | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | --------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-router`, `react-router-dom`                                                            | medium (runtime)      | yes             | Upgraded v6.30.4 → **v7.18.2** (SSR-hydration constructor injection is N/A to this SPA; the open-redirect / open-redirect→XSS are the real fixes). React 18 retained (v8 would require React 19).                                                                                                                                                                                                                                |
| `js-yaml` ×3                                                                                  | high/medium (runtime) | yes             | Override bumped `4.1.1` → **`^4.3.1`** (quadratic-CPU DoS on `!!omap` / merge-key chains).                                                                                                                                                                                                                                                                                                                                       |
| `undici` ×5                                                                                   | high/medium (dev)     | no              | Override → **`^7.29.0`**.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `fast-uri`                                                                                    | high (dev)            | no              | Override → **`^3.1.5`**.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `brace-expansion`                                                                             | high (dev)            | no              | `npm audit fix` (patched within each major present in the tree).                                                                                                                                                                                                                                                                                                                                                                 |
| `ip-address` ×3                                                                               | high/medium (dev)     | no              | `npm audit fix`; remaining puppeteer path removed (below).                                                                                                                                                                                                                                                                                                                                                                       |
| `extract-zip`, `puppeteer-core`, `@puppeteer/browsers`, `find-chrome-bin`, `nanoid`, `estimo` | high (dev)            | no              | **Removed the dependency chain**: swapped `@size-limit/preset-app` → `@size-limit/file`. The `size-limit` config only measures file size, so the puppeteer-based `@size-limit/time` timing preset (which pulled `extract-zip`, for which there is _no_ upstream fix) was unused. 55 packages removed.                                                                                                                            |
| `vite`, `esbuild`                                                                             | high/moderate (dev)   | no              | Upgraded **vite `5.4.21` → `^7.3.6`** (fixes `server.fs.deny` bypass, optimized-deps `.map` path traversal, `launch-editor` NTLM, and the bundled esbuild dev-server request reflection). vite 7 is the compatible target — `@vitejs/plugin-react-swc` supports `^7` and `vitest@4` requires `^6\|\|^7\|\|^8`; vite 8 is not yet supported by the SWC plugin. Also aligns vitest onto the app's vite (was a peer mismatch on 5). |

react-router v7 adds ~18 KB gz to the total bundle, so the `size-limit` "Total
initial JS" budget was raised 1500 KB → 1600 KB (main entry is unchanged at
~238 KB / 350 KB budget). This is the only user-facing side effect of the sweep.

Proof: `npm audit` clears all of the above; `tsc --noEmit`, `npm run build`, and
the full `vitest` suite (1644 tests, incl. all react-router-wrapped UI/auth tests)
pass on vite 7; `npm run size` passes (main 238/350 KB, total 1.51/1.6 MB).

## Accepted (with rationale)

One item remains in `npm audit` — it has **no upstream fix at all** and is not
exploitable in this app.

### `quill` / `react-quill-new` — low, mitigated by DOMPurify

- Advisory: Quill XSS via its **HTML export** feature (GHSA-v3m3-f69x-jf25), low.
- **Why accepted:** the only "fix" `npm audit` offers is `react-quill-new@3.7.0`,
  a **downgrade** with no real patch (Quill 2.0.3 is the latest and still
  affected). All user-authored HTML rendered by this app is sanitized through the
  central DOMPurify sanitizer (`src/lib/security.ts`, enforced by
  `SAST-NO-DANGEROUS-DOM-SINKS` / the DOMPurify guards), so exported/rendered
  content cannot inject script.
- **Revisit:** when Quill ships a patched release.
