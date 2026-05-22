/**
 * Custom ESLint plugin: forbids raw `<Input id|name="discord_username">`
 * or `value={...discord_username}` outside the shared ProfileDiscordConnector.
 *
 * Single-source-of-truth: every surface that captures a Discord username
 * MUST render `<ProfileDiscordConnector />` so verification, role assignment,
 * and stale-candidate handling stay consistent.
 *
 * Allowed files:
 *   - src/components/profile/ProfileDiscordConnector.tsx (the connector itself)
 *   - src/integrations/supabase/types.ts (generated schema)
 */

const ALLOWED = [
  "src/components/profile/ProfileDiscordConnector.tsx",
  "src/integrations/supabase/types.ts",
];

function isAllowed(filename) {
  return ALLOWED.some((p) => filename.replace(/\\/g, "/").endsWith(p));
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw discord_username inputs outside ProfileDiscordConnector. Use <ProfileDiscordConnector /> instead.",
    },
    schema: [],
    messages: {
      rawInput:
        'Raw "discord_username" input is not allowed here. Render <ProfileDiscordConnector /> so every Discord capture goes through the shared verified flow.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (isAllowed(filename)) return {};

    return {
      JSXOpeningElement(node) {
        const tag =
          node.name && node.name.type === "JSXIdentifier" ? node.name.name : "";
        if (tag !== "Input" && tag !== "input") return;

        for (const attr of node.attributes) {
          if (attr.type !== "JSXAttribute" || !attr.name) continue;
          const attrName = attr.name.name;
          if (attrName !== "id" && attrName !== "name") continue;
          const v = attr.value;
          if (!v) continue;
          let str = "";
          if (v.type === "Literal") str = String(v.value || "");
          else if (
            v.type === "JSXExpressionContainer" &&
            v.expression.type === "Literal"
          ) {
            str = String(v.expression.value || "");
          }
          if (str === "discord_username") {
            context.report({ node: attr, messageId: "rawInput" });
          }
        }
      },
    };
  },
};

export default {
  rules: {
    "no-raw-discord-input": rule,
  },
};
