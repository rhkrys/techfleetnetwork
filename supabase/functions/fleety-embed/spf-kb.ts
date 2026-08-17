// Pure, testable core for embedding the SPF snapshot (spf_entity) into knowledge_base
// as rich, step-oriented text with REAL deep-links to the public Pages site
// (…/explore/#item/<slug>). Phase 3 of the Fleety v1.4 rework: this is what makes
// Fleety able to give exact steps for workshops + SPF milestones + career transitions,
// and cite the specific SPF page. No I/O here — the fleety-embed handler loads the
// rows and calls these builders, so CI can unit-test the extraction offline.

export const SPF_EXPLORE_BASE =
  "https://techfleetworks.github.io/skills-and-practices-framework/explore";

/**
 * Deep-link to a specific SPF entity page, UNIQUE per entity.
 *
 * Slugs are NOT unique across entity types (e.g. a `skill` and a `practice` can both be
 * "facilitation"), and the KB de-dups on `url`. A slug-only URL therefore collided distinct
 * entities onto one KB row → they overwrote each other (data loss) and re-embedded forever
 * (the backfill never converged). We disambiguate by putting the entity type in a query param
 * BEFORE the hash: browsers place everything after `#` in `location.hash`, so the SPA's hash
 * router still reads exactly `#item/<slug>` — navigation is byte-identical to the slug-only URL,
 * but the URL is now unique per (type, slug), so every entity gets its own KB row.
 */
export function spfEntityUrl(entityType: string, slug: string): string {
  return `${SPF_EXPLORE_BASE}/?e=${encodeURIComponent(entityType)}#item/${slug}`;
}

/** A {slug,label} graph ref as SPF emits it (label is what we surface to readers). */
type Ref = { slug?: string; label?: string };

/** Read a field that may be a {slug,label}[] array, a comma-joined string, or absent. */
function labelList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : (x as Ref)?.label))
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim());
  }
  if (typeof v === "string" && v.trim()) {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Read a scalar string field defensively. */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Append "Label: value" only when value is non-empty. */
function line(label: string, value: string): string {
  return value ? `${label}: ${value}\n` : "";
}

function labelLine(label: string, v: unknown): string {
  const list = labelList(v);
  return list.length ? `${label}: ${list.join(", ")}\n` : "";
}

export type SpfRow = {
  entity_type: string;
  slug: string;
  name: string;
  description: string | null;
  data: Record<string, unknown>;
};

export type WorkshopStep = {
  order: number;
  title: string;
  doThisNow: string;
  prompts: string;
  output: string;
  doneWhen: string;
  tips: string;
  timeBox: string;
};

/** Normalize one workshop_step spf_entity row into an ordered, typed step. */
export function parseWorkshopStep(data: Record<string, unknown>): {
  workshopSlug: string | null;
  step: WorkshopStep;
} {
  const wsRef = Array.isArray(data["Workshop"]) ? (data["Workshop"][0] as Ref) : undefined;
  const orderRaw = data["Order"];
  const order = typeof orderRaw === "number" ? orderRaw : parseInt(str(orderRaw) || "0", 10) || 0;
  return {
    workshopSlug: wsRef?.slug ?? null,
    step: {
      order,
      title: str(data["Step Title"]) || str(data["Step Name"]),
      doThisNow: str(data["Do This Now"]),
      prompts: str(data["Prompts / Questions"]),
      output: str(data["Output of This Step"]),
      doneWhen: str(data["Done When"]),
      tips: str(data["Tips & Pitfalls"]),
      timeBox: str(data["Time Box"]),
    },
  };
}

function renderSteps(steps: WorkshopStep[]): string {
  if (!steps.length) return "";
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const body = ordered
    .map((s) => {
      const bits = [
        `${s.order}. ${s.title}${s.timeBox ? ` (${s.timeBox})` : ""}`,
        s.doThisNow ? `   Do this now: ${s.doThisNow}` : "",
        s.output ? `   Output: ${s.output}` : "",
        s.doneWhen ? `   Done when: ${s.doneWhen}` : "",
        s.tips ? `   Tips & pitfalls: ${s.tips}` : "",
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n");
  return `\nSteps to run this workshop:\n${body}\n`;
}

export type KbRow = { url: string; title: string; content: string };

/** entity_types we promote into the KB. workshop_step is folded into its workshop
 *  (not embedded standalone), so it is intentionally absent here. */
export const SPF_EMBED_TYPES = new Set([
  "workshop",
  "project_milestone",
  "deliverable",
  "practice",
  "practice_component",
  "skill",
  "duty",
  "activity",
  "methodology",
  "specialization",
  "job_function",
  "career_transition",
]);

const TYPE_LABEL: Record<string, string> = {
  workshop: "Workshop",
  project_milestone: "Milestone",
  deliverable: "Deliverable",
  practice: "Team Practice",
  practice_component: "Practice Component",
  skill: "Skill",
  duty: "Duty",
  activity: "Activity",
  methodology: "Methodology",
  specialization: "Specialization",
  job_function: "Job Function",
  career_transition: "Career Transition",
};

/**
 * Build a KB row from an spf_entity row. Returns null for types we don't embed.
 * `stepsByWorkshopSlug` supplies a workshop's ordered steps (folded in-line).
 */
export function buildSpfKbRow(
  row: SpfRow,
  stepsByWorkshopSlug?: Map<string, WorkshopStep[]>
): KbRow | null {
  if (!SPF_EMBED_TYPES.has(row.entity_type)) return null;
  if (!row.slug) return null;

  const d = row.data ?? {};
  const typeLabel = TYPE_LABEL[row.entity_type] ?? "Framework";
  const desc = row.description ?? "";
  let title = `${typeLabel}: ${row.name}`;
  let body = "";

  switch (row.entity_type) {
    case "workshop": {
      body =
        line("Summary", desc || str(d["Workshop Summary"])) +
        line("Why it's valuable", str(d["Why Is This Workshop Valuable?"])) +
        labelLine("Practices this teaches", d["Practices That This Workshop Teaches"]) +
        labelLine("Deliverable it produces", d["Deliverable the Workshop Produces"]) +
        labelLine("Milestone it belongs to", d["What Milestone Does This Workshop Belong To?"]) +
        renderSteps(stepsByWorkshopSlug?.get(row.slug) ?? []);
      break;
    }
    case "project_milestone": {
      body =
        line("Description", desc || str(d["Milestone Description"])) +
        labelLine("Deliverables in this milestone", d["All Deliverables In the Milestone"]) +
        labelLine("Skills", d["UNIQUE Skills in the Milestone"]) +
        labelLine("Practices", d["UNIQUE Practices in the Milestone"]);
      break;
    }
    case "career_transition": {
      const target = str(d["Target Field"]);
      const from = str(d["Transition From"]);
      if (target) title = `Career Transition: into ${target}${from ? ` (from ${from})` : ""}`;
      body =
        line("A day in the life", str(d["A Day in the Life"])) +
        line("First steps", str(d["First Steps"])) +
        labelLine("Foundational skills to build", d["Foundational Skills to Build"]) +
        labelLine("Tools to learn", d["Tools to Learn"]) +
        labelLine("Methodologies to learn", d["Methodologies to Learn"]) +
        labelLine("Deliverables to learn", d["Deliverables to Learn"]) +
        line("Summary of the gaps", str(d["Summary of the Gaps"])) +
        line("Training recommendations", str(d["Training Recommendations"])) +
        labelLine(
          "Transferable skills from this industry",
          d["Transferable Skills From This Industry"]
        );
      break;
    }
    case "practice":
    case "practice_component": {
      body =
        line("Description", desc) +
        line("Mindset", str(d["Mindset"])) +
        line("Habit", str(d["Habit"])) +
        line("Belief", str(d["Belief"])) +
        line("Behavior", str(d["Behavior"]));
      break;
    }
    case "deliverable": {
      body =
        line("Description", desc) +
        labelLine("Required skills", d["Required Skills for the Deliverable"]) +
        labelLine("Required activities", d["Required Activities"]) +
        labelLine("Required practices", d["Required Practices for the Deliverable"]);
      break;
    }
    default: {
      body = line("Description", desc);
    }
  }

  const content = `${title}\n${body}`.trim();
  return { url: spfEntityUrl(row.entity_type, row.slug), title, content };
}

/** Group workshop_step rows by their parent workshop slug (for buildSpfKbRow). */
export function groupSteps(stepRows: SpfRow[]): Map<string, WorkshopStep[]> {
  const map = new Map<string, WorkshopStep[]>();
  for (const r of stepRows) {
    if (r.entity_type !== "workshop_step") continue;
    const { workshopSlug, step } = parseWorkshopStep(r.data ?? {});
    if (!workshopSlug) continue;
    const arr = map.get(workshopSlug) ?? [];
    arr.push(step);
    map.set(workshopSlug, arr);
  }
  return map;
}
