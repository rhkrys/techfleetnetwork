import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety saved-chat persistence (hot-fix G1 / #21):
 * "history disappeared in the middle of the session".
 *
 * Both chat surfaces persist to chat_conversations / chat_messages and reload messages when
 * activeConvoId changes. The bug: sending the FIRST message of a new chat calls setActiveConvoId
 * with the freshly-created id, which fired the [activeConvoId] reload effect. That effect ran a
 * SELECT and overwrote `messages` with the DB snapshot — but the assistant reply isn't saved until
 * onDone, so on a fast/cached answer the reload landed after the answer rendered and WIPED it off
 * screen (even though it was stored). Fix: a skipConvoReloadRef guard suppresses exactly that one
 * self-inflicted reload, so the live turn survives; reloads still run when a user picks an existing
 * conversation from the sidebar.
 *
 * Full render tests need the app shell + a mocked SSE stream + a mocked Supabase client; these
 * source-level assertions (matching fleety-sources-ui.smoke.test.ts) fail loudly if a refactor
 * drops the guard and reopens the clobber.
 */
const SURFACES = [
  "src/pages/ChatPage.tsx",
  "src/components/FleetyChatWidget.tsx",
  "src/components/resources/GuidanceEmbed.tsx",
];

describe("fleety chat history survives the first-message reload (G1/#21)", () => {
  for (const path of SURFACES) {
    describe(path, () => {
      const src = read(path);

      it("still persists across sessions (creates a conversation and loads history)", () => {
        expect(src).toMatch(/from\(["']chat_conversations["']\)/);
        expect(src).toMatch(/from\(["']chat_messages["']\)/);
      });

      it("declares the skip-reload guard ref", () => {
        expect(src).toMatch(/skipConvoReloadRef\s*=\s*useRef\(false\)/);
      });

      it("arms the guard before flipping activeConvoId on a new chat", () => {
        // The assignment must appear before the setActiveConvoId call in the send path.
        const armIdx = src.indexOf("skipConvoReloadRef.current = true");
        const setIdx = src.indexOf("setActiveConvoId(convoId)");
        expect(armIdx).toBeGreaterThan(-1);
        expect(setIdx).toBeGreaterThan(-1);
        expect(armIdx).toBeLessThan(setIdx);
      });

      it("short-circuits the reload effect when the guard is armed", () => {
        expect(src).toMatch(/if\s*\(skipConvoReloadRef\.current\)\s*\{/);
        // and clears it so subsequent sidebar selections DO reload
        expect(src).toMatch(/skipConvoReloadRef\.current\s*=\s*false/);
      });
    });
  }
});
