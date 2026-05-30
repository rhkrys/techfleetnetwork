/**
 * ESLint rule: no-raw-functions-invoke
 *
 * Forbids `supabase.functions.invoke(...)` outside the unified `invokeEdge`
 * wrapper. The wrapper provides:
 *   - AbortController timeout (default 8s)
 *   - Single transparent retry on FunctionsFetchError
 *   - Typed `EdgeInvokeError` throws
 *   - Structural-classifier-gated reporting
 *
 * Phase-2 triage refactor: removes the per-call try/catch boilerplate that
 * historically forwarded every transient blip into agent_fix_queue.
 */
const ALLOWED_FILES = [
  "src/lib/edge/invokeEdge.ts",
  "src/integrations/supabase/audited-invoke.ts",
];

export default {
  meta: {
    type: "problem",
    docs: { description: "Use invokeEdge() instead of supabase.functions.invoke." },
    schema: [],
    messages: {
      forbidden:
        "Use invokeEdge() from '@/lib/edge/invokeEdge' instead of supabase.functions.invoke().",
    },
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, "/");
    if (ALLOWED_FILES.some((f) => filename.endsWith(f))) return {};
    return {
      MemberExpression(node) {
        if (
          node.property?.name === "invoke" &&
          node.object?.type === "MemberExpression" &&
          node.object.property?.name === "functions"
        ) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
};
