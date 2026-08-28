# Review follow-ups — findings surfaced _during_ remediation

Findings that judge-arch (or a PR review) raised while fixing an audit item, tracked so
they are vetted and resolved rather than lost. Distinct from the original audit
(`findings.md`) and the PLAUSIBLE triage (`plausible-triage.md`).

| id    | source                   | severity | status           | resolution                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------ | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-01 | judge-arch on P35 (#306) | Med      | **fixed (#306)** | In-flight `listFactors()` could re-seed `factorCache` _after_ the sign-out reset (race re-opening P35). Fixed with a generation counter in `mfa.service.ts`; regression test `mfa.service.signout-race.test.ts` (failing-first proven).                                                                                                              |
| RF-02 | judge-arch on P35 (#306) | Low      | **fixed (#306)** | `signOut()` / `signOutAllDevices()` cleared the query cache but not the MFA cache (it rode solely on the `SIGNED_OUT` event). Added a defensive `clearAllMfaClientState()` call to both imperative paths (belt-and-suspenders with the event handler).                                                                                               |
| RF-03 | judge-arch on P35 (#306) | Low      | **fixed (#306)** | `auth-mfa.service.ts` `recentlyVerifiedAt` (10s post-verify quiet window) survived sign-out. Currently read only by the contract test (no live bypass today), but now reset on every sign-out path via `resetMfaQuietWindowForSignOut()` so it is correct-by-construction if ever wired into a live gate. Unit test `auth-mfa-quiet-window.test.ts`. |

## Standing rule established here

**Gate integrity (no false-positive checks, ever).** Every CI check/guard must (a) emit a
_substantial evidence line_ stating what it inspected and how much (counts/paths), (b) **fail
closed** — a missing input, an internal error, or a zero-scan must exit non-zero, never a silent
`exit 0`, and (c) never pass vacuously on a diff-based no-op. Tracked as a dedicated hardening
task (audit of all `scripts/ci/*` + an enforcing meta-check); see the gate-integrity work item.
