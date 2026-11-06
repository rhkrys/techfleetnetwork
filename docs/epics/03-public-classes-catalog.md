# Epic 03 — Public Classes Catalog (Gumroad-backed)

**Status:** proposed — plan for approval, no product code in this PR
**Discovery:** 2026-11-06, Claude Code, on a fork of `techfleetworks/techfleetnetwork` at `c32d81f9`
**Decision record:** [ADR-0022](../adr/0022-public-classes-catalog-gumroad-source-of-truth.md)
**Goal in one line:** anyone, signed out, can browse Tech Fleet's classes at
`techfleet.network/classes`, read a complete class page at `/classes/:slug`, and register on
Gumroad — with the platform as the canonical catalog and Gumroad as the canonical price and
checkout.

> Process note. Discovery used the `impeccable` skill (`shape`, after `init`) and the
> enterprise skills (`enterprise-architecture-standards`, `pattern-selector`,
> `architectural-decision-records`, `owasp-secure-coding-bdd`, `bdd-comprehensive-testing`,
> `comprehensive-test-strategy`, `release-deployment-safety`, `sre-operational-readiness`,
> `compliance-data-lifecycle`, `universal-accessibility-wcag`,
> `universal-browser-device-support`, `usability-ux-universal-design`, `skeptical-audit`).
> The impeccable interview round could not run in an unattended session, so the seven open
> decisions were put to the owner afterwards and answered on 2026-11-06; §9 records the
> answers and this plan reflects them.

---

## 1. Why this epic exists (measured, not hypothetical)

Every claim below has a re-runnable source in §10.

- **Live 404s today.** Three call sites link to `/classes/${slug}` — course cards on
  `/courses` (`src/pages/TrainingPage.tsx:348`), the member's "My registered classes" tab
  (`src/components/MyRegisteredClassesTab.tsx:87`), and universal search
  (`src/components/UniversalSearch.tsx:251`) — but `src/App.tsx` declares no `/classes`
  route. Every published class card a member clicks lands on `NotFound`.
- **No public surface, although the database already allows one.** All class routes are
  wrapped in `TeacherRoute` (`src/App.tsx:638-685`). RLS policies "Public can view published
  classes" and "Public can view published cohorts of published classes" (migration
  `20260502160222`) already grant anonymous SELECT. The gap is purely the UI/routing layer.
- **Gumroad is where classes are actually offered.** The storefront
  `techfleet.gumroad.com` lists six `course` products plus the Founding Membership (§2).
  The platform holds **one** published class (`ai-development-residency`) and **zero**
  published cohorts. A prospective learner's discovery path today is Gumroad, not the
  platform.
- **No key between a cohort and the product that sells it.** `cohorts.registration_url` is
  a free-form https URL; the entitlement function `is_class_learner()` carries
  `TODO(gumroad-entitlement): replace with verified paid registration`
  (`supabase/migrations/20260808160000_class_curriculum_v2_hardening.sql:68`). Without a
  product id on the cohort, that TODO cannot be closed.

## 2. What Gumroad sells today (evidence snapshot, 2026-11-06)

Extracted from the storefront's Inertia page data and each product page. Prices differ
between the storefront listing (`price_cents`) and the product page; the sync in §5 must read
the API, never this table.

| Product (Gumroad name)                                      | Permalink | Listing price | Page price | Format      | Platform class? |
| ----------------------------------------------------------- | --------- | ------------- | ---------- | ----------- | --------------- |
| Fall / Winter 2026 AI Development Residency                 | `rotlxh`  | $99.50        | $199.00    | residency   | yes — `ai-development-residency` (published, advanced track) |
| UPGRADE TO PREMIUM AI Development Residency                 | `xnmkcl`  | $150.00       | —          | upgrade SKU | no |
| September 2026 Agile Coaching Residency                     | `ykfkdu`  | $100.00       | $200.00    | residency   | no |
| August 2026 Agile UX Masterclass                            | `ylhxpx`  | $49.50        | $99.00     | masterclass | no |
| September 2026 Collaborative AI Data Analytics Masterclass  | `enftm`   | $49.50        | $99.00     | masterclass | no |
| September 2026 AI-Enabled Systems Design Masterclass        | `vofawk`  | $49.50        | $99.00     | masterclass | no |
| Tech Fleet FOUNDING Membership                              | `ftpql`   | $49.99        | —          | membership  | n/a (already integrated) |

Content the product pages carry and the platform class model already has fields for:
timeframe (weeks, hours per week, total live hours), audiences, experience requirements,
overview, syllabus link, schedule, and in one case "FREE for Founding Members". None of the
products has ratings, sales counts, or cover images exposed; thumbnails exist for five.

## 3. Discovery brief (impeccable `shape`)

**Job and audience.** A prospective learner (career changer, early-career designer, PM, or
developer) arrives from Gumroad, LinkedIn, Discord, or search, deciding whether a class is
worth their money and five to twenty hours a week. Mode: **Persuade** for `/classes` and
`/classes/:slug`. A signed-in member arrives from `/courses` or search to re-read a class
they already registered for; the same pages serve them inside the authenticated layout.

**Outcome and proof.** The visitor can answer, without an account: what will I do, with whom,
when, how long, what do I need first, and how do I register. Proof is real: cohort dates, time commitment,
the live Gumroad product description as the overview, teacher-entered audiences and
prerequisites, and the curriculum outline. Price is deliberately not shown on the platform;
the register link goes to the live Gumroad product (decision §9.2). Success is a click on
"Register on Gumroad", recorded for members by `register_for_cohort_click` and for
anonymous visitors by a new rate-limited, identifier-free counter (decision §9.3).

**Selected direction.** Extend the existing world: `@/design-system` components (MUI-owned
layer; Poppins body, Futura headings, `tf-card`, asymmetric-radius button; 4px grid). No new
tokens, no new fonts. Structural thesis: *the catalog is a schedule, not a shop*. The page
leads with "what is starting next" (upcoming cohorts across classes, soonest first), then the
two tracks as sections, each class a card with title, format badge (residency / masterclass),
next start date, and weekly commitment. The category default this refuses is the grid
of identical thumbnails with "Learn more" buttons; here the card's primary text is a date and
a commitment, because that is what a working adult decides on. The detail page's first
viewport puts the next cohort's dates, the weekly hours, and the register action in a
sticky aside beside the overview, so the decision facts never scroll away from the reading.
The overview itself is the synced Gumroad description (decision §9.1), so a prospective
learner reads the same words on both sites and they never drift.

**Scope and boundaries.** Two public routes, one shared card, one sticky "registration" aside,
a landing-page section and header link behind a flag, sitemap/SEO entries. Untouched: the
teacher and admin class pages, the curriculum tab (stays entitlement-gated), auth, the
Gumroad membership pipeline. Anti-goals: no price shown on the platform at all (decision §9.2), no fake ratings or
learner counts, no "coming soon" cards, no iframe of Gumroad.

**States and ranges.** Classes: 0 (empty state that links to the Gumroad storefront and
explains how classes are announced), 1 (today), 6 (near term), 20+ (pagination or
track-tabs; design for 20 without pagination). Cohorts per class: 0 ("No upcoming cohort —
follow this class" for members, Gumroad link for anonymous), 1, 3+. Summary HTML: 0 to
10,000 chars (today 5,611); description up to 50,000; render sanitized HTML with the existing
`prose` treatment. Hero image: often missing (fall back to the synced Gumroad thumbnail, then a
track-colored surface with the format badge, never a broken image). Overview: the synced
Gumroad description of the soonest upcoming linked cohort's product; when no cohort is
linked, the platform `summary` (today's single published class has one). Price: never
shown. Dates: past cohorts hidden from the public page; a class with
only past cohorts shows "Next cohort not yet scheduled".

**Interaction and layout.** Catalog: page title, one-line lede, "Starting soon" strip
(horizontal list of up to four cohorts, each a link to its class), then "Basic training" and
"Advanced training" sections (a section hides when empty). Cards are single links with one
accessible name; the whole card is the target, with a visible focus ring. Detail: breadcrumb
(Classes › title), title, format and track badges, the registration aside (dates, timezone,
weekly commitment, "Register on Gumroad" external link with opens-in-new-tab indication,
capacity when present), then overview (synced from Gumroad when linked), why take it,
audiences, outcomes, skills,
prerequisites, curriculum outline (public, not the gated module content), cohorts list,
expectations, reading. Mobile: aside becomes a bottom bar with dates + register.
Motion: none beyond focus and hover; respect `prefers-reduced-motion`.

**Constraints.** WCAG 2.2 AA; works from 320px; no new dependency; UI → hooks → services only
(the two existing component-level Supabase reads in `MyRegisteredClassesTab` and
`UniversalSearch` are pre-existing waivers and stay out of scope); SEO via the existing
`SEO` component and `scripts/generate-sitemap.ts`; the Gumroad token never reaches the
browser; CSP already allows `https:` images so Gumroad thumbnails load without a CSP change.

## 4. Architecture

Layering follows `decisions.md`: pages → hooks → services → integrations.

```
/classes            ClassesCatalogPage      usePublishedClasses()            ClassService.listPublished()
                                            useUpcomingCohorts()             CohortService.listUpcomingPublished()
                                            useGumroadProducts()             GumroadProductsService.listPublished()
/classes/:slug      PublicClassPage         useClassBySlug(slug)   (exists)  ClassService.getBySlug()      (exists)
                                            useCohortsByClass(id,{publishedOnly}) (exists)
                                            useGumroadProduct(productId)     GumroadProductsService.getById()
```

**Pattern (pattern-selector).** The Gumroad mirror is an *anti-corruption layer with a
cache-aside read model*: one scheduled writer translates Gumroad's product shape into a small
owned table; readers never see Gumroad's API. It prevents price drift and token leakage. Cost:
one cron job, one table, one stale-data alert. The simpler option skipped is a static config
list (it is a second writer; see ADR-0022 alternatives). The pattern is already proven in this
codebase by `gumroad_sales` → `compute_membership()`.

**Data ownership (one fact, one owner).**

| Fact                                   | Owner / writer                                   | Readers |
| -------------------------------------- | ------------------------------------------------ | ------- |
| Class copy, track, status, slug        | teachers/admins via `ClassService` (unchanged)    | public pages, teacher/admin pages |
| Cohort dates, capacity, schedule       | teachers via `CohortService` (unchanged)          | public pages |
| Which product sells a cohort           | teacher picks in `CohortForm` → `cohorts.gumroad_product_id`; admin may override at approval (§9.7) | public pages, entitlement |
| Product name, description (overview copy), price, currency, URL, thumbnail, published | `gumroad-products-sync` edge fn → `gumroad_products` | public pages (description, thumbnail, URL), cohort form, admin (price) |
| Structured class facts: audiences, prerequisites, outcomes, skills, hours per week | teachers via `ClassService`/`CohortService` (unchanged) | public pages |
| Register clicks (anonymous)            | `record_public_registration_click()` RPC → `cohort_click_counts` (no identifier) | admin |
| Purchase facts                         | `gumroad-webhook` → `gumroad_sales` (unchanged)   | `is_class_learner()` (phase 4) |

**Schema (expand/contract, all additive).**

```sql
CREATE TABLE public.gumroad_products (
  product_id      text PRIMARY KEY,            -- Gumroad stable id
  name            text NOT NULL,
  permalink       text NOT NULL,               -- short code, e.g. rotlxh
  custom_permalink text,
  url             text NOT NULL,               -- canonical product URL
  description_html text NOT NULL DEFAULT '',  -- sanitized on write; the public overview copy
  price_cents     integer NOT NULL,            -- synced for admins and entitlement; never rendered publicly
  currency        text NOT NULL DEFAULT 'usd',
  thumbnail_url   text,
  native_type     text NOT NULL DEFAULT '',    -- course | membership | ...
  published       boolean NOT NULL DEFAULT false,
  raw             jsonb NOT NULL DEFAULT '{}', -- public product fields only, no buyer data
  synced_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gumroad_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view published products" ON public.gumroad_products
  FOR SELECT USING (published = true AND native_type <> 'membership');
CREATE POLICY "Admins can view all products" ON public.gumroad_products
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages products" ON public.gumroad_products
  FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.cohorts
  ADD COLUMN gumroad_product_id text REFERENCES public.gumroad_products(product_id) ON DELETE SET NULL;
CREATE INDEX idx_cohorts_gumroad_product ON public.cohorts(gumroad_product_id);
CREATE INDEX idx_cohorts_upcoming ON public.cohorts(start_date) WHERE status = 'published';
```

`registration_url` stays `NOT NULL` for backward compatibility; the cohort form fills it from
the linked product and lets a teacher override only when no product is linked.

**Anonymous click counter (decision §9.3).** A SECURITY DEFINER RPC
`record_public_registration_click(_cohort_id uuid)` granted to `anon` and `authenticated`
increments a per-cohort daily counter in `cohort_click_counts (cohort_id, day, clicks)`. It
stores no IP, user id, or user agent, and it is rate limited through the existing
`rate_limits` table (one increment per cohort per 10 seconds per caller key derived from the
request, dropped on overflow, never an error to the visitor). Signed-in members keep using
`register_for_cohort_click`, which records the registration row; the public counter is
interest, not registration.

**Edge function `gumroad-products-sync`.** Composes `_shared` (admin client, `withAuditWrapper`
with label equal to the directory name, `jsonResponse`); `verify_jwt = false` with a cron
secret header exactly like `gumroad-backfill-all`; `GET https://api.gumroad.com/v2/products`
paginated; filters `seller_id = GUMROAD_SELLER_ID`; strips anything that is not a public
product field before storing `raw`; sanitizes `description` server-side (same allow-list as
`sanitize_classes_html`) into `description_html`; upserts; marks products missing from the response
`published = false` (never deletes); writes one `ops_events` row with counts. Scheduled hourly
by pg_cron (migration mirrors `20260803160500_gumroad_backfill_all_cron.sql`).

**Routing and layout.** Both routes sit outside `ProtectedRoute` next to `/privacy` and
`/terms`. `Index` already shows `LandingPage` to anonymous users and `AppLayout` renders a
public header with "Connect"; the pages work in both layouts. `RouteTitle` gains
`/classes` → "Classes" and `/classes/:slug` → "Class". The sitemap generator adds `/classes`
statically and each published slug dynamically (it already does this for project openings).
Lighthouse and the a11y audit add `/classes`.

**Entitlement (phase 4).** Single-body replacement of `is_class_learner()`:

```sql
SELECT EXISTS (
  SELECT 1 FROM public.gumroad_sales s
  JOIN public.cohorts co ON co.gumroad_product_id = s.product_id
  JOIN public.profiles p ON p.id = _user_id AND lower(p.email) = lower(s.email)
  WHERE co.class_id = _class_id AND s.status = 'processed'
);
```

Resolution by `resolved_user_id` is preferred when present; the email join is the fallback
the membership pipeline already uses. Behavior change ships only after a comparison report
shows which current learners would lose access (§7).

## 5. Phased delivery (one PR each, each independently revertable)

| Phase | PR scope | Flag | Gate evidence |
| ----- | -------- | ---- | ------------- |
| 1 | `/classes` + `/classes/:slug` pages, shared `ClassCard`, `RegistrationAside`, `ClassService.listPublished`, `CohortService.listUpcomingPublished`, hooks, `RouteTitle`, sitemap, SEO; anonymous click counter RPC + table. Fixes the 404s. Overview falls back to the platform `summary` until phase 3. | none for routes; `public_classes_catalog` gates the landing section + header link | Vitest UI tests, Playwright anon e2e, pgTAP for the click RPC, axe, visual snapshots |
| 2 | `gumroad_products` table + RLS + pgTAP; `gumroad-products-sync` edge fn + cron; `GumroadProductsService`; admin "Gumroad products" tab on `/admin/classes` showing unlinked products | — | pgTAP RLS tests, edge fn unit test with recorded API fixture, `ops_events` row |
| 3 | `cohorts.gumroad_product_id`; product picker in `CohortForm` (teacher) with admin override on `/admin/classes`; public pages show the synced Gumroad description as overview, thumbnail fallback, canonical register URL | — | migration-applied gate, form tests, e2e |
| 4 | `is_class_learner()` redefinition; backfill report; curriculum e2e update | `verified_purchase_entitlement` | comparison report, `curriculum.e2e.ts` green |
| 5 | Landing "Classes" section, header nav link, Lighthouse/a11y route additions; flag flipped on | `public_classes_catalog` | Lighthouse budget, a11y report |

Rollback for every phase is a flag flip or a revert; no phase drops a column or policy.

## 6. BDD scenarios (bdd-comprehensive-testing)

Audiences: anonymous visitor, signed-in member, teacher, admin, search-engine crawler. The
feature file lives beside the feature module (per `bdd-gate.yml`), proposed as
`src/features/public-classes/public-classes.feature`; scenarios are wired to Playwright
(e2e) and Vitest (UI) as executable, blocking tests.

```gherkin
Feature: Public classes catalog

  Scenario: PCC-001 Anonymous visitor browses the catalog
    Given no session
    And at least one class is published
    When I open /classes
    Then I see each published class as a card with title, track, and format
    And I am not redirected to /login

  Scenario: PCC-002 Catalog is empty
    Given no class is published
    When I open /classes
    Then I see an empty state that links to the Gumroad storefront
    And no card is rendered

  Scenario: PCC-003 Anonymous visitor reads a class page
    Given a published class with slug "ai-development-residency"
    When I open /classes/ai-development-residency
    Then I see the title, overview, audiences, prerequisites and skills
    And curriculum module content is not shown

  Scenario: PCC-004 Draft and archived classes are not public
    Given a class in status draft and one in status archived
    When I open their /classes/:slug URLs
    Then I see "Class not found" with a link back to /classes

  Scenario: PCC-005 Upcoming cohort shows registration facts
    Given a published cohort starting in the future with a linked Gumroad product
    When I open the class page
    Then I see start and end dates with timezone and weekly commitment
    And the overview is the synced Gumroad description
    And no price is rendered anywhere on the page
    And "Register on Gumroad" opens the product URL in a new tab with rel noopener

  Scenario: PCC-006 Cohort without a linked product
    Given a published cohort with registration_url but no gumroad_product_id
    When I open the class page
    Then the overview is the platform summary and the register link uses registration_url

  Scenario: PCC-007 Past cohorts are hidden from the public page
    Given a published cohort whose end_date is in the past and no future cohort
    When I open the class page
    Then I see "Next cohort not yet scheduled"

  Scenario: PCC-008 Member click-through is recorded
    Given I am signed in as a member
    When I click "Register on Gumroad"
    Then register_for_cohort_click is called once for that cohort

  Scenario: PCC-009 Member dead links are fixed
    Given I am signed in and a published class exists
    When I click its card on /courses
    Then I land on /classes/:slug and not on the 404 page

  Scenario: PCC-010 Teacher-only pages stay private
    Given no session
    When I open /teach/classes
    Then I am redirected to /login

  Scenario: PCC-011 Product sync is the only writer
    Given the anon role and the authenticated role
    When either attempts INSERT or UPDATE on gumroad_products
    Then the write is rejected by RLS

  Scenario: PCC-012 Product sync marks missing products unpublished
    Given a product in gumroad_products that the API no longer returns
    When gumroad-products-sync runs
    Then the row is kept with published = false and one ops_events row records counts

  Scenario: PCC-013 Keyboard and screen reader
    When I tab through /classes
    Then every card is one focusable link with a visible focus ring and one accessible name
    And headings form a single h1 and ordered h2 sections

  Scenario: PCC-014 Crawler
    When a crawler fetches /sitemap.xml
    Then /classes and every published /classes/:slug are listed

  Scenario: PCC-015 Anonymous click is counted without an identifier
    Given no session
    When I click "Register on Gumroad" on a cohort
    Then cohort_click_counts for that cohort and today increases by one
    And no row stores an IP address, user id, or user agent

  Scenario: PCC-016 Anonymous click counter is rate limited (@security)
    Given no session
    When I call record_public_registration_click twice within 10 seconds for one cohort
    Then the counter increases by one
    And the second call returns success without error
```

## 7. Test strategy (comprehensive-test-strategy)

- **Unit (Vitest):** service mappers (product → overview/thumbnail/URL, cohort → "starting
  soon" ordering, past-cohort filtering), date/timezone formatting, slug lookup fallbacks.
- **UI (Vitest + Testing Library):** pages render with mocked hooks for empty / one / many /
  no-hero / no-linked-product / long-HTML cases, following `src/test/ui/AdminClassesPage.test.tsx`.
- **Over-the-wire e2e (Playwright):** anonymous RLS reads via PostgREST against local
  Supabase, same fixture approach as `e2e/classes/curriculum.e2e.ts`; the 404-fix path from
  `/courses`; the `/teach/*` redirect.
- **Database (pgTAP):** `gumroad_products` RLS matrix (anon, authenticated, admin, service
  role), cohort FK behavior, `is_class_learner()` before/after comparison.
- **Edge function:** `gumroad-products-sync` unit test with a recorded API response fixture;
  fail-closed when the token is missing (mirrors `gumroad-backfill`).
- **Visual regression + axe:** add `/classes` and one detail page to `e2e/visual` and the a11y
  audit; Lighthouse budget unchanged (`lighthouse-budget.json`).
- **Entitlement comparison report (phase 4):** a one-off SQL report listing users who pass the
  current `is_class_learner()` but would fail the verified-purchase body; reviewed by an admin
  before the flag flips.

## 8. Security, accessibility, operations, compliance

**Security (owasp-secure-coding-bdd).** No new write path from the browser. Anonymous reads
are bounded by existing RLS and the explicit column lists in services. All class HTML passes
`sanitizeHtml` (and the DB `sanitize_classes_html` trigger) before `dangerouslySetInnerHTML`.
External links use `rel="noopener noreferrer"`. The Gumroad token stays in edge-function
secrets; the sync endpoint requires the cron secret and `withAuditWrapper`. `raw` stores
public product fields only. Public slug enumeration is acceptable (slugs are meant to be
public). The anonymous click RPC is the one new anon-callable write: it is rate limited,
stores no identifier, and cannot be used to create registrations. Synced Gumroad
`description_html` is sanitized on write and again at render. Scenarios PCC-010/011/016 are
the `@security` BDD checks.

**Accessibility (universal-accessibility-wcag, usability-ux-universal-design).** Single h1
per page, landmark `main`, cards as one link each, dates and hours as text (not only color or
icon), external-link indication in text, 4.5:1 contrast in both themes, 320px layout, visible
focus, reduced motion respected, plain-language commitments ("5 hours a week for 16 weeks").

**Browser/device (universal-browser-device-support).** Existing support matrix; sticky aside
degrades to static on browsers without `position: sticky` support; touch targets 44px.

**Operations (sre-operational-readiness).** SLI: `/classes` renders with data (synthetic check
in the existing verify-deploy flow); sync SLI: `gumroad_products.max(synced_at)` younger than
3 hours. Alert: stale mirror over 24 hours → `ops_events` severity warning (not a page).
Runbook: `docs/runbooks/gumroad-products-sync.md` (token rotation, manual run, how to unlink
a product).

**Compliance (compliance-data-lifecycle).** `gumroad_products` holds no personal data.
The anonymous click counter stores only a per-cohort daily integer. Existing GDPR erasure
for `gumroad_sales` email is unaffected.

## 9. Decisions (answered by the owner, 2026-11-06)

| # | Question | Answer | What it changes in this plan |
| - | -------- | ------ | ---------------------------- |
| 1 | Should the synced Gumroad description be the live overview copy, with teachers adding only structured fields? | **Yes** | `gumroad_products.description_html` is synced and sanitized; the public class page renders it as the overview; teachers keep audiences, prerequisites, outcomes, skills, and cohort facts in the platform. |
| 2 | Show the price on the platform? | **No** | No price on cards or pages; `price_cents` is still synced for admins and entitlement but never rendered publicly. |
| 3 | Count anonymous "Register on Gumroad" clicks? | **Yes** | New rate-limited, identifier-free RPC and `cohort_click_counts` table in phase 1. |
| 4 | Are basic-training classes sold on Gumroad? | **Yes** | Both tracks behave identically: cohort → Gumroad product → register link. |
| 5 | Member-aware "free for Founding Members" message? | **No** | The plain note stays in the class copy; no tier lookup on public pages. |
| 6 | "Classes" in the public header as well as the landing section? | **Yes** | Both, behind `public_classes_catalog`. |
| 7 | Teachers pick the Gumroad product on the cohort form, admins can override? | **Yes** | Picker in `CohortForm`; override on `/admin/classes` at approval. |

Remaining assumption to verify in phase 1: that every cohort's `registration_url` will point
at a Gumroad product (no published cohort exists yet to confirm).

## 10. Evidence (re-runnable)

```bash
# Dead links: three call sites, zero routes
grep -rn "/classes/" src | grep -v "teach/classes\|admin/classes"
grep -n '"/classes' src/App.tsx            # (no output)

# Public RLS already exists
grep -n -A2 'Public can view published' supabase/migrations/20260502160222_*.sql

# Entitlement seam TODO
grep -n "TODO(gumroad-entitlement)" supabase/migrations/20260808160000_class_curriculum_v2_hardening.sql

# Production state via the public anon key (read-only, RLS-bounded)
K=sb_publishable_yKbfQNAnhEEW-9TPII5_Og_8G7gOzm2; U=https://pzvqxdgoztbfikfuifix.supabase.co/rest/v1
curl -s "$U/classes?select=title,slug,track,published_at&status=eq.published" -H "apikey: $K"
curl -s "$U/cohorts?select=label,start_date,registration_url&status=eq.published" -H "apikey: $K"   # []

# Gumroad storefront products (Inertia data-page JSON; products sit under sections[].search_results)
curl -sL https://techfleet.gumroad.com/ -o /tmp/tf-gumroad.html
python3 - <<'PY'
import re, html, json
s = open('/tmp/tf-gumroad.html').read()
d = json.loads(html.unescape(re.search(r'data-page="([^"]+)"', s).group(1)))
def walk(o):
    if isinstance(o, dict):
        if 'permalink' in o and 'name' in o and 'price_cents' in o:
            print(o['name'], '|', o['permalink'], '|', o['price_cents'], '|', o.get('native_type'))
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d['props'])
PY
```

Evidence states (skeptical-audit): the 404 and routing facts are **proven** by grep against
commit `c32d81f9`; production counts are **observed** on 2026-11-06 via the anon REST API;
Gumroad product facts are **observed** from the public storefront on the same day; the
assumption that `registration_url` points to Gumroad is **inferred** (no published cohort
exists to check); the seven product decisions in §9 are **reported** by the owner.
