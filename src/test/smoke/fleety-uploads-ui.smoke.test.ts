import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACCEPTED_FILE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/fleety/attachment";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety file uploads (2.2-F). All THREE member-facing surfaces must wire the
 * SHARED attach control (single source of truth: src/lib/fleety/attachment.ts + the
 * useFleetyAttachment hook + FleetyAttach components) and pass the extracted attachment to
 * techfleet-chat. Fleety UI changes land on all three together, so this list guards against a
 * surface silently drifting behind. Full render tests need the app shell + a mocked stream + a
 * mocked upload; these source-level assertions (same convention as fleety-modes-ui.smoke.test.ts)
 * fail loudly if a refactor drops the attach button or stops sending the attachment.
 */
describe("fleety attachment client (shared source of truth)", () => {
  it("caps uploads at 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });
  it("hints pdf/image/text file types (server still decides the true type)", () => {
    expect(ACCEPTED_FILE_TYPES).toMatch(/\.pdf/);
    expect(ACCEPTED_FILE_TYPES).toMatch(/\.png/);
    expect(ACCEPTED_FILE_TYPES).toMatch(/\.txt/);
    // docx/xlsx are intentionally NOT offered (refused server-side).
    expect(ACCEPTED_FILE_TYPES).not.toMatch(/\.docx/);
    expect(ACCEPTED_FILE_TYPES).not.toMatch(/\.xlsx/);
  });
});

const SURFACES = [
  "src/pages/ChatPage.tsx",
  "src/components/FleetyChatWidget.tsx",
  "src/components/resources/GuidanceEmbed.tsx",
];

describe("all chat surfaces wire the shared upload control", () => {
  for (const path of SURFACES) {
    describe(path, () => {
      const src = read(path);
      it("uses the shared attachment hook (no per-surface upload logic)", () => {
        expect(src).toMatch(/from ["']@\/hooks\/useFleetyAttachment["']/);
        expect(src).toMatch(/useFleetyAttachment\(\)/);
      });
      it("renders the shared attach button + status chip", () => {
        expect(src).toMatch(/from ["']@\/components\/fleety\/FleetyAttach["']/);
        expect(src).toMatch(/<FleetyAttachButton/);
        expect(src).toMatch(/<FleetyAttachmentChip/);
      });
      it("sends the extracted attachment to techfleet-chat", () => {
        expect(src).toMatch(/toChatAttachment/);
        expect(src).toMatch(/attachment/);
      });
    });
  }
});
