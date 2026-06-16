/**
 * eslint-plugin-auth-bootstrap-no-refresh
 *
 * AUTH-WEDGE-013..015 (2026-06-16). Forbids any call that matches
 * `<supabase|sessionPort|*auth>.refreshSession()` inside `src/contexts/AuthContext.tsx`.
 *
 * Root cause: bootstrap firing `refreshSession()` on the first transient
 * `bad_jwt` from `getUser()` inherited the same GoTrue hiccup, was classified
 * unrecoverable, and purged a healthy session in one round-trip — bypassing
 * the two-strike protection and bouncing Google logins to /. The fix is to
 * trust the stored session on first strike and let the SDK auto-refresh +
 * fetch-guard recover. This rule keeps the bug class out.
 */

const FILE_RE = /\/src\/contexts\/AuthContext\.tsx$/;

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid refreshSession() calls inside src/contexts/AuthContext.tsx — bootstrap must trust the stored session on first transient bad_jwt (AUTH-WEDGE-013..015).",
    },
    schema: [],
    messages: {
      noRefresh:
        "Do not call refreshSession() from AuthContext. On a transient bad_jwt, refresh inherits the same flapping backend and bypasses the two-strike protection (AUTH-WEDGE-013..015). Trust the stored session; the SDK auto-refresh + fetch-guard handle real corruption.",
    },
  },
  create(context) {
    const filename = (context.getFilename() || "").replace(/\\/g, "/");
    if (!FILE_RE.test(filename)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.property.type !== "Identifier") return;
        if (callee.property.name !== "refreshSession") return;
        context.report({ node, messageId: "noRefresh" });
      },
    };
  },
};

export default {
  rules: {
    "no-refresh-session": rule,
  },
};
