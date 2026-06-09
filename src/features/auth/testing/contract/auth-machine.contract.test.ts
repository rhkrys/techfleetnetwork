import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import { createAuthMachine } from "../../state/auth-machine";
import type { AuthErr, AuthOk } from "../../domain/auth-result";

const correlationId = "test-corr-id";

function makeActor(mode: Parameters<typeof createAuthMachine>[0]["mode"] = "signin_password") {
  const actor = createActor(createAuthMachine({ mode }), { input: { mode } });
  actor.start();
  return actor;
}

describe("auth-machine contract", () => {
  it("starts in idle", () => {
    const a = makeActor();
    expect(a.getSnapshot().value).toBe("idle");
  });

  it("SUBMIT -> submitting", () => {
    const a = makeActor();
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    expect(a.getSnapshot().value).toBe("submitting");
  });

  it("SERVER_OK signed_in routes through setting_session then signed_in", () => {
    const a = makeActor();
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    const value: AuthOk = { kind: "signed_in", userId: "u1", correlationId };
    a.send({ type: "SERVER_OK", value });
    expect(a.getSnapshot().value).toBe("setting_session");
    a.send({ type: "SERVER_OK", value });
    expect(a.getSnapshot().value).toBe("signed_in");
  });

  it("SERVER_OK mfa_required parks in awaiting_mfa", () => {
    const a = makeActor();
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    const value: AuthOk = { kind: "mfa_required", challengeId: "c1", correlationId };
    a.send({ type: "SERVER_OK", value });
    expect(a.getSnapshot().value).toBe("awaiting_mfa");
    expect(a.getSnapshot().context.mfaChallengeId).toBe("c1");
  });

  it("SERVER_ERR -> failed with typed error", () => {
    const a = makeActor();
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    const error: AuthErr = { code: "invalid_credentials", correlationId };
    a.send({ type: "SERVER_ERR", error });
    const snap = a.getSnapshot();
    expect(snap.value).toBe("failed");
    expect(snap.context.error?.code).toBe("invalid_credentials");
  });

  it("failed cannot reach signed_in without going through submitting", () => {
    const a = makeActor();
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    a.send({ type: "SERVER_ERR", error: { code: "invalid_credentials", correlationId } });
    // SERVER_OK is not handled from `failed` — must SUBMIT/RETRY first.
    a.send({ type: "SERVER_OK", value: { kind: "signed_in", userId: "u1", correlationId } });
    expect(a.getSnapshot().value).toBe("failed");
  });

  it("RESET returns to idle and rotates correlationId", () => {
    const a = makeActor();
    const before = a.getSnapshot().context.correlationId;
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    a.send({ type: "SERVER_ERR", error: { code: "unexpected", correlationId } });
    a.send({ type: "RESET" });
    const snap = a.getSnapshot();
    expect(snap.value).toBe("idle");
    expect(snap.context.error).toBeNull();
    expect(snap.context.correlationId).not.toBe(before);
  });

  it("client_session_write_failed lands in failed with non-punitive code", () => {
    const a = makeActor();
    a.send({ type: "SUBMIT", email: "v@x.com", password: "pw" });
    a.send({
      type: "SERVER_ERR",
      error: { code: "client_session_write_failed", correlationId },
    });
    expect(a.getSnapshot().value).toBe("failed");
    expect(a.getSnapshot().context.error?.code).toBe("client_session_write_failed");
  });
});
