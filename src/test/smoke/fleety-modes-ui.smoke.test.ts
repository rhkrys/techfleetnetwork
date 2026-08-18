import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_FLEETY_MODE, FLEETY_MODES, fleetyModeMeta } from "@/lib/fleety/modes";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety's mode switch (2.2-B): Chat / Deliverables Review / Plan — a UI
 * switch like Claude's modes. Both chat surfaces must import the SHARED mode metadata (single
 * source of truth in src/lib/fleety/modes.ts, kept in lockstep with the server's `mode` enum) and
 * send the selected mode to techfleet-chat. Full render tests need the app shell + a mocked stream;
 * these source-level assertions (same convention as fleety-sources-ui.smoke.test.ts) fail loudly if
 * a refactor drops the selector or stops sending the mode.
 */
describe("fleety mode metadata (shared source of truth)", () => {
  it("exposes exactly chat / review / plan", () => {
    expect(FLEETY_MODES.map((m) => m.id)).toEqual(["chat", "review", "plan"]);
  });
  it("defaults to chat and resolves meta safely", () => {
    expect(DEFAULT_FLEETY_MODE).toBe("chat");
    expect(fleetyModeMeta("review").label).toBe("Deliverables Review");
    // Unknown/casted value falls back to the first (chat) rather than throwing.
    expect(fleetyModeMeta("bogus" as never).id).toBe("chat");
  });
  it("every mode has a non-empty placeholder", () => {
    for (const m of FLEETY_MODES) expect(m.placeholder.length).toBeGreaterThan(0);
  });
});

// ALL three member-facing Fleety surfaces must carry the mode switch — the /chat page, the floating
// widget, and the /resources GuidanceEmbed (the main member widget). Fleety UI changes must land on
// all of them together, so this list guards against a surface silently drifting behind.
const SURFACES = [
  "src/pages/ChatPage.tsx",
  "src/components/FleetyChatWidget.tsx",
  "src/components/resources/GuidanceEmbed.tsx",
];

describe("all chat surfaces wire the mode switch", () => {
  for (const path of SURFACES) {
    describe(path, () => {
      const src = read(path);
      it("imports the shared mode module (no duplicated mode list)", () => {
        expect(src).toMatch(/from ["']@\/lib\/fleety\/modes["']/);
      });
      it("renders a mode radiogroup over the shared list", () => {
        expect(src).toMatch(/role="radiogroup"/);
        expect(src).toMatch(/FLEETY_MODES\.map/);
        expect(src).toMatch(/aria-checked=\{mode === m\.id\}/);
      });
      it("sends the selected mode to techfleet-chat", () => {
        expect(src).toMatch(/\bmode\b/);
        expect(src).toMatch(/JSON\.stringify\(\{[^}]*mode/s);
      });
    });
  }
});
