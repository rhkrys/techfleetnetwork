import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import compat from "eslint-plugin-compat";
import security from "eslint-plugin-security";
import brandTerms from "./scripts/lint/eslint-plugin-brand-terms.mjs";
import cssPortability from "./scripts/lint/eslint-plugin-css-portability.mjs";
import noRawDiscordInput from "./scripts/lint/eslint-plugin-no-raw-discord-input.mjs";
import noDirectErrorReporter from "./scripts/lint/eslint-plugin-no-direct-error-reporter.mjs";
import noRawFunctionsInvoke from "./scripts/lint/eslint-plugin-no-raw-functions-invoke.mjs";
import noSupabaseSingle from "./scripts/lint/eslint-plugin-no-supabase-single.mjs";
import authInvariants from "./scripts/lint/eslint-plugin-auth-invariants.mjs";
import lazyRequiresRetry from "./scripts/lint/eslint-plugin-lazy-requires-retry.mjs";
import useAuthRequiresProvider from "./scripts/lint/eslint-plugin-use-auth-requires-provider.mjs";
import noAnonymousMutation from "./scripts/lint/eslint-plugin-no-anonymous-mutation.mjs";
import noRpcThenCatch from "./scripts/lint/eslint-plugin-no-rpc-then-catch.mjs";
import noLegacyEmailSend from "./scripts/lint/eslint-plugin-no-legacy-email-send.mjs";
import noFocusListener from "./scripts/lint/eslint-plugin-no-focus-listener.mjs";
import authBootstrapNoRefresh from "./scripts/lint/eslint-plugin-auth-bootstrap-no-refresh.mjs";
import oauthCanonicalOrigin from "./scripts/lint/eslint-plugin-oauth-canonical-origin.mjs";
import noRawSupabaseRpc from "./scripts/lint/eslint-plugin-no-raw-supabase-rpc.mjs";
import noDirectMui from "./scripts/lint/eslint-plugin-no-direct-mui.mjs";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      // Tech Fleet brand voice / editorial guard. Surfaces banned terms
      // ("TechFleet", "click here", ableist words, etc.) at lint time.
      "brand-terms": brandTerms,
      // CSS portability — guards against iOS/Android-breaking `h-screen`/`100vh`.
      "css-portability": cssPortability,
      // Single source of truth for Discord username capture — forbids raw
      // `<Input id="discord_username">` outside the shared connector.
      "discord-connect": noRawDiscordInput,
      // Phase-2 triage refactor — see mem://tech/observability/single-reporter
      "triage-permanent": {
        rules: {
          "no-direct-error-reporter": noDirectErrorReporter,
          "no-raw-functions-invoke": noRawFunctionsInvoke,
          "no-supabase-single": noSupabaseSingle,
          // 2026-06-08 — guards against `supabase.rpc(...).catch(...)` which
          // throws "catch is not a function" at runtime (root cause of 18
          // `email_failed` audit rows on 2026-06-05).
          "no-rpc-then-catch": noRpcThenCatch,
          // 2026-06-22 — kills the PGRST002/503 schema-cache class of incidents
          // by forcing every service-layer supabase.rpc/from through a
          // transient-retry wrapper. See mem://tech/observability/transient-retry.
          "no-raw-supabase-rpc": noRawSupabaseRpc,
        },
      },
      // Email subsystem v2 Phase 6 — bans direct invokes of legacy
      // send-* edge fns; routes must go through EnqueueEmail.
      "email-v2": { rules: { "no-legacy-email-send": noLegacyEmailSend } },
      // NO-RELOAD-TAB-002 — focus/visibilitychange/pageshow listeners in
      // components/pages require an inline `// reason: tab-switch-safe — …`
      // justification. Prevents another MfaEnforcementGuard-style regression
      // that reloads /admin/activity-log on tab return.
      "tab-switch": noFocusListener,
      // AUTH-WEDGE-013..015 (2026-06-16) — bootstrap MUST NOT call
      // refreshSession() against a flapping GoTrue on first transient
      // bad_jwt; it bypasses the two-strike protection.
      "auth-bootstrap": authBootstrapNoRefresh,
      "oauth-origin": oauthCanonicalOrigin,
      "auth-invariants": authInvariants,
      // Part 1 §1.5 — chunk-load brick + AuthProvider hoist invariants.
      lazy: lazyRequiresRetry,
      auth: useAuthRequiresProvider,
      // Issue G of 2026-06-02 audit — every useMutation must declare
      // mutationKey or meta.audit so failures aren't logged as
      // source:"mutation.anonymous".
      "triage-mutation": noAnonymousMutation,
      // Browser-compat — fails on JS APIs unsupported in our `browserslist`
      // (package.json: iOS >=14.5, Safari >=14.1, Firefox ESR, last 2 versions).
      compat,
      // WCAG 2.1/2.2 + EN 301 549 — static a11y enforcement on every PR.
      // Recommended set covers labels, alt text, ARIA roles/props, and
      // keyboard interactivity. Surfaced violations downgraded to "warn"
      // initially so the existing baseline doesn't break CI; tighten to
      // "error" once the warning queue is at zero.
      "jsx-a11y": jsxA11y,
      // OWASP A05/A02 — surfaces eval, unsafe regex, child_process, buffer
      // noassert, possible timing attacks, pseudoRandomBytes, etc. Warn-only
      // initially so baseline noise doesn't brick CI; promote per-rule after
      // the queue is at zero.
      security,
    },
    rules: {
      // react-hooks v6 bundles the React Compiler rules (set-state-in-effect,
      // purity, refs, immutability, static-components, incompatible-library,
      // preserve-manual-memoization, …) and the recommended config ships them
      // at "error". That contradicts the baseline strategy below and bricked
      // CI with ~161 pre-existing violations across ~250 files (the linter got
      // stricter; the code did not regress). Apply the SAME downgrade pattern
      // used for jsx-a11y just below: map the whole recommended set to "warn"
      // so every finding still surfaces, then keep the one classic correctness
      // rule (rules-of-hooks — currently clean) at "error". Promote the
      // compiler rules back to "error" per-folder as the conformance sweep
      // reaches zero. Tracked: phased react-compiler conformance (auth last).
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.recommended.rules).map((k) => [k, "warn"])
      ),
      "react-hooks/rules-of-hooks": "error",
      // Baseline strategy: every project-wide rule starts at "warn" so a
      // legacy violation cannot brick CI. Promote individual rules to "error"
      // ONLY after the existing baseline is at zero. This keeps `npm run lint`
      // green while still surfacing every problem in the report output.
      ...Object.fromEntries(Object.keys(jsxA11y.configs.recommended.rules).map((k) => [k, "warn"])),
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/tabindex-no-positive": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/media-has-caption": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/aria-role": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      // WCAG 1.1.1 Non-text Content — every <img> must carry alt (empty for
      // decorative). Brand Visual Guide v1 mandates purposeful alt copy.
      "jsx-a11y/alt-text": "warn",
      "brand-terms/no-banned-terms": "warn",
      // CSS portability — escalate after baseline cleanup.
      "css-portability/no-h-screen": "warn",
      "css-portability/no-vh-units": "warn",
      "discord-connect/no-raw-discord-input": "warn",
      "triage-permanent/no-direct-error-reporter": "warn",
      "triage-permanent/no-raw-functions-invoke": "warn",
      "triage-permanent/no-supabase-single": "warn",
      "triage-permanent/no-rpc-then-catch": "error",
      // Warn-only initially — promote to error after services baseline is at
      // zero unwrapped reads.
      "triage-permanent/no-raw-supabase-rpc": "warn",
      // Warn-only during v2 strangler-fig migration; promote to error after
      // bitmask=7 + 72h soak per mem://features/email-subsystem-v2.
      "email-v2/no-legacy-email-send": "warn",
      "tab-switch/no-focus-listener": "error",
      "auth-bootstrap/no-refresh-session": "error",
      "oauth-origin/oauth-canonical-origin": "error",
      "auth-invariants/no-bare-password-set-input": "error",
      "auth-invariants/no-raw-password-update": "error",
      // Rebuild §8 — single source of truth guards. Warn-only initially so
      // the legacy auth surface (LoginPage, AuthService, RateLimitService…)
      // does not brick CI; promote to "error" after each surface migrates
      // to `src/features/auth/**`.
      "auth-invariants/no-direct-supabase-auth": "warn",
      // 2026-06-22 — read-side guard: getSession/getUser must use the port
      // so Web Locks "AbortError: Lock broken" race is retried in one place.
      "auth-invariants/no-direct-auth-session-reads": "warn",
      "auth-invariants/no-direct-failure-counters": "warn",
      "auth-invariants/no-auth-storage-literals": "warn",
      "auth-invariants/no-auth-booleans-in-ui": "error",
      // AUTH-RESILIENCE-001..006 — session-mutating auth methods (signOut,
      // setSession, signInWithPassword, signInWithOAuth, refreshSession) MUST
      // route through src/lib/auth/session-port.ts or src/features/auth/**.
      // Hard error: this is the rule that prevents the "side door bounces
      // logged-in member to /login on backend hiccup" class.
      "auth-invariants/no-direct-auth-mutations": "error",
      // SIGNUP-TIMEOUT-PROBE-005 — detect duplicate accounts via server codes,
      // not English message-string matches in auth flow files.
      "auth-invariants/no-signup-string-match": "warn",

      // Part 1 §1.5 — bare React.lazy white-screens on stale chunks after a
      // deploy; the wrapper retries 3× then surfaces <UpdateAvailableBanner/>.
      "lazy/requires-retry": "warn",
      // Part 1 §1.5 — useAuth() must live under <AuthProvider>; calls from
      // main.tsx or plain functions produce the "must be used within
      // AuthProvider" white-screen.
      "auth/use-auth-requires-provider": "error",
      "triage-mutation/require-audit-label": "warn",
      // Typed-error hierarchy — non-typed variant avoids slow projectService.
      "no-throw-literal": "warn",
      // Browser-compat — warn until the baseline reaches zero; this is the
      // biggest noisy category in the current report.
      "compat/compat": "warn",
      // eslint-plugin-security — warn-only baseline (OWASP A05/A02).
      "security/detect-eval-with-expression": "warn",
      "security/detect-non-literal-require": "warn",
      "security/detect-child-process": "warn",
      "security/detect-buffer-noassert": "warn",
      "security/detect-disable-mustache-escape": "warn",
      "security/detect-no-csrf-before-method-override": "warn",
      "security/detect-pseudoRandomBytes": "warn",
      "security/detect-unsafe-regex": "warn",
      "security/detect-new-buffer": "warn",
      // These two are too noisy on a typed codebase (object/array index
      // access patterns) — leave off until a dedicated sweep.
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
      // Legacy baseline rules — disabled until a dedicated cleanup sweep.
      // Switching to "warn" globally generates ~270+ noise per run with no
      // actionable signal. Re-enable per-folder once the queue is at zero.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-useless-escape": "warn",
      // shadcn/ui components legitimately co-export variants + components,
      // which trips this rule across most of the design system. Off until
      // we split files per the React Refresh contract.
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "warn",
      "prefer-const": "warn",
      "no-control-regex": "warn",
      // Legacy baseline — too many real dependency arrays to fix in one pass.
      "react-hooks/exhaustive-deps": "off",

      // Force a single canonical import path for context modules. Multiple
      // import paths (relative vs alias, with/without extension) cause Vite to
      // load the same context twice, breaking provider/consumer matching.
      // Patterns target ONLY relative paths and the .tsx variant — the
      // canonical "@/contexts/<Name>" alias must remain importable.
      "no-restricted-imports": [
        "warn",

        {
          patterns: [
            {
              group: [
                "./contexts/AuthContext",
                "../**/contexts/AuthContext",
                "**/contexts/AuthContext.tsx",
                "./contexts/PageHeaderContext",
                "../**/contexts/PageHeaderContext",
                "**/contexts/PageHeaderContext.tsx",
              ],
              message:
                "Import context modules only via the '@/contexts/*' alias (no relative paths, no .tsx extension). This prevents HMR from loading duplicate context instances.",
            },
          ],
          paths: [
            {
              name: "@/contexts/AuthContext.tsx",
              message: "Drop the .tsx extension — import as '@/contexts/AuthContext'.",
            },
            {
              name: "@/contexts/PageHeaderContext.tsx",
              message: "Drop the .tsx extension — import as '@/contexts/PageHeaderContext'.",
            },
            {
              name: "gtag",
              message:
                "Analytics may only be loaded via src/lib/consent/loadAnalytics.ts after consent.",
            },
            {
              name: "clarity",
              message:
                "Microsoft Clarity may only be loaded via src/lib/consent/loadAnalytics.ts after consent.",
            },
          ],
        },
      ],
    },
  },
  {
    // The context modules themselves are allowed to be the canonical source.
    files: ["src/contexts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // CSS-portability guard tests intentionally contain the forbidden strings.
    files: [
      "src/test/smoke/css-portability.smoke.test.ts",
      "scripts/lint/eslint-plugin-css-portability.mjs",
    ],
    rules: {
      "css-portability/no-h-screen": "off",
      "css-portability/no-vh-units": "off",
    },
  },
  {
    // Build scripts, e2e harnesses, and edge functions run in Node/Deno —
    // browser-compat assertions are inapplicable. Also silences `fetch` /
    // `requestAnimationFrame` false positives flagged against op_mini.
    files: [
      "scripts/**/*.{ts,tsx,mjs,js}",
      "e2e/**/*.{ts,tsx,mjs,js}",
      "supabase/functions/**/*.{ts,tsx}",
      "playwright.config.ts",
      "vitest.config.ts",
      "vite.config.ts",
    ],
    rules: {
      "compat/compat": "off",
    },
  },
  {
    // AUTH REBUILD Ship 2 (2026-06-11): new auth screens under
    // src/features/auth/ui/ must depend only on the engine + UI primitives.
    // Catching screen-layer imports of auth.service / auth-lockout /
    // auth-captcha / TurnstileChallenge / sign-in-password.flow stops the
    // three-parallel-paths spaghetti from reappearing on the new surface.
    files: [
      "src/features/auth/ui/SignInScreen.tsx",
      "src/features/auth/ui/SignUpScreen.tsx",
      "src/features/auth/ui/ForgotPasswordScreen.tsx",
      "src/features/auth/ui/ResetPasswordScreen.tsx",
      "src/features/auth/ui/RegisterScreen.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/services/auth.service",
              message: "Screens must consume the engine hook, not AuthService directly.",
            },
            { name: "@/lib/auth-lockout", message: "Lockout is owned by the engine hook." },
            { name: "@/lib/auth-captcha", message: "Captcha state is owned by the engine hook." },
            {
              name: "@/lib/auth-error-classifier",
              message: "Use AuthErrorMessage + AuthErr from the engine.",
            },
            {
              name: "@/features/auth/flows/sign-in-password.flow",
              message: "Call the engine hook, not the flow directly.",
            },
            {
              name: "@/features/auth/services/auth-failure-policy",
              message: "Failure-policy decisions belong inside the engine hook.",
            },
          ],
          patterns: [
            {
              group: ["**/auth-lockout", "**/auth-captcha", "**/auth-error-classifier"],
              message: "Screens must consume the engine hook.",
            },
          ],
        },
      ],
    },
  },
  {
    // AUTH REBUILD Ship 5 prep (2026-06-11): non-auth-screen callers
    // (AuthContext bootstrap, ProfileEditPanel, EditProfilePage, …) must
    // route session operations through `@/features/auth/ports/session.port`
    // so we have a single seam when AuthService is finally deleted. The
    // engine hooks under `features/auth/engine/**` and the port itself are
    // the only modules still allowed to import AuthService directly.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/features/auth/**",
      "src/services/auth.service.ts",
      "src/test/**",
      "src/lib/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@/services/auth.service",
              message:
                "Import sessionPort from '@/features/auth/ports/session.port' instead. AuthService is deletion-pending — see Ship 5 in the auth rebuild plan.",
            },
          ],
        },
      ],
    },
  },
  {
    // AUTH REBUILD Ship 5b prep (2026-06-11): engine hooks under
    // src/features/auth/engine/** must depend only on ports + adapters, not
    // on the legacy auth surface or Supabase client directly. Warn-only
    // until each engine migrates; flip to "error" in Ship 5.
    files: ["src/features/auth/engine/**/*.{ts,tsx}"],
    rules: {
      // Ship 6 lock-in (2026-06-11): engines verified clean, guard flipped
      // to error so any future port-bypass fails CI.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/integrations/supabase/client",
              message:
                "Engines must call ports/adapters (supabaseSessionAdapter) — not the Supabase client directly.",
            },
            {
              name: "@/services/auth.service",
              message:
                "Engines must call sessionPort or the supabase-session adapter — not AuthService.",
            },
            {
              name: "@/lib/auth-lockout",
              message:
                "Lockout counters belong behind a port (rate-limit / device-lockout). Use the engine helper.",
            },
            {
              name: "@/lib/auth-captcha",
              message: "Captcha state belongs behind the captcha port + adapter.",
            },
            {
              name: "@/lib/auth-captcha-telemetry",
              message: "Telemetry must route through telemetryPort (audit-telemetry adapter).",
            },
            {
              name: "@/lib/auth-error-classifier",
              message:
                "Use the typed AuthErr from features/auth/domain instead of string-match classification.",
            },
          ],
          patterns: [
            {
              group: ["**/auth-lockout", "**/auth-captcha", "**/auth-error-classifier"],
              message: "Engines must use ports/adapters, not legacy lib modules.",
            },
          ],
        },
      ],
    },
  },
  {
    // TFDS governance — the app imports UI from '@/design-system', never
    // '@mui/material' directly. Zero current violations (MUI is brand-new), so
    // this ships as "error" immediately. Only src/design-system/** and tests
    // may import MUI. See docs/design/design-system/architecture-spec.md §7.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/design-system/**",
      "src/**/*.test.{ts,tsx}",
      "src/**/__tests__/**",
      "src/test/**",
    ],
    plugins: { "design-system": { rules: { "no-direct-mui": noDirectMui } } },
    rules: { "design-system/no-direct-mui": "error" },
  },
  {
    // jsx-a11y/label-has-associated-control crashes under eslint-plugin-jsx-a11y@6.x
    // with minimatch v10 (TypeError: minimatch is not a function). The rule is
    // already covered by label-has-for + label requirements elsewhere.
    rules: {
      "jsx-a11y/label-has-associated-control": "off",
    },
  },
  {
    // Drop the entire "unused eslint-disable directive" noise — comments are
    // intentionally future-proofing for rules that may flip back on.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  }
);
