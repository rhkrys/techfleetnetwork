import { describe, it, expect, vi, beforeEach } from "vitest";

// PR 7: sendNotifications must carry the admin's not-marketing attestation to the edge function,
// which refuses to send without it.
const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: vi.fn(),
  },
}));
vi.mock("@/lib/cached-session", () => ({
  getCachedSession: () => Promise.resolve({ access_token: "tok" }),
}));

import { AnnouncementService } from "@/services/announcement.service";

describe("AnnouncementService.sendNotifications marketing attestation", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ error: null });
  });

  it("passes marketing_attested: true when the admin attested", async () => {
    await AnnouncementService.sendNotifications("ann-1", true);
    expect(invokeMock).toHaveBeenCalledWith("send-announcement-email", {
      headers: { Authorization: "Bearer tok" },
      body: { announcement_id: "ann-1", marketing_attested: true },
    });
  });

  it("forwards a false attestation verbatim (the edge function rejects it)", async () => {
    await AnnouncementService.sendNotifications("ann-2", false);
    expect(invokeMock).toHaveBeenCalledWith(
      "send-announcement-email",
      expect.objectContaining({
        body: { announcement_id: "ann-2", marketing_attested: false },
      })
    );
  });
});
