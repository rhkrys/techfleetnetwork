// Smoke coverage for audit T-D — stored XSS via notification title/body_html.
// Every writer must escape user/teacher-controlled text before insert (the
// render path trusts stored HTML). Hermetic file-content invariants; the escape
// helper itself is unit-tested in _shared/escape-html.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const questNudge = read("supabase/functions/quest-nudge/index.ts");
const markInterview = read("supabase/functions/mark-interview-scheduled/index.ts");
const promoteAdmin = read("supabase/functions/promote-to-admin/index.ts");
const promoteTeacher = read("supabase/functions/promote-to-teacher/index.ts");
const notifyClassPublished = read("supabase/functions/notify-class-published/index.ts");
const notifyApplicant = read("supabase/functions/notify-applicant-status/index.ts");
const announcementEmail = read("supabase/functions/send-announcement-email/index.ts");
const replayDlq = read("supabase/functions/replay-dlq-emails/index.ts");

describe("notification stored-XSS escaping (smoke)", () => {
  it("T-D-001: quest-nudge escapes path_title before title/body_html", () => {
    expect(questNudge).toMatch(/escapeHtml/);
    // Raw path_title must not be interpolated straight into title/body_html.
    expect(questNudge).not.toMatch(/title:\s*`Pick back up: \$\{c\.path_title\}`/);
    expect(questNudge).not.toMatch(/<strong>\$\{c\.path_title\}<\/strong>/);
  });

  it("T-D-002: mark-interview-scheduled escapes applicantName in the title", () => {
    // The title must use the escaped name, not the raw one.
    expect(markInterview).not.toMatch(/Interview Scheduled — \$\{applicantName\}`/);
    expect(markInterview).toMatch(/Interview Scheduled — \$\{safeApplicantName\}`/);
  });

  it("T-D-003: promote-to-admin escapes userName in the HTML email body", () => {
    expect(promoteAdmin).toMatch(/Hi \$\{escapeHtml\(userName\)\},<\/p>/);
    // The raw HTML interpolation must be gone (the plain-text `text:` field may keep it).
    expect(promoteAdmin).not.toMatch(/>Hi \$\{userName\},<\/p>/);
  });

  it("T-D-004: promote-to-teacher escapes userName in the HTML email body", () => {
    expect(promoteTeacher).toMatch(/Hi \$\{escapeHtml\(userName\)\},<\/p>/);
    expect(promoteTeacher).not.toMatch(/>Hi \$\{userName\},<\/p>/);
  });

  it("T-D-005: notify-class-published escapes the teacher-controlled class title", () => {
    expect(notifyClassPublished).toMatch(/New class published: \$\{escapeHtml\(cls\.title\)\}/);
    expect(notifyClassPublished).not.toMatch(/New class published: \$\{cls\.title\}`/);
  });

  it("T-D-006: notify-applicant-status escapes projectName in the notification title", () => {
    expect(notifyApplicant).toMatch(/— \$\{escapeHtml\(projectName\)\}`/);
    expect(notifyApplicant).not.toMatch(/— \$\{projectName\}`/);
  });

  it("T-D-007: announcement emails escape the title in the <h2> sink", () => {
    expect(announcementEmail).toMatch(/<h2[^>]*>\$\{escHtml\(announcement\.title\)\}<\/h2>/);
    expect(announcementEmail).not.toMatch(/<h2[^>]*>\$\{announcement\.title\}<\/h2>/);
    expect(replayDlq).toMatch(/<h2[^>]*>\$\{escHtml\(title\)\}<\/h2>/);
    expect(replayDlq).not.toMatch(/<h2[^>]*>\$\{title\}<\/h2>/);
  });
});
