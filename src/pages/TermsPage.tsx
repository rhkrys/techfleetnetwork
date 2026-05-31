import { PolicyMarkdownView } from "@/components/PolicyMarkdownView";
import { SEO } from "@/components/SEO";

export default function TermsPage() {
  return (
    <>
      <SEO
        title="Terms & Conditions"
        description="Read the terms and conditions for using Tech Fleet's platform and services."
        canonicalPath="/terms"
      />
      <PolicyMarkdownView
      title="Terms & Conditions"
      effective="May 7, 2026"
      contactEmail="info@techfleet.network"
      policyKey="terms-and-conditions"
    />
    </>
  );
}
