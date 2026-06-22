/**
 * eslint-plugin-oauth-canonical-origin
 *
 * AUTH-OAUTH-APEX-CANONICAL-001 (2026-06-22). Forbids raw
 * `window.location.origin` in OAuth initiation sites — they must route
 * through `getCanonicalOAuthOrigin()` so the apex `techfleet.network`
 * never reaches the broker (which rejects it with
 * `failed to sign in with vendor`).
 */

const ENFORCED_FILES = new Set([
  "src/components/GoogleSignInButton.tsx",
]);

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw window.location.origin in OAuth initiation sites; use getCanonicalOAuthOrigin() from @/lib/auth/oauth-origin.",
    },
    schema: [],
    messages: {
      noRawOrigin:
        "Use getCanonicalOAuthOrigin() from '@/lib/auth/oauth-origin' instead of window.location.origin in OAuth initiation. Raw origin sends the apex techfleet.network host to the broker which fails with 'failed to sign in with vendor'.",
    },
  },
  create(context) {
    const filename = (context.getFilename() || "").replace(/\\/g, "/");
    const matches = [...ENFORCED_FILES].some((f) => filename.endsWith(f));
    if (!matches) return {};

    return {
      MemberExpression(node) {
        // window.location.origin
        if (
          node.object?.type === "MemberExpression" &&
          node.object.object?.type === "Identifier" &&
          node.object.object.name === "window" &&
          node.object.property?.type === "Identifier" &&
          node.object.property.name === "location" &&
          node.property?.type === "Identifier" &&
          node.property.name === "origin"
        ) {
          context.report({ node, messageId: "noRawOrigin" });
        }
      },
    };
  },
};

export default {
  rules: {
    "oauth-canonical-origin": rule,
  },
};
