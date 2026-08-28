import type { PublicClass } from "@/types/public-course";

/**
 * Data access for the PUBLIC (anonymous) course catalog.
 *
 * Deliberately uses a bare `fetch` against the public edge function rather than
 * the Supabase client:
 *   - This surface must render for a signed-OUT visitor, so it must not depend
 *     on AuthProvider or a session.
 *   - It must not query tables directly. The edge function owns the field
 *     allowlist (supabase/functions/_shared/public-class.ts); going through it
 *     is what guarantees the member discount link and private fields are never
 *     part of the response.
 * Matches the existing public pattern in ProjectOpeningDetailPage.
 */

export interface PublicCatalogResponse {
  version: number;
  generated_at: string;
  count: number;
  classes: PublicClass[];
}

function functionsUrl(path: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/${path}`;
}

async function getJson(url: string): Promise<PublicCatalogResponse> {
  const res = await fetch(url, {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 404) {
    const notFound = new Error("Not found") as Error & { status?: number };
    notFound.status = 404;
    throw notFound;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "We couldn't load courses right now.");
  }

  return (await res.json()) as PublicCatalogResponse;
}

export async function fetchPublicCourses(track?: string): Promise<PublicClass[]> {
  const qs = new URLSearchParams();
  if (track) qs.set("track", track);
  const suffix = qs.toString() ? `?${qs}` : "";
  const data = await getJson(functionsUrl(`public-classes${suffix}`));
  return data.classes ?? [];
}

export async function fetchPublicCourseBySlug(slug: string): Promise<PublicClass | null> {
  const data = await getJson(functionsUrl(`public-classes?slug=${encodeURIComponent(slug)}`));
  return data.classes?.[0] ?? null;
}
