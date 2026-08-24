# ADR 0016 — TAL 9000 "Future Mode" (Fleety retro-CRT terminal shell)

- Status: Accepted
- Date: 2026-08-22
- Deciders: TechFleet (owner)
- Related: Fleety's three chat surfaces (ChatPage, FleetyChatWidget, GuidanceEmbed); ADR 0011 (conversation modes); ADR 0014 (file uploads); the `techfleet-chat` SSE contract; `AppLayout` chrome branches; the published CRT design prototype

## Context

The owner wants Fleety to gain a **"Future Mode"** — a retro control-panel / CRT-terminal experience branded **TAL 9000** (a friendly HAL homage: it helps, it does not manipulate) — shipped as a real feature, starting with Fleety only. Locked requirements:

- A top-level nav item **"TAL 9000"** at `/tal-9000`, separate from Resources.
- `/tal-9000` opens Fleety in **Classic chat by default**; a **Classic/Future switch** appears on **every** Fleety surface.
- **Future Mode** is a full-screen takeover (nav/menu/chrome gone) with an on-panel control to leave.
- Rename nav **"Get Help" → "Support"**; **remove Fleety from Resources**.
- **Full launch** (the app has no feature-flag system) and **fully responsive**.

Investigation (see the build memory) surfaced the key constraint: **there is no shared Fleety chat hook** — the send/stream logic (`streamChat`) is copy-pasted across the three surfaces, with the real shared contract being the `techfleet-chat` SSE protocol (token stream + `X-Fleety-Sources`/`X-Fleety-Chips`/`X-Fleety-Turn-Id` headers). Per CLAUDE.md ("fix root cause, don't duplicate"), the terminal must **not** become a 4th copy. Work was done in an isolated git worktree because a concurrent agent is editing the main checkout (design-system migration).

## Decision

- **Route.** `/tal-9000` → `TAL9000Page`: Classic mode renders the existing `ChatPage`; `?mode=future` renders the new `TalTerminal`. Lazy-loaded, `ProtectedRoute` + `ScopedErrorBoundary`, above the catch-all; a `RouteTitle` entry added.
- **Full-screen takeover.** `AppLayout` gains an early-return branch for `/tal-9000?mode=future` that drops the header, sidebar, footer, and floating widget — **but keeps the auth guards** (`MfaEnforcementGuard`, `ProfileSetupDialog`, `AdminTwoFactorGraceDialog`) so the takeover never weakens security. Classic mode keeps normal chrome. This mirrors the existing `isPublicPage` pattern (no `App.tsx` restructure).
- **Reuse, don't duplicate.** The canonical `streamChat` is extracted to `src/lib/fleety/stream-chat.ts`; a new `useFleetyChat` hook wraps it with conversation persistence. The terminal also reuses `useFleetyAttachment` (uploads, ADR 0014), and the shared `sources`/`feedback` modules. **Cross-mode continuity:** the hook writes the same `chat_conversations`/`chat_messages` rows with the same `conversation_id`, so a thread is continuous whether started in Classic or Future.
- **Switch everywhere.** `FleetyModeSwitch` (Classic ⇄ Future, styled with app design tokens) is added to `ChatPage` and `FleetyChatWidget`; the terminal's own panel carries the **Classic** and **Exit** controls (Exit → previous page, fallback `/dashboard`).
- **Sealed styling.** `tal-9000.css` scopes every selector under `.tal9k`, defines tokens on that root class (never `:root`), prefixes keyframes `tal9k-`, and honors `prefers-reduced-motion` — isolated from the design-system migration.
- **Nav / Resources.** "Get Help" relabeled to "Support" (route `/community/get-help` unchanged, so no broken links); the Guidance tab + `GuidanceEmbed` removed from Resources with the default tab repointed to `explore`.
- **Responsive.** XL: TAL eye and control panel side-by-side; MD/SM/XS: everything stacks, buttons single-column.

## Security

- The full-screen branch preserves MFA/profile/2FA-grace guards; the route is `ProtectedRoute`-guarded.
- No new endpoints, auth, or RLS changes: the terminal reuses the session-JWT `streamChat` path, the `techfleet-chat` untrusted-material framing, and the ephemeral `fleety-extract` upload path (ADR 0014) unchanged.

## Consequences

- Fleety gains a full-screen terminal that inherits streaming, sources, 👍/👎, and uploads; chats persist and are continuous across modes.
- **Temporary duplication:** the shared `stream-chat.ts` is a copy of the widget's proven logic while the three inline copies remain; converging those surfaces onto the shared module + hook is a deliberate follow-up (kept out of this change to avoid destabilizing live chat, respecting the "change all three surfaces together" rule).
- The CRT is rendered in **CSS** rather than embedding `computer.svg` via SVG `foreignObject`; foreignObject is fragile for a live, scrolling, focusable, streaming terminal. Same look, more robust; an exact-SVG bezel is a possible visual follow-up.
- Retro faces load from Google Fonts with a monospace fallback; self-host if a CSP blocks them.
- **Not in scope (fast-follow):** in-terminal history browser (a `LOG` command reusing `groupConversationsByDate`); migrating the three surfaces onto `useFleetyChat`; a review/plan mode selector inside the terminal.
- **Rollback** is additive-only: remove the nav items, the `/tal-9000` route, the `AppLayout` branch, and the `FleetyModeSwitch` usages; `stream-chat.ts`/`useFleetyChat` are new files nothing else depends on.
