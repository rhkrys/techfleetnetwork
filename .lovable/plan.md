
# Tablet Responsiveness Refit

## Root cause (why tablets look broken today)

1. **`useIsMobile` cliff.** `MOBILE_BREAKPOINT = 768` flips every consumer (`AppLayout`, `ui/sidebar`, `responsive-tabs`, `UniversalSearch`, `GenericCoursePage`) straight into desktop mode at 768px. iPad portrait (810/820/834px) and most Android tablets land in the desktop branch but lack the horizontal room desktop layouts assume.
2. **Sidebar opens at `md:` (768+).** `ui/sidebar.tsx` shows the persistent rail from 768. With a 256px sidebar, a portrait tablet has ~560px left for content — most pages overflow.
3. **Page grids jump too early.** Most pages use a single `md:grid-cols-2`/`md:flex-row` flip and assume desktop chrome.
4. **AG Grid / data tables** overflow horizontally with no `overflow-x-auto` wrapper.
5. **Toolbars/headers/tabs/dialogs** are designed for ≥1024 and clip or wrap awkwardly between 768–1023.

## Strategy

Introduce a real **tablet tier** (768–1023) instead of treating it as small-desktop. Promote `lg:` (1024) as the "true desktop" breakpoint and reserve `md:` for tablet adaptations. Codify with a new `useBreakpoint()` hook and an audit script, then refit every screen.

## Phase 1 — Foundations (ship first)

1. **New `useBreakpoint()` hook** (`src/hooks/use-breakpoint.ts`) returning `'mobile' | 'tablet' | 'desktop'` keyed at 768/1024. Keep `useIsMobile` as a thin shim (now `<768`) for back-compat.
2. **Sidebar tier change** (`src/components/ui/sidebar.tsx`): switch persistent sidebar from `md:` → `lg:`. On tablet, sidebar becomes the same off-canvas Sheet used on mobile (the Sheet code already exists). Add a header hamburger trigger visible on `<lg`. Net effect: tablets get full content width; nothing changes on desktop.
3. **AppLayout** (`src/components/AppLayout.tsx`): replace `isMobile` branching with `breakpoint !== 'desktop'` for chrome decisions (header layout, footer condensing, sidebar trigger). Mobile-specific bits stay mobile-only.
4. **Container tokens** in `src/index.css`:
   - Add `.container-page` utility: `mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8`.
   - Add `.grid-responsive-2/3/4` utilities that go `1 → md:2 → lg:3/4` so pages don't reinvent the cadence.
5. **Global overflow guard**: add `min-w-0` to `<main>` and to AG Grid wrappers; add a `.table-scroll` utility (`w-full overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0`) and wrap every AG Grid / shadcn `<Table>`.
6. **Tailwind config**: add explicit `screens` block to lock semantics (`sm: 640, md: 768, lg: 1024, xl: 1280, 2xl: 1400`) and add a `tablet` alias (`min: 768px, max: 1023.98px`) for the rare tablet-only rule.

## Phase 2 — Page-level refit (mass pass)

Apply a consistent set of edits to every page under `src/pages/**` and feature components:

- **Headers/toolbars**: stack vertically on `<lg`, action buttons become full-width on `<sm`, icon-only on tablet where labels would clip. Use `flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between`.
- **Card/list grids**: replace ad-hoc `md:grid-cols-2` with `grid-responsive-2/3/4` so cadence is mobile → tablet (2) → desktop (3/4).
- **Forms**: two-column form rows become single-column under `lg:`. Inputs span full width on `<md`.
- **Tabs**: continue using `<ResponsiveTabs>` but raise its mobile-dropdown threshold to `<lg` for tab strips with >4 items.
- **Dialogs/sheets**: cap at `max-w-[calc(100vw-2rem)] sm:max-w-lg lg:max-w-2xl`; switch wide admin dialogs to full-screen Sheet on tablet.
- **AG Grid pages** (`ApplicationsPage`, `AdminRosterPage`, `SystemHealthPage` tabs, `RecruitingCenter`, etc.): wrap in `.table-scroll`, force `domLayout="autoHeight"` off where it pins width, and hide low-priority columns at `<lg` via the existing AG Grid column `hide` API.
- **Charts/widgets** (Dashboard, NetworkActivity, MemberWorldMap): set explicit `min-h` and `w-full`, drop fixed pixel widths.
- **Sticky 3-step forms** (Project application, signup wizards): sticky panel collapses to a top accordion on `<lg`.
- **Course player popup** (`GenericCoursePage`): already breakpoint-aware — adjust threshold to `lg`.

Target pages (full list, all touched):
LandingPage, DashboardPage, TrainingPage, ResourcesPage, EventsPage, MyJourneyPage, QuestDetailPage, ChatPage, ApplicationsPage, MyProjectApplicationsPage, ProjectOpeningsPage, ProjectApplicationPage, ApplicationStatusPage, AdminRosterPage, RosterApplicantDetailPage, RosterProjectDetailPage, RecruitingCenter widgets, SystemHealthPage (all tabs), UserAdminPage, ClientsPage, BannerManagementPage, BrandTokensPage, CurriculumAdminPage, AdminClassesPage, ClassDetailPage, ClassFormPage, CohortFormPage, MyClassesPage, ProfileSetupPage, EditProfilePage, RegisterPage, LoginPage, ForgotPasswordPage, ResetPasswordPage, ConnectDiscordPage, FirstStepsPage, SecondStepsPage, ThirdStepsPage, NotificationsPage, UpdatesPage, FeedbackPage, PrivacyPage, TermsPage, TermsOfUsePage, CookiesPage, AccessibilityPage, DsarSubmitPage, UnsubscribePage, NotFound, AccessDeniedPage, ObserverCoursePage, DiscordCoursePage, VolunteerTeamsPage, ProjectTrainingPage, ProjectAnalysisDetailPage, ApplicationSubmissionDetailPage, AdminEmailDeliverabilityTestPage, AdminIngestPage, ConfirmAdminPage, ConfirmTeacherPage, ActivityLogPage, Index.

## Phase 3 — Guardrails

1. **ESLint rule** `responsive/no-bare-md-flip`: warns on `md:grid-cols-*` or `md:flex-row` without a `lg:` companion, to prevent regressions.
2. **Playwright responsive sweep** (`e2e/responsive-stability.e2e.ts` extension): visit every top-level route at 768×1024, 820×1180, 1024×768 and assert no horizontal scrollbar on `<body>` and no element with `scrollWidth > clientWidth` above 8px tolerance.
3. **Smoke test** `src/test/smoke/responsive-tiers.smoke.test.ts` enforcing the breakpoint contract (sidebar gated at `lg:`, container utility present, AG Grid wrappers carry `.table-scroll`).
4. **BDD scenarios** `RESPONSIVE-TIER-001..010` in `bdd_scenarios` covering: sidebar collapses to sheet on tablet [UI], data tables horizontally scroll instead of clipping [UI], forms stack on tablet [UI], no element overflows viewport at 768/820/1024 [UI], `useBreakpoint` returns correct tier [Code], chrome decisions follow tier not `isMobile` [Code].

## Technical notes

- **No visual regression on desktop**: every change is additive at the tablet tier or moves an existing `md:` rule to `lg:`. Desktop (≥1024) keeps its current layout pixel-for-pixel.
- **No new clicks/prompts** — sidebar trigger on tablet uses the existing mobile Sheet pattern users already see on phones.
- **Brand & a11y**: all new utilities keep tokens (`bg-card`, `border-border`), 4px spacing grid, and pass the existing `css-portability` lint (uses `100dvh`, no `100vh`).
- **Files created**: `src/hooks/use-breakpoint.ts`, `scripts/lint/eslint-plugin-responsive.mjs`, `src/test/smoke/responsive-tiers.smoke.test.ts`, one migration adding the BDD scenario rows.
- **Files edited** (high-impact): `src/components/ui/sidebar.tsx`, `src/components/AppLayout.tsx`, `src/components/AppSidebar.tsx`, `src/index.css`, `tailwind.config.ts`, every file in `src/pages/**`, AG Grid wrappers under `src/components/**`, `src/components/ui/responsive-tabs.tsx`, `src/hooks/use-mobile.tsx` (back-compat shim).

## Delivery

All three phases ship in one go per the standing "ship everything" preference. Verification: build, smoke tests, Playwright responsive sweep at 768/820/1024, manual spot-check on `/dashboard`, `/applications`, `/system-health`, `/training`, `/admin/roster`.
