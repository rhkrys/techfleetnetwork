import { Sparkles, BadgeCheck, ExternalLink } from "lucide-react";
import { Badge, Button } from "@/design-system";

import { FOUNDING_PROMO, MEMBERSHIP_TIERS, type TierId } from "@/config/membership-tiers";
import { cn } from "@/lib/utils";

interface CurrentMembershipBannerProps {
  currentTier: TierId;
  isFoundingMember?: boolean;
  billingPeriod?: "monthly" | "yearly" | string | null;
  membershipUpdatedAt?: string | null;
  /** Direct Gumroad customer manage URL for paid tiers. */
  manageUrl?: string | null;
  className?: string;
}

/**
 * Prominent "Your current plan" callout shown at the top of the
 * Membership tab on the profile so users always know what they're on.
 *
 * BDD: profile-membership-current-plan-banner
 */
export function CurrentMembershipBanner({
  currentTier,
  isFoundingMember = false,
  billingPeriod = null,
  membershipUpdatedAt,
  manageUrl,
  className,
}: CurrentMembershipBannerProps) {
  const isPaid = currentTier !== "starter";
  const tier = MEMBERSHIP_TIERS[currentTier] ?? MEMBERSHIP_TIERS.starter;
  const billingPeriodLabel = billingPeriod === "yearly" ? "Yearly" : "Monthly";
  const priceLabel =
    currentTier === "community" && billingPeriod === "yearly" && isFoundingMember
      ? `${FOUNDING_PROMO.yearlyPriceDisplay} USD per year`
      : currentTier === "community" && billingPeriod === "yearly"
        ? `${FOUNDING_PROMO.yearlyOriginalDisplay} USD per year`
        : tier.priceDisplay === "FREE"
          ? tier.priceDisplay
          : `${tier.priceDisplay} ${tier.priceSubtitle.replace(/^USD\s*/, "")}`;

  const sinceLabel = membershipUpdatedAt
    ? new Date(membershipUpdatedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <section
      aria-label="Your current membership plan"
      className={cn(
        "rounded-lg border border-primary/40 bg-primary/5 p-5 sm:p-6",
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4",
        className
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <BadgeCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your current plan
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-bold text-foreground">{tier.name}</h3>
            <span className="text-sm text-muted-foreground">· {priceLabel}</span>
            {isFoundingMember && (
              <Badge
                variant="secondary"
                className="gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wide"
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Founding Member
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{tier.tagline}</p>
          {currentTier !== "starter" && (
            <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-2">
              <dt className="font-medium text-muted-foreground">Billing period</dt>
              <dd className="font-semibold text-foreground">{billingPeriodLabel}</dd>
            </dl>
          )}
          {sinceLabel && (
            <p className="mt-1 text-xs text-muted-foreground">Active since {sinceLabel}</p>
          )}
        </div>
      </div>
      {isPaid && manageUrl && (
        <div className="shrink-0 sm:self-center">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <a
              href={manageUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Manage your subscription on Gumroad (opens in a new tab)"
            >
              Manage subscription
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        </div>
      )}
    </section>
  );
}
