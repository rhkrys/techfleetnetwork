## What's wrong today

In `src/pages/DashboardPage.tsx` (lines 366–408), once a user finishes the 5 onboarding/core courses (`allOnboardingDone`), the `core_courses` widget swaps to a generic celebration card: rocket illustration + "You finished the onboarding and core courses!" + "Continue Courses" button pointing at `/courses`.

It never mentions Observer Course, so 96% of users (24 starters out of 578) never discover it.

## The new experience

Keep the first 5 courses' behavior untouched. Replace only the post-completion celebration card with a dedicated Observer Course card that has **two states**, both reusing the same rocket-image card layout (image on the left, content on the right, CTA primary button).

### State A — Observer Course not started (`observerCompleted === 0`)

- Rocket image (same `celebrationImg`, same dimensions/styling)
- H2 title: **"You're ready to observe a Tech Fleet project"**
- Body copy (Welcoming + Caring + Informative, 7th-grade reading level, no emojis, no icons):
  > "Great work finishing your onboarding. The Observer Course is your next step. It teaches you how to shadow a real project team and get ready to apply as an Observer."
- Primary CTA button: **"Start observer course"** → `/courses/observer`

### State B — Observer Course in progress (`0 < observerCompleted < TOTAL_OBSERVER_LESSONS`)

- Same rocket image, same card layout
- H2 title: **"Keep preparing to observe"**
- Body copy:
  > "You've finished {observerCompleted} of {TOTAL_OBSERVER_LESSONS} sections in the Observer Course. Keep going to get ready to shadow a real Tech Fleet project team."
- Progress indicator: existing `<Progress>` component from `@/components/ui/progress`, value = `(observerCompleted / TOTAL_OBSERVER_LESSONS) * 100`, with text label `"{observerCompleted} of {TOTAL_OBSERVER_LESSONS} sections complete"` above it. No icons.
- Primary CTA button: **"Continue observer course"** → `/courses/observer`

### State C — Observer Course finished (`observerCompleted >= TOTAL_OBSERVER_LESSONS`)

Fall back to the existing generic celebration card ("You finished the onboarding and core courses!" → `/courses`) so people who've done everything still see a positive end state. No change to that copy.

## Implementation

One file changes: `src/pages/DashboardPage.tsx`.

1. Add the existing observer-progress hook call alongside the others (~line 198 in `TrainingPage` already has the pattern):
   ```ts
   import { TOTAL_OBSERVER_LESSONS, ALL_OBSERVER_LESSON_IDS } from "@/data/observer-course";
   const { data: observerCompleted = 0 } = useCompletedCount(userId, "observer", ALL_OBSERVER_LESSON_IDS);
   ```
2. Derive flags near line 242:
   ```ts
   const observerNotStarted = allOnboardingDone && observerCompleted === 0;
   const observerInProgress = allOnboardingDone && observerCompleted > 0 && observerCompleted < TOTAL_OBSERVER_LESSONS;
   const observerDone = allOnboardingDone && observerCompleted >= TOTAL_OBSERVER_LESSONS;
   ```
3. Rewrite the `case "core_courses":` branch (lines 366–409) into three sub-states:
   - `!allOnboardingDone` → existing `<GettingStartedChecklist>` (unchanged)
   - `observerNotStarted` → new State A card
   - `observerInProgress` → new State B card (with `<Progress>`)
   - `observerDone` → existing celebration card (unchanged)
4. Import `Progress` from `@/components/ui/progress`. No new icons, no emojis, no new images.
5. Keep `aria-labelledby`, `sr-only` heading, `loading="lazy"`, and image dimensions identical for accessibility and CLS parity. Use `<Button asChild variant="hero" size="lg">` to match the existing CTA style.

## Tests / BDD

- Extend `src/test/smoke/dashboard-core-courses.smoke.test.ts` with three cases: not-started, in-progress (asserts the progress bar renders with the right value and label), done.
- Add Gherkin scenarios `DASH-OBS-001/002/003` to `bdd_scenarios` with tri-layer Then-clauses ([UI] correct card variant + CTA label + href; [DB] reads `journey_progress` phase=`observer` count; [Code] `useCompletedCount` called with `ALL_OBSERVER_LESSON_IDS`).

## Out of scope

- No changes to the 5 onboarding courses, their cards, or the checklist component.
- No changes to `/training`, `/courses/observer`, or the observer role opt-in flow.
- No emails, nudges, or sidebar changes — just the dashboard card.
