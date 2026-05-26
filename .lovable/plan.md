## What's wrong

On `ClassDetailPage`, the Edit / Submit for review / Archive buttons live in the **same flex row** as the class title and `summary` (rendered as rich HTML). When the teacher saves a long summary — like the one in your screenshot with intro copy and a numbered video list — `flex-wrap` + `justify-between` pushes the action buttons to wrap **underneath the summary**, so they appear floating in the middle of the page right above "About this class".

## Fix

Pull the action buttons out of the title row into a dedicated action bar that always sits at the top of the page, regardless of summary length.

### Changes — `src/pages/ClassDetailPage.tsx` only

1. Add a sticky-top action bar directly under the `Back` button (and under the "Changes were requested" alert when present):
   - Right-aligned row containing `Edit` + `<ApprovalActions />`
   - Only rendered when `canEdit`
   - Uses `sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 -mx-* px-* py-2 border-b border-border` so it stays visible while scrolling the long detail page (per memory: required `supports-[backdrop-filter]` guard)
2. Remove the buttons from the title row (lines 110–119). The title row becomes a simple block with the status badge, `h1`, and summary — no flex/justify-between needed.
3. Keep all other sections (description, why_take, outcomes, audiences, skills, cohorts, history) unchanged.

### Out of scope
No business-logic, RPC, email, or notification changes. Pure presentation fix.