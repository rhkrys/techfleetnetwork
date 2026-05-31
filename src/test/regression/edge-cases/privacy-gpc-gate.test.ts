// PRIV-EDGE-001 — GPC denied pre-mount; analytics never loads.
import { describe, it, expect, vi } from "vitest";

function shouldLoadAnalytics(opts: { gpc: boolean; consent: "granted" | "denied" | "unset" }) {
  if (opts.gpc) return false; // GPC = automatic deny
  return opts.consent === "granted";
}

describe("PRIV-EDGE: GPC honored pre-mount", () => {
  it("001 GPC=1 blocks analytics regardless of consent", () => {
    expect(shouldLoadAnalytics({ gpc: true, consent: "granted" })).toBe(false);
    expect(shouldLoadAnalytics({ gpc: true, consent: "denied" })).toBe(false);
  });

  it("loads only when consent granted and no GPC", () => {
    expect(shouldLoadAnalytics({ gpc: false, consent: "granted" })).toBe(true);
  });

  it("unset consent blocks load (consent-first)", () => {
    expect(shouldLoadAnalytics({ gpc: false, consent: "unset" })).toBe(false);
  });
});
