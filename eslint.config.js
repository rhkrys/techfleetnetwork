import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import compat from "eslint-plugin-compat";
import brandTerms from "./scripts/lint/eslint-plugin-brand-terms.mjs";
import cssPortability from "./scripts/lint/eslint-plugin-css-portability.mjs";
import noRawDiscordInput from "./scripts/lint/eslint-plugin-no-raw-discord-input.mjs";
import noDirectErrorReporter from "./scripts/lint/eslint-plugin-no-direct-error-reporter.mjs";
import noRawFunctionsInvoke from "./scripts/lint/eslint-plugin-no-raw-functions-invoke.mjs";
import noSupabaseSingle from "./scripts/lint/eslint-plugin-no-supabase-single.mjs";

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
      // Browser-compat — fails on JS APIs unsupported in our `browserslist`
      // (package.json: iOS >=14.5, Safari >=14.1, Firefox ESR, last 2 versions).
      compat,
      // WCAG 2.1/2.2 + EN 301 549 — static a11y enforcement on every PR.
      // Recommended set covers labels, alt text, ARIA roles/props, and
      // keyboard interactivity. Surfaced violations downgraded to "warn"
      // initially so the existing baseline doesn't break CI; tighten to
      // "error" once the warning queue is at zero.
      "jsx-a11y": jsxA11y,
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
      // Typed-error hierarchy — non-typed variant avoids slow projectService.
      "no-throw-literal": "warn",
      // Browser-compat — warn until the baseline reaches zero; this is the
      // biggest noisy category in the current report.
      "compat/compat": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-useless-escape": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",

      // Force a single canonical import path for context modules. Multiple
      // import paths (relative vs alias, with/without extension) cause Vite to
      // load the same context twice, breaking provider/consumer matching.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/contexts/AuthContext",
                "**/contexts/AuthContext.tsx",
                "**/contexts/PageHeaderContext",
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
);
