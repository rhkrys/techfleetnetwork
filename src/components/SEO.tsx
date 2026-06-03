import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  canonicalPath?: string;
  ogType?: "website" | "article";
}

const BASE_URL = "https://techfleet.network";

export function SEO({ title, description, canonicalPath, ogType = "website" }: SEOProps) {
  const SUFFIX = " | Tech Fleet Network Platform | Agile Practice and Teamwork For All";
  const fullTitle = title.includes("Tech Fleet Network Platform") ? title : `${title}${SUFFIX}`;
  const canonical = canonicalPath ? `${BASE_URL}${canonicalPath}` : BASE_URL;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:type" content={ogType} />
    </Helmet>
  );
}
