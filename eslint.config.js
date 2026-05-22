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
      // jsx-a11y recommended set: keep the broad coverage at "warn" so the
      // historical baseline doesn't tip the build over, but promote the
      // hardest, never-acceptable subset to "error" — these correspond to
      // WCAG 2.1.1 / 2.4.3 / 2.4.7 / 4.1.2 violations that always block.
      ...Object.fromEntries(
        Object.keys(jsxA11y.configs.recommended.rules).map((k) => [k, "warn"])
      ),
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/tabindex-no-positive": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/media-has-caption": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      // WCAG 1.1.1 Non-text Content — every <img> must carry alt (empty for
      // decorative). Brand Visual Guide v1 mandates purposeful alt copy.
      "jsx-a11y/alt-text": "error",
      // Brand voice: warn now, escalate to error after sweep is complete.
      "brand-terms/no-banned-terms": "warn",
      // CSS portability — these always block (memory: CSS-COMPAT-006).
      "css-portability/no-h-screen": "error",
      "css-portability/no-vh-units": "error",
      // Static browser-compat: block JS APIs that don't exist in the oldest
      // supported browser per `browserslist`. Tighten to "error" — the
      // matrix is conservative so violations are rare and always fixable.
      "compat/compat": "error",
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
