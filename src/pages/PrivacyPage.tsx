import { usePolicy } from "@/hooks/usePolicy";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { Button } from "@/design-system";
import { useAuth } from "@/contexts/AuthContext";
import { openCookieSettings } from "@/components/CookieConsentBanner";
import { SEO } from "@/components/SEO";

const RIGHTS: Array<{
  type: string;
  label: string;
  description: string;
  href?: string;
  action?: () => void;
}> = [
  {
    type: "access",
    label: "Download my data",
    description: "Receive a portable copy of everything we hold about you (JSON).",
    href: "/privacy/dsar?type=access",
  },
  {
    type: "correction",
    label: "Correct my data",
    description: "Edit your profile details directly.",
    href: "/profile-setup",
  },
  {
    type: "erasure",
    label: "Delete my account",
    description: "Permanently remove your account and personal data.",
    href: "/profile-setup#delete",
  },
  {
    type: "restrict",
    label: "Restrict processing",
    description: "Ask us to pause processing of your data.",
    href: "/privacy/dsar?type=restrict",
  },
  {
    type: "object",
    label: "Object to processing",
    description: "Object to a use of your data based on legitimate interests or marketing.",
    href: "/privacy/dsar?type=object",
  },
  {
    type: "withdraw_consent",
    label: "Withdraw consent",
    description: "Change cookie & analytics preferences.",
    action: () => openCookieSettings(),
  },
  {
    type: "human_review",
    label: "Request human review",
    description: "Ask a human to review an automated suggestion (Fleety, recommendations).",
    href: "/privacy/dsar?type=human_review",
  },
  {
    type: "appeal",
    label: "Appeal a decision",
    description: "Disagree with our response to a previous request? Appeal it.",
    href: "/privacy/dsar?type=appeal",
  },
];

export default function PrivacyPage() {
  const { data: policy } = usePolicy("privacy");
  const md = policy?.body_md ?? "";
  const { user } = useAuth();

  return (
    <div className="container-app py-8 space-y-8">
      <SEO
        title="Privacy Policy"
        description="Learn how Tech Fleet collects, uses, and protects your personal data."
        canonicalPath="/privacy"
      />
      <header>
        <h1 className="text-2xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Effective May 7, 2026 · Questions:{" "}
          <a className="underline" href="mailto:info@techfleet.network">
            info@techfleet.network
          </a>
        </p>
      </header>

      <section
        id="rights-center"
        aria-labelledby="rights-title"
        className="rounded-md border bg-card p-4 sm:p-6"
      >
        <h2 id="rights-title" className="text-lg font-semibold">
          Your privacy rights
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Depending on your jurisdiction (EU/UK GDPR, Swiss FADP, CCPA/CPRA, LGPD, PIPEDA, POPIA,
          PIPL, and more) you may exercise some or all of the rights below. We respond within 30
          days.{" "}
          {!user && (
            <span>
              You'll need to{" "}
              <Link className="underline" to="/login">
                sign in
              </Link>{" "}
              to use one-click actions; otherwise email us.
            </span>
          )}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {RIGHTS.map((r) => (
            <li key={r.type} className="rounded-md border p-3">
              <div className="text-sm font-medium">{r.label}</div>
              <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
              <div className="mt-2">
                {r.action ? (
                  <Button variant="outline" size="sm" onClick={r.action}>
                    Open
                  </Button>
                ) : (
                  <Button component={Link} to={r.href!} variant="outline" size="sm">
                    Open
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="do-not-sell"
        aria-labelledby="dns-title"
        className="rounded-md border bg-card p-4 sm:p-6"
      >
        <h2 id="dns-title" className="text-lg font-semibold">
          Do Not Sell or Share My Personal Information
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          We do not sell personal information for money. We honor Global Privacy Control (GPC)
          browser signals as a valid opt-out of "sale" and "sharing" under U.S. state laws. You can
          also use the button below to set this preference manually.
        </p>
        <div className="mt-3">
          <Button onClick={() => openCookieSettings()}>Open privacy settings</Button>
        </div>
      </section>

      <section
        aria-labelledby="policy-text"
        className="prose prose-sm dark:prose-invert max-w-none"
      >
        <h2 id="policy-text" className="sr-only">
          Full Privacy Policy
        </h2>
        <ReactMarkdown>{md}</ReactMarkdown>
      </section>
    </div>
  );
}
