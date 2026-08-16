// Pure, testable core of the SPF sync (no I/O — the index.ts handler does the fetch/DB work).
// Kept separate so the SSRF guard + the SPF-record → spf_entity normalization are unit-tested
// in CI's deno-check job with no network. See ADR-0002.

import { SPF_DATASETS } from "../_shared/spf/contract.ts";

/** SPF dataset key → normalized singular entity_type stored in spf_entity.entity_type.
 *  (Phase A2 maps these to the framework_entity_type enum for the graph rebuild.) */
export const SPF_ENTITY_TYPE: Record<string, string> = {
  skills: "skill",
  deliverables: "deliverable",
  workshops: "workshop",
  milestones: "project_milestone",
  practices: "practice",
  duties: "duty",
  "job-functions": "job_function",
  activities: "activity",
  "project-types": "project_type",
  "project-phases": "project_phase",
  "handoff-deliverables-map": "handoff_component",
  // Full ontology (see contract.ts).
  "data-types": "data_type",
  "practice-components": "practice_component",
  specializations: "specialization",
  methodologies: "methodology",
  tools: "tool",
  "company-types": "company_type",
  stakeholders: "stakeholder",
  "job-industries": "job_industry",
  "workshop-steps": "workshop_step",
  "workshop-template-sections": "workshop_template_section",
  "career-transitioning": "career_transition",
};

// The primaryField is the manifest's key field, but it isn't always the best human "name"
// for the snapshot (the handoff map's primaryField is the arc, repeated across rows). Override
// the name source per dataset where needed.
const NAME_FIELD: Record<string, string> = {
  "handoff-deliverables-map": "Component",
};

// Preferred description source(s) per dataset; falls back to a generic "*Description" scan.
const DESCRIPTION_FIELDS: Record<string, string[]> = {
  "handoff-deliverables-map": ["Description"],
  deliverables: ["Deliverable Description"],
  workshops: ["Workshop Summary", "Why Is This Workshop Valuable?"],
  milestones: ["Milestone Description"],
};

export function entityTypeFor(entity: string): string {
  const t = SPF_ENTITY_TYPE[entity];
  if (!t) throw new Error(`No entity_type mapping for SPF dataset: ${entity}`);
  return t;
}

/** SSRF guard for the SPF fetch (ADR-0002 / threat T1). Allow ONLY https to the pinned
 *  GitHub Pages host under the framework path. Throws otherwise; the caller must also
 *  disable redirect-following (redirect: "error"). */
export function assertSpfUrlAllowed(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`SSRF: invalid SPF URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new Error(`SSRF: SPF fetch must be https (${u.protocol})`);
  if (u.hostname !== "techfleetworks.github.io") {
    throw new Error(`SSRF: SPF host not allowed: ${u.hostname}`);
  }
  if (!u.pathname.startsWith("/skills-and-practices-framework/")) {
    throw new Error(`SSRF: SPF path not allowed: ${u.pathname}`);
  }
}

export type NormalizedRow = {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  data: Record<string, unknown>;
};

/** Map one SPF record → the spf_entity 9-column shape. Keeps the full record in `data`. */
export function normalizeRecord(entity: string, rec: Record<string, unknown>): NormalizedRow {
  const spec = SPF_DATASETS[entity];
  if (!spec) throw new Error(`Unknown SPF dataset: ${entity}`);
  const slug = String(rec.slug ?? "").trim();
  const nameField = NAME_FIELD[entity] ?? spec.primaryField;
  const name = String(rec[nameField] ?? rec[spec.primaryField] ?? slug).trim();

  let description: string | null = null;
  for (const f of DESCRIPTION_FIELDS[entity] ?? []) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) {
      description = v.trim();
      break;
    }
  }
  if (description === null) {
    for (const [k, v] of Object.entries(rec)) {
      if (/description/i.test(k) && typeof v === "string" && v.trim()) {
        description = v.trim();
        break;
      }
    }
  }

  return { slug, name, description, category: null, data: rec };
}

export function normalizeDataset(
  entity: string,
  records: Record<string, unknown>[]
): NormalizedRow[] {
  return records.map((r) => normalizeRecord(entity, r));
}
