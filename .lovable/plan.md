## Root cause

`src/lib/support/freescoutInvoke.ts` sends a custom `x-trace-id` header on every `freescout-proxy` POST. The shared CORS preflight response (from `_shared/http.ts` → `npm:@supabase/supabase-js/cors`) only allows `authorization, x-client-info, apikey, content-type`. Browsers reject the preflight, the POST never fires, and `supabase.functions.invoke` returns `invoke_error`.

Evidence:
- Edge logs for `freescout-proxy` show only `OPTIONS | 200` — zero POST entries in the last 24h.
- Live `curl -X OPTIONS` confirms `access-control-allow-headers: authorization, x-client-info, apikey, content-type` (no `x-trace-id`).
- `agent_fix_queue` has 13× listMine, 2× listAll, 3× create — all same wrapper, all transport-blocked.
- Severity is logged as `error` despite wrapper passing `warn` (separate triage classification issue, not load-bearing here).

## Fix (single small change, no UX impact)

Override `Access-Control-Allow-Headers` once in `supabase/functions/_shared/http.ts` so every function using `handleCors` / `jsonHeaders` accepts trace headers:

- Define `EXTRA_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type, x-trace-id, x-request-id"`.
- Build `mergedCorsHeaders` by spreading the SDK `corsHeaders` and overriding `Access-Control-Allow-Headers`.
- Use `mergedCorsHeaders` in both `handleCors()` and `jsonHeaders`.

That's it. No frontend changes, no schema, no other functions to edit — this fixes freescout-proxy and pre-empts the same trap in any other function that uses these helpers.

## Verification

1. Redeploy `freescout-proxy` (plus any other functions that hot-import `_shared/http.ts`; Lovable redeploys on shared edits).
2. `curl -X OPTIONS … -H "Access-Control-Request-Headers: x-trace-id"` → expect `x-trace-id` in the allow-list.
3. Reload Get Help in the browser → POST appears in edge logs, no new `freescout-proxy * invoke_error` rows in `agent_fix_queue`.
4. Mark the three existing `agent_fix_queue` rows as resolved.

## BDD

Add `HELP-DESK-024` to `bdd_scenarios`: preflight for `x-trace-id` returns 200 with header in allow-list [UI: Get Help loads tickets without invoke_error toast] [DB: no new agent_fix_queue freescout fingerprints] [Code: OPTIONS response contains `x-trace-id` in `Access-Control-Allow-Headers`].

## Out of scope

- Triage severity mapping (`warn` → `error`) — separate from this incident; track separately if you want.
- Removing `x-trace-id` from the wrapper — keep it; the trace header is useful for correlation.
