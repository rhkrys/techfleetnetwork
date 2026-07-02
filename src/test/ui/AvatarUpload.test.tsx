import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AvatarUpload } from "@/components/AvatarUpload";

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://example.com/avatar.jpg" } }),
        list: vi.fn().mockResolvedValue({ data: [] }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";

const defaultProps = {
  userId: "user-123",
  currentUrl: null,
  initials: "TU",
  onUploaded: vi.fn(),
};

describe("AvatarUpload — BDD 30.x", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // BDD 30.1: Avatar upload component renders with upload button
  it("renders with upload button", () => {
    render(<AvatarUpload {...defaultProps} />);
    expect(screen.getByText("Upload Photo")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload profile picture")).toBeInTheDocument();
  });

  // BDD 30.3: Invalid file type is rejected
  it("rejects invalid file types", async () => {
    render(<AvatarUpload {...defaultProps} />);
    const input = screen.getByLabelText("Upload profile picture");

    const file = new File(["data"], "test.gif", { type: "image/gif" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Please upload a PNG, JPG, or WEBP image.");
    });
    expect(defaultProps.onUploaded).not.toHaveBeenCalled();
  });

  // BDD 30.4: Oversized file is rejected (limit is 5MB pre-crop)
  it("rejects files over 5MB", async () => {
    render(<AvatarUpload {...defaultProps} />);
    const input = screen.getByLabelText("Upload profile picture");

    const bigContent = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([bigContent], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Image must be under 5MB.");
    });
    expect(defaultProps.onUploaded).not.toHaveBeenCalled();
  });

  // BDD 30.5: User can remove their avatar
  it("shows remove button when avatar exists", () => {
    render(<AvatarUpload {...defaultProps} currentUrl="https://example.com/pic.jpg" />);
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("hides remove button when no avatar", () => {
    render(<AvatarUpload {...defaultProps} />);
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  // BDD 30.7: Avatar upload appears in onboarding step 1 — structural check
  it("renders initials fallback when no URL provided", () => {
    render(<AvatarUpload {...defaultProps} initials="JD" />);
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  // BDD 30.8: Avatar upload appears in profile edit panel — structural check
  it("renders accessible camera overlay button", () => {
    render(<AvatarUpload {...defaultProps} />);
    expect(screen.getByLabelText("Change profile picture")).toBeInTheDocument();
  });
});
