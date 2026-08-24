import { describe, it, expect, afterEach, vi } from "vitest";
import type { FleetyMode } from "@/lib/fleety/modes";

/**
 * Regression: Classic Fleety chat (ChatPage) surfaced "Invalid or expired token".
 *
 * Root cause: ChatPage's streamChat sent the static publishable (anon) key as the Bearer token;
 * techfleet-chat authenticates with getUser(), which yields no user for the anon key and 401s
 * with "Invalid or expired token" (techfleet-chat/index.ts:514). FleetyChatWidget + GuidanceEmbed
 * already send the member session JWT (ASVS V13.2.1); this asserts ChatPage now does too.
 *
 * Unit-level (calls the exported streamChat directly) so it can't hang on ChatPage's render-time
 * timers/subscriptions — it isolates exactly the auth header that regressed.
 *
 * Covers: src/pages/ChatPage.tsx
 */
const { getSessionSafe } = vi.hoisted(() => ({ getSessionSafe: vi.fn() }));
vi.mock("@/lib/auth/session-port", () => ({ getSessionSafe }));
// ChatPage constructs the supabase client at import; stub it so importing the module is inert.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}), auth: {} },
}));

import { streamChat } from "@/pages/ChatPage";

const baseArgs = {
  messages: [{ role: "user" as const, content: "hi" }],
  mode: "chat" as FleetyMode,
  onDelta: () => {},
  onDone: () => {},
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ChatPage streamChat — auth", () => {
  it("authenticates with the member session JWT, not the static publishable key", async () => {
    getSessionSafe.mockResolvedValue({ access_token: "SESSION_JWT" });
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "boom" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    // ok:false short-circuits before the stream; we only care that the request was authenticated.
    await expect(streamChat(baseArgs)).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers.Authorization).toBe("Bearer SESSION_JWT");
  });

  it("refuses to call the endpoint when there is no session (no anon-key fallback)", async () => {
    getSessionSafe.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(streamChat(baseArgs)).rejects.toThrow(/sign in/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
