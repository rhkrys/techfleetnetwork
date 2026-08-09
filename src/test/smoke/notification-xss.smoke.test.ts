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
});
