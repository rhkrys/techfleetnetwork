import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FLEETY_MODE,
  FLEETY_MODES,
  fleetyModeMeta,
  isFleetyMode,
  loadStoredMode,
  storeMode,
} from "./modes";

afterEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* ignore */
  }
});

describe("fleety modes", () => {
  it("exposes exactly chat / review / plan", () => {
    expect(FLEETY_MODES.map((m) => m.id)).toEqual(["chat", "review", "plan"]);
  });

  it("isFleetyMode guards unknown values", () => {
    expect(isFleetyMode("plan")).toBe(true);
    expect(isFleetyMode("PLAN")).toBe(false);
    expect(isFleetyMode("bogus")).toBe(false);
    expect(isFleetyMode(null)).toBe(false);
  });

  it("fleetyModeMeta falls back to chat for unknown ids", () => {
    expect(fleetyModeMeta("review").short).toBe("Review");
    expect(fleetyModeMeta("nope" as never).id).toBe("chat");
  });

  it("persists and restores the selected mode", () => {
    storeMode("plan");
    expect(loadStoredMode()).toBe("plan");
  });

  it("defaults to chat when nothing valid is stored", () => {
    globalThis.localStorage?.setItem("fleety.mode", "garbage");
    expect(loadStoredMode()).toBe(DEFAULT_FLEETY_MODE);
  });
});
