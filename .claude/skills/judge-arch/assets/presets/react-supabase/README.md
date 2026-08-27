# Preset: React + Supabase

A batteries-included starting point for the architecture gate on a React (Vite / CRA / Next) +
Supabase app. It encodes the standard layering — **UI → data hooks → services → lib / integrations**,
one Supabase client, edge functions composing a shared layer — so you get an enforceable gate in
minutes instead of writing rules from scratch.

## What's here
| File | Copy it to | Purpose |
|---|---|---|
| `arch-gate.config.json` | repo root | the mechanical rules (patterns forbidden per folder) |
| `decisions.md` | repo root | the standing rules with ✅/❌ examples, reviewed by `judge-arch` |
| `scoped/components.AGENTS.md` | `src/components/AGENTS.md` | "no data access; call a hook" |
| `scoped/services.AGENTS.md` | `src/services/AGENTS.md` | "no React/DOM; own your types; report failures" |
| `scoped/functions.AGENTS.md` | `supabase/functions/AGENTS.md` | "compose `_shared`; no inline auth/CORS" |

## Adopt it (5 steps)
```bash
# 1. Copy the gate script + this preset's config into your repo
cp ../../scripts/arch-gate.mjs        scripts/arch-gate.mjs
cp arch-gate.config.json              arch-gate.config.json
cp decisions.md                       decisions.md
cp scoped/components.AGENTS.md        src/components/AGENTS.md
cp scoped/services.AGENTS.md          src/services/AGENTS.md
cp scoped/functions.AGENTS.md         supabase/functions/AGENTS.md

# 2. Adjust the globs in arch-gate.config.json to your folder names (client path, layer dirs)

# 3. Grandfather today's violations so the gate is green for existing code
node scripts/arch-gate.mjs --baseline > arch-gate.waivers.json

# 4. Add the npm scripts
#    "check:architecture":     "node scripts/arch-gate.mjs --changed"
#    "check:architecture:all": "node scripts/arch-gate.mjs"

# 5. Wire it into CI (copy assets/arch-gate.workflow.yml to .github/workflows/) and your
#    pre-push hook. The gate now blocks NEW violations; the baseline is your cleanup backlog.
```

## Tuning notes
- The **one-client** rule excludes `src/integrations/supabase/client.ts` — change that to wherever
  your canonical client lives.
- The **domain-purity** rule excludes `src/lib/observability/**` and `src/lib/telemetry/**` — real
  web adapters (web-vitals, etc.) legitimately touch `window`. Add your own adapter dirs there.
- The **edge** rules assume shared helpers in `supabase/functions/_shared`. If yours are named
  differently, update the `message` fields to point at the right helpers.
- Delete a rule you don't want, or move a genuinely-permanent exception into the waivers file with
  a reason and an expiry — never by loosening a rule for everyone.
