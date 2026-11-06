# ADR 0022 — Public classes catalog: platform `classes` is the catalog, Gumroad is price and checkout, mirrored by one writer

- Status: Proposed (product decisions confirmed by the owner 2026-11-06; architecture awaiting approval on the plan PR)
- Date: 2026-11-06
- Deciders: TechFleet (owner)
- Related: `docs/epics/03-public-classes-catalog.md` (the plan); `supabase/migrations/20260502160222_*.sql` (classes/cohorts + public RLS); `supabase/migrations/20260808160000_class_curriculum_v2_hardening.sql` (`is_class_learner()` entitlement seam, `TODO(gumroad-entitlement)`); `supabase/functions/gumroad-webhook`, `gumroad-backfill` (existing Gumroad integration, `GUMROAD_ACCESS_TOKEN`); `decisions.md` §2 (one fact, one owner); ADR-0021 (feature flags).

## Context

Tech Fleet sells classes on Gumroad (six course products on techfleet.gumroad.com on
2026-11-06). The platform has a full teacher-authored class model (`classes`, `cohorts`,
curriculum, approval workflow) whose RLS already lets anonymous users read published rows,
but every class route sits behind `TeacherRoute`, and three call sites
(`TrainingPage`, `MyRegisteredClassesTab`, `UniversalSearch`) link to `/classes/:slug`, a
route that does not exist. There is no public surface where a prospective learner can read
about a class, and no link from a class or cohort to the Gumroad product that sells it
(`cohorts.registration_url` is a free-form https URL).

Forces:

- One fact, one owner (decisions.md §2). Price, checkout, and purchase records live on Gumroad
  and already flow into `gumroad_sales` through one writer. Class copy, curriculum, and the
  approval workflow live in the platform.
- The Gumroad seller token is a server secret; the browser can never call the Gumroad API.
- Public pages must be fast, indexable, and accessible, which rules out embedding the Gumroad
  storefront.
- The entitlement seam `is_class_learner()` was built to be replaced by a verified-purchase
  check keyed on a Gumroad product id; that key does not exist on cohorts today.

## Decision

1. **The platform `classes` table is the canonical public catalog.** `/classes` and
   `/classes/:slug` are public routes that read published classes and published cohorts via
   the existing hooks and services (`ClassService`, `CohortService`) under the existing RLS.
   No new read policies are needed for classes or cohorts.
2. **Gumroad owns price, checkout, and the overview copy.** The platform shows no price at
   all; the register link always goes to the live Gumroad product. The product description
   (sanitized), thumbnail, published state, and canonical URL come from a new
   `public.gumroad_products` mirror table and the description is rendered as the class
   overview. The platform keeps the structured facts Gumroad does not model: audiences,
   prerequisites, outcomes, skills, cohort dates, hours per week, curriculum.
3. **One writer for the mirror.** A new edge function `gumroad-products-sync` (scheduled via
   pg_cron, same shape as `gumroad-backfill-all`) calls `GET /v2/products` with
   `GUMROAD_ACCESS_TOKEN`, filters by `GUMROAD_SELLER_ID`, and upserts `gumroad_products`
   keyed on the stable Gumroad `product_id`. Nothing else writes that table. Rows carry only
   public product facts (no buyer data).
4. **Cohorts link to products, not URLs.** Teachers pick the product on the cohort form and
   admins may override it at approval. `cohorts.gumroad_product_id` (nullable FK to the
   mirror) becomes the registration key; `registration_url` is derived from the linked
   product when present and kept as a fallback for non-Gumroad registrations. Expand/contract:
   the column is added nullable, the UI starts writing it, and only then does any check
   depend on it.
5. **Entitlement follows the key.** In a later phase, `is_class_learner()` is redefined to
   `EXISTS (gumroad_sales s JOIN cohorts c ON c.gumroad_product_id = s.product_id ...)`
   with the click-through fallback removed, exactly the single-body replacement the seam was
   designed for.
6. **Anonymous interest is counted, not identified.** A rate-limited RPC increments a
   per-cohort daily counter for signed-out "Register on Gumroad" clicks and stores no
   identifier; member clicks keep using `register_for_cohort_click`.
7. **Rollout behind a flag.** Public routes ship unflagged (they fix live 404s), but the
   landing-page section, header link, and sitemap entries are gated by the feature flag
   `public_classes_catalog` (ADR-0021), so the marketing surface can be switched off without a
   deploy.

## Alternatives considered

- **Fetch Gumroad from the browser.** Rejected: the public storefront is an Inertia app with
  no CORS JSON endpoint, and the API needs the seller token.
- **A hand-maintained list of Gumroad products in `src/config/`** (as `membership-tiers.ts`
  does for membership URLs). Rejected: it is a second writer for product facts that drifts
  the moment a product is renamed or re-priced; acceptable only as the phase-1 fallback for
  the single founding-membership link that already exists.
- **Embed the Gumroad storefront (iframe or overlay) at `/classes`.** Rejected: no control
  over accessibility, SEO, theming, or the learner's path into the platform.
- **Make Gumroad the editorial source and drop platform classes.** Rejected: curriculum,
  approval, teacher ownership, cohort registration, and entitlement are already built on
  `classes`/`cohorts`, and Gumroad descriptions are unstructured HTML.

## Consequences

- Positive: the live 404s disappear; prospective learners get an indexable, accessible class
  page; price and checkout stay correct by construction; the entitlement TODO gets its key;
  the mirror pattern matches the one the codebase already trusts for membership.
- Negative: overview copy can only be edited on Gumroad, so a teacher who wants different
  wording on the platform must change the product; one more scheduled edge function and two
  more tables to operate (stale-mirror
  alerting and a runbook are part of the plan); teachers must pick a product when creating a
  cohort; a Gumroad product with no platform class is invisible until a teacher creates one
  (an admin view lists unlinked products to make that gap visible).
- Deferred: whether `basic_training` classes also sell on Gumroad, multi-currency display,
  and whether the platform should ever sell outside Gumroad.
