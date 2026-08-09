import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserActionsDropdown, type UserRow } from "@/components/admin/UserActionsDropdown";

// Radix DropdownMenu's trigger touches pointer-capture APIs jsdom lacks.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    user_id: "u-1",
    email: "member@example.com",
    first_name: "Mem",
    last_name: "Ber",
    display_name: "Member",
    created_at: new Date().toISOString(),
    isAdmin: false,
    isTeacher: false,
    pendingPromotion: false,
    pendingTeacher: false,
    emailConfirmed: true,
    isBanned: false,
    authProviders: [],
    hasProfile: true,
    profileCompleted: true,
    ...overrides,
  };
}

function renderDropdown(user: UserRow) {
  const handlers = {
    onPromote: vi.fn(),
    onResendInvite: vi.fn(),
    onView: vi.fn(),
    onDelete: vi.fn(),
    onPromoteTeacher: vi.fn(),
    onResendTeacher: vi.fn(),
    onRevokeTeacher: vi.fn(),
  };
  render(<UserActionsDropdown user={user} isSelf={false} {...handlers} />);
  return handlers;
}

describe("UserActionsDropdown — teacher promotion resend", () => {
  it("shows 'Resend Teacher Invite' and fires onResendTeacher for a user with a pending (unconfirmed) teacher promotion", async () => {
    const u = makeUser({ pendingTeacher: true });
    const handlers = renderDropdown(u);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Actions for/i }));
    const resend = await screen.findByText("Resend Teacher Invite");
    await user.click(resend);

    expect(handlers.onResendTeacher).toHaveBeenCalledWith(u);
    // Resend replaces the initial-promote item for a pending user.
    expect(screen.queryByText("Promote to Teacher")).not.toBeInTheDocument();
  });

  it("shows 'Promote to Teacher' (not resend) for a plain member with no pending promotion", async () => {
    renderDropdown(makeUser());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Actions for/i }));
    expect(await screen.findByText("Promote to Teacher")).toBeInTheDocument();
    expect(screen.queryByText("Resend Teacher Invite")).not.toBeInTheDocument();
  });

  it("shows 'Revoke Teacher' for a confirmed teacher", async () => {
    renderDropdown(makeUser({ isTeacher: true }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Actions for/i }));
    expect(await screen.findByText("Revoke Teacher")).toBeInTheDocument();
    expect(screen.queryByText("Resend Teacher Invite")).not.toBeInTheDocument();
    expect(screen.queryByText("Promote to Teacher")).not.toBeInTheDocument();
  });
});
