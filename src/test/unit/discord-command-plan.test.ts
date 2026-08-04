// Behavioral coverage for the declarative Discord command manifest + the
// deletion-safety planner. Backs BDD DISCORD-CMD-001..004 (005/006 are wiring
// asserted in discord-command-registration.smoke.test.ts).
import { describe, it, expect } from "vitest";
import { COMMANDS, planCommandChanges } from "@/lib/discord/command-plan";

describe("Discord command registration plan (unit)", () => {
  it("DISCORD-CMD-001: manifest declares fleety + support with the right required options", () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual(["fleety", "support"]);
    const support = COMMANDS.find((c) => c.name === "support")!;
    expect(support.options?.map((o) => o.name)).toEqual(["subject", "details"]);
    expect(support.options?.every((o) => o.required)).toBe(true);
  });

  it("DISCORD-CMD-002: in-sync state is an idempotent no-op (no deletions, not blocked)", () => {
    const names = COMMANDS.map((c) => c.name);
    const plan = planCommandChanges(names, names, false);
    expect(plan.deletions).toEqual([]);
    expect(plan.blocked).toBe(false);
  });

  it("DISCORD-CMD-003: refuses (blocks) when a registered command is missing from the manifest", () => {
    const plan = planCommandChanges(["fleety", "support", "legacy"], ["fleety", "support"], false);
    expect(plan.deletions).toEqual(["legacy"]);
    expect(plan.blocked).toBe(true);
  });

  it("DISCORD-CMD-004: deletion proceeds only with an explicit override", () => {
    const plan = planCommandChanges(["fleety", "support", "legacy"], ["fleety", "support"], true);
    expect(plan.deletions).toEqual(["legacy"]);
    expect(plan.blocked).toBe(false);
  });
});
