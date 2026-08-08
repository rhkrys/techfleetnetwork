import { Link } from "react-router-dom";
import { PrivacyFooterLinks } from "./PrivacyFooterLinks";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";

/**
 * Global site footer with policy links. Rendered on every page (public and
 * authenticated) so users can always reach Terms, Privacy, Cookies, and
 * Accessibility from anywhere in the app — required by GDPR / CCPA / WCAG.
 */
export function AppFooter() {
  return (
    <footer className="border-t bg-card mt-auto" role="contentinfo">
      <div className="container-app py-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <img
              src={techFleetLogo}
              alt=""
              className="h-5 w-5 dark:invert"
              width={20}
              height={20}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">
              <span data-no-translate>Tech Fleet&trade;</span> · © {new Date().getFullYear()} All
              Rights Reserved
            </span>
          </div>
          <nav
            aria-label="Footer navigation"
            className="mx-auto flex flex-wrap items-start justify-start gap-x-4 gap-y-2 text-xs text-muted-foreground"
          >
            <Link to="/terms" className="hover:text-foreground transition-colors">
              Terms &amp; Conditions
            </Link>
            <Link to="/terms-of-use" className="hover:text-foreground transition-colors">
              Terms of Use
            </Link>
            <Link to="/code-of-conduct" className="hover:text-foreground transition-colors">
              Code of Conduct
            </Link>
            <PrivacyFooterLinks />
            <Link to="/accessibility" className="hover:text-foreground transition-colors">
              Accessibility
            </Link>
            <Link to="/legal/dispute" className="hover:text-foreground transition-colors">
              Dispute Resolution
            </Link>
          </nav>
        </div>
        <p className="text-center text-xs text-muted-foreground leading-relaxed">
          <a
            href="https://techfleet.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground underline"
          >
            techfleet.org
          </a>
          {" · "}
          <a href="mailto:onboarding@techfleet.org" className="hover:text-foreground underline">
            onboarding@techfleet.org
          </a>
        </p>
      </div>
    </footer>
  );
}
