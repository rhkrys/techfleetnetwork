/**
 * ESLint plugin: forbid fetches/imports of content that now lives in the database.
 *
 * Source of truth: `mem://tech/data/db-first-content`.
 * - Policies → `policy_versions` (via `usePolicy` + `get_current_policy` RPC)
 * - Framework CSVs → `reference_*` tables (ingest via `framework-csv-fetch` edge fn)
 * - i18n bundles → `i18n_strings` / `i18n_translations` (planned: get-i18n-bundle edge fn)
 *
 * Any new `/policies/*.md`, `/data/*.csv`, or `/locales/*.json` fetch reintroduces
 * the drift this refactor closed. Block at lint time.
 */

const FORBIDDEN_FETCH_RE = /^\s*\/?(policies|data|locales)\//;
const FORBIDDEN_IMPORT_RE = /\.(csv|md)$|\/locales\/.+\.json$/;

export default {
  rules: {
    "no-public-content": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Forbid fetches of /policies, /data, /locales and imports of .csv/.md/locale .json — content is DB-first.",
        },
        schema: [],
        messages: {
          forbiddenFetch:
            "Do not fetch '{{path}}'. Policies → usePolicy(), CSVs → ingest via framework-csv-fetch, locales → i18next backend.",
          forbiddenImport:
            "Do not import '{{path}}' from src/. Content lives in the database (policy_versions / reference_* / i18n_strings).",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type === "Identifier" &&
              node.callee.name === "fetch" &&
              node.arguments[0]?.type === "Literal" &&
              typeof node.arguments[0].value === "string"
            ) {
              const v = node.arguments[0].value;
              if (FORBIDDEN_FETCH_RE.test(v)) {
                context.report({ node, messageId: "forbiddenFetch", data: { path: v } });
              }
            }
          },
          ImportDeclaration(node) {
            const src = node.source.value;
            if (typeof src === "string" && FORBIDDEN_IMPORT_RE.test(src)) {
              context.report({ node, messageId: "forbiddenImport", data: { path: src } });
            }
          },
        };
      },
    },
  },
};
