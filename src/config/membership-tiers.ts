/**
 * Membership Tier Configuration — single source of truth.
 *
 * Content mirrors techfleet.org/overview#costs verbatim so members see the
 * same offer on the platform that brought them here. Prices shown to users
 * are the marketing prices ($10 / $16). The literal Gumroad SKU charge
 * ($9.99) is disclosed in fine print on the CTA so there's no surprise.
 *
 * NEVER hardcode tier prices, names, or feature lists anywhere else — read
 * from this file. A lint rule enforces this.
 */

export type TierId = "starter" | "community" | "professional";

export interface TierFeature {
  /** Human-readable feature name */
  label: string;
  /** Optional inline qualifier (e.g. "$50 per class") */
  qualifier?: string;
}

export interface TierCta {
  /**
   * Behavior of the primary action button:
   *   - current_or_signup : "Your current tier" if user is on it, else sign up flow
   *   - dual_recurrence   : show monthly + yearly Subscribe buttons
   *   - subscribe         : single Subscribe button to a configured SKU
   *   - waitlist          : capture interest in DB (no SKU yet)
   */
  type: "current_or_signup" | "dual_recurrence" | "subscribe" | "waitlist";
}

export interface MembershipTier {
  id: TierId;
  name: string;
  tagline: string;
  /** Display price (matches techfleet.org marketing). Use null for FREE tier. */
  priceDisplay: string;
  priceSubtitle: string;
  /** Optional fine-print clarifying the actual charge (e.g. ".99 USD billed via Gumroad") */
  priceFootnote?: string;
  /** Features unique to this tier */
  uniqueFeatures: TierFeature[];
  /** Inherited features shown under "Plus everything in [lower tier]:" */
  inheritedFeatures?: { fromTier: string; features: TierFeature[] };
  /** Marks the visually-emphasized tier */
  popular?: boolean;
  cta: TierCta;
  /** Gumroad product URLs — populated as SKUs are created */
  skus?: {
    monthly?: string;
    yearlyFounding?: string;
    yearlyRegular?: string;
    primary?: string;
  };
}

const STARTER_FEATURES: TierFeature[] = [
  { label: "Community Access" },
  { label: "Free Events" },
  { label: "Leadership Training" },
  { label: "Lab-Based Classes", qualifier: "$100 per class" },
  { label: "Online Career Guidance" },
  { label: "Platform Access" },
  { label: "Project Team Training" },
];

const COMMUNITY_UNIQUE: TierFeature[] = [
  { label: "Asynchronous Courses" },
  { label: "Communities of Practice" },
  { label: "Discounts to Classes" },
  { label: "Free Agile Training" },
  { label: "Group Mentoring" },
  { label: "Member-Only Events" },
  { label: "Residencies" },
  { label: "Skills Assessments" },
  { label: "Lab-Based Classes", qualifier: "$50 per class" },
];

const PROFESSIONAL_UNIQUE: TierFeature[] = [
  { label: "Career Coaching" },
  { label: "Late-Career Support" },
];

export const MEMBERSHIP_TIERS: Record<TierId, MembershipTier> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "Shift your mindset to empowered teams and build a better future of work.",
    priceDisplay: "FREE",
    priceSubtitle: "forever",
    uniqueFeatures: STARTER_FEATURES,
    cta: { type: "current_or_signup" },
  },
  community: {
    // NOTE: display name is "Early Career Membership" (owner rebrand, 2026-08).
    // The `id`/enum token stays `community` internally to avoid a high-risk
    // production enum rename; users only ever see `name`.
    id: "community",
    name: "Early Career Membership",
    tagline: "Commit to developing as a service leader and build empowered teams.",
    priceDisplay: "$10",
    priceSubtitle: "USD per month",
    priceFootnote: "Billed at $9.99 USD via Gumroad",
    uniqueFeatures: COMMUNITY_UNIQUE,
    inheritedFeatures: { fromTier: "Starter", features: STARTER_FEATURES },
    popular: true,
    cta: { type: "dual_recurrence" },
    skus: {
      // monthly: TBD — admin to add Gumroad URL
      yearlyFounding: "https://techfleet.gumroad.com/l/founding-membership",
      // yearlyRegular: TBD — admin to create post-promo SKU
    },
  },
  professional: {
    id: "professional",
    name: "Professional",
    tagline: "Working professionals and executive leaders are a part of the future of work too.",
    priceDisplay: "$16",
    priceSubtitle: "USD per month",
    uniqueFeatures: PROFESSIONAL_UNIQUE,
    inheritedFeatures: {
      fromTier: "Early Career Membership",
      features: [...COMMUNITY_UNIQUE, ...STARTER_FEATURES],
    },
    cta: { type: "waitlist" },
    // No SKU yet — Professional shows waitlist CTA
  },
};

/** Ordered list for grid rendering: Starter → Community → Professional */
export const TIER_ORDER: TierId[] = ["starter", "community", "professional"];

/** Founding-member promo window (America/New_York) */
export const FOUNDING_PROMO = {
  startsAt: "2026-04-01T00:00:00-04:00",
  endsAt: "2026-09-30T23:59:59-04:00",
  yearlyPriceDisplay: "$49.99",
  yearlyOriginalDisplay: "$99.99",
  savingsLabel: "save ~58%",
  description: "Locked-in rate, never increases for as long as you stay subscribed.",
} as const;

/**
 * Server-driven check (placeholder for hook implementation).
 * The authoritative window is enforced by the create-gumroad-checkout
 * edge function; this client value is informational only.
 */
export function isFoundingPromoActive(now: Date = new Date()): boolean {
  const start = new Date(FOUNDING_PROMO.startsAt).getTime();
  const end = new Date(FOUNDING_PROMO.endsAt).getTime();
  const t = now.getTime();
  return t >= start && t <= end;
}
