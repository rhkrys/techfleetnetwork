<!-- Copy to supabase/functions/AGENTS.md. Loads only when the agent works on edge functions. -->
# Rules for edge functions

- **Compose `_shared`, don't hand-roll.** Auth via `_shared/request-auth.ts`, the service-role client via `_shared/admin-client.ts` (`getAdminClient`), CORS + responses via `_shared/http.ts` (`handleCors`, `jsonResponse`). Never read `SUPABASE_SERVICE_ROLE_KEY` or write `Access-Control-Allow-Origin` inline in a handler.
- **No inline admin checks.** Never query `user_roles` directly for authz — use the shared `has_role`-backed helper, so the admin predicate has one definition.
- **Handler is thin.** Validate → call one unit of business logic → return. Keep the business logic separable and testable, not welded into `Deno.serve`.
- **Errors are reported.** A failure that the caller can't see must land in the audit/observability sink; pass `p_user_id: null` for service-role audit writes.
