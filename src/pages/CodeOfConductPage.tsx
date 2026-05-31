import { PolicyMarkdownView } from "@/components/PolicyMarkdownView";
import { SEO } from "@/components/SEO";

export default function CodeOfConductPage() {
  return (
    <>
      <SEO
        title="Code of Conduct & Anti-Harassment Policy"
        description="Tech Fleet's community standards and anti-harassment policy."
        canonicalPath="/code-of-conduct"
      />
      <PolicyMarkdownView
      title="Code of Conduct & Anti-Harassment Policy"
      effective="October 15, 2023"
      contactEmail="safespace@techfleet.org"
      policyKey="code-of-conduct"
    />
    </>
  );
}
