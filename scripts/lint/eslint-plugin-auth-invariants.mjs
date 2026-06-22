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
const ENGINE_FAILURE_POLICY_FILE = "src/features/auth/engine/failure-policy.ts";

const noDirectFailureCounters = {
  meta: { type: "problem", docs: { description: "Auth failure counters must only fire from auth-failure-policy.ts." }, schema: [], messages: { forbidden: "Counter '{{name}}' may only be invoked from auth-failure-policy.ts." } },
  create(context) {
    if (fileEndsWith(context, FAILURE_POLICY_FILE)) return {};
    if (fileEndsWith(context, ENGINE_FAILURE_POLICY_FILE)) return {};
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

// AUTH-RESILIENCE-001..006 — bans the SESSION-MUTATING auth methods outside
// the canonical entrypoints. These are the calls that can kick a user out
// when the backend stutters: `signOut`, `setSession`, `updateUser`,
// `signInWithPassword`, `signInWithOAuth`, `refreshSession`. Read-only
// methods (`getSession`, `getUser`, `onAuthStateChange`, `mfa.*`) are
// covered by the warn-level `no-direct-supabase-auth` rule and migrated
// gradually through the session-port.
const SESSION_PORT_FILE = "src/lib/auth/session-port.ts";
const GOOGLE_BUTTON_FILE = "src/components/GoogleSignInButton.tsx";
const CACHED_SESSION_FILE = "src/lib/cached-session.ts";
const SESSION_HEALTH_FILE = "src/lib/auth/session-health.ts";
const AUTH_CONTEXT_FILE = "src/contexts/AuthContext.tsx";
// Legitimate MFA flows — these write a session AAL2 upgrade or reauth a
// password challenge before unenrolling TOTP. They are not "side doors";
// they are the canonical place those mutations happen.
const MFA_SERVICE_FILE = "src/services/mfa.service.ts";
const TOTP_MGMT_FILE = "src/components/TotpMfaManagement.tsx";
const FORBIDDEN_MUTATIONS = new Set([
  "signOut",
  "setSession",
  "signInWithPassword",
  "signInWithOAuth",
  "refreshSession",
]);


const noDirectAuthMutations = {
  meta: {
    type: "problem",
    docs: { description: "Session-mutating auth methods must route through src/lib/auth/session-port.ts or src/features/auth/**." },
    schema: [],
    messages: {
      forbidden:
        "Direct `{{root}}.auth.{{prop}}()` call. Route session mutations through `signOutSafe` / `src/features/auth/**` so backend hiccups can never bounce members to /login.",
    },
  },
  create(context) {
    if (fileInAuthFeature(context)) return {};
    if (fileEndsWith(context, AUTH_SERVICE_LEGACY)) return {};
    if (fileEndsWith(context, AUTO_CLIENT)) return {};
    // Generated Lovable Cloud auth SDK — the only place `lovable.auth.*`
    // raw mutations are implemented.
    if (normalisedFilename(context).includes("src/integrations/lovable/")) return {};
    if (fileEndsWith(context, SESSION_PORT_FILE)) return {};
    if (fileEndsWith(context, GOOGLE_BUTTON_FILE)) return {};
    if (fileEndsWith(context, CACHED_SESSION_FILE)) return {};
    if (fileEndsWith(context, SESSION_HEALTH_FILE)) return {};
    if (fileEndsWith(context, AUTH_CONTEXT_FILE)) return {};
    if (fileEndsWith(context, MFA_SERVICE_FILE)) return {};
    if (fileEndsWith(context, TOTP_MGMT_FILE)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression") return;
        const propName = callee.property?.type === "Identifier" ? callee.property.name : null;
        if (!propName || !FORBIDDEN_MUTATIONS.has(propName)) return;
        // callee.object must be `<root>.auth`
        const obj = callee.object;
        if (obj?.type !== "MemberExpression") return;
        if (obj.property?.type !== "Identifier" || obj.property.name !== "auth") return;
        const root = obj.object;
        if (root?.type !== "Identifier") return;
        if (root.name !== "supabase" && root.name !== "lovable") return;
        context.report({ node, messageId: "forbidden", data: { root: root.name, prop: propName } });
      },
    };
  },
};

// no-signup-string-match — once GoTrue's `email_exists` / `user_already_exists`
// codes are mapped in auth-classifier, English substring matching for duplicate
// accounts in auth flow files is a regression risk (localization, copy drift).
// Warn-only so the classifier's last-resort fallback can keep its substring
// guard, but new uses are discouraged.
const FORBIDDEN_DUP_SUBSTRINGS = [
  "already registered",
  "already been registered",
  "user already",
];
const noSignupStringMatch = {
  meta: {
    type: "suggestion",
    docs: { description: "Auth flows must detect duplicate accounts via server codes, not English substrings." },
    schema: [],
    messages: {
      forbidden: "Detect duplicate accounts via `classifyAuthErrorCode` (server `email_exists` / `user_already_exists` → `account_exists`), not message-string matching on \"{{needle}}\".",
    },
  },
  create(context) {
    const file = normalisedFilename(context);
    if (!file.includes("src/features/auth/flows/") && !file.includes("src/features/auth/services/")) return {};
    // Allow the classifier itself + the legacy sign-up.service fallback to keep
    // their bounded substring guard (already wrapped by code-first detection).
    if (file.endsWith("/auth-classifier.ts")) return {};
    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const v = node.value.toLowerCase();
        for (const needle of FORBIDDEN_DUP_SUBSTRINGS) {
          if (v.includes(needle)) {
            context.report({ node, messageId: "forbidden", data: { needle } });
            return;
          }
        }
      },
    };
  },
};

// 2026-06-22 — bans raw `supabase.auth.getSession()` / `getUser()` outside the
// session-port + allowlisted callers. Forces every read through
// `getSessionSafe()` / `getUserSafe()` so GoTrue's Web Locks "AbortError: Lock
// broken" race during identity bootstrap is retried in one place instead of
// surfacing to users. See mem://features/session-port-resilience.
const FORBIDDEN_SESSION_READS = new Set(["getSession", "getUser"]);
const noDirectAuthSessionReads = {
  meta: {
    type: "problem",
    docs: { description: "supabase.auth.getSession()/getUser() must route through src/lib/auth/session-port.ts (getSessionSafe / getUserSafe / withAuthLockRetry)." },
    schema: [],
    messages: {
      forbidden:
        "Direct `{{root}}.auth.{{prop}}()` call. Use `getSessionSafe`/`getUserSafe` from `@/lib/auth/session-port` (or wrap with `withAuthLockRetry`) so GoTrue Web Locks contention is retried in one place.",
    },
  },
  create(context) {
    if (fileInAuthFeature(context)) return {};
    if (fileEndsWith(context, AUTH_SERVICE_LEGACY)) return {};
    if (fileEndsWith(context, AUTO_CLIENT)) return {};
    if (normalisedFilename(context).includes("src/integrations/lovable/")) return {};
    if (fileEndsWith(context, SESSION_PORT_FILE)) return {};
    if (fileEndsWith(context, "src/lib/auth/auth-lock-retry.ts")) return {};
    if (fileEndsWith(context, GOOGLE_BUTTON_FILE)) return {};
    if (fileEndsWith(context, CACHED_SESSION_FILE)) return {};
    if (fileEndsWith(context, SESSION_HEALTH_FILE)) return {};
    if (fileEndsWith(context, AUTH_CONTEXT_FILE)) return {};
    if (fileEndsWith(context, MFA_SERVICE_FILE)) return {};
    if (fileEndsWith(context, TOTP_MGMT_FILE)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression") return;
        const propName = callee.property?.type === "Identifier" ? callee.property.name : null;
        if (!propName || !FORBIDDEN_SESSION_READS.has(propName)) return;
        const obj = callee.object;
        if (obj?.type !== "MemberExpression") return;
        if (obj.property?.type !== "Identifier" || obj.property.name !== "auth") return;
        const root = obj.object;
        if (root?.type !== "Identifier") return;
        if (root.name !== "supabase" && root.name !== "lovable") return;
        context.report({ node, messageId: "forbidden", data: { root: root.name, prop: propName } });
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
    "no-direct-auth-mutations": noDirectAuthMutations,
    "no-direct-auth-session-reads": noDirectAuthSessionReads,
    "no-signup-string-match": noSignupStringMatch,
  },
};


