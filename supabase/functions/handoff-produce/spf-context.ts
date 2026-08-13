// SPF enrichment for the hand-off pipeline.
//
// The board (or doc, or slide deck) gives the team's SPECIFICS. The SPF gives the MEANING:
// every hand-off component maps to a deliverable, and each deliverable carries — by framework
// definition — the skills it demonstrates, the Team Practices it applies, the duty that owns it,
// the milestone it sits in, and the activities that produce it. Writers weave this into the
// Teammate / Case-Study / Org narratives so the hand-off says what the work MEANS, from the
// framework, not from a guess. Client stays lean (outcomes only) and does not get this block.
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Svc = SupabaseClient<any, "public", any>;

export type DeliverableContext = {
  name: string;
  description: string;
  skills: string[];
  practices: string[];
  duty: string[];
  milestones: string[];
  activities: string[];
};
export type ComponentContext = {
  workshops: string[];
  deliverables: DeliverableContext[];
  /** "Output of This Step" across the component's workshops — the concrete artifacts the team
   *  produced (the extractor's recognition anchors). */
  workshopOutputs: string[];
  /** "Section / Prompt: What Goes Here" across the component's workshops — the template sections
   *  the team filled in (what to look for in the material). */
  workshopSections: string[];
  /** Hand-off map "Format of the Resulting Section" hint (e.g. "List of items, and pictures"). */
  format: string;
};

/** SPF ref arrays are [{slug,label}]; pull the human labels. */
function labels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? ((x as any).label ?? (x as any).slug) : x))
    .filter(Boolean)
    .map(String);
}
/** SPF ref arrays are [{slug,label}]; pull the slugs (to join workshops -> steps/sections). */
function refSlugs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? String((x as any).slug ?? "") : ""))
    .filter(Boolean);
}
const uniq = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))];
/** Some SPF fields are a comma-joined STRING, not a {slug,label}[] ref array — notably
 *  "Project Milestones" (see _shared/spf/contract.ts). Accept either shape so the value is not
 *  silently dropped to [] when it arrives as a string. */
function labelsOrCsv(v: unknown): string[] {
  if (Array.isArray(v)) return labels(v);
  if (typeof v === "string")
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** Load every hand-off component's SPF context: deliverables (+ skills/practices/duty/activities)
 *  AND the WORKSHOP STRUCTURE (step outputs + template-section prompts) for the workshops each
 *  component maps to. The workshop structure gives the extractor concrete "what the team produced"
 *  search anchors, far sharper than deliverable names alone. Four batched reads. */
export async function loadSpfContext(svc: Svc): Promise<Map<string, ComponentContext>> {
  const [{ data: comps }, { data: delivs }, { data: steps }, { data: secs }] = await Promise.all([
    svc
      .from("spf_entity")
      .select("slug,data")
      .eq("entity_type", "handoff_component")
      .eq("is_active", true),
    svc
      .from("spf_entity")
      .select("slug,data")
      .eq("entity_type", "deliverable")
      .eq("is_active", true),
    svc.from("spf_entity").select("data").eq("entity_type", "workshop_step").eq("is_active", true),
    svc
      .from("spf_entity")
      .select("data")
      .eq("entity_type", "workshop_template_section")
      .eq("is_active", true),
  ]);
  const bySlug = new Map(
    (delivs ?? []).map((d: any) => [d.slug, d.data as Record<string, unknown>])
  );

  // Index workshop step OUTPUTS + template SECTION prompts by their workshop slug.
  const outputsByWs = new Map<string, string[]>();
  for (const s of steps ?? []) {
    const d = (s as any).data as Record<string, unknown>;
    const output = String(d["Output of This Step"] ?? d["Step Title"] ?? "").trim();
    if (!output) continue;
    for (const ws of refSlugs(d["Workshop"]))
      outputsByWs.set(ws, [...(outputsByWs.get(ws) ?? []), output]);
  }
  const sectionsByWs = new Map<string, string[]>();
  for (const s of secs ?? []) {
    const d = (s as any).data as Record<string, unknown>;
    const title = String(d["Section / Prompt"] ?? d["Section Title"] ?? "").trim();
    const goes = String(d["What Goes Here"] ?? "").trim();
    const label = title && goes ? `${title}: ${goes}` : title || goes;
    if (!label) continue;
    for (const ws of refSlugs(d["Workshop"]))
      sectionsByWs.set(ws, [...(sectionsByWs.get(ws) ?? []), label]);
  }

  const out = new Map<string, ComponentContext>();
  for (const c of comps ?? []) {
    const d = c.data as Record<string, unknown>;
    const refs = Array.isArray(d["From Which Deliverable Does This Information Come?"])
      ? (d["From Which Deliverable Does This Information Come?"] as any[])
      : [];
    const deliverables: DeliverableContext[] = refs.map((ref) => {
      const dv = bySlug.get(ref.slug);
      if (!dv)
        return {
          name: ref.label ?? ref.slug,
          description: "",
          skills: [],
          practices: [],
          duty: [],
          milestones: [],
          activities: [],
        };
      return {
        name: String(dv["Deliverable Name"] ?? ref.label ?? ref.slug),
        description: String(dv["Deliverable Description"] ?? ""),
        skills: labels(dv["Required Skills for the Deliverable"]),
        practices: labels(dv["Required Practices for the Deliverable"]),
        duty: labels(dv["Duty Who Owns the Deliverable"]),
        milestones: labelsOrCsv(dv["Project Milestones"] ?? dv["Milestones"]),
        activities: labels(dv["Required Activities"]),
      };
    });
    const wsSlugs = refSlugs(d["Workshop Associated with the Deliverables"]);
    out.set(c.slug, {
      workshops: labels(d["Workshop Associated with the Deliverables"]),
      deliverables,
      workshopOutputs: uniq(wsSlugs.flatMap((w) => outputsByWs.get(w) ?? [])),
      workshopSections: uniq(wsSlugs.flatMap((w) => sectionsByWs.get(w) ?? [])),
      format: String(d["Format of the Resulting Section"] ?? "").trim(),
    });
  }
  return out;
}

/** PURE: the EXTRACTOR's search scope for one component — the SPF deliverables + activities to look
 *  for in the submitted material, plus the owning duty. Skills/practices are intentionally excluded
 *  (those are the writer's meaning layer, not the extractor's capture scope). */
export function toExtractionScope(ctx: ComponentContext | undefined): {
  deliverables: Array<{ name: string; description?: string }>;
  activities: string[];
  workshops: string[];
  workshopOutputs: string[];
  workshopSections: string[];
  duty: string[];
  format: string;
} {
  const empty = {
    deliverables: [],
    activities: [],
    workshops: [],
    workshopOutputs: [],
    workshopSections: [],
    duty: [],
    format: "",
  };
  if (!ctx || (!ctx.deliverables.length && !ctx.workshops.length)) return empty;
  const u = (a: string[]) => [...new Set(a.filter(Boolean))];
  return {
    deliverables: ctx.deliverables.map((d) => ({
      name: d.name,
      description: d.description || undefined,
    })),
    activities: u(ctx.deliverables.flatMap((d) => d.activities)),
    workshops: u(ctx.workshops),
    // Cap the workshop structure so the prompt stays bounded (a component rarely maps to > 2 workshops).
    workshopOutputs: u(ctx.workshopOutputs).slice(0, 18),
    workshopSections: u(ctx.workshopSections).slice(0, 14),
    duty: u(ctx.deliverables.flatMap((d) => d.duty)),
    format: ctx.format ?? "",
  };
}

/** PURE: a compact SPF-context block for one component's writer prompt (empty if nothing known). */
export function formatSpfContext(ctx: ComponentContext | undefined): string {
  if (!ctx?.deliverables.length) return "";
  const lines: string[] = [];
  const cap = (a: string[], n: number) =>
    a.length > n ? `${a.slice(0, n).join(", ")}, and more` : a.join(", ");
  for (const d of ctx.deliverables) {
    const bits: string[] = [];
    if (d.skills.length) bits.push(`skills demonstrated: ${cap(d.skills, 10)}`);
    if (d.practices.length) bits.push(`Team Practices applied: ${d.practices.join(", ")}`);
    if (d.duty.length) bits.push(`owned by the ${d.duty.join(", ")} duty`);
    if (d.milestones.length) bits.push(`milestone: ${d.milestones.join(", ")}`);
    if (d.activities.length) bits.push(`activities: ${cap(d.activities, 6)}`);
    if (bits.length) lines.push(`      · ${d.name}: ${bits.join("; ")}`);
  }
  return lines.length ? lines.join("\n") : "";
}
