/**
 * TRIAGE-NOISE-013 + TRIAGE-NOISE-014 regression tests.
 *
 * Locks the fingerprint-normalization rules and the opaque-payload drop so
 * the "19 pending fingerprints for one defect" pattern can't quietly come
 * back the next time we add a new per-user query key.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeFingerprintKey,
  isOpaqueScriptErrorMessage,
} from "@/services/error-reporter.service";

describe("normalizeFingerprintKey (TRIAGE-NOISE-013)", () => {
  it("replaces UUIDs with :id so per-user sources collapse", () => {
    const a = "query.journey-completed.fca0f463-bff0-4f31-b44f-6001ae64ec14.observer.obs-1,obs-2,obs-3,obs-4";
    const b = "query.journey-completed.517cae33-cb83-4e0b-b8fb-30dc16c5ebb9.observer.obs-1,obs-2,obs-3,obs-4";
    expect(normalizeFingerprintKey(a)).toBe(normalizeFingerprintKey(b));
    expect(normalizeFingerprintKey(a)).toContain(":id");
  });

  it("collapses comma-separated slug lists with 3+ tokens to :list", () => {
    const out = normalizeFingerprintKey(
      "query.x.foo,bar,baz,qux"
    );
    expect(out).toContain(":list");
    expect(out).not.toContain("foo,bar,baz");
  });

  it("strips long hex blobs as :hash", () => {
    const out = normalizeFingerprintKey("error.sha-abc123def456789ffeed");
    expect(out).toContain(":hash");
  });

  it("collapses long numeric ids", () => {
    const out = normalizeFingerprintKey("queue.job.987654321");
    expect(out).toContain(":id");
  });

  it("leaves short, stable keys untouched", () => {
    expect(normalizeFingerprintKey("query.announcements")).toBe(
      "query.announcements",
    );
  });
});

describe("isOpaqueScriptErrorMessage SerializationError extension (TRIAGE-NOISE-014)", () => {
  it("drops SerializationError with empty message payload", () => {
    expect(
      isOpaqueScriptErrorMessage(
        'SerializationError: Non-Error thrown: {"message":""}',
      ),
    ).toBe(true);
  });

  it("drops SerializationError with empty object payload", () => {
    expect(
      isOpaqueScriptErrorMessage("SerializationError: Non-Error thrown: {}"),
    ).toBe(true);
  });

  it("drops multi-line wrappers (only first line counts)", () => {
    expect(
      isOpaqueScriptErrorMessage(
        'SerializationError: Non-Error thrown: {"message":""}\n  at lb (https://x/y.js:1:1)',
      ),
    ).toBe(true);
  });

  it("does NOT drop SerializationError with a real message", () => {
    expect(
      isOpaqueScriptErrorMessage(
        'SerializationError: Non-Error thrown: {"message":"something went wrong"}',
      ),
    ).toBe(false);
  });

  it("still drops the classic 'Script error.'", () => {
    expect(isOpaqueScriptErrorMessage("Script error.")).toBe(true);
  });
});
