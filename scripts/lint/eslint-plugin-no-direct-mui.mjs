/**
 * ESLint rule: no-direct-mui
 *
 * Enforces the TechFleet Design System (TFDS) single import surface: the app
 * imports UI from `@/design-system`, never `@mui/material` directly. Only
 * `src/design-system/**` may import MUI components. This is the CI-enforced
 * version of the "one consistent library, used correctly" governance rule
 * (see docs/design/design-system/architecture-spec.md §7).
 *
 * `@mui/icons-material` is intentionally NOT restricted — icon glyphs are
 * picked at the usage site and rendered through the <Icon> atom.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid importing @mui/material outside src/design-system — import UI from '@/design-system'.",
    },
    schema: [],
    messages: {
      forbidden:
        "Import UI from '@/design-system', not '{{source}}'. Only src/design-system/** may import @mui/material directly.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          typeof source === "string" &&
          (source === "@mui/material" || source.startsWith("@mui/material/"))
        ) {
          context.report({ node, messageId: "forbidden", data: { source } });
        }
      },
    };
  },
};
