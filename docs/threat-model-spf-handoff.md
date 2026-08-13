# Threat Model — SPF Data Layer + Hand-Off Production System

Companion to `docs/threat-model.md` and `docs/attack-surface.md`. Covers the two workstreams
(A: SPF becomes source of truth; B: hand-off production). Findings map to `@security` BDD
scenarios wired into `bdd-gate.yml` / `security.yml`. Derived from the OWASP secure-coding
threat-modeling pass in the approved plan.

## Trust boundaries

1. Internet → `spf-sync` edge fn (untrusted external JSON from GitHub Pages, no auth).
2. Browser (active teammate) → upload edge fn (attacker-authorable files + text).
3. User-supplied Figma/FigJam URL → platform-token fetch (SSRF surface).
4. Uploaded/retrieved content → LLM prompt (prompt-injection / RAG-poisoning surface).
5. Edge fn → Postgres (RLS boundary) and → private Storage (signed-URL boundary).
6. LLM output → SPA render (insecure-output-handling / stored-XSS surface).

## Threats → controls → `@security` scenario

| ID  | Threat (STRIDE)                                                          | Control                                                                                                                                                                        | Scenario                                                                                        |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| T1  | SSRF via SPF fetch / Figma URL (Info-disclosure, EoP)                    | host allow-list, https-only, resolve+re-check IP vs private/metadata ranges, no auto-redirect, cert-validate                                                                   | "SSRF blocks internal targets (SPF + Figma, incl. redirect)"                                    |
| T2  | RAG poisoning: malicious SPF feed grounds Fleety (Tampering)             | schema-validate v1 + checksum/provenance, atomic swap, fail-closed                                                                                                             | "external JSON failing schema is rejected, snapshot unchanged"                                  |
| T3  | Prompt injection from uploaded deliverable / SPF text (Tampering, EoP)   | system vs untrusted-content separation; writer agents have NO tools; output validated                                                                                          | "injected instruction in a retrieved/uploaded doc does not trigger a tool call"                 |
| T4  | Malicious upload (zip bomb, XXE, CSV formula, disguised type) (DoS, EoP) | magic-byte type check, size cap, random name, no-execute bucket, malware scan, decompress cap, XXE-off, CSV cells inert                                                        | "upload type-by-content / path-traversal / zip-bomb / XXE / CSV-formula"                        |
| T5  | IDOR: read another project's hand-off (Info-disclosure)                  | deny-by-default RLS, ownership re-check every access, short-lived project-scoped signed URLs                                                                                   | "teammate on Y cannot read X's deliverables or its signed URL"                                  |
| T6  | Non-member produces / mass-assignment of `project_id`/`role` (EoP)       | produce gate in edge fn AND RLS; DTO allow-list; server-derived membership                                                                                                     | "non-member cannot produce project X"; "mass-assignment ignored"                                |
| T7  | Pipeline abuse / cost exhaustion (DoS)                                   | per-user rate limit + concurrency cap, LLM spend/iteration cap, timeouts, one-run-per-project                                                                                  | "rate-limit + duplicate-produce → exactly one run"                                              |
| T8  | Stored XSS via LLM-authored MD/HTML (Tampering)                          | DOMPurify + server sanitize before render; CSP `script-src 'self'`                                                                                                             | "LLM narrative containing `<script>` renders inert"                                             |
| T9  | Secret leak (Figma/Groq tokens) (Info-disclosure)                        | edge secret store, fail-fast if unset, gitleaks in CI, least-privilege Figma scope                                                                                             | "edge fn fails fast if Groq/Figma secret unset"                                                 |
| T10 | Self-lockout / clobber on `reference_*` → SPF cutover (DoS, data loss)   | Step-0 lockout check; additive-before-subtractive; verified restorable backup; explicit confirmation; preserve `description_source` + `reference_relationships` + `anon` grant | "@lockout-prevention: SPF verified before `reference_*` drop; RLS change preserves admin/owner" |

## Live-risk flags (OWASP Step 6)

- **Multiple writers to `reference_*`** (`scrape-figma-workshops`, `fill-content-gaps`) +
  `description_source` precedence mean a naive SPF overwrite would **clobber curated + AI
  descriptions**. The cutover must merge, not overwrite — enforced in Phase A2 and covered by a
  `@data-lifecycle` invariant test.
- **`reference_relationships`** is migration-seeded (not in the SPF feed) and feeds
  `fw_lookup_relationships`; it is preserved, not replaced.
