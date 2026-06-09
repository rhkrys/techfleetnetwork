// ESLint plugin: auth-invariants
//
// Enforces the single-source-of-truth contract for the new
// `src/features/auth/**` module. Six rules collectively prevent the
// regression classes described in §17 of the rebuild plan:
//   - no-bare-password-set-input
//   - no-raw-password-update
//   - no-direct-supabase-auth   (NEW — Vichea class)
//   - no-direct-failure-counters (NEW — counter inflation class)
//   - no-auth-storage-literals  (NEW — storage drift class)
//   - no-auth-booleans-in-ui    (NEW — state-machine bypass class)

const PASSWORD_SET_COMPONENT = "src/components/auth/PasswordSetFields.tsx";
const AUTH_SERVICE_LEGACY = "src/services/auth.service.ts";
const AUTH_FEATURE_PREFIX = "src/features/auth/";
const AUTO_CLIENT = "src/integrations/supabase/client.ts";

const FORBIDDEN_COUNTER_NAMES = new Set([
  "record_failed_login",
  "recordInvalidAuthAttempt",
  "recordFailedLoginAttempt",
  "recordFailure",
]);

const FORBIDDEN_STORAGE_KEYS = new Set([
  "tfn:reset-attempts",
  "tfn:login-lockout",
  "tfn:auth-strikes",
  "tfn:device-id",
  "supabase.auth.token",
]);

const FORBIDDEN_UI_BOOLEAN_NAMES = new Set([
  "isLoading",
  "isSubmitting",
  "needsCaptcha",
  "needsMfa",
  "isSettingSession",
]);

function normalisedFilename(context) {
  return context.getFilename().replace(/\\/g, "/");
}
function fileEndsWith(context, suffix) {
  return normalisedFilename(context).endsWith(suffix);
}
function fileInAuthFeature(context) {
  return normalisedFilename(context).includes(AUTH_FEATURE_PREFIX);
}
function literalAttrValue(attr) {
  const value = attr?.value;
  if (!value) return "";
  if (value.type === "Literal") return String(value.value ?? "");
  if (value.type === "JSXExpressionContainer" && value.expression.type === "Literal") return String(value.expression.value ?? "");
  return "";
}

const noBarePasswordSetInput = {
  meta: { type: "problem", docs: { description: "Credential setup must use PasswordSetFields." }, schema: [], messages: { forbidden: "New-password inputs must be rendered by <PasswordSetFields /> so confirmation and validation cannot be skipped." } },
  create(context) {
    if (fileEndsWith(context, PASSWORD_SET_COMPONENT)) return {};
    // The rebuilt feature-module forms (SignUpForm / ResetPasswordForm) own
    // their own confirm-password field and are exempt.
    if (fileInAuthFeature(context)) return {};
    return {
      JSXOpeningElement(node) {
        const tag = node.name?.type === "JSXIdentifier" ? node.name.name : "";
        if (tag !== "Input" && tag !== "input") return;
        const hasNewPasswordAutocomplete = node.attributes.some((attr) => attr.type === "JSXAttribute" && attr.name?.name === "autoComplete" && literalAttrValue(attr) === "new-password");
        if (hasNewPasswordAutocomplete) context.report({ node, messageId: "forbidden" });
      },
    };
  },
};

const noRawPasswordUpdate = {
  meta: { type: "problem", docs: { description: "Password updates must go through AuthService.updatePassword." }, schema: [], messages: { forbidden: "Do not call auth.updateUser({ password }) directly; use AuthService.updatePassword with password confirmation." } },
  create(context) {
    if (fileEndsWith(context, AUTH_SERVICE_LEGACY)) return {};
    if (fileInAuthFeature(context)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression" || callee.property?.name !== "updateUser") return;
        const first = node.arguments?.[0];
        if (first?.type !== "ObjectExpression") return;
        const hasPassword = first.properties.some((prop) => prop.type === "Property" && prop.key?.type === "Identifier" && prop.key.name === "password");
        if (hasPassword) context.report({ node, messageId: "forbidden" });
      },
    };
  },
};

// Bans `supabase.auth.<anything>` and `lovable.auth.<anything>` outside the
// feature module + legacy auth-service shim + the auto-generated client.
const noDirectSupabaseAuth = {
  meta: { type: "problem", docs: { description: "Only src/features/auth/** may call supabase.auth / lovable.auth." }, schema: [], messages: { forbidden: "Direct {{root}}.auth.{{prop}}() call. Route through src/features/auth (flows or services)." } },
  create(context) {
    if (fileInAuthFeature(context)) return {};
    if (fileEndsWith(context, AUTH_SERVICE_LEGACY)) return {}; // legacy shim
    if (fileEndsWith(context, AUTO_CLIENT)) return {};
    return {
      MemberExpression(node) {
        // Match `X.auth.Y` where X is `supabase` or `lovable`.
        if (node.object?.type !== "MemberExpression") return;
        const root = node.object.object;
        const mid = node.object.property;
        if (root?.type !== "Identifier") return;
        if ((root.name !== "supabase" && root.name !== "lovable")) return;
        if (mid?.type !== "Identifier" || mid.name !== "auth") return;
        const prop = node.property?.name ?? "<computed>";
        context.report({ node, messageId: "forbidden", data: { root: root.name, prop } });
      },
    };
  },
};

const FAILURE_POLICY_FILE = "src/features/auth/services/auth-failure-policy.ts";

const noDirectFailureCounters = {
  meta: { type: "problem", docs: { description: "Auth failure counters must only fire from auth-failure-policy.ts." }, schema: [], messages: { forbidden: "Counter '{{name}}' may only be invoked from auth-failure-policy.ts." } },
  create(context) {
    if (fileEndsWith(context, FAILURE_POLICY_FILE)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        let name = null;
        if (callee?.type === "Identifier") name = callee.name;
        else if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") name = callee.property.name;
        if (!name || !FORBIDDEN_COUNTER_NAMES.has(name)) return;
        context.report({ node, messageId: "forbidden", data: { name } });
      },
    };
  },
};

const STORAGE_KEYS_FILE = "src/features/auth/domain/auth-storage-keys.ts";

const noAuthStorageLiterals = {
  meta: { type: "problem", docs: { description: "Auth storage-key literals must live in auth-storage-keys.ts." }, schema: [], messages: { forbidden: "Hard-coded auth storage key '{{key}}'. Import it from auth-storage-keys.ts." } },
  create(context) {
    if (fileEndsWith(context, STORAGE_KEYS_FILE)) return {};
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!FORBIDDEN_STORAGE_KEYS.has(node.value)) return;
        context.report({ node, messageId: "forbidden", data: { key: node.value } });
      },
    };
  },
};

const noAuthBooleansInUi = {
  meta: { type: "problem", docs: { description: "UI components must render off state.value, not boolean flags." }, schema: [], messages: { forbidden: "Boolean state '{{name}}' is forbidden in src/features/auth/ui/**. Render off the XState machine instead." } },
  create(context) {
    const fname = normalisedFilename(context);
    if (!fname.includes("src/features/auth/ui/")) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "Identifier" || callee.name !== "useState") return;
        // Find the parent VariableDeclarator to read the destructured name.
        let parent = node.parent;
        while (parent && parent.type !== "VariableDeclarator") parent = parent.parent;
        if (!parent || parent.id?.type !== "ArrayPattern") return;
        const first = parent.id.elements?.[0];
        if (first?.type !== "Identifier") return;
        if (!FORBIDDEN_UI_BOOLEAN_NAMES.has(first.name)) return;
        context.report({ node, messageId: "forbidden", data: { name: first.name } });
      },
    };
  },
};

export default {
  rules: {
    "no-bare-password-set-input": noBarePasswordSetInput,
    "no-raw-password-update": noRawPasswordUpdate,
    "no-direct-supabase-auth": noDirectSupabaseAuth,
    "no-direct-failure-counters": noDirectFailureCounters,
    "no-auth-storage-literals": noAuthStorageLiterals,
    "no-auth-booleans-in-ui": noAuthBooleansInUi,
  },
};
