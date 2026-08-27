# Rules for edge functions (scoped — loads when working here)

- **Compose `_shared`, don't hand-roll.** Auth via `_shared/request-auth.ts` (`requireAuthenticatedRequest`/`requireAdminRequest`), the service-role client via `_shared/admin-client.ts` (`getAdminClient`), CORS + responses via `_shared/http.ts` (`handleCors`, `jsonResponse`). Never read `SUPABASE_SERVICE_ROLE_KEY` or write `Access-Control-Allow-Origin` inline in a handler.
- **`http.ts` CORS includes the `x-trace-id`/`x-request-id` preflight headers.** Hand-rolled CORS blocks that omit them silently fail preflight — that's why inline CORS is banned.
- **No inline admin checks.** Never query `user_roles` directly for authz — use the shared `has_role`-backed helper, so the admin predicate has one definition.
- **Handler is thin.** Validate → call one unit of business logic → return. Keep the business logic separable/testable, not welded into `Deno.serve`.
- **Errors are reported.** A failure the caller can't see must land in the audit/observability sink; pass `p_user_id: null` for service-role audit writes (a nil-UUID is rejected by `write_audit_log`).
