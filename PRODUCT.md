# Product

<!-- impeccable:product-schema 1 -->

> Captured 2026-11-06 by Claude Code during discovery for the public classes catalog.
> The impeccable interview round could not run in this unattended session, so every fact
> below is sourced from the repository (README, migrations, code) or the public Gumroad
> storefront. Facts marked **[inferred]** were not confirmed in an interview; the seven
> product decisions in `docs/epics/03-public-classes-catalog.md` §9 were confirmed by the
> owner on 2026-11-06. The rest is quoted from committed project material.

## Platform

web

## Users

- **Primary: Tech Fleet members** (trainees, teammates, apprentices) using the platform to run
  programs, projects, classes, and community. ~767 real accounts (CLAUDE.md).
- **Teachers / coaches**: author classes, cohorts, and curriculum behind `/teach/classes`.
- **Administrators**: review and publish classes, manage rosters, memberships, and system health.
- **Prospective learners (signed out)** [inferred]: people who find a Tech Fleet class on
  techfleet.gumroad.com, LinkedIn, or search, and want to understand it before paying. Today
  they never reach the platform; this audience is the reason the public classes catalog exists.

## Product Purpose

Tech Fleet Network is the member platform for Tech Fleet, a nonprofit workforce development
organization. "The platform where people learn to lead through service by doing real work, on
real teams, for real clients." Success for the platform is members progressing through
training, classes, and apprenticeship projects into service leadership (README Part 1).

## Positioning

Learning happens on real cross-functional teams doing real client work, under the seven Team
Practices and the Agile Manifesto, not in a classroom. Classes (masterclasses and residencies)
are the paid, cohort-based on-ramp into that team experience. A generic course marketplace
cannot truthfully claim the team-based apprenticeship that follows a class.

## Operating Context

- Classes are sold as Gumroad products on **techfleet.gumroad.com** (seller "Tech Fleet
  Professional Association Inc."). Membership (Founding Membership) is also a Gumroad product
  and is already integrated end to end (webhook, ledger, `compute_membership()`).
- In the platform, a class is a `classes` row (track: basic_training or advanced_training;
  status draft → pending_review → published → archived) with `cohorts` (dates, timezone,
  capacity, `registration_url`, meeting URL, schedule). Teachers author; admins approve.
- Cohort registration is a click-through: the platform records the click
  (`register_for_cohort_click`) and sends the learner to `registration_url`, which in practice
  is the Gumroad product page [inferred from the storefront; no published cohort exists yet
  to confirm].
- Curriculum entitlement is `is_class_learner()`, currently "any cohort registration"; the
  migration comment marks `TODO(gumroad-entitlement)` to replace it with verified purchase.

## Capabilities and Constraints

- Stack: Vite + TypeScript + React + Tailwind + an owned design-system layer on MUI Core;
  Supabase (Postgres, PostgREST, GoTrue, RLS, edge functions); static `dist/` on Cloudflare
  Pages; edge functions deployed by GitHub Actions.
- Architecture rules (decisions.md): UI → hooks → services → lib; one fact one owner; domain
  code web-free; every failure reports; the Gumroad ledger is the reference "one writer" model.
- Auth layer is frozen (`06-auth-flow-lockdown`). Public pages must not touch it.
- RLS already allows anonymous SELECT on published classes and published cohorts of published
  classes; no public route uses it yet.
- Terminology: "Tech Fleet" is always two words. "Class" is the product; "cohort" is a dated
  run of a class; "track" is basic or advanced training; "residency" and "masterclass" are
  class formats used in Gumroad product names.
- Decided 2026-11-06 (owner): Gumroad is the source of truth for class overview copy, price,
  and checkout; the platform owns structured class facts and curriculum; no price is shown on
  the platform; anonymous register clicks are counted without identifiers; both tracks sell
  on Gumroad; teachers link cohorts to products with admin override.

## Brand Commitments

- Name: Tech Fleet (two words). Logo asset in `src/assets/`.
- Typography and surface language are owned by the design system (Poppins body, Futura
  headings, the asymmetric-radius button, the `tf-card` surface; 4px grid; WCAG 2.2 AA).
- Voice (README): plain, direct, service-minded; "leadership is a practice anyone can learn."

## Evidence on Hand

- Six course products on the Gumroad storefront as of 2026-11-06 (names, permalinks,
  thumbnails, long-form descriptions with syllabus, time commitment, audiences, prerequisites).
  See `docs/epics/03-public-classes-catalog.md` §2 for the extracted table.
- One published class in production (`ai-development-residency`, advanced track, no hero
  image, a 5.6 KB HTML summary) and zero published cohorts.
- No testimonials, ratings, or completion statistics for classes exist in the repo or on the
  storefront (ratings_count is null on every product). Future work must not fabricate them.

## Product Principles

1. Real work on real teams is the product; a class is the doorway, so class pages must say
   what the learner will do and with whom, not just what they will watch.
2. One fact, one owner: Gumroad owns price and checkout; the platform owns the catalog
   entry, curriculum, and the learner's record.
3. Public before private: anything a prospective learner needs to decide must be readable
   without an account; the account starts at registration, not before.
4. Accessible by default: WCAG 2.2 AA, keyboard and screen-reader complete, 320px up.
5. Nothing invented: no fake proof, no placeholder prices, no "coming soon" filler.

## Accessibility & Inclusion

WCAG 2.2 AA is a committed standard (design-system docs, a11y-audit workflow, axe in CI).
The audience includes career changers and people new to tech, so plain language and
explicit time and cost commitments matter as much as visual polish.
