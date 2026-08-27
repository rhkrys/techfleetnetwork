# Rules for components (scoped — loads when working here)

- **No data access here.** Never import `@/integrations/supabase/client` or call `supabase.from/rpc/storage/functions`. Call a hook (`useX`) that goes through a service.
- **Writes to `profiles` go through `ProfileService`** — never a raw `supabase.from('profiles').update(...)`. The service owns sanitization + the mass-assignment allow-list; bypassing it is a security regression.
- **No business math in JSX.** Money/date/eligibility calculations belong in a service or `src/lib/`, not fused into the render.
- **No raw `fetch()` to edge functions.** Use `invokeEdge`/`auditedInvoke` so auth headers, retries, and operator reporting are centralized.
- Render and format. That's it. (`src/components/ui/**` shadcn primitives are exempt.)
