// @edge-cron
// Public, unauthenticated read-only feed of published classes for the
// Tech Fleet marketing site (Framer). Uses the public RLS policies on
// `classes` + `cohorts` and serves with CORS + edge cache headers.

import { createClient } from 'npm:@supabase/supabase-js@2'

import { applyWaf } from "../_shared/waf.ts";
import { serializePublicClass, PUBLIC_CATALOG_VERSION } from "../_shared/public-class.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
const ALLOWED_ORIGINS = new Set([
  'https://www.techfleet.network',
  'https://techfleet.network',
  'https://techfleet.org',
  'https://www.techfleet.org',
  'https://framer.com',
  'https://framer.app',
  'https://framercanvas.com',
])

// DELIBERATE DEVIATION from supabase/functions/CLAUDE.md ("never write
// Access-Control-Allow-Origin inline; use _shared/http.ts"). The shared
// helper cannot express this handler's two hard requirements:
//   1. an ORIGIN ALLOWLIST — _shared/http.ts reflects the SDK's `*`, which
//      would drop the reflected-origin behavior the marketing site relies on;
//   2. CACHEABILITY — _shared/http.ts's `jsonHeaders` forces
//      `Cache-Control: no-store, max-age=0`, which would silently destroy the
//      60s edge cache + stale-while-revalidate this endpoint serves under.
// Centralizing CORS here is Epic 03 Phase 2 (a public-response helper that
// takes an allowlist and cache policy). Until then the rule's ACTUAL purpose —
// that preflight must not reject the trace/request headers frontend wrappers
// attach — is satisfied explicitly below.
function corsFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-trace-id, x-request-id',
    'Vary': 'Origin',
  }
}

Deno.serve(withAuditWrapper("public-classes", async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsFor(origin)

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  // WAF: rate-limit / size / scanner / SQLi / path-traversal protection.
  // This is an unauthenticated public endpoint — the same threat profile as
  // public-project-detail, which has had the WAF since it shipped. applyWaf
  // skips OPTIONS itself, and its security_events logging is lazy and
  // failure-swallowing, so it cannot break the response path.
  const blocked = await applyWaf(req, 'public-classes')
  if (blocked) return blocked

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url = new URL(req.url)
    const trackParam = url.searchParams.get('track')
    const validTracks = new Set(['basic_training', 'advanced_training'])
    const track = trackParam && validTracks.has(trackParam) ? trackParam : null

    // Detail mode. Bounded + character-restricted before it reaches PostgREST.
    const slugParam = url.searchParams.get('slug')
    const slug = slugParam && /^[a-z0-9-]{1,200}$/i.test(slugParam) ? slugParam : null
    // A malformed slug must not silently fall back to the full list — that
    // would turn a typo into a catalog dump. Treat it as not-found.
    if (slugParam !== null && slug === null) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, anonKey)

    let q = supabase
      .from('classes')
      .select(`
        id, slug, title, summary, description, track, hero_image_url,
        outcomes, skills, prerequisites, published_at,
        cohorts:cohorts!inner(
          id, label, start_date, end_date, timezone,
          registration_url, status, published_at
        )
      `)
      .eq('status', 'published')
      .eq('cohorts.status', 'published')
      .gte('cohorts.end_date', new Date().toISOString().slice(0, 10))
      .order('published_at', { ascending: false })

    if (track) q = q.eq('track', track)
    if (slug) q = q.eq('slug', slug)

    const { data, error } = await q
    if (error) {
      console.error('public-classes query error:', error)
      return new Response(JSON.stringify({ error: 'Failed to load classes' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Explicit allowlist serialization — never spread the DB row. The
    // `Public can view published classes` policy is column-blind, so any column
    // the table gains is anon-readable by default; building the response field
    // by field is what keeps a new column private until it is added on purpose.
    // See supabase/functions/_shared/public-class.ts (covered by
    // src/test/edge/public-class-serializer.test.ts).
    const classes = (data ?? []).map(serializePublicClass)

    // Detail request for a slug that is unpublished or does not exist: return
    // the SAME 404 either way, so response shape never discloses whether an
    // unpublished class exists.
    if (slug && classes.length === 0) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        version: PUBLIC_CATALOG_VERSION,
        generated_at: new Date().toISOString(),
        count: classes.length,
        classes,
      }),
      {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          // Edge cache 60s, allow stale for a day while revalidating
          'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=86400',
        },
      },
    )
  } catch (err) {
    console.error('public-classes unexpected:', err)
    return new Response(JSON.stringify({ error: 'Unexpected error' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
}))
