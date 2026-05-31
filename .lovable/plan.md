
# Audit vs Technical Architecture Report

## What's already covered (no work needed)

| Report area | Status | Evidence |
|---|---|---|
| CI/CD automation | ✅ | 12 GitHub workflows: `regression`, `bdd-gate`, `lighthouse`, `cross-browser`, `browserstack-weekly`, `a11y-audit`, `npm-audit`, `pentest`, `secret-scan`, `preview-comment`, `auto-rerun-flake`, `ci-alert` |
| Unit + integration tests | ✅ | Vitest + React Testing Library, `src/test/{smoke,regression,services,hooks,validators,ui}` |
| E2E tests | ✅ | Playwright suite across 20+ folders (`e2e/`) |
| OWASP coverage | ✅ | RLS on all tables, defense-in-depth memory, hash-chain audit log, pentest workflow, npm-audit workflow, secret-scan workflow, edge-fn JWT/service-role gate |
| XSS / `dangerouslySetInnerHTML` | ✅ | `dompurify@3.4.2` used; server-pre-sanitized `body_html` for policies |
| Code splitting / lazy loading | ✅ | 89 `lazy()` call sites + `src/lib/lazy-with-retry.ts` |
| Error boundary | ✅ | `src/components/ErrorBoundary.tsx` + `error-reporter.service.ts` + agent_fix_queue triage |
| Web Vitals RUM | ✅ | `src/lib/web-vitals.ts` + `record-web-vital` edge fn + admin Performance tab |
| Feature-based architecture | ✅ | Service/repository layers, `src/services/*`, React Query everywhere |
| State management discipline | ✅ | React Query for server state, contexts for global, `useState` local — no duplicated state |
| Routing + design system | ✅ | React Router + tf-card design tokens + Brand Visual Guide v1 |
| API service layer | ✅ | UI → hooks → service → Supabase; circuit breaker for external APIs |
| Cross-browser + a11y | ✅ | BrowserStack weekly + axe a11y workflow + WCAG 2/3 in Core memory |
| DB-first content (supply chain) | ✅ | DBC-001..007, no public/data CSVs, sanitized policy HTML |
| Auth failures (A07) | ✅ | TOTP for admins, login rate limit fairness, session revocation, password reset race fix |

## Gaps to close — 10 fixes shipped in one pass

### 1. Pre-commit hygiene (report §5.2)
- Add **Husky** + **lint-staged** + **Prettier** (config matching existing eslint style).
- Pre-commit runs: `eslint --fix` + `prettier --write` on staged files.
- New `package.json` script `prepare` for Husky install.

### 2. ESLint security hardening (report §2.2)
- Add `eslint-plugin-security` + `eslint-plugin-react` (security rules: `no-danger-with-children`, `no-unsafe`, `no-find-dom-node`).
- Wire into `eslint.config.js` as warn-on-violation so it surfaces without breaking the build immediately.

### 3. Dependency auto-update (report §2.1 A03 supply chain)
- Add `.github/dependabot.yml` — weekly grouped PRs for npm + GitHub Actions, security updates daily.
- Complements existing `npm-audit.yml`.

### 4. SBOM artifact (report §2.1 A03/A08)
- Extend `npm-audit.yml` to emit a CycloneDX SBOM (`@cyclonedx/cyclonedx-npm`) and upload as a workflow artifact, retained 90 days. Satisfies SOC 2 SBOM line in `mem://compliance/technical-controls`.

### 5. List virtualization (report §3.1)
- Add `@tanstack/react-virtual` (already standard alongside our stack).
- Apply to the three known long-scroll card grids that are NOT AG Grid:
  - Recruiting Center applicants card view
  - Members directory grid
  - Announcements feed
- Threshold: virtualize when item count > 50.

### 6. Image optimization helper (report §3.1)
- Add `vite-plugin-image-optimizer` for build-time PNG/JPG → optimized + sibling WebP.
- New `<OptimizedImage>` wrapper (drop-in `<img>` replacement) emitting `<picture>` with `image/webp` source, `loading="lazy"`, `decoding="async"`, explicit `width`/`height`.
- Migrate the obvious hero/brand images (landing, course covers, client logos) — leave generated-content images alone.

### 7. Bundle-size budget (report §3.1)
- Add `size-limit` with `@size-limit/preset-app`.
- Budgets: main entry ≤ 250 KB gz, total initial ≤ 500 KB gz.
- New CI step in `regression.yml` — fails PR if budget exceeded.

### 8. Visual regression baseline (report §1.2)
- Existing `e2e/visual/` is small. Promote to a proper Playwright `toHaveScreenshot()` baseline covering: landing, sign-in, dashboard empty state, /terms, /privacy, /accessibility, project openings list, lesson player.
- New workflow `visual-regression.yml` running on PR with screenshot diff threshold 0.2%; baseline stored under `e2e/visual/__screenshots__/`.

### 9. Static prerender for SEO-critical public routes (report §4.2)
- Add `vite-plugin-prerender-spa` (or `vite-plugin-prerender`) — pre-renders `/`, `/terms`, `/terms-of-use`, `/privacy`, `/cookies`, `/accessibility`, `/code-of-conduct`, `/sign-in`.
- HTML is served instantly; React hydrates after. Improves LCP + SEO without abandoning SPA model.
- Content still comes from DB at runtime; prerender uses the bundled offline fallback strings + `<noscript>` policy text fetched at build via `get_current_policy` RPC.

### 10. Security headers smoke test (report §2.1 A02 misconfig)
- New `src/test/smoke/security-headers.smoke.test.ts` that asserts production-host responses for `/` include: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy` (or `Content-Security-Policy-Report-Only`).
- Runs in `regression.yml`. Tells us immediately if the platform CDN drops a header.

## Out of scope (intentionally rejected)

- **Sentry / LogRocket**: superseded by internal triage queue + web vitals RUM + agent_fix_queue.
- **Zustand / Jotai**: React Query + contexts already cover state needs; adding another store harms simplicity.
- **Monorepo / micro-frontends**: single app, single team — overhead > value.
- **SSR / ISR**: Vite SPA + prerender for static routes is sufficient; full SSR would require rebuilding the host model.
- **React Compiler (React 19)**: project on React 18; upgrade is its own dedicated wave.
- **Edge / API gateway**: Supabase Edge Functions already provide this; no extra gateway needed.

## Technical details

- All new tooling added as **devDependencies** — zero runtime weight.
- BDD scenarios added under `bdd_scenarios` tag `@arch-report-2026`, one per fix (10 total), tri-layer Then-clauses per Core memory.
- Memory: new `mem://tech/arch-report-coverage-2026` indexing what's done; update `mem://compliance/technical-controls` with SBOM artifact path; update `mem://features/web-vitals-rum` with bundle budget pointer.
- Rollback: every fix is a separate commit; Husky/lint-staged opt-in via `prepare` script (devs without it just don't get pre-commit), all CI additions are new jobs so they can be disabled individually.

## Verification gates after shipping

- `bun run test` green, `bun run lint` green (existing + new security rules as warn).
- `size-limit` report ≤ budgets.
- `playwright test --grep visual` produces 8 baseline screenshots.
- `dependabot.yml` validated by GitHub UI.
- `npm-audit.yml` artifact list now includes `bom.json`.
- Prerendered HTML for `/terms` contains visible policy heading on `curl -s` (no JS execution).
- Security-headers smoke test green against the published URL.
- All 10 BDD scenarios `@arch-report-2026` pass tri-layer assertions.
