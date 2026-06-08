/**
 * ESLint rule: no-rpc-then-catch
 *
 * Forbids `.catch(...)` chained directly off `supabase.rpc(...)` (and on the
 * `safeRpc` helper). Supabase's `.rpc()` returns a *PostgrestFilterBuilder*,
 * which is awaitable but does NOT expose `.catch` until awaited — calling
 * `.catch()` on it throws `TypeError: supabase.rpc(...).catch is not a function`.
 *
 * This was the 2026-06-05 root cause of 18 `email_failed` audit_log rows.
 * Wrap the call in `try { await supabase.rpc(...) } catch {}` (or
 * `safeRpc(...)`) instead.
 *
 * Escape hatch: `// rpc-catch-ok: <reason>` on the same line.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid .catch() chained off supabase.rpc() / safeRpc() — wrap in try/await/catch.",
    },
    schema: [],
    messages: {
      forbidden:
        ".rpc(...).catch(...) throws 'catch is not a function' at runtime — the builder isn't a Promise until awaited. Use try { await supabase.rpc(...) } catch {} or safeRpc().",
    },
  },
  create(context) {
    const isRpcCall = (node) =>
      node?.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      (node.callee.property?.name === "rpc" ||
        node.callee.property?.name === "safeRpc");

    const isSafeRpcIdentifier = (node) =>
      node?.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "safeRpc";

    return {
      CallExpression(node) {
        // Match `<x>.catch(...)` where the callee is the result of `.rpc(...)` or `safeRpc(...)`.
        if (
          node.callee?.type !== "MemberExpression" ||
          node.callee.property?.name !== "catch"
        )
          return;
        const recv = node.callee.object;
        if (!recv) return;
        if (!isRpcCall(recv) && !isSafeRpcIdentifier(recv)) return;

        const line = node.loc.start.line;
        const optedOut = context
          .getSourceCode()
          .getAllComments()
          .some(
            (c) => c.loc.start.line === line && /rpc-catch-ok:/.test(c.value),
          );
        if (optedOut) return;

        context.report({ node, messageId: "forbidden" });
      },
    };
  },
};
