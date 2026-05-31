import { PolicyMarkdownView } from "@/components/PolicyMarkdownView";
import { SEO } from "@/components/SEO";

export default function TermsOfUsePage() {
  return (
    <>
      <SEO
        title="Terms of Use"
        description="Read the terms of use for Tech Fleet's platform and services."
        canonicalPath="/terms-of-use"
      />
      <PolicyMarkdownView
      title="Terms of Use"
      effective="May 7, 2026"
      contactEmail="info@techfleet.network"
      policyKey="terms-of-use"
    />
    </>
  );
}
