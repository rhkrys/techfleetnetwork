// bdd-gate coverage: src/pages/UpdatesPage.tsx
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithRouter } from "./test-utils";

// PR 7: the announcement composer must require the "this is not marketing" attestation — the Post
// button stays disabled until the admin checks it.

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, profile: { first_name: "Ada" } }),
}));
vi.mock("@/hooks/use-admin", () => ({ useAdmin: () => ({ isAdmin: true, loading: false }) }));

vi.mock("@/hooks/use-announcements", () => ({
  useAnnouncements: () => ({ data: [], isLoading: false }),
  useCreateAnnouncement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnnouncement: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkAnnouncementRead: () => ({ mutate: vi.fn() }),
  useRecordAnnouncementView: () => ({ mutate: vi.fn() }),
  useAnnouncementReadIds: () => ({ data: new Set() }),
  useAnnouncementActions: () => ({ data: new Map() }),
  useRecordAnnouncementAction: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: () => <div data-testid="rte" />,
}));
vi.mock("@/components/VideoRecorder", () => ({ default: () => <div data-testid="recorder" /> }));
vi.mock("@/components/AgGrid", () => ({ ThemedAgGrid: () => <div data-testid="grid" /> }));
vi.mock("@/components/AnnouncementViewStats", () => ({ AnnouncementViewStats: () => null }));
vi.mock("@/components/i18n/TranslatedContent", () => ({
  TranslatedContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/useUgcTranslation", () => ({
  useUgcTranslation: () => ({ text: "", isTranslating: false }),
}));

import UpdatesPage from "@/pages/UpdatesPage";

describe("UpdatesPage announcement composer attestation", () => {
  it("keeps Post disabled until the not-marketing attestation is checked", async () => {
    renderWithRouter(<UpdatesPage />);

    fireEvent.click(screen.getByRole("button", { name: /New Announcement/i }));

    const post = await screen.findByRole("button", { name: /Post Announcement/i });
    expect(post).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/confirm this is a service or platform update/i));
    expect(post).toBeEnabled();
  });
});
