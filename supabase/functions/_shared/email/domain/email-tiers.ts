// Email subsystem v2 — pure domain: the email-type TIER REGISTRY.
// No I/O. No Deno. No npm. (Enforced by scripts/ci/check-email-architecture.mjs.)
//
// This is the single source of truth for what TIER every email type belongs to,
// and therefore how it is allowed to be gated and unsubscribed from. Requirements:
// docs/design/email-rearchitecture-requirements.md §6 (the tier map).
//
// Tier is a property of the EMAIL TYPE, decided here — never ad hoc in a sender.
//
//   Tier 0  Critical transactional. Always send. NO preference may gate it; only
//           global suppression (hard bounce / spam complaint) can stop it.
//   Tier 1  Service / opportunity. Everyone by default, one opt-out ("opportunities").
//   Tier 2  Marketing. Opt-in only, from the consent ledger.
//   'ops'   Internal staff/admin email. Not member-facing, no member preference.
//   'per-send'  The announcement composer classifies each send as service (Tier 1)
//               or marketing (Tier 2). Resolved at send time, never Tier 0.
//
// Guards that consume this registry:
//   • scripts/ci/check-email-tier-registry.mjs — every real template has an entry.
//   • (PR 3) a guard that no Tier-0 send path reads a member preference flag.
// Sequencing note: the four bolded Tier-0 emails below still carry the
// `notify_announcements` gate in the codebase today; PR 3 removes those gates.
// The two 🔴 emails are on the retired raw queue today; PR 2 migrates them to v2.

import type { Lane } from "./types.ts";

/** 0/1/2 by purpose; 'ops' internal; 'per-send' resolved by the composer. */
export type EmailTier = 0 | 1 | 2 | "ops" | "per-send";

/** Which unsubscribe bucket an email belongs to. Tier 0 and ops are 'none'. */
export type UnsubBucket = "none" | "opportunities" | "marketing" | "per-send";

export interface EmailTypeSpec {
  /** Send tier. Tier 0 can never be gated by a preference. */
  readonly tier: EmailTier;
  /** Delivery lane (mirrors _shared/email/domain/types.ts routing). */
  readonly lane: Lane;
  /** Unsubscribe bucket. */
  readonly bucket: UnsubBucket;
  /** Optional note (bug status, migration, deprecation). */
  readonly note?: string;
}

// The registry. Keyed by the template/label used at send time. Every template in
// TEMPLATES (registry.ts), AUTH_TEMPLATES and BULK_TEMPLATES (types.ts), plus the
// inline-HTML and DB-trigger emails, MUST appear here.
export const EMAIL_TIERS: Record<string, EmailTypeSpec> = {
  // ---- Tier 0: critical transactional (always send) ----
  // Auth lane (GoTrue hook). Never gated.
  signup: { tier: 0, lane: "auth", bucket: "none" },
  invite: { tier: 0, lane: "auth", bucket: "none" },
  magiclink: { tier: 0, lane: "auth", bucket: "none" },
  recovery: { tier: 0, lane: "auth", bucket: "none" },
  email_change: { tier: 0, lane: "auth", bucket: "none" },
  reauthentication: { tier: 0, lane: "auth", bucket: "none" },

  // Transactional lane.
  "general-application-submitted": { tier: 0, lane: "transactional", bucket: "none" },
  "project-application-submitted": { tier: 0, lane: "transactional", bucket: "none" },
  "support-ticket-reply": { tier: 0, lane: "transactional", bucket: "none" },
  "class-status-change": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "Teacher (owner) + admins — curriculum authoring workflow. Trainee/cohort notification dropped 2026-08-20: learners enrol in cohorts (cohort_registrations), not classes, so class-status transitions are authoring-only.",
  },
  "interview-invite": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "PR 3: remove notify_announcements gate (core suppression bug).",
  },
  "applicant-status-change": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "PR 3: remove notify_announcements gate (core suppression bug).",
  },
  "observer-role-granted": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "PR 3: remove notify_announcements gate (core suppression bug).",
  },
  "community-agreement-request": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "PR 3: remove the training/announcements gate (offer of an earned place).",
  },
  "resume-application": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "Owner decision: Tier 0. PR 3 removes its notify_announcements gate.",
  },
  admin_promotion: {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "Renders inline HTML; PR 13 (C8) brings it into the template registry.",
  },
  teacher_promotion: {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "Renders inline HTML; PR 13 (C8) brings it into the template registry.",
  },
  "signup-confirmation-reminder": {
    tier: 0,
    lane: "transactional",
    bucket: "none",
    note: "DEAD template (no caller). PR 13 (C1) removes it.",
  },

  // Bulk lane, still Tier 0 (owner decision).
  "project-blast": {
    tier: 0,
    lane: "bulk",
    bucket: "none",
    note: "Owner decision: Tier 0 (about the recipient's own application to that project).",
  },

  // ---- Tier 1: service / opportunity (everyone, one opt-out) ----
  "quest-nudge": {
    tier: 1,
    lane: "transactional",
    bucket: "opportunities",
    note: "PR 5: re-gate from notify_announcements to the Tier-1 opportunities opt-out.",
  },
  project_opening_alert: {
    tier: 1,
    lane: "bulk",
    bucket: "opportunities",
    note: "🔴 On the retired raw queue (delivering nothing). PR 2 migrates to v2; PR 5 re-gates; interest filter removed.",
  },

  // ---- Announcement: classified per send by the composer (Tier 1 or Tier 2) ----
  announcement: {
    tier: "per-send",
    lane: "bulk",
    bucket: "per-send",
    note: "PR 11: composer picks service (Tier 1, everyone-minus-optout) or marketing (Tier 2, consent ledger).",
  },

  // ---- Ops: internal staff/admin (no member preference) ----
  "admin-member-alert": {
    tier: "ops",
    lane: "transactional",
    bucket: "none",
    note: "Targets the project coordinator (fallback: inviting admin).",
  },
  "fleety-coach-digest": { tier: "ops", lane: "bulk", bucket: "none", note: "All admins." },
  feedback_alert: {
    tier: "ops",
    lane: "transactional",
    bucket: "none",
    note: "🔴 On the retired raw queue (delivering nothing). PR 2 migrates to v2. All admins.",
  },
  "triage-digest": {
    tier: "ops",
    lane: "transactional",
    bucket: "none",
    note: "PR 13: whole feature removed (email + Discord + cron), owner decision.",
  },
};

/** Lookup, or undefined if the template is not registered. */
export function getEmailSpec(template: string): EmailTypeSpec | undefined {
  return EMAIL_TIERS[template];
}

/** Lookup, or throw. Use in send paths so an unregistered template fails loudly. */
export function requireEmailSpec(template: string): EmailTypeSpec {
  const spec = EMAIL_TIERS[template];
  if (!spec) {
    throw new Error(
      `Email template "${template}" has no tier registry entry. ` +
        `Add it to EMAIL_TIERS in _shared/email/domain/email-tiers.ts.`
    );
  }
  return spec;
}

/** True only for Tier 0. Tier-0 send paths must never read a member preference. */
export function isCriticalTransactional(template: string): boolean {
  return EMAIL_TIERS[template]?.tier === 0;
}

/** The unsubscribe bucket for a template ('none' if unknown / not member-facing). */
export function unsubBucketOf(template: string): UnsubBucket {
  return EMAIL_TIERS[template]?.bucket ?? "none";
}

/** Every registered template identifier. */
export const REGISTERED_TEMPLATES: readonly string[] = Object.freeze(Object.keys(EMAIL_TIERS));
