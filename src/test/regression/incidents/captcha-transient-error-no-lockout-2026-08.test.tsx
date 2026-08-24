import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";

/**
 * INCIDENT captcha-transient-lockout-2026-08 (Bug A).
 *
 * The Aug-2026 activity-log audit found 1,387 `captcha_failed` login events vs
 * only 61 real `invalid_credentials`. 86% of the captcha failures carried
 * non-user-fault Cloudflare codes — 300010 (challenge timed out) = 954,
 * 600010 (network) = 142, 110600 (client/config) = 103. Yet the widget's
 * `error-callback` incremented the punitive consecutive-failure counter for
 * EVERY error kind and 30s-locked the member after two — contradicting the
 * component's own contract (punitive counting is "Never for network/server").
 *
 * Net effect: real members whose invisible captcha merely timed out were
 * locked out of the platform. These tests fail on the pre-fix code and pass
 * after the fault-split fix, and guard against regression forever.
 */

const recordLoginEvent = vi.fn();
vi.mock("@/lib/login-telemetry", () => ({
  recordLoginEvent: (...args: unknown[]) => recordLoginEvent(...args),
  newAttemptId: () => "attempt-test",
}));

let capturedOptions: Record<string, any> | null = null;
const resetSpy = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  capturedOptions = null;
  recordLoginEvent.mockClear();
  resetSpy.mockClear();
  (window as any).turnstile = {
    render: (_el: HTMLElement, options: Record<string, any>) => {
      capturedOptions = options;
      return "widget-under-test";
    },
    reset: resetSpy,
    remove: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).turnstile;
});

async function mountLogin() {
  const onToken = vi.fn();
  const utils = render(<TurnstileChallenge action="login" onTokenChange={onToken} />);
  await waitFor(() => expect(capturedOptions).not.toBeNull());
  return { onToken, ...utils };
}

describe("captcha transient errors must not lock members out (incident: captcha-transient-lockout-2026-08)", () => {
  it("two timeout errors (300010 → 'expired') do NOT trigger the 30s punitive lockout", async () => {
    const { queryByText } = await mountLogin();
    act(() => {
      capturedOptions!["error-callback"]("300010");
    });
    act(() => {
      capturedOptions!["error-callback"]("300010");
    });
    // Fixed: no 30-second punitive countdown appears anywhere.
    expect(queryByText(/retry in \d+ second/i)).toBeNull();
    // Fixed: the widget is soft-reset to fetch a fresh token instead.
    expect(resetSpy).toHaveBeenCalled();
  });

  it("two network errors (600010 → 'network') do NOT trigger the 30s punitive lockout", async () => {
    const { queryByText } = await mountLogin();
    act(() => {
      capturedOptions!["error-callback"]("600010");
    });
    act(() => {
      capturedOptions!["error-callback"]("600010");
    });
    expect(queryByText(/retry in \d+ second/i)).toBeNull();
  });

  it("a client/config error (110600 → 'expired') does NOT lock out either", async () => {
    const { queryByText } = await mountLogin();
    act(() => {
      capturedOptions!["error-callback"]("110600");
    });
    act(() => {
      capturedOptions!["error-callback"]("110600");
    });
    expect(queryByText(/retry in \d+ second/i)).toBeNull();
  });

  it("records telemetry when a live token expires (expired-callback) so soft-expiry is observable (Bug C)", async () => {
    await mountLogin();
    recordLoginEvent.mockClear();
    act(() => {
      capturedOptions!["expired-callback"]();
    });
    expect(recordLoginEvent).toHaveBeenCalledWith(
      expect.any(String),
      "captcha_failed",
      expect.objectContaining({ branch: "expired" })
    );
  });
});

describe("no security regression: genuine repeated credential failures STILL lock out", () => {
  it("failureCount prop reaching 2 keeps the punitive 30s lockout intact", async () => {
    const onToken = vi.fn();
    const { rerender, findByText } = render(
      <TurnstileChallenge action="login" onTokenChange={onToken} failureCount={0} />
    );
    await waitFor(() => expect(capturedOptions).not.toBeNull());
    // Two genuine user-attributable failures (driven by invalid_credentials
    // in the sign-in engine) must still arm the retry countdown.
    rerender(<TurnstileChallenge action="login" onTokenChange={onToken} failureCount={1} />);
    rerender(<TurnstileChallenge action="login" onTokenChange={onToken} failureCount={2} />);
    expect(await findByText(/retry in \d+ second/i)).toBeTruthy();
  });
});
