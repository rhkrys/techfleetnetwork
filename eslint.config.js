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
        },
      },
      "auth-invariants": authInvariants,
      // Part 1 §1.5 — chunk-load brick + AuthProvider hoist invariants.
      lazy: lazyRequiresRetry,
      auth: useAuthRequiresProvider,
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
      ...reactHooks.configs.recommended.rules,
      // Baseline strategy: every project-wide rule starts at "warn" so a
      // legacy violation cannot brick CI. Promote individual rules to "error"
      // ONLY after the existing baseline is at zero. This keeps `npm run lint`
      // green while still surfacing every problem in the report output.
      ...Object.fromEntries(
        Object.keys(jsxA11y.configs.recommended.rules).map((k) => [k, "warn"])
      ),
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
      "auth-invariants/no-bare-password-set-input": "error",
      "auth-invariants/no-raw-password-update": "error",
      // Part 1 §1.5 — bare React.lazy white-screens on stale chunks after a
      // deploy; the wrapper retries 3× then surfaces <UpdateAvailableBanner/>.
      "lazy/requires-retry": "warn",
      // Part 1 §1.5 — useAuth() must live under <AuthProvider>; calls from
      // main.tsx or plain functions produce the "must be used within
      // AuthProvider" white-screen.
      "auth/use-auth-requires-provider": "error",
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
              message: "Analytics may only be loaded via src/lib/consent/loadAnalytics.ts after consent.",
            },
            {
              name: "clarity",
              message: "Microsoft Clarity may only be loaded via src/lib/consent/loadAnalytics.ts after consent.",
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
  },
);
