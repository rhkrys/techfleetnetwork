# Runbook — Hand-Off Production launch (prod)

Steps to take the Hand-Off Production feature live on the prod Supabase project
(`pzvqxdgoztbfikfuifix`) and verify it end-to-end. Do them in order.

Feature = SPF data layer (dormant, `active_source='reference'`) + Hand-Off Production
(collect → produce → celebrate → review → re-create), for active teammates AND admins.

---

## A. Database (Supabase SQL editor)

1. **[DONE] Full migration set (15 migrations)** — the `handoff-apply-FULL.sql` script. Result: success.
2. **Admin read policies (migration 16, `20260812230000`)** — paste and run:
   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_output_files' AND policyname='handoff_out admin read') THEN
       CREATE POLICY "handoff_out admin read" ON public.handoff_output_files
         FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='handoff_run_budget' AND policyname='handoff_budget admin read') THEN
       CREATE POLICY "handoff_budget admin read" ON public.handoff_run_budget
         FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
     END IF;
   END $$;
   ```
3. **(Optional) reconcile migration tracking** so a future `supabase db push` doesn't re-apply:
   ```
   supabase migration repair --status applied 20260810160500 20260810161000 20260810170000 20260810171000 20260810180000 20260810190000 20260810191000 20260811120000 20260811130000 20260812170000 20260812180000 20260812190000 20260812200000 20260812210000 20260812220000 20260812230000
   ```

## B. Ship the code

4. **Merge the branch to `main`.** Confirm CI is green on `feat/spf-source-of-truth`, then merge the PR.
   Merging triggers **both** deploys automatically:
   - Cloudflare Pages → the frontend (the panel, `/admin/handoff`, the sidebar link).
   - `.github/workflows/deploy-edge-functions.yml` → the edge functions.
     Safe to merge: the SPF layer stays on `reference`; the panel only renders for active teammates + admins.

   _Manual alternative (without merging yet):_

   ```
   supabase functions deploy handoff-produce handoff-worker handoff-submit handoff-download spf-sync --project-ref pzvqxdgoztbfikfuifix
   ```

5. **Set the LLM key** (OpenRouter — powers the Opus writer + DeepSeek mechanical):
   ```
   supabase secrets set LLM_API_KEY=<openrouter_key> --project-ref pzvqxdgoztbfikfuifix
   ```
   or Dashboard → Edge Functions → Secrets. (Optional: `FIGMA_TOKEN` for reading Figma/FigJam links.)

## C. Load the 26 components

6. **Run `spf-sync` once** — ingests the public SPF API into `spf_entity`, including the 26
   `handoff_component` rows. (It's `verify_jwt=true`, so use the service-role bearer.)
   ```
   curl -X POST https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/spf-sync \
     -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
     -H "content-type: application/json" -d '{}'
   ```

## D. Verify (SQL editor)

7. **Run the preflight** (green/red readout). Rows 01, 02 should now pass after step 6:

   ```sql
   -- (the preflight query — checks handoff_component=26, spf_entity populated, worker cron,
   -- prune cron, vault key, tables, enqueue RPC, source=reference; LLM key + edge deploy are manual)
   ```

   (See the preflight query shared in chat, or `docs/runbooks/handoff-preflight.sql`.)

8. **Confirm the worker cron:**
   ```sql
   select jobname, schedule from cron.job where jobname = 'handoff-worker-1m';
   ```
   One row = good. The worker drains queued runs every minute.

## E. Test end-to-end

9. **As an active teammate:** My Projects → open your project → **Hand-Off Production**.
   - Add at least one file/link/text to each of the 26 components (unlimited mixed inputs per component).
   - **Produce hand-offs** → the 5-stage stepper runs (~20 min, safe to leave) → in-app "ready" notification → 🎉 celebratory state → 4 version cards (View / Download).
   - Rate a version 👍/👎; **Re-create** a subset (uses the team's one retry, writer-only).
10. **As an admin:** sidebar → **Admin → Hand-Off Production** (`/admin/handoff`) → pick any project +
    phase → same flow. Admins share the same 1+1 team budget.

## Rollback / kill switch

- Halt production without a deploy: set the edge secret `HANDOFF_PRODUCE_DISABLED=true`
  (front door 503s new runs; the worker holds queued ones). Unset to resume.
- The SPF source stays `reference`; nothing about Fleety/Journeys changed.
