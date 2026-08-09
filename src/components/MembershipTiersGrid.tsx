import { useState } from "react";
import { Check, Sparkles, Star, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MEMBERSHIP_TIERS,
  TIER_ORDER,
  FOUNDING_PROMO,
  isFoundingPromoActive,
  type MembershipTier,
  type TierId,
} from "@/config/membership-tiers";

export type BillingRecurrence = "monthly" | "yearly";

export interface MembershipTiersGridProps {
  /** The user's current tier; controls per-card CTA state. */
  currentTier?: TierId | null;
  /** Whether the user is already a Founding Member (locked-in rate). */
  isFoundingMember?: boolean;
  /** Direct Gumroad customer manage URL for the current paid subscription. */
  manageUrl?: string | null;
  /** Triggered when the user picks a CTA. */
  onSelect: (intent: {
    tier: TierId;
    recurrence?: BillingRecurrence;
    skuUrl?: string;
    action: "subscribe" | "waitlist" | "downgrade" | "manage";
  }) => void;
  className?: string;
}

/**
 * Three-up tier grid that mirrors techfleet.org/overview content exactly.
 * Stacks on mobile, side-by-side on ≥lg. Community card is visually
 * highlighted as "popular" — matches the .org hierarchy and conversion goal.
 *
 * Includes a Monthly / Yearly billing toggle that swaps each card's price
 * display and CTA target. While the founding-member promo window is open,
 * the yearly view exposes the discounted founding rate inline.
 */
export function MembershipTiersGrid({
  currentTier = "starter",
  isFoundingMember = false,
  manageUrl = null,
  onSelect,
  className,
}: MembershipTiersGridProps) {
  const promoActive = isFoundingPromoActive();
  // Default to yearly while the founding promo is live so the discount is
  // the first thing members see — best-deal-forward (Heuristic #6).
  const [recurrence, setRecurrence] = useState<BillingRecurrence>(
    promoActive ? "yearly" : "monthly"
  );

  return (
    <div className={cn("space-y-6", className)}>
      <BillingToggle value={recurrence} onChange={setRecurrence} promoActive={promoActive} />

      <div
        role="list"
        aria-label="Tech Fleet membership tiers"
        className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 pt-2"
      >
        {TIER_ORDER.map((id) => (
          <TierCard
            key={id}
            tier={MEMBERSHIP_TIERS[id]}
            isCurrent={currentTier === id}
            currentTier={currentTier ?? "starter"}
            isFoundingMember={isFoundingMember}
            manageUrl={manageUrl}
            promoActive={promoActive}
            recurrence={recurrence}
            onSelect={onSelect}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto">
        🌍 <strong>Fair pricing, wherever you are.</strong> We use Purchasing Power Parity. If
        you're outside higher-cost regions, you may see an automatic discount at checkout based on
        your country — no code needed.
      </p>
    </div>
  );
}

/* ── Billing toggle ─────────────────────────────────────── */

interface BillingToggleProps {
  value: BillingRecurrence;
  onChange: (next: BillingRecurrence) => void;
  promoActive: boolean;
}

function BillingToggle({ value, onChange, promoActive }: BillingToggleProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Billing frequency"
        className="inline-flex items-center rounded-full border border-border bg-muted p-1"
      >
        <ToggleOption
          label="Monthly"
          selected={value === "monthly"}
          onClick={() => onChange("monthly")}
        />
        <ToggleOption
          label="Yearly"
          selected={value === "yearly"}
          onClick={() => onChange("yearly")}
          trailing={
            promoActive ? (
              <Badge
                variant="default"
                className="ml-2 gap-1 px-2 py-0 text-[10px] uppercase tracking-wide"
              >
                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                {FOUNDING_PROMO.savingsLabel}
              </Badge>
            ) : null
          }
        />
      </div>
      {value === "yearly" && promoActive && (
        <p className="text-xs text-muted-foreground">
          Founding Member rate — {FOUNDING_PROMO.yearlyPriceDisplay}/yr,{" "}
          {FOUNDING_PROMO.description.toLowerCase()}
        </p>
      )}
    </div>
  );
}

function ToggleOption({
  label,
  selected,
  onClick,
  trailing,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      {trailing}
    </button>
  );
}

/* ── Tier card ──────────────────────────────────────────── */

interface TierCardProps {
  tier: MembershipTier;
  isCurrent: boolean;
  currentTier: TierId;
  isFoundingMember: boolean;
  manageUrl: string | null;
  promoActive: boolean;
  recurrence: BillingRecurrence;
  onSelect: MembershipTiersGridProps["onSelect"];
}

function TierCard({
  tier,
  isCurrent,
  currentTier,
  isFoundingMember,
  manageUrl,
  promoActive,
  recurrence,
  onSelect,
}: TierCardProps) {
  const headingId = `tier-${tier.id}-name`;
  const tierRank: Record<TierId, number> = { starter: 0, community: 1, professional: 2 };
  const isUpgrade = tierRank[tier.id] > tierRank[currentTier];
  const isDowngrade = tierRank[tier.id] < tierRank[currentTier];

  const priceView = derivePriceView(tier, recurrence, promoActive);

  return (
    <article
      role="listitem"
      aria-labelledby={headingId}
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "relative flex flex-col rounded-lg border bg-card p-6 transition-shadow",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        // Current-tier styling takes precedence over "popular" so the user's
        // own plan is the most visually prominent card on the page. The whole
        // card gets a light-blue (primary) wash + border; the "current plan"
        // status lives in the header (see below), not in a floating badge.
        isCurrent
          ? "border-primary border-2 bg-primary/5 shadow-lg ring-1 ring-primary/20"
          : tier.popular
            ? "border-primary/60 shadow-lg ring-1 ring-primary/20"
            : "border-border shadow-sm hover:shadow-md"
      )}
    >
      {isCurrent && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          role="status"
          aria-label={`${tier.name} is your current membership tier`}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary-foreground shadow-sm">
            <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
            Your Current Plan
          </span>
          {tier.id === "community" && isFoundingMember && (
            <Badge
              variant="secondary"
              className="gap-1 px-2 py-0.5 text-[10px] uppercase tracking-wide"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Founding Member
            </Badge>
          )}
        </div>
      )}
      {tier.popular && !isCurrent && (
        <Badge
          variant="default"
          className="absolute -top-3 left-1/2 -translate-x-1/2 gap-1 px-3 py-1"
        >
          <Star className="h-3 w-3" aria-hidden="true" />
          <span>Most Popular</span>
          <span className="sr-only"> tier</span>
        </Badge>
      )}

      {/* Header: name + tagline */}
      <div className="space-y-2">
        <h3 id={headingId} className="text-xl font-bold text-foreground">
          {tier.name}
        </h3>
        <p className="text-sm text-muted-foreground min-h-[3rem]">{tier.tagline}</p>
      </div>

      {/* Price block */}
      <div className="my-6 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-4xl font-bold text-foreground">{priceView.priceDisplay}</span>
          <span className="text-sm text-muted-foreground">{priceView.priceSubtitle}</span>
          {priceView.strikethroughDisplay && (
            <span
              className="text-sm text-muted-foreground line-through"
              aria-label={`Original price ${priceView.strikethroughDisplay}`}
            >
              {priceView.strikethroughDisplay}
            </span>
          )}
        </div>
        {priceView.priceFootnote && (
          <p className="text-xs text-muted-foreground">{priceView.priceFootnote}</p>
        )}
      </div>

      {/* Feature list */}
      <div className="flex-1 space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Includes
          </h4>
          <ul className="space-y-2" role="list">
            {tier.uniqueFeatures.map((f) => (
              <FeatureRow key={`${tier.id}-${f.label}`} feature={f} />
            ))}
          </ul>
        </div>

        {tier.inheritedFeatures && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Plus everything in {tier.inheritedFeatures.fromTier}
            </h4>
            <ul className="space-y-2" role="list">
              {tier.inheritedFeatures.features.map((f) => (
                <FeatureRow key={`${tier.id}-inh-${f.label}`} feature={f} muted />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* CTA area — hidden for the free Starter plan when it's the current
          tier, since that case renders no button and an empty divider looks
          broken. */}
      {!(isCurrent && tier.id === "starter") && (
        <div className="mt-6 pt-4 border-t border-border">
          <TierCtaButtons
            tier={tier}
            isCurrent={isCurrent}
            isUpgrade={isUpgrade}
            isDowngrade={isDowngrade}
            isFoundingMember={isFoundingMember}
            manageUrl={manageUrl}
            promoActive={promoActive}
            recurrence={recurrence}
            onSelect={onSelect}
          />
        </div>
      )}
    </article>
  );
}

/* ── Pricing view derivation ────────────────────────────── */

interface PriceView {
  priceDisplay: string;
  priceSubtitle: string;
  priceFootnote?: string;
  strikethroughDisplay?: string;
}

function derivePriceView(
  tier: MembershipTier,
  recurrence: BillingRecurrence,
  promoActive: boolean
): PriceView {
  // Starter is always free regardless of recurrence
  if (tier.id === "starter") {
    return {
      priceDisplay: tier.priceDisplay,
      priceSubtitle: tier.priceSubtitle,
    };
  }

  // Community: switch by recurrence; yearly shows founding rate while active
  if (tier.id === "community") {
    if (recurrence === "yearly") {
      if (promoActive) {
        return {
          priceDisplay: FOUNDING_PROMO.yearlyPriceDisplay,
          priceSubtitle: "USD per year",
          priceFootnote: "Founding Member rate — locked for life",
          strikethroughDisplay: FOUNDING_PROMO.yearlyOriginalDisplay,
        };
      }
      return {
        priceDisplay: FOUNDING_PROMO.yearlyOriginalDisplay,
        priceSubtitle: "USD per year",
        priceFootnote: "Billed annually via Gumroad",
      };
    }
    // Monthly view — defer to base tier display
    return {
      priceDisplay: tier.priceDisplay,
      priceSubtitle: tier.priceSubtitle,
      priceFootnote: tier.priceFootnote,
    };
  }

  // Professional: yearly view shows ~10× monthly as a placeholder hint
  // (no live SKU yet — kept neutral until admin configures)
  if (tier.id === "professional" && recurrence === "yearly") {
    return {
      priceDisplay: "$192",
      priceSubtitle: "USD per year ($16 × 12)",
      priceFootnote: tier.priceFootnote,
    };
  }

  return {
    priceDisplay: tier.priceDisplay,
    priceSubtitle: tier.priceSubtitle,
    priceFootnote: tier.priceFootnote,
  };
}

/* ── Feature row + CTA buttons ──────────────────────────── */

function FeatureRow({
  feature,
  muted = false,
}: {
  feature: { label: string; qualifier?: string };
  muted?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <Check
        className={cn(
          "h-4 w-4 mt-0.5 flex-shrink-0",
          muted ? "text-muted-foreground" : "text-primary"
        )}
        aria-hidden="true"
      />
      <span className={cn(muted ? "text-muted-foreground" : "text-foreground")}>
        {feature.label}
        {feature.qualifier && <span className="text-muted-foreground"> ({feature.qualifier})</span>}
      </span>
    </li>
  );
}

interface CtaProps {
  tier: MembershipTier;
  isCurrent: boolean;
  isUpgrade: boolean;
  isDowngrade: boolean;
  isFoundingMember: boolean;
  manageUrl: string | null;
  promoActive: boolean;
  recurrence: BillingRecurrence;
  onSelect: MembershipTiersGridProps["onSelect"];
}

function TierCtaButtons({
  tier,
  isCurrent,
  isDowngrade,
  isFoundingMember,
  manageUrl,
  promoActive,
  recurrence,
  onSelect,
}: CtaProps) {
  const isPaidTier = tier.id !== "starter";

  // Current tier: the card is already marked as current (light-blue fill +
  // header indicator), so the CTA area only carries the management action for
  // paid tiers. Free (Starter) current plan needs no CTA at all.
  if (isCurrent) {
    if (!isPaidTier) return null;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => onSelect({ tier: tier.id, action: "manage" })}
      >
        Manage subscription
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    );
  }

  // Downgrade path — opens Gumroad manage page so the member can cancel
  // or switch their existing subscription. Starter is the free tier so
  // downgrading to Starter means cancelling on Gumroad.
  if (isDowngrade) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={() => onSelect({ tier: tier.id, action: "manage" })}
      >
        {tier.id === "starter" ? "Cancel on Gumroad" : `Switch to ${tier.name}`}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    );
  }

  // Community: routes to the SKU matching the active recurrence.
  if (tier.cta.type === "dual_recurrence") {
    const skuUrl =
      recurrence === "yearly"
        ? promoActive
          ? tier.skus?.yearlyFounding
          : tier.skus?.yearlyRegular
        : tier.skus?.monthly;

    return (
      <Button
        type="button"
        className="w-full"
        onClick={() =>
          onSelect({
            tier: tier.id,
            recurrence,
            skuUrl,
            action: "subscribe",
          })
        }
      >
        Subscribe
      </Button>
    );
  }

  // Professional: waitlist if no SKU configured
  if (tier.cta.type === "waitlist") {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => onSelect({ tier: tier.id, action: "waitlist" })}
      >
        Coming soon · Join waitlist
      </Button>
    );
  }

  // Single-SKU subscribe (e.g. Professional once SKU exists)
  if (tier.cta.type === "subscribe") {
    return (
      <Button
        type="button"
        className="w-full"
        onClick={() =>
          onSelect({
            tier: tier.id,
            recurrence,
            skuUrl: tier.skus?.primary,
            action: "subscribe",
          })
        }
      >
        Subscribe
      </Button>
    );
  }

  return null;
}
