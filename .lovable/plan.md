## Problem
`MAX_EXPERIENCE_AREAS` is capped at 30, but `EXPERIENCE_AREAS` lists 66 options. Members who already have (or want) more than 30 areas selected hit a `too_big` schema validation error on `EditProfilePage.handleSubmit` and cannot save their profile.

## Solution
Raise the cap to match the full option list so no member is blocked.

## Changes

### Code
1. **`src/lib/validators/profile.ts`**
   - Change `MAX_EXPERIENCE_AREAS` from `30` to `66` (or derive from `EXPERIENCE_AREAS.length` to prevent future drift).
   - No other validator changes needed; `safeStringArraySchema` already uses this constant.

2. **`src/components/ExperienceAreasSelect.tsx`**
   - No changes required. It already imports `MAX_EXPERIENCE_AREAS` from the schema and will pick up the new cap automatically.

3. **`src/pages/EditProfilePage.tsx`, `src/components/ProfileEditPanel.tsx`, `src/components/ProfileSetupDialog.tsx`, etc.**
   - No changes required. All use the shared `profileSchema`.

### Database
- None. The `profiles.experience_areas` column is `text[]` with no length constraint.

### Tests / BDD
- Add BDD scenario `PROFILE-EXP-001` to `bdd_scenarios`:
  - Given a member edits their profile
  - When they select all 66 experience areas
  - Then [UI] the counter shows "66 of 66 selected"
  - Then [DB] the save succeeds with no validation_rejected event
  - Then [Code] `profileSchema.safeParse` returns `success=true`

## Verification
- `ExperienceAreasSelect` counter label updates to "X of 66 selected".
- Members with >30 existing areas can now save without truncation or errors.
- No regression: the "I'm not sure yet" mutual-exclusion logic remains unchanged.