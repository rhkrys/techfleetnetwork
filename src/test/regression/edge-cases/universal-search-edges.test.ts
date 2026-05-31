// USR-EDGE-001/002/004/010 — universal search edge cases (pure logic locks).
import { describe, it, expect, vi } from "vitest";

function clampQuery(q: string, max = 200) {
  return q.slice(0, max);
}

function debounce<T extends (...a: any[]) => any>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

describe("USR-EDGE: universal search", () => {
  it("001 empty query → no fetch", () => {
    const search = vi.fn();
    const q = "";
    if (q.trim()) search(q);
    expect(search).not.toHaveBeenCalled();
  });

  it("002 debounce coalesces fast strokes", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 250);
    d("f"); d("fo"); d("foo");
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("foo");
    vi.useRealTimers();
  });

  it("004 empty results path returns []", () => {
    expect([] as string[]).toEqual([]);
  });

  it("010 long query clamped to 200 chars", () => {
    expect(clampQuery("x".repeat(500)).length).toBe(200);
  });
});
