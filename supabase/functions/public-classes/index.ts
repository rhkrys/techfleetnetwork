// @edge-cron
// Public, unauthenticated read-only feed of published classes for the
// Tech Fleet marketing site (Framer). Uses the public RLS policies on
// `classes` + `cohorts` and serves with CORS + edge cache headers.

import { createClient } from 'npm:@supabase/supabase-js@2'

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

function corsFor(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  }
}

Deno.serve(withAuditWrapper("public-classes", async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsFor(origin)

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, anonKey)

    let q = supabase
      .from('classes')
      .select(`
        id, slug, title, summary, description, track, hero_image_url,
        outcomes, skills, prerequisites, published_at,
        cohorts:cohorts!inner(
          id, label, start_date, end_date, timezone, capacity,
          registration_url, status, published_at
        )
      `)
      .eq('status', 'published')
      .eq('cohorts.status', 'published')
      .gte('cohorts.end_date', new Date().toISOString().slice(0, 10))
      .order('published_at', { ascending: false })

    if (track) q = q.eq('track', track)

    const { data, error } = await q
    if (error) {
      console.error('public-classes query error:', error)
      return new Response(JSON.stringify({ error: 'Failed to load classes' }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const classes = (data ?? []).map((c: any) => ({
      ...c,
      cohorts: (c.cohorts ?? []).sort(
        (a: any, b: any) => (a.start_date || '').localeCompare(b.start_date || ''),
      ),
    }))

    return new Response(
      JSON.stringify({ generated_at: new Date().toISOString(), count: classes.length, classes }),
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
