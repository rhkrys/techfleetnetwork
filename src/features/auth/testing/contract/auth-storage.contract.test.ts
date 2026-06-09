import { describe, expect, it } from "vitest";
import {
  bumpResetAttempts,
  clearResetAttempts,
  readLoginLockout,
  writeLoginLockout,
  clearLoginLockout,
  purgeAuthOwnedStorage,
  readCorrelationId,
  writeCorrelationId,
} from "../../services/auth-storage.service";

describe("auth-storage.service", () => {
  it("reset attempts are monotonic and clearable", () => {
    clearResetAttempts();
    expect(bumpResetAttempts()).toBe(1);
    expect(bumpResetAttempts()).toBe(2);
    expect(bumpResetAttempts()).toBe(3);
    clearResetAttempts();
    expect(bumpResetAttempts()).toBe(1);
  });

  it("login lockout snapshot round-trips", () => {
    writeLoginLockout({ attempts: 4, lockedUntilMs: 9_999_999 });
    expect(readLoginLockout()).toEqual({ attempts: 4, lockedUntilMs: 9_999_999 });
    clearLoginLockout();
    expect(readLoginLockout()).toEqual({ attempts: 0, lockedUntilMs: 0 });
  });

  it("malformed lockout falls back to zeros (never crashes)", () => {
    localStorage.setItem("tfn:auth:login-lockout", "not json");
    expect(readLoginLockout()).toEqual({ attempts: 0, lockedUntilMs: 0 });
  });

  it("purgeAuthOwnedStorage clears every owned key", () => {
    writeCorrelationId("abc-123");
    writeLoginLockout({ attempts: 2, lockedUntilMs: 1 });
    bumpResetAttempts();
    purgeAuthOwnedStorage();
    expect(readCorrelationId()).toBeNull();
    expect(readLoginLockout()).toEqual({ attempts: 0, lockedUntilMs: 0 });
  });
});
