# ADR-0008: OWASP secure-coding CI gate with enforced 120-sheet coverage

- **Status:** Accepted (2026-08-16)
- **Related:** `.github/workflows/ci.yml` (the required `gate`), `scripts/pentest/sast.mjs`, `docs/security/owasp-coverage.md`, the `owasp-secure-coding-bdd` skill.

## Context

The codebase already had a strong static OWASP analyzer — `scripts/pentest/sast.mjs`,
49 controls spanning XSS, injection, authz/IDOR, secrets, crypto, SSRF, edge-function
auth posture, CI/CD supply chain, LLM/MCP, and more. But it did **not** actually gate
deploys, for three reasons:

1. **Not a required check.** Deploys happen on push to `main` → Cloudflare Pages. Branch
   protection requires only `ci / gate`. The SAST suite ran in `pentest.yml`, which is not
   in that aggregator, so it never blocked a merge.
2. **Silently skippable.** `pentest.yml` gates every suite behind a `secrets-guard` step
   that needs live-target pen-test secrets. The static SAST sweep needs **no** secrets, yet
   was skipped whenever those secrets were absent — so it could (and likely did) never run
   to completion in CI.
3. **Not OS-portable.** The suite hard-coded forward-slash paths, so on non-Linux dev
   machines every path-based rule silently no-op'd — a false all-clear. When it was finally
   run to completion it surfaced 11 findings on `main`, a mix of scanner false positives and
   genuine pre-existing gaps, proving it had never been green in CI.

There was also no machine-checked proof that the analyzer's controls actually cover the
**whole** OWASP Cheat Sheet Series (120 sheets) — "OWASP coverage" was prose in a README.

## Decision

Make OWASP secure-coding a **blocking gate on everything that deploys**, and make
"100% cheat-sheet coverage" a mechanically enforced property rather than a claim.

1. **New required job `security-owasp` in `ci.yml`, folded into the `gate` aggregator.**
   It runs two secret-free, dependency-free (Node built-ins only) checks on every PR/push:
   - `scripts/pentest/sast.mjs` — the full OWASP static SAST sweep.
   - `scripts/ci/check-owasp-coverage.mjs` — the coverage completeness gate.
     Because it needs no npm install and no secrets, it cannot be silently skipped the way the
     `pentest.yml` SAST run could, and because it is in `gate` it blocks merge → deploy.

2. **A machine-enforced coverage map.** `docs/security/owasp-coverage.md` maps **all 120**
   cheat sheets to a real enforcing mechanism — a SAST rule id, a CI guard, a pen-test
   suite, pgTAP proofs, a workflow, a design doc, or an explicitly justified `config:` /
   `n/a:` reason. `check-owasp-coverage.mjs` fails the build if any of the 120 is unmapped,
   if a name is not one of the 120, if an `sast:` id doesn't exist in the suite, or if a
   referenced `check:`/`workflow:`/`doc:` path is missing. A new OWASP sheet or a deleted
   rule breaks CI until the map is honest again.

3. **Scanner precision fixes (not weakening).** Making `main` green required correcting
   scanner false positives that had hidden it from ever passing: multi-line sanitizer
   detection for `dangerouslySetInnerHTML`; excluding test files from DOM-sink and
   password-storage rules; dropping the `setPassword:` state-setter false match; matching
   only flag-shaped authz keys in client storage; allowlisting XML namespace URIs; skipping
   comments/doc-paths in the raw-SQL rule; reading `supabase/config.toml` (`verify_jwt`) and
   the `authorizeServiceRoleRequest` helper for edge-function auth posture; and scoping the
   untrusted-CI-context rule to genuinely attacker-controllable inputs per the OWASP GitHub
   Actions cheat sheet. Two rules were **strengthened**: the SHA-pin rule no longer lets a
   trailing comment bypass validation, and the least-privilege rule now requires an inline
   `# owasp-allow: <reason>` to grant scoped elevated permissions.

4. **Genuine findings fixed, not annotated away:** `github.head_ref` routed through `env`
   in `visual-regression.yml` (shell-injection surface), and four unpinned third-party
   actions pinned to SHAs in `deploy-frontend.yml` / `deploy-edge-functions.yml` /
   `lighthouse.yml`.

## Rollout

"Blocking, once proven green" (owner decision). The suite was made OS-portable and proven
green locally (49/49) and the coverage gate green (120/120) **before** being added to the
required `gate`, rather than landing informational-first. `pentest.yml` is left unchanged:
its runtime suites still need live-target secrets, and its now-redundant SAST run is
harmless — the authoritative, unconditional, blocking SAST run is `ci.yml`'s `security-owasp`.

## Consequences

- **Positive:** No code can deploy without passing the full OWASP static sweep; coverage of
  all 120 sheets is a build invariant; the scanner is now correct cross-OS and locally
  runnable; two real CI/CD supply-chain and injection findings are fixed.
- **Negative / trade-offs:** `security-owasp` is now a merge blocker — a new genuine finding
  will (correctly) stop merges until fixed or explicitly, visibly justified. SAST runs in two
  workflows (redundant compute, accepted for simplicity and blast-radius safety). The
  coverage map needs a one-line update whenever OWASP adds or renames a sheet — the gate
  makes that non-optional, which is the point.
