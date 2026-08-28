// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.
// Fetches dynamic project openings from the database and merges them with static routes.

import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://techfleet.network";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

// Only routes that render for an ANONYMOUS visitor belong here. Every path
// below was checked against the route table in src/App.tsx: anything wrapped
// in <ProtectedRoute>/<TeacherRoute>/<AdminRoute> is omitted, because
// submitting a login-walled URL to search engines indexes a redirect to
// /login, not content. `/reset-password` is also omitted — public/_headers
// sets `X-Robots-Tag: noindex` on it, so listing it here contradicted the
// header. Public detail pages are added dynamically below.
const staticEntries: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/login", changefreq: "monthly", priority: "0.6" },
  { path: "/register", changefreq: "monthly", priority: "0.7" },
  { path: "/forgot-password", changefreq: "yearly", priority: "0.3" },
  { path: "/accessibility", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy", changefreq: "monthly", priority: "0.5" },
  { path: "/cookies", changefreq: "monthly", priority: "0.5" },
  { path: "/terms", changefreq: "monthly", priority: "0.5" },
  { path: "/terms-of-use", changefreq: "monthly", priority: "0.5" },
  { path: "/code-of-conduct", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy/dsar", changefreq: "yearly", priority: "0.3" },
  { path: "/confirm-admin", changefreq: "monthly", priority: "0.3" },
  { path: "/confirm-teacher", changefreq: "monthly", priority: "0.3" },
  { path: "/unsubscribe", changefreq: "yearly", priority: "0.1" },
];

// KNOWN BROKEN — do not assume this returns anything. There is no
// `project_openings` table: no migration creates it and it is absent from
// src/integrations/supabase/types.ts (the only occurrences in migrations are
// inside BDD scenario seed text). This fetch therefore always fails, hits the
// catch below, and returns []. The sitemap has never contained a dynamic
// entry. Epic 03 Phase 4 replaces this with a read of the versioned public
// feed; until then this is dead code kept only so the failure stays visible
// in build logs rather than being silently deleted.
async function fetchDynamicEntries(): Promise<SitemapEntry[]> {
  try {
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn("Missing Supabase env vars; skipping dynamic project openings in sitemap.");
      return [];
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/project_openings?select=slug,updated_at&status=eq.published`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!res.ok) {
      console.warn(`Failed to fetch project openings for sitemap: ${res.status}`);
      return [];
    }

    const rows = (await res.json()) as Array<{ slug: string; updated_at?: string }>;

    return rows.map((row) => ({
      path: `/project-openings/${row.slug}`,
      lastmod: row.updated_at ? row.updated_at.split("T")[0] : undefined,
      changefreq: "weekly" as const,
      priority: "0.8",
    }));
  } catch (err) {
    console.warn("Error fetching dynamic sitemap entries:", err);
    return [];
  }
}

function generateSitemap(entries: SitemapEntry[]) {
  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

async function main() {
  const dynamicEntries = await fetchDynamicEntries();
  const allEntries = [...staticEntries, ...dynamicEntries];
  writeFileSync(resolve("public/sitemap.xml"), generateSitemap(allEntries));
  console.log(`sitemap.xml written (${allEntries.length} entries, ${dynamicEntries.length} dynamic)`);
}

main();
