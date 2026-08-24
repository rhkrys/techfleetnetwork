import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FEEDBACK_REASONS } from "@/lib/fleety/feedback";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety answer feedback (👍/👎) across surfaces. The learning loop
 * (techfleet-chat few-shot exemplars + canned-answer ranking + nightly suppression) only learns
 * from turns that GOT feedback — so every member-facing surface must capture it, not just the
 * floating widget. Before this, only FleetyChatWidget had thumbs; ChatPage and GuidanceEmbed (the
 * main /resources widget) fed nothing back. All three now use the SHARED FleetyMessageFeedback
 * component keyed on the X-Fleety-Turn-Id header. Source-level assertions (same convention as
 * fleety-modes-ui.smoke.test.ts) fail loudly if a surface drops feedback capture.
 */
describe("fleety feedback client (shared source of truth)", () => {
  it("exposes a stable reason-chip set", () => {
    expect(FEEDBACK_REASONS.length).toBeGreaterThanOrEqual(4);
    expect(FEEDBACK_REASONS).toContain("Too vague");
  });
});

const SURFACES = [
  "src/pages/ChatPage.tsx",
  "src/components/FleetyChatWidget.tsx",
  "src/components/resources/GuidanceEmbed.tsx",
];

describe("all chat surfaces capture answer feedback into the learning loop", () => {
  for (const path of SURFACES) {
    describe(path, () => {
      const src = read(path);
      it("uses the shared feedback component (no per-surface duplicate)", () => {
        expect(src).toMatch(/from ["']@\/components\/fleety\/FleetyFeedback["']/);
        expect(src).toMatch(/<FleetyMessageFeedback\s+turnId=/);
      });
      it("reads the turn id header so a rating ties back to the answer", () => {
        expect(src).toMatch(/X-Fleety-Turn-Id/);
        expect(src).toMatch(/turnId/);
      });
    });
  }
});
