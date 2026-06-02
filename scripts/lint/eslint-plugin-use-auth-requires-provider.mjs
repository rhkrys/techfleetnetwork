/**
 * Custom ESLint plugin: any file calling `useAuth()` must live inside the
 * `<AuthProvider>` tree. We can't statically prove tree membership, but we
 * CAN forbid the two known anti-patterns that produced the 20 "useAuth must
 * be used within an AuthProvider" white-screens (Part 1 §1.5):
 *
 *   1. Calling `useAuth()` from a module-level (non-component, non-hook)
 *      function — its caller is unknown, so provider presence can't be
 *      guaranteed.
 *   2. Calling `useAuth()` inside `main.tsx` / the router shell file —
 *      those mount ABOVE the provider, so the hook is always undefined.
 *
 * Real React components (PascalCase) and custom hooks (use*) are allowed.
 *
 * Allowed files (the contract source):
 *   - src/contexts/AuthContext.tsx
 *   - src/integrations/supabase/types.ts
 */

const ALLOWED = [
  "src/contexts/AuthContext.tsx",
  "src/integrations/supabase/types.ts",
];

const FORBIDDEN_HOSTS = [
  "src/main.tsx",
  "src/main.ts",
];

function norm(filename) {
  return filename.replace(/\\/g, "/");
}

function isAllowed(filename) {
  const n = norm(filename);
  return ALLOWED.some((p) => n.endsWith(p));
}

function isForbiddenHost(filename) {
  const n = norm(filename);
  return FORBIDDEN_HOSTS.some((p) => n.endsWith(p));
}

/** PascalCase → React component. */
function isComponentName(name) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

/** `use*` (camelCase) → custom hook. */
function isHookName(name) {
  return /^use[A-Z0-9]/.test(name);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "useAuth() must be called from a component or hook that lives under <AuthProvider>. Forbid calls from main.tsx or non-component functions, which white-screen with 'useAuth must be used within an AuthProvider'.",
    },
    schema: [],
    messages: {
      forbiddenHost:
        "useAuth() must not be called from {{file}} — this file mounts ABOVE <AuthProvider>. Move the call into a component rendered by the router.",
      notInComponent:
        "useAuth() must be called from a React component (PascalCase) or a custom hook (use*). Calls from plain functions can't guarantee they run inside <AuthProvider>.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowed(filename)) return {};

    const forbiddenHost = isForbiddenHost(filename);

    function findEnclosingFunctionName(node) {
      let cur = node.parent;
      while (cur) {
        if (
          cur.type === "FunctionDeclaration" ||
          cur.type === "FunctionExpression" ||
          cur.type === "ArrowFunctionExpression"
        ) {
          // FunctionDeclaration → id.name
          if (cur.id && cur.id.name) return cur.id.name;
          // const Foo = () => {} / const useFoo = () => {}
          if (
            cur.parent &&
            cur.parent.type === "VariableDeclarator" &&
            cur.parent.id.type === "Identifier"
          ) {
            return cur.parent.id.name;
          }
          // export default function () {} → unnamed; treat as anonymous
          return null;
        }
        cur = cur.parent;
      }
      return null;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          !(callee.type === "Identifier" && callee.name === "useAuth")
        ) {
          return;
        }

        if (forbiddenHost) {
          context.report({
            node: callee,
            messageId: "forbiddenHost",
            data: { file: norm(filename).split("/").slice(-1)[0] },
          });
          return;
        }

        const fnName = findEnclosingFunctionName(node);
        if (!fnName) {
          // anonymous function or module top-level — both unsafe
          context.report({ node: callee, messageId: "notInComponent" });
          return;
        }
        if (!isComponentName(fnName) && !isHookName(fnName)) {
          context.report({ node: callee, messageId: "notInComponent" });
        }
      },
    };
  },
};

export default {
  rules: {
    "use-auth-requires-provider": rule,
  },
};
