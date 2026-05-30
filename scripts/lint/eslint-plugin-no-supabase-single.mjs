/**
 * ESLint rule: no-supabase-single
 *
 * Forbids `.single()` on Postgrest query builders — the PGRST116 throw was
 * the #1 source of agent_fix_queue noise in May 2026. Use one of:
 *
 *     await maybeOne(builder, "source")       // T | null
 *     await requireOne(builder, "User", "source") // T or NotFoundError
 *
 * (from `@/lib/db/safeSelect`).
 *
 * Escape hatch: a sibling line comment `// single-required: <reason>` on the
 * call line opts the call out (use only when a separate constraint guarantees
 * a row exists, e.g. immediately after `.insert(...).select()`).
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid .single() — use maybeOne/requireOne from @/lib/db/safeSelect or annotate with // single-required:",
    },
    schema: [],
    messages: {
      forbidden:
        ".single() throws PGRST116 on missing rows. Use maybeOne()/requireOne() from '@/lib/db/safeSelect', or add a '// single-required: <reason>' line comment.",
    },
  },
  create(context) {
    const sourceCode = context.getSourceCode();
    return {
      CallExpression(node) {
        if (
          node.callee?.type !== "MemberExpression" ||
          node.callee.property?.name !== "single" ||
          node.arguments.length !== 0
        )
          return;
        // Check for opt-out comment on same line.
        const line = node.loc.start.line;
        const comments = sourceCode.getAllComments();
        const optedOut = comments.some(
          (c) => c.loc.start.line === line && /single-required:/.test(c.value),
        );
        if (optedOut) return;
        context.report({ node, messageId: "forbidden" });
      },
    };
  },
};
