import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentMembershipBanner } from "./CurrentMembershipBanner";

describe("CurrentMembershipBanner", () => {
  it("shows the Early Career Membership plan with yearly founding-member pricing after a yearly purchase", () => {
    render(
      <CurrentMembershipBanner
        currentTier="community"
        isFoundingMember
        billingPeriod="yearly"
        membershipUpdatedAt="2026-04-25T12:00:00.000Z"
      />
    );

    const banner = screen.getByRole("region", {
      name: /your current membership plan/i,
    });

    expect(
      within(banner).getByRole("heading", { name: "Early Career Membership" })
    ).toBeInTheDocument();
    expect(within(banner).getByText(/\$49\.99 USD per year/i)).toBeInTheDocument();
    expect(within(banner).getByText("Billing period")).toBeInTheDocument();
    expect(within(banner).getByText("Yearly")).toBeInTheDocument();
  });

  it("shows the Early Career Membership plan with monthly pricing after a monthly purchase", () => {
    render(
      <CurrentMembershipBanner
        currentTier="community"
        isFoundingMember={false}
        billingPeriod="monthly"
        membershipUpdatedAt="2026-04-25T12:00:00.000Z"
      />
    );

    const banner = screen.getByRole("region", {
      name: /your current membership plan/i,
    });

    expect(
      within(banner).getByRole("heading", { name: "Early Career Membership" })
    ).toBeInTheDocument();
    expect(within(banner).getByText(/\$10 per month/i)).toBeInTheDocument();
    expect(within(banner).getByText("Billing period")).toBeInTheDocument();
    expect(within(banner).getByText("Monthly")).toBeInTheDocument();
  });
});
