import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

const signInWithOAuth = vi.fn().mockResolvedValue({ error: null, redirected: true });

// GoogleSignInButton moved off the Lovable Cloud adapter to
// supabase.auth.signInWithOAuth directly (see the component's own comment).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/lib/oauth-ui-guard", () => ({ markOAuthUiInitiated: vi.fn() }));
vi.mock("@/lib/auth/oauth-callback-pending", () => ({ markOAuthCallbackPending: vi.fn() }));
vi.mock("@/lib/auth/session-health", () => ({ beaconWedge: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("GoogleSignInButton — no apex restart loop", () => {
  beforeEach(() => {
    signInWithOAuth.mockClear();
  });

  it("does NOT call window.location.replace on click (apex canonicalization moved to boot)", async () => {
    const replace = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        host: "www.techfleet.network",
        origin: "https://www.techfleet.network",
        replace,
        assign: vi.fn(),
        href: "https://www.techfleet.network/login",
      },
    });

    render(<GoogleSignInButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it("has no needsCanonicalRestart branch in source", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/components/GoogleSignInButton.tsx", "utf8");
    expect(src).not.toMatch(/needsCanonicalRestart/);
    expect(src).not.toMatch(/from=oauth-canonical/);
  });
});
