## Why this matters

A reusable `ProfileDiscordConnector` already exists and powers the same verified Discord flow on **ProfileSetupDialog**, **ProfileSetupPage**, **ProfileEditPanel**, and **EditProfilePage**. But two surfaces still use isolated raw text inputs for `discord_username`:

1. **General Application → Profile section** (`src/components/general-application/SectionProfile.tsx`, lines 116–161) — a "Do you have Discord? Yes/No → free-text username" pattern. This is the "profile set up section of the application" the user is calling out.
2. **`ConnectDiscordPage`** (894-line page) duplicates the connector's logic inline instead of importing the shared component — so it can drift.

Both bypass server-side Discord verification, role assignment, and stale-candidate handling that the shared connector provides.

## Goal

One verified Discord connect experience, everywhere `discord_username` is captured. Identical UX, identical functionality, single source of truth.

## Changes

### 1. General Application → SectionProfile (primary fix)
- Remove the "Do you have a Discord account? Yes/No" radio and the free-text `discord_username` input (lines 116–161).
- Render `<ProfileDiscordConnector />` in its place under a "Discord account" subheading.
- On successful verification, the connector already writes `profiles.discord_username` and `profiles.discord_user_id` via `refreshProfile()`. Add a tiny effect in `SectionProfile` (or in `use-general-application`) that mirrors `profile.discord_username` into the general-application form state so the review/submit step keeps showing it. No new DB column — single source of truth stays `profiles`.
- Drop `has_discord_account` from the form's local state path (it becomes derived: `Boolean(profile.discord_user_id)`); keep the column in DB writes for backward compatibility, derived from the verified link.
- Update `SectionReview.tsx` to read the linked status from `profile` instead of the form's free-text field.
- Update `src/lib/validators/general-application.ts` to no longer require/validate `discord_username` as a free-text field (verification is the contract now).

### 2. ConnectDiscordPage refactor
- Replace the page's ~700 lines of inline verification UI with `<ProfileDiscordConnector />` wrapped in the page's existing chrome (heading, completion banner, "next step" CTA, journey-task wiring).
- Keep page-only concerns (route-level loading, completion redirect to the lesson, dashboard back-link). All form/verify/candidate logic lives only in the shared component.
- Verifies the Nielsen heuristics already baked into the connector (visibility of status, error recovery with stale-candidate cleanup, undo via "Re-link", consistency across surfaces, recognition vs. recall via the tutorial + candidate list).

### 3. Tiny accessibility/UX touch-ups in `ProfileDiscordConnector` (apply once, benefits all 6 surfaces)
- Add an `aria-live="polite"` region around the verification status so screen readers announce "verifying…", "found N matches", and the final success copy without losing focus.
- Add `autoComplete="off"` to the username input (prevents browser autofill polluting Discord search).
- That's it — no other behavior changes.

### 4. Code-level guard (so the raw input can't sneak back)
- Add ESLint rule entry in `eslint.config.js` (or a tiny script under `scripts/brand/`) that forbids JSX `<Input … id|name="discord_username">` or `value={…discord_username}` outside `src/components/profile/ProfileDiscordConnector.tsx` and `src/integrations/supabase/types.ts`. Anything else must go through the shared connector.

## Files touched

- `src/components/general-application/SectionProfile.tsx` — swap raw input → `<ProfileDiscordConnector />`
- `src/components/general-application/SectionReview.tsx` — read linked status from `profile`
- `src/hooks/use-general-application.tsx` — mirror verified `profile.discord_username` into form state; stop requiring free-text input
- `src/lib/validators/general-application.ts` — drop `discord_username` free-text validation
- `src/pages/ConnectDiscordPage.tsx` — replace inline logic with `<ProfileDiscordConnector />`; keep page chrome + journey navigation
- `src/components/profile/ProfileDiscordConnector.tsx` — add `aria-live` region + `autoComplete="off"`
- `eslint.config.js` (or new `scripts/brand/no-raw-discord-input.mjs`) — enforce single-source

## BDD scenarios (stored in `bdd_scenarios`)

- `DISCORD-CONN-001` — General Application Profile section renders the shared verified connector instead of a free-text input [UI/Code]
- `DISCORD-CONN-002` — Verifying Discord inside the General Application writes `profiles.discord_username` + `discord_user_id`, mirrors into general-app form state, and assigns the Community role [UI/DB/Code]
- `DISCORD-CONN-003` — ConnectDiscordPage uses `<ProfileDiscordConnector />` and completes the `first_steps/connect-discord` task identically to before [UI/DB/Code]
- `DISCORD-CONN-004` — Re-linking from any of the 6 surfaces (General App, ProfileSetupDialog, ProfileSetupPage, ProfileEditPanel, EditProfilePage, ConnectDiscordPage) shows the same candidate-picker UX and stale-candidate recovery [UI/Code]
- `DISCORD-CONN-005` — Screen-reader announces verification status changes via `aria-live="polite"` without losing input focus [UI]
- `DISCORD-CONN-006` — ESLint/brand guard fails CI when a raw `discord_username` `<Input>` is added outside the shared connector [Code]

## Out of scope

- DB schema (already correct: `profiles.discord_username`, `profiles.discord_user_id`)
- The `discord-notify.service`, `manage-discord-roles`, `generate-discord-invite` edge functions (unchanged)
- Admin-facing display of `discord_username` (read-only labels; no edit path needed)
- Tutorial copy in `DiscordUsernameTutorial` (reused as-is)