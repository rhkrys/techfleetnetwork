# Epic 03 — Public catalog: unauthenticated access to classes + projects

**Status:** proposed (plan only — no implementation in this change)
**Owner:** Morgan · engineering by Claude Code
**Goal in one line:** give an anonymous visitor a real, indexable catalog of published
classes and approved projects — served by one versioned, allowlisted public read contract —
without weakening any existing authenticated route, RLS policy, or the frozen auth layer.

> This plan responds to the "Public View Access Review" (Manus AI, 2026-08-28). That review's
> direction is broadly right: build a **new** public read surface rather than unlocking
> teacher/admin pages. But several of its current-state claims did not survive verification
> against the repository, and two of its instructions are unimplementable as written. The
> corrections in §1 change the sequencing, so read §1 before costing the work.

---

## 1. Verification pass — what the review got right, and what it got wrong

Every claim below was checked against the tree at `cc48762`. Corrections first, because two
of them are load-bearing.

### ❌ Corrections

- ❌ **"Keep anon direct table access revoked."** Anon table access to `classes` is **already
  granted and is what production depends on**. `supabase/migrations/20260502160222_*.sql:261`
  creates `Public can view published classes … FOR SELECT USING (status = 'published')` with
  **no `TO` clause**, so it applies to `PUBLIC` — including `anon`. `cohorts` has the matching
  policy at `:293`. `supabase/functions/public-classes/index.ts:47-48` deliberately builds its
  client with `SUPABASE_ANON_KEY` to ride those policies. The only revoke in place is
  column-level (`REVOKE SELECT (meeting_url) ON public.cohorts FROM anon`,
  `20260513041024_*.sql:8`). So this is not a rule to preserve — it is **a narrowing migration
  to plan, schedule, and regression-test**, and it is a breaking change for the consumer in the
  next bullet.
- ❌ **The review missed that a live external consumer already exists.**
  `public-classes/index.ts:9-17` allowlists `framer.com`, `framer.app`, `framercanvas.com`
  alongside the techfleet domains, and the file header says the endpoint feeds "the Tech Fleet
  marketing site (Framer)". **`public-classes` is a published integration, not an internal
  draft.** Any field removal, envelope change, or anon-grant narrowing is a breaking change for
  a site this repo does not control. This is the single largest risk in the epic and the review
  does not mention it once. It also raises a product question that must be answered before
  Phase 2 (§5, D1).
- ❌ **"the sitemap reads `project_openings.slug`" — the table does not exist.**
  `scripts/generate-sitemap.ts:62` fetches `/rest/v1/project_openings?...`, but there is **no
  `CREATE TABLE project_openings`** anywhere in `supabase/migrations/`, and no such table in
  `src/integrations/supabase/types.ts`. The only occurrences in migrations are inside BDD
  scenario *seed text* (`20260531020224_*.sql:395-403`). The fetch therefore always fails, hits
  the `catch` at `:84`, warns, and returns `[]`. **`public/sitemap.xml` has never had a single
  dynamic entry.** The review treats this script as working code to "update"; it is closer to
  dead code to rewrite.
- ❌ **"run the new surface behind a feature flag" contradicts "do not mount
  AuthProvider-dependent behavior as a prerequisite for rendering the public catalog."** The
  repo's flag hook is auth-coupled: `src/hooks/use-feature-flag.ts:11` calls `useAuth()` and
  resolves `isEnabledIn(data, key, user?.id)`, defaulting **off** until the RPC resolves.
  Gating public routes on it would (a) re-introduce the auth dependency the same review forbids
  and (b) make every prerendered page emit an empty shell, since the flag is false at build
  time. The runtime flag mechanism (ADR-0021) is the wrong tool here — see §5, D3.

### ✅ Confirmed

- ✅ **Listing protected, detail public.** `src/App.tsx:425-431` wraps `/project-openings` in
  `<ProtectedRoute>`; `:433-436` renders `/project-openings/:projectId` with no guard. The
  asymmetry is real: an anonymous visitor can open a project but cannot browse to one.
- ✅ **The class detail page is teacher-only.** `/teach/classes/:id` is wrapped in
  `<TeacherRoute>` (`src/App.tsx:655-662`). It is a management view and must not be reused.
- ✅ **No shared contract across the three public endpoints.** `public-classes` returns
  `{generated_at, count, classes}` with edge cache headers and no WAF; `public-project-detail`
  and `public-project-openings` return bare unversioned objects, apply `applyWaf`, and set no
  cache headers at all. Three shapes, three security postures, no version field anywhere.
- ✅ **No prerendering.** No SSR/SSG/prerender hook in `vite.config.ts` or `package.json`.
  Public pages are client-rendered only.
- ✅ **The public-opening smoke test is wrong** — and worse than described (see below).

### 🔴 New findings the review did not surface

- 🔴 **The public-opening e2e test is a false green.** `e2e/projects/public-opening.e2e.ts:14-20`
  navigates to `/projects`, which is **not in the route table**, so it renders the `*` →
  `NotFound` element (`src/App.tsx:722`) *inside* `AppLayout`. The URL assertion
  `/\/projects(\/|\?|$)/` still matches, and the `main` landmark still renders — so the test
  **passes while asserting nothing**. It is currently evidence that a 404 page has a `<main>`.
  This must be fixed as a standalone bug, ahead of the epic, or it will "prove" Phase 3 works
  before Phase 3 exists. Its BDD row (`W1-POD-001`) is still `not_built`.
- 🔴 **The global cache header defeats the whole prerender phase.** `public/_headers` sets
  `Cache-Control: no-cache, no-store, must-revalidate` on `/*`. Prerendered public HTML would
  be emitted and then served uncacheable. Phase 4 must add a public-route carve-out *before*
  the SEO work is measurable.
- 🔴 **`projects` has no slug column.** Generated types show `friendly_name` but no `slug`
  (`src/integrations/supabase/types.ts:5098-5156`); `classes` does have one (`:6094`). The
  review's "establish one canonical public slug" is therefore a migration + backfill +
  uniqueness index + collision policy for projects, not a naming decision. `classes` already has
  a slug generator and uniqueness loop (`20260502160222_*.sql:144-168`) to model it on.
- 🔴 **Slug URLs would 400 even if the table existed.** `public-project-detail/index.ts:29`
  hard-requires `/^[0-9a-f-]{36}$/i`. The sitemap emits `/project-openings/<slug>`. The route
  param is `:projectId`. The recorded BDD intent is `/projects/<slug>`. Four places, three
  different identifier models.
- 🔴 **Both public functions violate the scoped edge-function rules.**
  `supabase/functions/CLAUDE.md` says "Never … write `Access-Control-Allow-Origin` inline in a
  handler" and to use `_shared/http.ts` — because its CORS includes the `x-trace-id` /
  `x-request-id` preflight headers. All three public functions hand-roll CORS blocks.
  `public-classes` additionally has **no `applyWaf`**, despite being the most cacheable and most
  enumerable endpoint.
- 🔴 **The `classes` public policy is column-blind.** `USING (status = 'published')` exposes
  *every* column of a published class row to anon, forever, including columns added later. The
  serializer allowlist the review proposes protects the *edge function's* response; it does
  nothing about direct PostgREST reads. Any field-level policy must be enforced with a column
  grant or a view, not in TypeScript.
- 🔴 **The sitemap advertises login-walled routes.** `scripts/generate-sitemap.ts:34-51` lists
  `/dashboard`, `/my-journey`, `/chat`, `/applications*`, `/profile/edit`,
  `/profile/notifications`, `/profile-setup`. These are `<ProtectedRoute>` paths being submitted
  to search engines. Independent of this epic, that is an SEO defect worth its own small PR.
- 🔴 **`public-project-openings` leaks operational shape.** It returns `client_id`,
  `team_hats`, `current_phase_milestones`, and per-project completed-application counts
  (`index.ts:31,49-71`) with no cache headers. `scrubJson` strips PII patterns, but volunteer
  supply/demand data is a business disclosure, not a PII question.

---

## 2. Gap analysis

| Requirement | Today | Gap |
| --- | --- | --- |
| Public class catalog | no `/classes` route at all | build list + detail routes |
| Public class detail | teacher-only `/teach/classes/:id` | new public page, not a reuse |
| Public project catalog | `/project-openings` is `ProtectedRoute` | unwrap into a new public route |
| Public project detail | public, but UUID-keyed | add slug + compatibility path |
| Versioned contract | none — 3 ad-hoc shapes | `v=1` envelope + shared serializers |
| Field allowlist | edge-level only; RLS is column-blind | allowlist in DB *and* serializer |
| WAF on public endpoints | 2 of 3 | all, plus rate limits |
| Prerender / SEO | none | build-time prerender + `_headers` carve-out |
| Sitemap | static-only; lists protected routes | rebuild off the public feed |
| Proof | one false-green smoke test | real anonymous-context suite |

---

## 3. Recommended URL + API design

**Web routes** (new, additive, distinct from management pages):

- `/classes` — public class catalog
- `/classes/:slug` — public class detail
- `/projects` — public project catalog
- `/projects/:slug` — public project detail
- `/project-openings/*` — kept as 301 compatibility redirects to `/projects/*`

`/teach/**` stays `TeacherRoute`. `/project-openings/:projectId/apply` stays `ProtectedRoute`:
applying is a state-changing, member-scoped write. An anonymous visitor sees requirements and a
CTA that routes into signup with the intended destination preserved.

**API contract.** One `v=1` query parameter across all public endpoints, and one envelope:

```jsonc
{ "version": 1, "generated_at": "…", "data": { … } }
```

Endpoints: `public-classes` (list + detail), `public-projects` (list + detail),
`public-feed` (composes the same list serializers — never a second implementation of the shape).
Additive fields are allowed within `v=1`; removals and meaning changes require `v=2`.

**Because of §1's Framer finding, `public-classes` cannot simply change shape.** It must serve
the legacy body when `v` is absent and the envelope when `v=1` is present, until the Framer site
is confirmed migrated or retired (D1).

---

## 4. Field and publication policy

Default allowlist, pending product sign-off (§5, D2):

- **Class:** `slug`, `title`, `summary`, `description`, `track`, `hero_image_url`, `outcomes`,
  `skills`, `prerequisites`, `published_at`, module **outline only** (titles/order — never lesson
  bodies), and per-cohort `label`, `start_date`, `end_date`, `timezone`, `registration_url`,
  derived `seats_state`.
- **Project:** `slug`, `friendly_name`, `description`, `phase`, `project_status`, public skills,
  approved client `name`/`logo_url`, public join steps.
- **Never public:** `capacity` (raw), `meeting_url`, `coordinator_id`, `client_id`,
  `current_phase_milestones`, application counts, any profile field.

Two rules the review states and this plan keeps:

1. **`capacity` becomes derived.** Expose `seats_state` ∈ `open | full | closed`, not the raw
   number. Note this is a **removal** from the current `public-classes` response, hence D1.
2. **Publication is enforced twice** — in the query and again in the serializer — and an
   unpublished slug returns exactly the 404 an unknown slug returns, so publication state is not
   disclosed by response differences.

Add a third, from §1: **the DB is the enforcement point, not the serializer.** Replace the
column-blind `Public can view published classes` policy with an explicit column grant (or a
`public_classes` view with `security_invoker`) so a future column is private by default.

---

## 5. Decisions required before Phase 2 (blocking)

| # | Decision | Why it blocks |
| --- | --- | --- |
| **D1** | Is this catalog **replacing** the Framer marketing site, or coexisting with it? | Determines whether `public-classes` may break its contract or must dual-serve indefinitely. Changes Phase 2 scope materially. |
| **D2** | Is `registration_url` safe to serve anonymously — does any row carry a signed/tokenized Gumroad URL? | If yes, a separate public URL column is needed. Requires a data audit, not a code read. |
| **D3** | Rollout switch: build-time env flag, not the ADR-0021 runtime flag. | The runtime flag is auth-coupled and build-time false (§1). Recommend `VITE_PUBLIC_CATALOG=1` + preview-domain rollout. |
| **D4** | Project slug source: derive from `friendly_name`, or author explicitly? | Backfill for existing rows; collision policy. Model on `classes_set_slug()`. |
| **D5** | Do we expose projects with **no** public openings in `/projects`? | Changes list semantics and sitemap size. |

---

## 6. Phased delivery

**Phase 0 — pre-work (do first, small, independent).**
Fix the false-green smoke test; drop protected routes from the sitemap; add `applyWaf` +
`_shared/http.ts` CORS to `public-classes`. These are defects today regardless of the epic, and
Phase 0 buys honest signal for everything after it.

**Phase 1 — lock the contract.** ADR **0022** (`docs/adr/0022-public-catalog-contract.md`;
0021 is the highest existing) recording D1–D5, the allowlist, slug policy, and compatibility
behavior. Ship a JSON Schema fixture for `v=1` that the tests assert against.

**Phase 2 — Supabase public read layer.** Shared helpers first (CORS/method/envelope/pagination
via `_shared/http.ts`), then explicit serializers (`public-class.ts`, `public-project.ts`,
`public-module-outline.ts`, `public-join-steps.ts`), then `public-projects` and `public-feed`.
Add the slug migration (D4) and the column-grant narrowing. `applyWaf` on **every** public
endpoint. ETag/Last-Modified over a deterministic serialization so conditional GETs are stable.

**Phase 3 — public React surface.** New components under `src/pages/public` +
`src/features/public-catalog` — no reuse of `ClassDetailPage`. Must render with **no**
`AuthProvider` dependency; Gumroad links `target="_blank" rel="noopener noreferrer"`; explicit
loading/empty/not-found/error/stale states.

**Phase 4 — prerender + SEO.** Build-time prerender of the finite public routes from the `v=1`
feed; canonical URLs, OG/Twitter tags, `Course` JSON-LD on detail, `ItemList` on catalog.
**Carve public routes out of the `no-store` rule in `public/_headers` first** — otherwise none of
this caches. Rewrite `generate-sitemap.ts` against the feed.

**Phase 5 — release + observability.** Preview domain → percentage rollout via D3's build flag.
Dashboards for endpoint status, 404 rate, Gumroad click-through, anon→signup conversion, failed
prerender builds. Never log emails, purchase payloads, applicant data, or full response bodies.

---

## 7. Test plan

- **Anonymous-context e2e** (real assertions, not landmark presence): `/classes`, `/classes/:slug`,
  `/projects`, `/projects/:slug` load with no session and no `/login` redirect; `/apply` **does**
  redirect and preserves the destination.
- **Contract tests** against the `v=1` JSON Schema fixture, including the legacy-body path while
  D1 is unresolved.
- **Negative security tests** — the ones that actually retire the risk: a draft class slug 404s
  identically to a nonexistent slug; `capacity`, `meeting_url`, `client_id`,
  `current_phase_milestones`, and lesson bodies appear in **no** public response; **and a direct
  anon PostgREST read of `classes`/`cohorts` cannot retrieve a non-allowlisted column** (this is
  the test that proves §4's DB-level enforcement, and it fails today).
- **Gates, all of them, in the feature PR:** `npm run test`, `npm run check:architecture`,
  `npm run validate:edge-functions`, `npm run scan:secrets`, lint, typecheck, Playwright.
  Do not grow `arch-gate.waivers.json`. Run `judge-arch` on the diff per CLAUDE.md.

---

## 8. Suggested PR breakdown

| PR | Scope | Risk |
| --- | --- | --- |
| 1 | Phase 0 defects (smoke test, sitemap protected routes, WAF+CORS on `public-classes`) | low |
| 2 | ADR-0022 + `v=1` JSON Schema fixture | none (docs) |
| 3 | `_shared` helpers + serializers, `public-classes` dual-serve | medium |
| 4 | Project slug migration + backfill + uniqueness | medium (data) |
| 5 | `public-projects` + `public-feed` | medium |
| 6 | Column-grant narrowing on `classes`/`cohorts` | **high — breaks Framer if D1 unresolved** |
| 7 | Public routes + components | medium |
| 8 | `_headers` carve-out + prerender + sitemap rewrite | medium |
| 9 | Rollout flag + observability | low |

PR 6 is the one to schedule deliberately: it is the only irreversible-feeling step, and it is
gated on D1.

---

## Definition of done

An unauthenticated visitor can navigate directly to public class and project catalog and detail
URLs; sees only published, approved marketing data; sees outline-level modules and public join
steps; can click a safe Gumroad link without an account; and is routed into signup — destination
preserved — when an action requires membership. The same data is available through a documented
`v=1` feed. Public routes are prerendered, cacheable, and indexed; the sitemap contains no
login-walled URL. Automated tests prove drafts, private fields, PII, lesson content, and
operational project data cannot be reached **either through the public endpoints or through a
direct anonymous PostgREST read** — and no test in the suite passes by rendering a 404.
