/**
 * ESLint rule: no-direct-error-reporter
 *
 * Forbids importing the internal `@/services/error-reporter.service` from
 * anywhere except the public surface (`@/lib/observability/report`) and the
 * reporter's own ErrorBoundary. All other callers must use:
 *
 *     import { report } from "@/lib/observability/report";
 *
 * Phase-2 triage refactor: ensures every report goes through the structural
 * classifier so offline/extension/hidden-tab errors are dropped at source.
 */
const ALLOWED_FILES = [
  "src/lib/observability/report.ts",
  "src/components/ErrorBoundary.tsx",
  "src/lib/edge/invokeEdge.ts",
  "src/integrations/supabase/audited-invoke.ts",
  "src/lib/supabase/safe-rpc.ts",
  "src/lib/lazy-with-retry.ts",
];

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct imports of error-reporter.service outside the unified observability surface.",
    },
    schema: [],
    messages: {
      forbidden:
        "Import { report } from '@/lib/observability/report' instead of touching error-reporter.service directly.",
    },
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, "/");
    if (ALLOWED_FILES.some((f) => filename.endsWith(f))) return {};
    return {
      ImportDeclaration(node) {
        const src = node.source.value;
        if (typeof src === "string" && /error-reporter\.service$/.test(src)) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
};
