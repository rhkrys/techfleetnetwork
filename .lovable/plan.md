# Card Redesign: Project Openings + Platform-Wide Icon Purge

## Goals

1. Rebuild project opening cards (Client + Volunteer tabs) using NN/g information-hierarchy principles: scannable, left-aligned, single-column, clear visual rhythm.
2. Remove all decorative icons from cards across the entire system — no Lucide glyph inside a `Card` body or header.
3. Enforce a **1rem (16px) minimum font size** on every text element inside a card — no `text-xs`, no `text-[13px]`, no sub-16px values, anywhere in card surfaces. WCAG-compliant for body text and small-caps labels alike.

---

## 1. Accessibility floor (applies to every card change below)

- **Minimum font size = 1rem (16px)** on all card text, including section labels, badge text, hat chips, counts, and footer affordances.
- Tailwind classes allowed inside cards: `text-base` (16px), `text-lg` (18px), `text-xl` (20px), `text-2xl` (24px). **Banned in cards**: `text-xs`, `text-sm`, `text-[Npx]` where N<16.
- Status badge: `text-base font-semibold uppercase tracking-wide` (was `text-xs` — bumped to meet the floor).
- Section labels keep the small-caps treatment via `uppercase tracking-wider` but render at `text-base font-semibold` — visual hierarchy comes from weight + color + letter-spacing, not from shrinking the type.
- Color contrast: muted-foreground tier verified ≥ 4.5:1 against `bg-card` (token-level guarantee).

---

## 2. New project opening card spec

Applied to both **Client Projects** and **Volunteer Projects** tabs on `/project-openings`, and to matching detail card variants in admin/recruiting views.

### Layout (single column, left-aligned, stacked)

```text
┌──────────────────────────────────────────────┐
│  [STATUS BADGE]                              │  ← status pill, top-left
│                                              │
│  Client Name                                 │  ← H3, 24px, bold
│  Project Friendly Name                       │  ← 20px, medium, muted-foreground
│  Project Type                                │  ← 16px, semibold, uppercase, muted
│                                              │
│  ──────────────────────────────────────────  │  ← divider
│                                              │
│  PHASE                                       │  ← 16px, semibold, uppercase, muted
│  Discovery & Definition                      │  ← 16px, foreground
│                                              │
│  TEAM HATS                                   │
│  [hat] [hat] [hat]                           │  ← chips at 16px
│                                              │
│  YOUR STATUS                                 │
│  Applied   /   Not yet applied               │
│                                              │
│  APPLICATIONS                                │
│  12 total                                    │
│  • 4 — UX Researcher                         │
│  • 3 — Product Designer                      │
│  • …                                         │
│                                              │
│  ──────────────────────────────────────────  │
│  View opening →                              │  ← 16px text affordance, left-aligned
└──────────────────────────────────────────────┘
```

### Typography & hierarchy (4-tier, all ≥ 1rem)

| Tier | Element | Class |
|------|---------|-------|
| 1 | Status badge | `text-base font-semibold uppercase tracking-wide` |
| 2 | Client name (H3) | `text-2xl font-bold text-foreground leading-tight` |
| 3 | Project friendly name | `text-xl font-medium text-muted-foreground` |
| 4 | Project type | `text-base font-semibold uppercase tracking-wider text-muted-foreground` |
| Section label | "Phase", "Team Hats", etc. | `text-base font-semibold uppercase tracking-wider text-muted-foreground` |
| Section value | hat chips, counts, list items | `text-base text-foreground` |
| Footer affordance | "View opening →" | `text-base font-semibold text-primary` |

### Spacing (NN/g proximity)

- Card padding `p-6`
- Status → identity block: `mt-3`
- Identity block → divider: `mt-5`
- Between labeled sections: `space-y-5`
- Inside a section (label → value): `space-y-1.5`
- Divider before footer: `mt-5 pt-5 border-t`
- Outer grid stays `grid-cols-12 xl:col-span-6`; **inside** the card is single column.

### Removed from the card

- Client logo image + Handshake fallback icon
- `CheckCircle2`, `Eye`, `ExternalLink` inside the body/footer
- Right-side two-column header (`flex items-start justify-between`)
- Outline footer button → replaced with left-aligned text affordance ("View opening →"); the whole card remains clickable.

### Status badge colors

Reuse existing tokens (`success`, `warning`, `primary`, `info`). Filled, larger (`px-3 py-1.5 text-base font-semibold uppercase tracking-wide`).

---

## 3. Icon policy (system-wide)

Apply to **every component rendered inside a `<Card>`**.

**Remove (decorative chrome):**
- Lucide icons in `CardHeader` next to titles
- Icons prefixed to section labels
- Circular icon tiles (`h-10 w-10 rounded-lg bg-X/10` wrapping a glyph) on KPI/stat cards — replace with a 4px colored left bar + larger number
- Avatar fallback icons inside cards (use initials text only)
- Empty-state hero icons inside `Card` — replaced with bold text headline

**Keep (functional controls, not card chrome):**
- Icons inside `<Button>` action controls (edit, delete, close)
- Icons inside form inputs (search, calendar pickers)
- Sidebar / nav icons
- Toast / alert severity icons
- Loading spinners

---

## 4. Files to change

### Primary (project openings)

- `src/pages/ProjectOpeningsPage.tsx` — rewrite `ProjectSection` card markup; drop logo block; restructure header; remove `Handshake`/`CheckCircle2`/`Eye`/`ExternalLink` from cards (keep `Loader2`); bump every text class to ≥ `text-base`. Replace the 5 KPI stat tiles with iconless variants (colored accent bar + 24px number + 16px label).
- `src/components/projects/ProjectOpeningHeading.tsx` — add an `xl-stacked` variant rendering the 3-tier identity block (client / friendly name / type) at the new ≥16px sizes.

### Secondary cards aligned in the same pass

- `src/components/clients/ProjectsTab.tsx` — admin project cards (drop header logo, drop description/footer icons; Pencil/Trash kept only inside icon buttons with `aria-label`)
- `src/pages/AdminRosterPage.tsx` — recruiting tiles (remove `BarChart3`/`Users`/`FolderKanban`/`ArrowRight` from card body)
- `src/pages/RosterProjectDetailPage.tsx` — applicant cards
- `src/pages/MyProjectApplicationsPage.tsx` — application status cards
- `src/pages/MyJourneyPage.tsx` + `src/components/quest/*` cards
- `src/pages/ResourcesPage.tsx` cards
- `src/pages/EventsPage.tsx` event cards
- `src/components/JourneyStepCard.tsx`
- `src/components/GettingStartedChecklist.tsx`
- `src/pages/AdminClassesPage.tsx` class/cohort cards
- Dashboard widget cards under `src/components/`
- Empty-state blocks inside cards across the above pages

Each gets: status/title/meta stacked left-aligned, decorative icons removed, ≥16px type throughout, `space-y-5` chunking with `border-t` dividers where multiple semantic groups coexist.

### Out of scope

Sidebar, top nav, toasts, modals, forms, buttons, fleety widget, AG Grid tables, landing-page illustrations.

---

## 5. NN/g heuristics applied

- **#4 Consistency & standards** — one card pattern repeats everywhere.
- **#6 Recognition over recall** — explicit small-caps section labels above each value; no reliance on iconography.
- **#8 Aesthetic & minimalist** — decorative icons, logo tiles, and duplicate column headers stripped.
- **Information hierarchy** — 4 type tiers (status / client / project / type) differentiated by size, weight, color, and letter-spacing — never by going below 16px.
- **Scanability (F-pattern)** — everything left-aligned, single column, predictable label-then-value rhythm.

---

## 6. Accessibility & quality

- Client name renders as `<h3>` inside listing cards (page owns `<h1>`/`<h2>`).
- Whole-card click target preserved; `role="link"` + keyboard handler on the card root.
- No nested interactives — "View opening →" is visual text, not a button.
- New ESLint rule `card-min-font-size` (custom local plugin) flags any `text-xs`, `text-sm`, or `text-[<16px]` used inside files matching `**/components/**/Card*.tsx` or inside JSX with a `tf-card` ancestor — CI fails the build if violated. Backstop: a smoke test asserts computed font-size ≥ 16px for every text node within `[data-card]`.
- Companion smoke test asserts `[data-card] svg[data-lucide]` count is `0` outside `<button>` descendants.
- BDD scenarios added to `bdd_scenarios` covering: status above title; no Lucide icon inside card body; 4-tier hierarchy present; computed font-size ≥ 16px for every card text node; keyboard activation navigates to detail.

---

## 7. Technical notes

- New utility class `tf-card-section-label` in `src/index.css` standardizes the small-caps muted label at 16px.
- Lucide imports removed file-by-file (ESLint catches orphans).
- Status `Badge` tokens unchanged; only size/position/text-size classes change.
- No DB or edge-function changes; pure presentation work.

---

## 8. Rollout

1. Ship `ProjectOpeningsPage` + `ProjectOpeningHeading` (canonical reference) with the 16px floor.
2. Sweep secondary card files in the same change using the same primitives + ESLint rule.
3. Land the lint rule + smoke tests so future cards stay compliant.
4. Add `mem://design/card-iconless-pattern` memory entry capturing both the iconless rule and the ≥1rem font floor.
