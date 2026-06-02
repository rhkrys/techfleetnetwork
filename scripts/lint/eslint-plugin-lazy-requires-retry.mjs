/**
 * Custom ESLint plugin: forbids raw `React.lazy(...)` / `lazy(...)` imported
 * from "react" outside the shared `src/lib/lazy-with-retry.ts` wrapper.
 *
 * Part 1 §1.5 — chunk-load brick sessions. `lazyWithRetry` retries dynamic
 * imports up to 3× before surfacing `<UpdateAvailableBanner/>` instead of
 * white-screening on a stale chunk after a deploy.
 *
 * Allowed files:
 *   - src/lib/lazy-with-retry.ts          (the wrapper itself)
 *   - src/lib/lazyWithRetry.ts            (alternate filename)
 *   - src/integrations/supabase/types.ts  (generated schema; no React)
 */

const ALLOWED = [
  "src/lib/lazy-with-retry.ts",
  "src/lib/lazyWithRetry.ts",
];

function isAllowed(filename) {
  const norm = filename.replace(/\\/g, "/");
  return ALLOWED.some((p) => norm.endsWith(p));
}

/** Detects `import { lazy } from "react"` so we can flag bare `lazy(...)` calls. */
function collectReactLazyLocalNames(programNode) {
  const names = new Set();
  for (const node of programNode.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (node.source.value !== "react") continue;
    for (const spec of node.specifiers) {
      if (
        spec.type === "ImportSpecifier" &&
        spec.imported &&
        spec.imported.name === "lazy"
      ) {
        names.add(spec.local.name);
      }
    }
  }
  return names;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid React.lazy / lazy() outside src/lib/lazy-with-retry.ts. Use lazyWithRetry so chunk-load failures fall back to <UpdateAvailableBanner/> instead of white-screening.",
    },
    schema: [],
    messages: {
      noReactLazy:
        'Use `lazyWithRetry` from "@/lib/lazy-with-retry" instead of React.lazy — bare React.lazy white-screens on chunk-load failures after a deploy.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowed(filename)) return {};

    let reactLazyLocals = new Set();

    return {
      Program(node) {
        reactLazyLocals = collectReactLazyLocalNames(node);
      },
      CallExpression(node) {
        const callee = node.callee;
        // React.lazy(...)
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "React" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "lazy"
        ) {
          context.report({ node: callee, messageId: "noReactLazy" });
          return;
        }
        // Bare lazy(...) where `lazy` came from "react"
        if (
          callee.type === "Identifier" &&
          reactLazyLocals.has(callee.name)
        ) {
          context.report({ node: callee, messageId: "noReactLazy" });
        }
      },
    };
  },
};

export default {
  rules: {
    "requires-retry": rule,
  },
};
