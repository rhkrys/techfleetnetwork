// Smoke coverage for audit T-F — one-shot reminder / debounce timestamps must
// only advance when the message was actually delivered. Behavioral test of the
// pure helper + grep invariants that both cron senders gate the stamp on it and
// detect a failed functions.invoke via its returned { error }.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { wasDelivered } from "../../../supabase/functions/_shared/nudge-delivery.ts";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

describe("nudge/reminder delivery gating (smoke)", () => {
  it("TF-NUDGE-001: delivered when the in-app notification succeeded", () => {
    expect(wasDelivered({ inAppOk: true, emailAttempted: false, emailOk: false })).toBe(true);
    expect(wasDelivered({ inAppOk: true, emailAttempted: true, emailOk: false })).toBe(true);
  });

  it("TF-NUDGE-002: delivered when an attempted email was sent ok", () => {
    expect(wasDelivered({ inAppOk: false, emailAttempted: true, emailOk: true })).toBe(true);
  });

  it("TF-NUDGE-003: NOT delivered when the email failed and there was no in-app", () => {
    expect(wasDelivered({ inAppOk: false, emailAttempted: true, emailOk: false })).toBe(false);
  });

  it("TF-NUDGE-004: NOT delivered when email was skipped (opted out) and no in-app", () => {
    expect(wasDelivered({ inAppOk: false, emailAttempted: false, emailOk: false })).toBe(false);
  });

  it("TF-NUDGE-005: both cron senders gate the one-shot stamp on wasDelivered and check invoke error", () => {
    for (const f of ["resume-application-reminder", "quest-nudge"]) {
      const src = read(`supabase/functions/${f}/index.ts`);
      // captures the returned { error } from functions.invoke (not only a throw)
      expect(src).toMatch(/error:\s*emailErr\s*\}\s*=/);
      expect(src).toMatch(/supabase\.functions\.invoke\(/);
      // stamps only when delivered
      expect(src).toMatch(/if\s*\(!wasDelivered\(/);
    }
  });

  it("TF-NUDGE-006: resume-application-reminder no longer stamps unconditionally after the email block", () => {
    const src = read("supabase/functions/resume-application-reminder/index.ts");
    // the delivery gate must appear before the resume_reminder_sent_at update
    expect(src.indexOf("if (!wasDelivered(")).toBeLessThan(src.indexOf("resume_reminder_sent_at:"));
  });

  it("TF-NUDGE-007: quest-nudge gates before advancing last_nudged_at", () => {
    const src = read("supabase/functions/quest-nudge/index.ts");
    expect(src.indexOf("if (!wasDelivered(")).toBeLessThan(src.indexOf("last_nudged_at:"));
  });
});
