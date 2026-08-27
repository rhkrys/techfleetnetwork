# CLAUDE.md — TechFleet Network

Project memory for Claude Code. These rules apply to every change. The detailed rule sets
live in `.claude/skills/*.skill.md`; read the relevant one before working in that area.

## What this is
A Lovable-built (now self-managed) web app for Tech Fleet trainees and admins.
Stack: Vite + TypeScript + React + shadcn/ui + Tailwind. Backend: Supabase (Postgres +
PostgREST + GoTrue auth + RLS + edge functions). ~767 real users — treat as production.

## Prime directives (non-negotiable)
1. Never claim a change you didn't make. If you say you edited a file, a real diff exists.
2. Fix root causes, not symptoms. State the layer first: UI / state / data / auth / API /
   database / infra/config. If the cause is in config or the DB, do NOT patch it in React.
3. Prove every fix: a reproduction that failed before and passes after (automated test
   preferred). Show the diff and the test output.
4. Smallest change that fully solves it. No drive-by rewrites, renames, reformatting, or new
   dependencies without justification.
5. Never weaken auth, RLS, validation, or types to make something pass.
6. Label guesses as hypotheses. Ask for missing context instead of inventing it.

## Fix config problems in config (this app's #1 recurring mistake)
Apex/www, OAuth origins, redirects, caching, deploys, domains are INFRASTRUCTURE. Solve them
in Nginx/DNS/CDN/CI, not by adding client-side guards. The boot sequence in `main.tsx` is a
pile of such band-aids; the goal is to REMOVE them as the real fixes land, not add more.
When a root cause is fixed at the proper layer, delete the band-aid it replaces in the same PR.

## Auth is frozen (see 06-auth-flow-lockdown.skill.md)
Highest-priority area. Do not edit `src/integrations/supabase/client.ts`, the `main.tsx` boot
block, `src/lib/auth/**`, `src/features/auth/**`, or sign-in/up/reset/MFA UI without the full
auth regression suite passing. Exactly ONE Supabase client instance — never a second.
Once the server does apex→www 301 (Nginx/CDN), DELETE `enforceCanonicalHost()` and the
OAuth-restart machinery.

## Definition of Done (every task)
- [ ] Root cause + responsible layer named.
- [ ] Repro failed before, passes after; test added.
- [ ] `npm run test`, typecheck, lint all green; no new warnings.
- [ ] Only necessary files changed; diff shown.
- [ ] Security/RLS/validation not weakened.
- [ ] Summary: cause → change → proof. If a band-aid was made obsolete, it was deleted.

## Commands
- Install: `npm ci`
- Dev: `npm run dev`
- Test: `npm run test` (Vitest) and `npx playwright test` (e2e). CI is the source of truth —
  do not trust an in-tool runner.
- Build: `npm run build` → static `dist/` (this app has NO prod Node server; Nginx serves it).
- Deploy: push to `main` → **Cloudflare Pages** git integration deploys automatically (no GitHub Actions deploy step for the frontend). Edge functions deploy via `.github/workflows/deploy-edge-functions.yml` on changes to `supabase/functions/`.

## Skills index (read before working in-area)
- `01-architecture.skill.md` — layering, one client, React Query data flow.
- `02-secure-coding-owasp.skill.md` — OWASP for React + Supabase + edge functions.
- `03-database-rls.skill.md` — migrations, RLS, indexing, RPC security, PGRST002.
- `04-performance-scale.skill.md` — caching, dedupe, pagination, cost at 10k users.
- `05-devops-cicd.skill.md` — CI gates, migrations in CI, environments, observability.
- `06-auth-flow-lockdown.skill.md` — the frozen auth layer; overrides others on conflict.

## Architecture gate (blocking — every change)
Every change that adds, moves, deletes, or restructures code or schema passes the architecture gate
before it is "done." Both halves must pass:
1. **Mechanical:** `npm run check:architecture` exits 0 (locally and in CI). It blocks NEW
   violations; pre-existing ones are grandfathered in `arch-gate.waivers.json` — that file is the
   architectural backlog, so shrink it, don't grow it.
2. **Review:** run the `judge-arch` skill on the change (the four questions — boundary placement,
   data ownership, dependency direction, error handling). PASS, or every finding explicitly waived.

The only bypass is an explicit, dated waiver — never "it's trivial." Standing rules with ✅/❌
examples live in `decisions.md`; scoped rules live in `src/components/`, `src/services/`, and
`supabase/functions/`. Encode a newly-caught pattern with the `arch-encode` skill. The `judge-arch`
and `arch-encode` skills are in `.claude/skills/`, sourced from
[techfleetworks/enterprise-software-AI-skills](https://github.com/techfleetworks/enterprise-software-AI-skills).
