// Public edge function: serves curated i18n bundles from i18n_translations.
// No auth — returns only non-PII translation strings. ETag + SWR caching keep
// it CDN-cheap. See mem://features/i18n-runtime-translator + db-first-content.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, if-none-match',
  'Access-Control-Expose-Headers': 'etag',
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const locale = (url.searchParams.get('locale') || 'en').trim().toLowerCase()
    const namespace = (url.searchParams.get('namespace') || 'common').trim()

    // Basic input validation (avoid SQL/abuse): BCP-47 + simple ns.
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(locale) || !/^[a-z][a-z0-9_-]{0,32}$/i.test(namespace)) {
      return new Response(JSON.stringify({ error: 'invalid locale or namespace' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase
      .from('i18n_translations')
      .select('key, value, updated_at')
      .eq('locale', locale)
      .eq('namespace', namespace)
      .in('status', ['qa_passed', 'approved'])
      .order('key', { ascending: true })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rows = data ?? []
    const strings: Record<string, string> = {}
    let maxUpdated = 0
    for (const r of rows) {
      strings[r.key as string] = r.value as string
      const ts = new Date(r.updated_at as string).getTime()
      if (ts > maxUpdated) maxUpdated = ts
    }

    const body = JSON.stringify({ locale, namespace, version: maxUpdated, strings })
    const etag = 'W/"' + (await sha256Hex(body)).slice(0, 32) + '"'

    const ifNoneMatch = req.headers.get('if-none-match')
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          etag,
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
        },
      })
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        etag,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
