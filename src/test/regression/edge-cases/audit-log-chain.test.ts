// AUDIT-EDGE-001/002 — hash chain validity + DELETE refusal logic.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

type LogRow = { id: number; payload: string; prev_hash: string; hash: string };

function rowHash(prev: string, payload: string): string {
  return createHash("sha256").update(prev + payload).digest("hex");
}

function verifyChain(rows: LogRow[]): boolean {
  let prev = "";
  for (const r of rows) {
    const expected = rowHash(prev, r.payload);
    if (expected !== r.hash || r.prev_hash !== prev) return false;
    prev = r.hash;
  }
  return true;
}

describe("AUDIT-EDGE: audit log integrity", () => {
  it("001 detects intact chain", () => {
    const r1: LogRow = { id: 1, payload: "a", prev_hash: "", hash: rowHash("", "a") };
    const r2: LogRow = { id: 2, payload: "b", prev_hash: r1.hash, hash: rowHash(r1.hash, "b") };
    expect(verifyChain([r1, r2])).toBe(true);
  });

  it("001 detects tampered payload", () => {
    const r1: LogRow = { id: 1, payload: "a", prev_hash: "", hash: rowHash("", "a") };
    const r2: LogRow = { id: 2, payload: "TAMPERED", prev_hash: r1.hash, hash: rowHash(r1.hash, "b") };
    expect(verifyChain([r1, r2])).toBe(false);
  });

  it("002 DELETE intent is always refused (sentinel)", () => {
    const intent = "DELETE FROM audit_log";
    const allow = (sql: string) => !/^\s*DELETE\s+FROM\s+audit_log/i.test(sql);
    expect(allow(intent)).toBe(false);
  });
});
