/**
 * ESLint rule: no-legacy-email-send
 *
 * Phase 6 of email subsystem v2 refactor — bans direct invokes of the legacy
 * email edge functions. All app code MUST route through the EnqueueEmail
 * use-case so the dispatcher's CircuitBreaker, FrequencyCap, SuppressionGate,
 * and idempotency engine apply uniformly.
 *
 * See mem://features/email-subsystem-v2.
 *
 * Allowed call sites: the shared shims (`supabase/functions/_shared/...`)
 * that wrap EnqueueEmail and the dispatcher itself.
 */
const FORBIDDEN_FUNCTIONS = new Set([
  "send-transactional-email",
  "send-announcement-email",
  "send-project-blast",
  "send-application-confirmation",
  "send-community-agreement-trigger",
  "send-magic-link",
]);

const ALLOWED_PATH_SUBSTRINGS = [
  "supabase/functions/_shared/email/",
  "supabase/functions/_shared/transactional-email.ts",
  "supabase/functions/email-dispatcher/",
  "scripts/",
  "src/test/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
];

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct invokes of legacy email edge functions; route through EnqueueEmail.",
    },
    schema: [],
    messages: {
      forbidden:
        "Direct invoke of legacy email function '{{name}}' is forbidden. Use the EnqueueEmail use-case (queueTransactionalEmail / queueAnnouncementEmail) so the v2 dispatcher's circuit breaker, suppression, and idempotency apply uniformly.",
    },
  },
  create(context) {
    const filename = context.getFilename().replace(/\\/g, "/");
    if (ALLOWED_PATH_SUBSTRINGS.some((s) => filename.includes(s))) return {};

    function reportIfForbidden(node, value) {
      if (typeof value !== "string") return;
      if (FORBIDDEN_FUNCTIONS.has(value)) {
        context.report({ node, messageId: "forbidden", data: { name: value } });
      }
    }

    return {
      CallExpression(node) {
        // Catches: invokeEdge("send-transactional-email", ...),
        //          supabase.functions.invoke("send-...", ...),
        //          auditedInvoke("send-...", ...)
        const callee = node.callee;
        const isInvokeLike =
          (callee?.type === "Identifier" &&
            /^(invokeEdge|auditedInvoke|edgeInvoke)$/.test(callee.name)) ||
          (callee?.type === "MemberExpression" &&
            callee.property?.name === "invoke");
        if (!isInvokeLike) return;
        const first = node.arguments?.[0];
        if (!first) return;
        if (first.type === "Literal") reportIfForbidden(first, first.value);
        if (first.type === "TemplateLiteral" && first.expressions.length === 0) {
          reportIfForbidden(first, first.quasis[0]?.value?.cooked);
        }
      },
    };
  },
};
