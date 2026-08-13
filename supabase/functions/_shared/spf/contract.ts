// SPF v1 contract — the SINGLE place the shape of the public Skills & Practices
// Framework API is pinned, so the ingest side (spf-sync) and any consumer can NEVER
// silently drift onto an unexpected shape. Pure/testable: no I/O here, just the
// dataset registry + a validator. This is the same drift-guard idea as
// `_shared/gemini-embed.ts`: a shared contract with a CI test.
//
// Source of truth: the public open-data API (ADR-0001/0002). We pin to v1. When SPF
// ships v2, a captured-fixture test (contract.test.ts) fails FIRST — a controlled,
// visible break — instead of production Fleety/hand-off silently ingesting a changed
// shape. At ingest time, spf-sync runs validateRecords() and FAILS CLOSED (never swaps
// in) on a violation, so a poisoned or malformed feed can't reach the LLM grounding.

export const SPF_VERSION = "v1";
export const SPF_BASE_URL = "https://techfleetworks.github.io/skills-and-practices-framework";

/** Discovery manifest (lists all datasets, versions, checksums). */
export const SPF_MANIFEST_URL = `${SPF_BASE_URL}/data/json/manifest.json`;

/** The 5 story arcs, exactly as the handoff map spells them (data has real casing). */
export const HANDOFF_STORY_ARCS = [
  "Pre-amble",
  "Part 1: Empathy Building",
  "Part 2: The Journey",
  "Part 3: The outcomes",
  "Part 4: The Sequel",
] as const;

/** The four audience-inclusion flag fields on each handoff-map component. */
export const HANDOFF_AUDIENCE_FLAGS = [
  "Is this in the Client Hand-Off?",
  "Is this in the Teammate Hand-off?",
  "Is this in the Teammate Case Study?",
  "Is this in the Tech Fleet Org Case Study?",
] as const;

/** A slug-based graph link as SPF emits them. */
export type SpfRef = { slug: string; label: string };

type DatasetSpec = {
  /** File under /data/json/framework-data/ (from manifest.json). */
  file: string;
  /** Human primary field (from manifest). */
  primaryField: string;
  /** Scalar fields that MUST be present and non-empty on every record. */
  required: string[];
  /** Fields that, IF present, must be arrays of {slug,label}. Absence is allowed
   *  (e.g. direct-input handoff components have no deliverable/workshop link). */
  refArrays: string[];
  /** field -> allowed values (exact-match enum). */
  enums?: Record<string, readonly string[]>;
};

// Only the datasets the hand-off feature + graph rebuild actually depend on are pinned
// here; unknown NEW datasets/fields are tolerated (schema-evolution tolerance). Field
// names are the framework's own (verified against the live v1 API on 2026-08-10).
export const SPF_DATASETS: Record<string, DatasetSpec> = {
  "handoff-deliverables-map": {
    file: "handoff-deliverables-map.json",
    primaryField: "Hand-Off Story Arc",
    required: [
      "slug",
      "Hand-Off Story Arc",
      "Component",
      "Description",
      "Format of the Resulting Section",
      ...HANDOFF_AUDIENCE_FLAGS,
    ],
    refArrays: [
      "From Which Deliverable Does This Information Come?",
      "Workshop Associated with the Deliverables",
    ],
    enums: {
      "Hand-Off Story Arc": HANDOFF_STORY_ARCS,
      "Is this in the Client Hand-Off?": ["Yes", "No"],
      "Is this in the Teammate Hand-off?": ["Yes", "No"],
      "Is this in the Teammate Case Study?": ["Yes", "No"],
      "Is this in the Tech Fleet Org Case Study?": ["Yes", "No"],
    },
  },
  deliverables: {
    file: "deliverables.json",
    primaryField: "Deliverable Name",
    required: ["slug", "Deliverable Name"],
    // Verified {slug,label} arrays (2026-08-10). NOTE: "Project Milestones" is a comma-joined
    // STRING of project-specific names, NOT a graph link — the real milestone ref is
    // "Project Milestone Where It's Delivered". Do not add "Project Milestones" here.
    refArrays: [
      "Project Milestone Where It's Delivered",
      "Workshops",
      "Required Activities",
      "Required Skills for the Deliverable",
      "Required Practices for the Deliverable",
      "Duty Who Owns the Deliverable",
      "Hand-Off Deliverables Map",
    ],
  },
  workshops: {
    file: "workshops.json",
    primaryField: "Workshop Name",
    required: ["slug", "Workshop Name"],
    refArrays: [
      "Practices That This Workshop Teaches",
      "What Duty Runs This Workshop?",
      "Related Workshop Skills",
      "Deliverable the Workshop Produces",
      "What Milestone Does This Workshop Belong To?",
      "Related Activities",
    ],
  },
  milestones: {
    file: "milestones.json",
    primaryField: "Milestone Name",
    required: ["slug", "Milestone Name"],
    // "Project Phases" is a comma-joined STRING of project-specific phase names, NOT a ref
    // array (matches the known messy-column note in open-data-strategy.md). Excluded.
    refArrays: ["All Deliverables In the Milestone"],
  },
  practices: {
    file: "practices.json",
    primaryField: "Practice Name",
    required: ["slug", "Practice Name"],
    refArrays: [],
  },
  "project-types": {
    file: "project-types.json",
    primaryField: "Project Type",
    required: ["slug", "Project Type"],
    refArrays: [],
  },
  "project-phases": {
    file: "project-phases.json",
    primaryField: "Name",
    required: ["slug", "Name"],
    refArrays: [],
  },
  skills: {
    file: "skills.json",
    primaryField: "Skill Name",
    required: ["slug", "Skill Name"],
    refArrays: [],
  },
  duties: {
    file: "duties.json",
    primaryField: "Duty Name",
    required: ["slug", "Duty Name"],
    refArrays: [],
  },
  "job-functions": {
    file: "job-functions.json",
    primaryField: "Job Function",
    required: ["slug", "Job Function"],
    refArrays: [],
  },
  activities: {
    file: "activities.json",
    primaryField: "Activity Name",
    required: ["slug", "Activity Name"],
    refArrays: [],
  },

  // --- FULL ONTOLOGY (ADR-0001: the SPF is the single source of truth, so the WHOLE ontology is
  // snapshotted, not only the 11 hand-off-critical datasets). These are ingested with LENIENT
  // validation — require only `slug`, shapes not yet depended on — which is schema-evolution
  // tolerant. Promote any of these to a strict spec (required fields, refArrays) the moment a
  // feature reads its fields. ---
  "data-types": {
    file: "data-types.json",
    primaryField: "Data Type",
    required: ["slug"],
    refArrays: [],
  },
  "practice-components": {
    file: "practice-components.json",
    primaryField: "Practice Component Name",
    required: ["slug"],
    refArrays: [],
  },
  specializations: {
    file: "specializations.json",
    primaryField: "Specialization Name",
    required: ["slug"],
    refArrays: [],
  },
  methodologies: {
    file: "methodologies.json",
    primaryField: "Methodology Name",
    required: ["slug"],
    refArrays: [],
  },
  tools: { file: "tools.json", primaryField: "Tool Name", required: ["slug"], refArrays: [] },
  "company-types": {
    file: "company-types.json",
    primaryField: "Company Type",
    required: ["slug"],
    refArrays: [],
  },
  stakeholders: {
    file: "stakeholders.json",
    primaryField: "Stakeholder Name",
    required: ["slug"],
    refArrays: [],
  },
  "job-industries": {
    file: "job-industries.json",
    primaryField: "Job Industry",
    required: ["slug"],
    refArrays: [],
  },
  "workshop-steps": {
    file: "workshop-steps.json",
    primaryField: "Step Name",
    required: ["slug"],
    refArrays: [],
  },
  "workshop-template-sections": {
    file: "workshop-template-sections.json",
    primaryField: "Section Name",
    required: ["slug"],
    refArrays: [],
  },
};

export function spfDatasetUrl(entity: string): string {
  const spec = SPF_DATASETS[entity];
  if (!spec) throw new Error(`Unknown SPF dataset: ${entity}`);
  return `${SPF_BASE_URL}/data/json/framework-data/${spec.file}`;
}

export type ValidationResult = { ok: boolean; errors: string[] };

const MAX_ERRORS = 50;

function isNonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return true;
  return true;
}

function isSpfRefArray(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.every(
    (it) =>
      it !== null &&
      typeof it === "object" &&
      typeof (it as SpfRef).slug === "string" &&
      (it as SpfRef).slug.length > 0 &&
      typeof (it as SpfRef).label === "string"
  );
}

/**
 * Validate an array of records for a known SPF dataset against the pinned v1 contract.
 * Pure. Unknown fields are ignored (tolerated). Absent refArray fields are allowed;
 * present ones must be [{slug,label}]. Returns up to MAX_ERRORS human-readable errors.
 */
export function validateRecords(entity: string, records: unknown): ValidationResult {
  const spec = SPF_DATASETS[entity];
  if (!spec) return { ok: false, errors: [`Unknown SPF dataset: ${entity}`] };
  if (!Array.isArray(records)) {
    return { ok: false, errors: [`${entity}: payload is not a JSON array`] };
  }
  const errors: string[] = [];
  const push = (m: string) => {
    if (errors.length < MAX_ERRORS) errors.push(m);
  };

  records.forEach((rec, i) => {
    if (rec === null || typeof rec !== "object") {
      push(`${entity}[${i}]: record is not an object`);
      return;
    }
    const r = rec as Record<string, unknown>;
    const id = typeof r.slug === "string" && r.slug ? r.slug : `#${i}`;

    for (const field of spec.required) {
      if (!isNonEmpty(r[field])) {
        push(`${entity}[${id}]: missing/empty required field "${field}"`);
      }
    }
    for (const [field, allowed] of Object.entries(spec.enums ?? {})) {
      const val = r[field];
      if (val !== undefined && !allowed.includes(val as string)) {
        push(
          `${entity}[${id}]: field "${field}" = ${JSON.stringify(val)} not in {${allowed.join(", ")}}`
        );
      }
    }
    for (const field of spec.refArrays) {
      if (field in r && r[field] !== undefined && r[field] !== null) {
        if (!isSpfRefArray(r[field])) {
          push(`${entity}[${id}]: field "${field}" is not an array of {slug,label}`);
        }
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
