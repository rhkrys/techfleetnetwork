/**
 * ESLint rule: services/no-raw-supabase-rpc
 *
 * Enforces that every `supabase.rpc(...)` and `supabase.from(...).<select|...>`
 * read inside `src/services/**` is wrapped by a transient-retry helper
 * (`withTransientRetry`, `retryPostgrest`, `retryTransientWrite`, or
 * `withAuthLockRetry`). Prevents another PostgREST PGRST002 / 503 schema-cache
 * reload from surfacing as a hard error toast to users.
 *
 * Escape hatch: a sibling line comment `// raw-supabase-ok: <reason>` on the
 * same line opts the call out (e.g. write paths intentionally non-retriable,
 * realtime channels, or storage uploads).
 *
 * BDD: INFRA-PGRST002-RETRY-001/002
 */
const RETRY_WRAPPERS = new Set([
  "withTransientRetry",
  "retryPostgrest",
  "retryTransientWrite",
  "retryTransient",
  "withAuthLockRetry",
]);

function isInsideRetryWrapper(node) {
  let cur = node.parent;
  while (cur) {
    if (cur.type === "CallExpression") {
      const callee = cur.callee;
      const name =
        callee?.type === "Identifier"
          ? callee.name
          : callee?.type === "MemberExpression"
            ? callee.property?.name
            : null;
      if (name && RETRY_WRAPPERS.has(name)) return true;
    }
    // Function/Arrow boundaries also fine if the function itself is invoked
    // by a retry wrapper — handled because we walk past them.
    cur = cur.parent;
  }
  return false;
}

function isSupabaseCallee(node) {
  // Match `supabase.rpc(...)` or `supabase.from(...)`, plus `sb.rpc/from`
  // aliases used in a few services. Be conservative: only the literal names.
  if (node.type !== "MemberExpression") return null;
  const propName = node.property?.name;
  if (propName !== "rpc" && propName !== "from") return null;
  const objName =
    node.object?.type === "Identifier" ? node.object.name : null;
  if (!objName) return null;
  if (objName === "supabase" || objName === "sb") return propName;
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw supabase.rpc/from in src/services/** outside a transient-retry wrapper.",
    },
    schema: [],
    messages: {
      unwrapped:
        "supabase.{{kind}}(...) in src/services/** must be wrapped by withTransientRetry/retryPostgrest/retryTransientWrite so PGRST002/503 schema-cache reloads don't surface as user-facing errors. Add the wrapper, or annotate with `// raw-supabase-ok: <reason>`.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (!/[\\/]src[\\/]services[\\/]/.test(filename)) return {};
    const sourceCode = context.getSourceCode();
    return {
      CallExpression(node) {
        const kind = isSupabaseCallee(node.callee);
        if (!kind) return;
        if (isInsideRetryWrapper(node)) return;
        const line = node.loc.start.line;
        const optedOut = sourceCode
          .getAllComments()
          .some(
            (c) =>
              c.loc.start.line === line && /raw-supabase-ok:/.test(c.value),
          );
        if (optedOut) return;
        context.report({ node, messageId: "unwrapped", data: { kind } });
      },
    };
  },
};
