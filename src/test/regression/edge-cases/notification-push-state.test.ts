// NOTIF-EDGE-002 — service worker unavailable → graceful "unavailable" state.
import { describe, it, expect } from "vitest";

type PushState = "ready" | "denied" | "unavailable";

function pushState(sw: boolean, perm: NotificationPermission | "default" | "denied" | "granted"): PushState {
  if (!sw) return "unavailable";
  if (perm === "denied") return "denied";
  return "ready";
}

describe("NOTIF-EDGE: push graceful degradation", () => {
  it("002 returns 'unavailable' when no SW", () => {
    expect(pushState(false, "granted")).toBe("unavailable");
  });

  it("returns 'denied' when permission denied", () => {
    expect(pushState(true, "denied")).toBe("denied");
  });

  it("returns 'ready' when SW + granted", () => {
    expect(pushState(true, "granted")).toBe("ready");
  });
});
