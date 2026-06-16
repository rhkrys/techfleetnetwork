/**
 * eslint-plugin-no-focus-listener
 *
 * NO-RELOAD-TAB-001 / NO-RELOAD-TAB-002 (2026-06-16). Forbids
 * `addEventListener("focus" | "visibilitychange" | "pageshow", …)` in any
 * file under `src/components/**` or `src/pages/**` UNLESS the line directly
 * above the call carries an inline justification:
 *
 *   // reason: tab-switch-safe — <why this listener cannot cause reload/nav>
 *
 * Root cause: a global focus listener that performs a `getSession()` round-trip
 * (MfaEnforcementGuard pre-fix) can `window.location.replace("/login")` on a
 * transient null and destroy the admin's place on long-lived grids like
 * /admin/activity-log. This rule keeps the bug class out for good.
 *
 * Allowed without marker:
 *   - any file under `src/hooks/**`, `src/lib/**`, `src/contexts/**`,
 *     `src/features/**` (these are reviewed centrally and already audited)
 *   - any file under `src/test/**` or `e2e/**`
 */

const FORBIDDEN_EVENTS = new Set(["focus", "visibilitychange", "pageshow"]);
const ENFORCED_PATH_RE = /\/src\/(components|pages)\//;
const MARKER_RE = /reason:\s*tab-switch-safe/i;

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid focus/visibilitychange/pageshow listeners in components & pages without an inline 'reason: tab-switch-safe' justification.",
    },
    schema: [],
    messages: {
      noFocusListener:
        "Adding a '{{event}}' listener in src/components or src/pages can re-trigger reloads/redirects on tab return (see NO-RELOAD-TAB-002). If this listener is provably safe, prefix the line with `// reason: tab-switch-safe — <justification>`.",
    },
  },
  create(context) {
    const filename = (context.getFilename() || "").replace(/\\/g, "/");
    if (!ENFORCED_PATH_RE.test(filename)) return {};

    const sourceCode = context.getSourceCode();

    function hasMarkerAbove(node) {
      const comments = sourceCode.getCommentsBefore(node);
      return comments.some((c) => MARKER_RE.test(c.value));
    }

    function isMatch(node) {
      const callee = node.callee;
      // window.addEventListener / document.addEventListener
      if (
        callee.type !== "MemberExpression" ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "addEventListener"
      ) {
        return null;
      }
      const obj = callee.object;
      if (obj.type !== "Identifier" || (obj.name !== "window" && obj.name !== "document")) {
        return null;
      }
      const first = node.arguments[0];
      if (!first || first.type !== "Literal" || typeof first.value !== "string") return null;
      if (!FORBIDDEN_EVENTS.has(first.value)) return null;
      return first.value;
    }

    return {
      CallExpression(node) {
        const event = isMatch(node);
        if (!event) return;
        if (hasMarkerAbove(node) || hasMarkerAbove(node.parent ?? node)) return;
        context.report({ node, messageId: "noFocusListener", data: { event } });
      },
    };
  },
};

export default {
  rules: {
    "no-focus-listener": rule,
  },
};
