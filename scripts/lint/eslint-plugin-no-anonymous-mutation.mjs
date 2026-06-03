/**
 * eslint-plugin-no-anonymous-mutation
 *
 * Surfaces `useMutation({...})` call sites that lack BOTH `mutationKey` and
 * `meta.audit`. Without one of those, our error reporter logs the failure as
 * `source:"mutation.anonymous"` which is useless for triage (Issue G of the
 * 2026-06-02 activity-log audit).
 *
 * Rule is warn-only at introduction so the baseline doesn't brick CI;
 * promote to "error" once the queue is at zero.
 */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require useMutation calls to declare either mutationKey or meta.audit so triage can attribute failures.",
    },
    messages: {
      missing:
        "useMutation must declare either `mutationKey: [...]` or `meta: { audit: '<scope>' }`. Anonymous mutations log as source:mutation.anonymous and can't be triaged.",
    },
    schema: [],
  },
  create(context) {
    function hasKey(props, key) {
      return props.some(
        (p) =>
          p.type === "Property" &&
          ((p.key.type === "Identifier" && p.key.name === key) ||
            (p.key.type === "Literal" && p.key.value === key)),
      );
    }

    function getMeta(props) {
      const meta = props.find(
        (p) =>
          p.type === "Property" &&
          ((p.key.type === "Identifier" && p.key.name === "meta") ||
            (p.key.type === "Literal" && p.key.value === "meta")),
      );
      if (!meta || meta.value.type !== "ObjectExpression") return null;
      return meta.value.properties;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" && callee.property.type === "Identifier"
              ? callee.property.name
              : null;
        if (name !== "useMutation") return;

        const arg = node.arguments[0];
        if (!arg || arg.type !== "ObjectExpression") return; // dynamic — skip

        if (hasKey(arg.properties, "mutationKey")) return;
        const metaProps = getMeta(arg.properties);
        if (metaProps && hasKey(metaProps, "audit")) return;

        context.report({ node, messageId: "missing" });
      },
    };
  },
};

export default { rules: { "require-audit-label": rule } };
