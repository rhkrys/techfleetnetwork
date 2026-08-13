// SPF-driven source mapper (Phase B1/B2). Decides WHICH board sections feed each hand-off component
// by GROUNDING the decision in the SPF — the component's workshops, deliverables, and activities —
// instead of keyword-matching the component's title (which mis-mapped "UX design work" onto "UX
// research" sections, etc.). PURE core (prompt + resolution) is unit-tested; the LLM call + Figma
// fetch + handoff_source_map write live in the runner. Output is stored for HUMAN verification
// (origin='spf_mapped', approved=false) — never trusted blind on the hot path.
import type { LlmMessage } from "../_shared/llm/port.ts";

/** One candidate board section the mapper chooses among. `text` (the section's content) is used by
 *  the pre-filter stage; the LLM stage sees only the name. */
export type BoardSection = { nodeId: string; name: string; text?: string };

const STOP = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "your",
  "you",
  "are",
  "was",
  "were",
  "will",
  "have",
  "has",
  "our",
  "who",
  "what",
  "how",
  "not",
  "but",
  "all",
  "one",
  "each",
  "their",
  "team",
  "tech",
  "fleet",
  "work",
  "workshop",
  "template",
  "project",
  "phase",
  "section",
  "into",
  "out",
]);
/** Light stemming so plural/singular don't miss each other (KPIs vs KPI's -> kpi; measurements ->
 *  measurement). Without this the section "ORG-LEVEL KPIs" scored 0 against a target with "KPI's". */
function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}
function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
}

/** PURE: the distinctive terms that identify a component's work (from its SPF targets + description). */
export function targetTerms(t: ComponentTargets): Set<string> {
  return new Set(
    tokenize(
      [t.component, t.description, ...t.workshops, ...t.deliverables, ...t.activities].join(" ")
    )
  );
}

// Section-name patterns that mark SCAFFOLDING, not the team's filled work: workshop instructions,
// examples, blank prompts, SPF milestone/deliverable REFERENCE lists (these list deliverable names,
// which is exactly why name-matching gets fooled), and the hand-off OUTPUT itself.
const TEMPLATE_SECTION_NAME =
  /\binstructions?\b|^\s*(example|enter your|drop your|build your|how to|provide the|this is what)\b|looks like\s*$|\bhand.?off\b|\bmilestone\b|^\s*deliverables for\b/i;
const SECTION_TEMPLATE_MARKERS = [
  "enter here",
  "list here",
  "drop your",
  "write ideas",
  "summarize your results",
  "you may have heard",
  "template link",
  "in the space below",
  "results:\n(summarize",
];

/**
 * PURE: true when a board section is SCAFFOLDING (workshop instructions / blank prompts / an SPF
 * reference list / the hand-off output) rather than the team's filled-in work. This is the fix for
 * template contamination: name-matching alone maps "Experience Design Milestone" (a reference list
 * of deliverable NAMES) onto "UX design work". We exclude such sections before they reach the LLM.
 */
export function isTemplateSection(name: string, text?: string): boolean {
  if (TEMPLATE_SECTION_NAME.test(name)) return true;
  if (text) {
    const t = text.toLowerCase();
    const hits = SECTION_TEMPLATE_MARKERS.filter((m) => t.includes(m)).length;
    if (hits >= 2 && t.replace(/\s+/g, " ").trim().length < 500) return true; // mostly prompts, little fill
  }
  return false;
}

/**
 * STAGE 1 (PURE): pre-filter a large board (1000+ sections) down to the top-k candidates for one
 * component, by term overlap of the component's SPF/description vocabulary against each section's
 * name AND text. This is the recall fix: it surfaces the right sections (even when the section NAME
 * doesn't contain the component's title, because the section TEXT carries the vocabulary) so the LLM
 * stage sees a small, relevant candidate set instead of drowning in 1000+ names.
 */
export function prefilterSections(
  t: ComponentTargets,
  sections: BoardSection[],
  k = 70
): BoardSection[] {
  // Drop scaffolding/reference/output sections FIRST so they can never be matched (template fix).
  const real = sections.filter((s) => !isTemplateSection(s.name, s.text));
  const terms = [...targetTerms(t)];
  if (!terms.length) return real.slice(0, k);
  // FORCE-INCLUDE any section whose NAME contains a target term (substring): "ORG-LEVEL KPIs" for a
  // KPI component survives even though its funnel vocabulary barely overlaps the target's terms.
  const nameHit = real.filter((s) => {
    const n = s.name.toLowerCase();
    return terms.some((term) => n.includes(term));
  });
  // Plus the top-k by term overlap over NAME + TEXT.
  const topScored = real
    .map((s) => {
      const hay = new Set(tokenize(`${s.name} ${s.text ?? ""}`));
      let score = 0;
      for (const term of terms) if (hay.has(term)) score++;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
  const seen = new Set<string>();
  const out: BoardSection[] = [];
  for (const s of [...nameHit, ...topScored])
    if (!seen.has(s.nodeId)) {
      (seen.add(s.nodeId), out.push(s));
    }
  return out;
}

/** The SPF targets that DEFINE a component's work (from loadSpfContext / the handoff map). */
export type ComponentTargets = {
  slug: string;
  component: string;
  description: string;
  workshops: string[];
  deliverables: string[];
  activities: string[];
};

export const MAPPER_SYSTEM = `You map a hand-off component to the board sections that hold ITS work. You are given the component
and, from the Skills and Practices Framework, the WORKSHOPS it was done in, the DELIVERABLES it should
produce, and the ACTIVITIES that produce them. You are also given a list of the board's section names.

Choose the section names whose work matches THIS component, judged by MEANING against its workshops,
deliverables, and activities — NOT by whether the section name contains the component's title words.
For example, "UX design work" means wireframes, prototypes, sketches, UI specs (the Rapid Ideation and
design workshops); it does NOT mean "UX research" sections. A section may belong to no component; a
component may map to several sections. If nothing clearly matches, return an empty list. Never invent
a section name that is not in the provided list. Return only the emit_mapping tool call.`;

/** PURE: build the grounded mapping prompt for one component over the board's sections. */
export function buildMappingPrompt(
  target: ComponentTargets,
  sections: BoardSection[]
): { messages: LlmMessage[]; toolName: string; schema: Record<string, unknown> } {
  const list = sections.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
  return {
    messages: [
      { role: "system", content: MAPPER_SYSTEM },
      {
        role: "user",
        content:
          `COMPONENT: ${target.component}\nWHAT IT COVERS: ${target.description}\n` +
          `SPF WORKSHOPS: ${target.workshops.join(", ") || "(none)"}\n` +
          `SPF DELIVERABLES: ${target.deliverables.join(", ") || "(none)"}\n` +
          `SPF ACTIVITIES: ${target.activities.join(", ") || "(none)"}\n\n` +
          `BOARD SECTIONS (choose the ones that hold THIS component's work, by meaning):\n${list}`,
      },
    ],
    toolName: "emit_mapping",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sections: {
          type: "array",
          description:
            "The board section names (verbatim from the list) that hold this component's work.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              confidence: {
                type: "number",
                description: "0..1 confidence this section is this component's work.",
              },
            },
            required: ["name", "confidence"],
          },
        },
        reasoning: { type: "string" },
      },
      required: ["sections", "reasoning"],
    },
  };
}

/** PURE: resolve chosen section names back to board node ids (exact, then case-insensitive match).
 *  Names not found in the section list are dropped (the model was told to choose from the list). */
export function resolveSections(
  chosen: Array<{ name: string; confidence: number }>,
  sections: BoardSection[]
): Array<{ nodeId: string; name: string; confidence: number }> {
  const byName = new Map(sections.map((s) => [s.name.toLowerCase().trim(), s]));
  const out: Array<{ nodeId: string; name: string; confidence: number }> = [];
  const seen = new Set<string>();
  for (const c of chosen) {
    const hit = byName.get(String(c.name).toLowerCase().trim());
    if (hit && !seen.has(hit.nodeId)) {
      seen.add(hit.nodeId);
      out.push({ nodeId: hit.nodeId, name: hit.name, confidence: Number(c.confidence) || 0 });
    }
  }
  return out;
}
