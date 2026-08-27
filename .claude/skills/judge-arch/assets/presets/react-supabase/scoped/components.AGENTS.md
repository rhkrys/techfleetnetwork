<!-- Copy to src/components/AGENTS.md (and/or src/pages/AGENTS.md). Loads only when the agent works here. -->
# Rules for components & pages

- **No data access here.** Never import the Supabase client or call `supabase.from/rpc/storage/functions`. Call a hook (`useX`) that goes through a service.
- **No business math.** Money/date/eligibility calculations belong in a service or `lib/`, not fused into JSX.
- **No raw `fetch()` to edge functions.** Use the app's edge/invoke wrapper so auth headers, retries, and error reporting are centralized.
- Render and format. That's it.
