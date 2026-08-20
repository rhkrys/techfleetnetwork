# Email UX Build Standard (voice, IA, components)

Binding standard for every user-facing and admin-facing screen in the email rearchitecture.
Built from the Tech Fleet Brand Guide (May 12, 2026). If a screen conflicts with this doc, this
doc wins.

## Components to reuse (no new one-offs)

All from `src/components/ui/`. Match the existing idiom in `ProfileEditPanel.tsx`.

| Need                      | Component                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| On/off preference         | `Switch` (`switch.tsx`) with `<Label>` + helper `<p class="text-xs text-muted-foreground">`       |
| Consent opt-in at signup  | `Checkbox` (`checkbox.tsx`) with `onCheckedChange`, same pattern as the current notify checkboxes |
| Service vs Marketing pick | `RadioGroup` / `RadioGroupItem` (`radio-group.tsx`)                                               |
| Section container         | `Card` / `CardHeader` / `CardTitle` / `CardContent`                                               |
| Grouping / rules          | `Separator`                                                                                       |
| Status pill               | `Badge`                                                                                           |
| Info / warning callout    | `Alert` / `AlertDescription` (pair an icon with text, never color alone)                          |
| Actions                   | `Button` (default + `variant="outline"` for secondary)                                            |
| Saving state              | existing `SaveStatus` / `AutosaveStatus`                                                          |
| Composer fields           | `Input`, `Textarea`, `Label`                                                                      |

## Voice rules (from the brand guide)

- **Sentence case** for every heading, title, and label. Not Title Case.
- **No em dashes anywhere.** Use a period, a comma, or restructure the sentence.
- **Plain language, grade 7 to 9.** Short sentences. Explain any term the first time.
- **Buttons are verb plus noun, three words or fewer.** Never "Submit", "Go", "OK", "Click here".
- **Address the person as "you."** Avoid the noun "users" in copy. Say "people" when referring to
  a group.
- **No internal tooling names in member copy.** Members never see "Ghost" or "Email Octopus".
  They see "Community newsletter" and "Promotions and offers".
- **Empathetic system states.** Success confirms what happened. Errors say what went wrong and how
  to fix it, and never blame the person.
- **Write "Tech Fleet" as two words.** Capitalize "Team Practices" when naming the framework.
- **Tooltips** are supplementary only, under 100 characters, no links inside. Never put essential
  information in a tooltip.
- **Dates** as "Month Day, Year"; **times** as 12-hour with time zone.

## Patterns that are banned on these screens

- Em dashes.
- Eyebrows (a small uppercase kicker label sitting above a heading).
- Numbered section markers like 01 / 02 / 03 used for decoration.
- Decorative accent bars or rails on cards.
- Centering long blocks of text.
- Emoji used as section markers or as a substitute for a label.
- Color used as the only signal for a state (always pair with an icon and text).
- Title case, ALL CAPS shouting, or exclamation pileups.

## Screen copy and information architecture

Headings below are sentence case. Helper text sits under its control in muted text.

### 1. Sign up (extends the existing register screen; auth-frozen area, see build note)

IA: required consent first, then the optional marketing opt-ins in their own group.

- Required: **Account and service emails** (required). Helper: "Sign-in help, security alerts, and
  updates about your applications."
- Required: **I agree to the Terms and Privacy Policy** (required).
- Optional, one checkbox: **Marketing and news**. Helper: "Stories, events, programs, and offers
  from the Tech Fleet community. You can change this anytime in your profile."
- Microcopy under it: "We never check this box for you."
- Primary action: **Create account**.

### 2. Email preferences (new page under the profile)

IA: always-on first (so people trust the system), then the one service opt-out, then marketing.

- Page title: **Email preferences**. Intro: "Choose what reaches your inbox. Marketing emails stay
  off until you turn them on."
- Section: **Account and essential emails**. Helper: "We always send these. They keep your account
  and applications working." Rows (read-only, each with a lock icon and the text "Always on"):
  - Sign-in and security
  - Application and interview updates
  - Support replies
- Section: **Opportunities and platform updates** (single `Switch`, on by default). Helper:
  "Project openings, reminders, and platform news. You can turn these off anytime, including from
  any of these emails."
- Section: **Marketing and news** (single `Switch`, off by default). Helper: "Stories, events,
  programs, and offers from the Tech Fleet community. Off until you turn it on. Your choice reaches
  our email tools within a few minutes."
- Footer microcopy: "We keep a record of your choices so we can honor them."
- Saving uses the existing autosave status. If a button is needed: **Save preferences**.

### 3. Unsubscribe confirmation (public page, one click, no sign-in)

- Title: **You're unsubscribed**. Body: "You won't get opportunity and platform update emails
  anymore. That took one click, no sign-in needed."
- Reassurance (Alert with a lock icon): "You'll still get essential account emails like sign-in
  help, application updates, and interview invitations. Those keep your account working."
- Primary action: **Manage preferences**. Secondary: **Turn emails back on**.

### 4. Announcement composer (admin)

IA: content first, then the required audience decision, then the resolved count, then send.

- Title: **New announcement**.
- **Subject line** (`Input`).
- **Message** (`Textarea`).
- Required decision, "Who is this for?" (`RadioGroup`, no default selected):
  - **Service update**. Helper: "Goes to everyone, except people who turned off opportunity emails."
  - **Marketing**. Helper: "Goes only to people who opted in to that email."
- Audience preview (Alert, updates live): "This will reach 1,187 people. 1,253 active members,
  minus 66 who opted out." For marketing: "This will reach 214 people who opted in to promotions."
- Note: "Marketing emails only reach people who opted in. We record who chose the send type."
- Primary action: **Send announcement** (opens a confirm dialog: title "Send this announcement?",
  body states the audience and count, buttons "Keep editing" / "Send announcement"). Secondary:
  **Preview audience**.

### 5. Email footer (every Tier 1 and Tier 2 email)

- Reason line: "You're getting this email because you opted in to promotions and offers."
- Links (meaningful text): **Unsubscribe** and **Manage preferences**.
- Physical postal address on its own line.
- `List-Unsubscribe` header is set on the message (not visible copy).

## Accessibility (WCAG 2.2 AA, from the brand guide)

- Every control has an associated `<Label>`; helper text is linked with `aria-describedby`.
- All interactive elements reachable and operable by keyboard, with a visible focus ring.
- State never relies on color alone: "Always on" pairs a lock icon with text; the audience
  callout pairs an icon with the count.
- Contrast at least 4.5:1 for text, 3:1 for large text and UI components.
- Layout reflows cleanly to 320px with no horizontal scroll.
- Respect `prefers-reduced-motion` for any transition.

## Build note (auth freeze)

Screen 1 lives in `src/features/auth/**`, which is frozen (see CLAUDE.md and
`06-auth-flow-lockdown.skill.md`). The signup marketing opt-ins ship in their own PR with the full
auth regression suite green, and touch only the added fields, never the sign-in or session path.
