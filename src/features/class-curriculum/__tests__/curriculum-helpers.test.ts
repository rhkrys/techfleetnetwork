import { describe, expect, it } from "vitest";
import { computeProgress, previewVideoProvider, reorderIds } from "../lib/curriculum-helpers";

describe("class-curriculum helpers", () => {
  describe("previewVideoProvider", () => {
    it("parses youtube watch URLs", () => {
      const r = previewVideoProvider("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(r.provider).toBe("youtube");
      expect(r.embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    });
    it("parses youtu.be short URLs", () => {
      const r = previewVideoProvider("https://youtu.be/abc12345xyz");
      expect(r.provider).toBe("youtube");
      expect(r.embedUrl).toBe("https://www.youtube-nocookie.com/embed/abc12345xyz");
    });
    it("parses youtube shorts", () => {
      const r = previewVideoProvider("https://www.youtube.com/shorts/abcdef1234");
      expect(r.provider).toBe("youtube");
    });
    it("parses vimeo URLs", () => {
      const r = previewVideoProvider("https://vimeo.com/123456789");
      expect(r.provider).toBe("vimeo");
      expect(r.embedUrl).toBe("https://player.vimeo.com/video/123456789");
    });
    it("parses loom share URLs", () => {
      const r = previewVideoProvider("https://www.loom.com/share/abc123def456");
      expect(r.provider).toBe("loom");
      expect(r.embedUrl).toBe("https://www.loom.com/embed/abc123def456");
    });
    it("flags google meet but does not iframe-embed", () => {
      const url = "https://meet.google.com/abc-defg-hij";
      const r = previewVideoProvider(url);
      expect(r.provider).toBe("google_meet");
      expect(r.embedUrl).toBe(url);
    });
    it("rejects non-http schemes as 'other'", () => {
      expect(previewVideoProvider("javascript:alert(1)").provider).toBe("other");
      expect(previewVideoProvider("ftp://x/y").provider).toBe("other");
    });
    it("returns 'none' for empty", () => {
      expect(previewVideoProvider("").provider).toBe("none");
      expect(previewVideoProvider(null).provider).toBe("none");
      expect(previewVideoProvider(undefined).provider).toBe("none");
    });
  });

  describe("reorderIds", () => {
    it("moves item down", () => {
      expect(reorderIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    });
    it("moves item up", () => {
      expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    });
    it("no-ops when from===to", () => {
      expect(reorderIds(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    });
    it("no-ops when id not present", () => {
      expect(reorderIds(["a", "b"], "z", "a")).toEqual(["a", "b"]);
    });
    it("returns a new array (immutability)", () => {
      const input = ["a", "b", "c"];
      const out = reorderIds(input, "a", "b");
      expect(out).not.toBe(input);
    });
  });

  describe("computeProgress", () => {
    it("counts only required items", () => {
      const items = [
        { id: "1", required: true },
        { id: "2", required: false },
        { id: "3", required: true },
      ];
      const r = computeProgress(items, new Set(["1", "2"]));
      expect(r).toEqual({ requiredTotal: 2, requiredDone: 1, percent: 50 });
    });
    it("returns 0% when there are no required items", () => {
      expect(computeProgress([], new Set())).toEqual({ requiredTotal: 0, requiredDone: 0, percent: 0 });
    });
    it("returns 100% when all required done", () => {
      const items = [{ id: "1", required: true }, { id: "2", required: true }];
      expect(computeProgress(items, new Set(["1", "2"])).percent).toBe(100);
    });
  });
});
