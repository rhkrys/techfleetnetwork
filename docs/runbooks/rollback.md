# Rollback Runbook (PRD v1.2 D-26)

Fast, tested paths to revert a bad deploy. Every path here is safe to execute
under pressure; none require code archaeology. Written 2026-07 after the
cutover-era incidents (bun.lock 11-day freeze, react-router/ag-grid major
mismatches, auth-email-hook migration).

## 1. Frontend (Cloudflare Pages/Workers)

**Symptom:** bad bundle live (broken page, crash on load) or build failing on
`main` (prod frozen on last good bundle — check the `Workers Builds:
techfleetnetwork` check + `Main failure alert`).

- **Instant rollback (no git):** Cloudflare dashboard → Workers & Pages →
  `techfleetnetwork` → Deployments → pick the last known-good deployment →
  **Rollback to this deployment**. Takes effect in seconds.
- **Git revert (durable):**
  ```bash
  git revert <bad-sha> --no-edit && git push origin main
  ```
  The push triggers a fresh Cloudflare build. Verify the build check goes green
  and the bundle hash changes (hard-refresh, or check `/version.json`).
- **Stale-tab note:** users on old tabs recover via the deploy-watcher banner /
  chunk-reload guard; no action needed.

## 2. Edge functions (Supabase)

**Symptom:** a function 500s/regresses right after a deploy (post-deploy smoke
failure in `deploy-edge-functions`, or `Main failure alert`).

- **Redeploy last good version of ONE function:**
  ```bash
  git checkout <last-good-sha> -- supabase/functions/<name>
  git commit -m "revert(<name>): roll back to <last-good-sha>" && git push
  ```
  The push deploys only the changed function (change detection).
- **Full redeploy from a known-good ref:** Actions → _Deploy edge functions_ →
  Run workflow (branch: main, `deploy_all=true`) after reverting the bad commit.
- **Fastest manual path (bypasses CI):**
  ```bash
  git checkout <last-good-sha>
  supabase functions deploy <name> --project-ref pzvqxdgoztbfikfuifix
  ```

## 3. Auth email hook

**Symptom:** signup/reset emails stop after an auth-email-hook change.

- **Instant config rollback:** Supabase dashboard → Authentication → Hooks →
  **disable the Send Email hook**. GoTrue reverts to its built-in sender
  immediately (rate-limited but functional). Re-enable after fixing.
- Watchdog: `auth_email_watchdog_15m` alarms if signups flow while
  confirmations flatline (ops_events + Discord).

## 4. Database migrations

**Symptom:** a migration applied to prod causes breakage.

- There is **no automatic down-migration**. Write a compensating forward
  migration (`supabase/migrations/<ts>_revert_<name>.sql`) that undoes the
  change, apply it the same way the bad one was applied.
- For function/grant-level breakage, `CREATE OR REPLACE` the previous
  definition (get it from git history of the migration files).
- Verify with `public.environment_readiness()` (admin) after any repair.

## 5. Dependency regressions (the recurring one)

**Symptom:** build breaks or a feature dies after a dependency PR (tailwind v4,
react-router v8, ag-grid-react v36, react-dom v19 — all real incidents).

- Realign the version in `package.json` to match its paired package / last
  good version, `npm install`, verify `npm run build` locally, ship as a
  `hotfix/*` PR. See #95 and #109 for worked examples.
- Prevention already in place: dependabot ignores ALL semver-major bumps
  (#98); the gate blocks stray non-npm lockfiles.
