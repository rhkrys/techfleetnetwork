import { describe, it, expect, vi } from "vitest";
import { withBoundedSave, SaveIndeterminateError } from "../bounded-save";

describe("withBoundedSave", () => {
  it("resolves saved when save completes within timeout", async () => {
    const probe = vi.fn();
    const r = await withBoundedSave({
      timeoutMs: 50,
      save: async () => {},
      probe,
    });
    expect(r.kind).toBe("saved");
    expect(probe).not.toHaveBeenCalled();
  });

  it("propagates a hard save error without probing", async () => {
    const probe = vi.fn();
    await expect(
      withBoundedSave({
        timeoutMs: 50,
        save: async () => { throw new Error("boom"); },
        probe,
      }),
    ).rejects.toThrow("boom");
    expect(probe).not.toHaveBeenCalled();
  });

  it("timeout + probe says persisted → indeterminate_resolved", async () => {
    const r = await withBoundedSave({
      timeoutMs: 20,
      save: () => new Promise(() => { /* never */ }),
      probe: async () => "persisted",
    });
    expect(r.kind).toBe("indeterminate_resolved");
  });

  it("timeout + probe says unresolved → SaveIndeterminateError", async () => {
    await expect(
      withBoundedSave({
        timeoutMs: 20,
        save: () => new Promise(() => {}),
        probe: async () => "unresolved",
      }),
    ).rejects.toBeInstanceOf(SaveIndeterminateError);
  });

  it("emits status transitions saving → checking → saved on probe hit", async () => {
    const statuses: string[] = [];
    await withBoundedSave({
      timeoutMs: 10,
      save: () => new Promise(() => {}),
      probe: async () => "persisted",
      onStatus: (s) => statuses.push(s),
    });
    expect(statuses).toEqual(["saving", "checking", "saved"]);
  });
});
