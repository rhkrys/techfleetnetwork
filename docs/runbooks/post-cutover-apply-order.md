# Post-cutover apply order & environment readiness

Runbook for reconciling the live DB with the repo after the 2026-07 Supabase
cutover, and for standing up / verifying any environment. Born from the
2026-07-07/08 firefight where imperative, un-migrated, silently-failing infra
had to be rebuilt by hand.

## 0. One-command verification (do this first and last)

```sql
SELECT * FROM public.environment_readiness();   -- DB-side (extensions, queues, vault, cron)
```

```bash
# edge-secret presence (admin JWT or service-role bearer)
curl -s -X POST https://<project>.supabase.co/functions/v1/environment-readiness \
  -H "Authorization: Bearer <service_role JWT>"
```

Everything should read `ok` / `present`. Any red row is a missing piece below.

## 1. Migrations (idempotent — safe to re-run)

Most 2026-07-08 fixes were applied live via the SQL Editor, so the migration
_ledger_ may be behind. All are idempotent (`CREATE OR REPLACE`, `IF NOT
EXISTS`, guarded `DO` blocks), so `supabase db push` re-runs them harmlessly and
syncs the ledger. Order (timestamp):

| Migration                                                  | Purpose                                            |
| ---------------------------------------------------------- | -------------------------------------------------- |
| `20260707170000_audit_log_count_fast_exact_when_small`     | Activity Log real count                            |
| `20260707180000_in_app_application_submitted_notification` | in-app submit notification                         |
| `20260707190000_repoint_cron_jobs_to_live_project`         | repoint dead-host cron rows (no-op if none)        |
| `20260707200000_recreate_cron_jobs_on_live_project`        | **canonical cron registry**                        |
| `20260707210000_email_v2_resend_cutover`                   | v2 dispatcher cron + `pipeline_v2_lanes_bitmask=7` |
| `20260708030000_environment_readiness_check`               | `environment_readiness()`                          |
| `20260708040000_base_infra_extensions_and_queues`          | extensions + pgmq queues (IaC)                     |
| `20260708050000_grant_has_role_to_service_role`            | admin edge-fn 403 fix                              |

## 2. Extensions (declared in `20260708040000`, or dashboard)

`pg_cron`, `pg_net`, `pgmq`, `supabase_vault`. Enable via
`CREATE EXTENSION IF NOT EXISTS …` or Database → Extensions.

## 3. Vault secrets (values are NOT in code — set per environment)

| Name                           | Value                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `project_url`                  | `https://<project>.supabase.co` (live host)                                                                      |
| `email_queue_service_role_key` | the **`service_role` JWT** (`eyJ…`, role=service_role) — NOT anon, NOT `sb_secret_…`, NOT the JWT signing secret |

## 4. Edge-function secrets (Project Settings → Edge Functions → Secrets)

Required: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `AUTH_EMAIL_HOOK_SECRET`,
`TURNSTILE_SECRET_KEY`, `FREESCOUT_API_KEY`, `DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (the last two
gate self-service Discord account linking — see
`docs/runbooks/discord-oauth-linking.md`; when unset, `discord-oauth-start`/
`discord-oauth-callback` fail closed with `code: oauth_not_configured`).
Optional/legacy: `AIRTABLE_API_KEY`, `FREESCOUT_WEBHOOK_SECRET`.
`LOVABLE_API_KEY` should be UNSET once fully off Lovable. Verify with the
`environment-readiness` edge function.

## 5. Cron jobs

All defined in `20260707200000` + the v2 dispatcher in `20260707210000`. After a
confirmed Resend soak, retire the obsolete legacy worker:

```sql
SELECT cron.unschedule('process-email-queue');
```

## 6. Frontend deploy (visibility)

`.github/workflows/deploy-frontend.yml` builds + deploys via wrangler on push to
`main`, so failures are red checks (not silent). Needs repo secrets:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`. Once a green run is
confirmed, disable the Cloudflare git-integration auto-build so there is one
visible deploy path.

## 7. Frontend build invariants (why deploys silently died)

Single lockfile only (`package-lock.json`; **no `bun.lock`** — bun can't parse
nested `overrides`). Keep `tailwindcss` on **v3** until a deliberate v4 migration
(the config is v3 / PostCSS-plugin style).
