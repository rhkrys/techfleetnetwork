const PASSWORD_SET_COMPONENT = "src/components/auth/PasswordSetFields.tsx";
const AUTH_SERVICE = "src/services/auth.service.ts";

function fileEndsWith(context, suffix) {
  return context.getFilename().replace(/\\/g, "/").endsWith(suffix);
}

function literalAttrValue(attr) {
  const value = attr?.value;
  if (!value) return "";
  if (value.type === "Literal") return String(value.value ?? "");
  if (value.type === "JSXExpressionContainer" && value.expression.type === "Literal") return String(value.expression.value ?? "");
  return "";
}

const noBarePasswordSetInput = {
  meta: {
    type: "problem",
    docs: { description: "Credential setup must use PasswordSetFields." },
    schema: [],
    messages: {
      forbidden: "New-password inputs must be rendered by <PasswordSetFields /> so confirmation and validation cannot be skipped.",
    },
  },
  create(context) {
    if (fileEndsWith(context, PASSWORD_SET_COMPONENT)) return {};
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
  meta: {
    type: "problem",
    docs: { description: "Password updates must go through AuthService.updatePassword." },
    schema: [],
    messages: {
      forbidden: "Do not call auth.updateUser({ password }) directly; use AuthService.updatePassword with password confirmation.",
    },
  },
  create(context) {
    if (fileEndsWith(context, AUTH_SERVICE)) return {};
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

export default {
  rules: {
    "no-bare-password-set-input": noBarePasswordSetInput,
    "no-raw-password-update": noRawPasswordUpdate,
  },
};