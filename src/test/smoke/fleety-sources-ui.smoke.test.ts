import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety's STRUCTURAL citations in the UI (PRD D-08 / G-02).
 *
 * The techfleet-chat edge function GUARANTEES the source URLs (navigable guide/SPF
 * links from the retrieved KB entries) in the `X-Fleety-Sources` response header,
 * independent of whatever the model wrote. Both chat surfaces must READ that header
 * and RENDER the links — otherwise the guarantee is invisible to members (which was
 * the pre-existing bug: the header was emitted but no frontend consumed it).
 *
 * These assertions read the component source directly (full React render tests need
 * the app shell + a mocked stream) and fail loudly if a refactor drops the header
 * consumption or the Sources rendering from either surface.
 */
const SURFACES = ["src/pages/ChatPage.tsx", "src/components/FleetyChatWidget.tsx"];

describe("fleety structural citations render in the chat UIs (D-08)", () => {
  for (const path of SURFACES) {
    describe(path, () => {
      const src = read(path);

      it("reads the X-Fleety-Sources response header", () => {
        expect(src).toMatch(/headers\.get\(["']X-Fleety-Sources["']\)/);
      });

      it("renders a Sources list from the parsed URLs", () => {
        // The message model carries sources, and the render path emits a labelled list.
        expect(src).toMatch(/sources\??:\s*string\[\]/);
        expect(src).toMatch(/msg\.sources/);
        expect(src).toMatch(/Sources/);
        // Links are rendered as anchors opening safely in a new tab.
        expect(src).toMatch(/rel=["']noopener noreferrer["']/);
      });
    });
  }
});
