---
name: Scoped Error Boundaries
description: ScopedErrorBoundary wraps Get Help route and ThemedAgGrid; third-party scripts loaded with crossorigin=anonymous
type: feature
---
- `src/components/ScopedErrorBoundary.tsx` — labeled boundary, console.error first with real Error, then reportError with `source=boundary.<label>:<route>`, `event_type=ui_render_error` (severity=error) or `ui_chunk_load_failed` (severity=warn). Per-label sessionStorage flag for chunk self-heal so one route's stale chunk doesn't block another's.
- Wraps `<GetHelpPage>` at the route in `src/App.tsx` (`label="Get Help"`).
- Wraps the lazy AG Grid render in `src/components/AgGrid.tsx` (`label="Data grid"`) — every consumer inherits the boundary.
- `crossorigin="anonymous"` on `/src/main.tsx` entry tag + dynamically injected GTM, Clarity, CookieYes scripts (`loadAnalytics.ts`, `CookieConsentBanner.tsx`) so real stack frames reach `window.onerror` instead of opaque "Script error.".
- Smoke: `src/test/smoke/scoped-error-boundary.smoke.test.tsx`. BDD: `UI-BOUNDARY-001` (Get Help), `UI-BOUNDARY-002` (AG Grid).
- Root `<ErrorBoundary>` in `src/App.tsx` remains the last-resort catch — do not remove.
