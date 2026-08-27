# Adoption — where each file goes, and what to change

> Load this reference when installing these skills into a repo: it says exactly where every file
> from the clone belongs on a user's machine, and which files they must edit (and which they must
> not). `SKILL.md` and the repo README have the step sequence; this is the per-file map.

## The golden rule
There are two kinds of file here, and they're treated oppositely:

- **The standard (do NOT edit).** The skill folders and the gate *engine* — `judge-arch/`,
  `arch-encode/`, `scripts/arch-gate.mjs`. These are the shared cookie cutter. Use them as-is. If
  one needs improving, change it *here* and open a PR — never fork it per repo, or every repo
  drifts and the standard means nothing.
- **The instance (you MUST edit / generate).** The files you copy into your repo —
  `AGENTS.md`, `decisions.md`, `arch-gate.config.json`, `arch-gate.waivers.json`. These describe
  *your* codebase, so every adopter fills them in differently. This is where "your specifics" live.

## Two install locations for the skills
- **Personal (all your projects):** copy the skill folders to `~/.claude/skills/`.
- **Project (shared with your team):** copy them to the repo's `.claude/skills/` and **commit**, so
  every teammate's agent loads them.

The config/rules files (below) are always **per-repo** — they live at the root of the repo you're
protecting, regardless of where the skills are installed.

## Table 1 — WHERE each file goes
`<clone>` = the folder you cloned `enterprise-software-AI-skills` into. `<repo>` = the repository
you're adopting the gate in.

| From the clone | Copy/generate to | One-time? |
|---|---|---|
| `<clone>/judge-arch/` (whole folder) | `<repo>/.claude/skills/judge-arch/` **or** `~/.claude/skills/judge-arch/` | copy the folder |
| `<clone>/arch-encode/` (whole folder) | `<repo>/.claude/skills/arch-encode/` **or** `~/.claude/skills/arch-encode/` | copy the folder |
| `<clone>/judge-arch/scripts/arch-gate.mjs` | `<repo>/scripts/arch-gate.mjs` | copy |
| `<clone>/judge-arch/assets/AGENTS.baseline.md` | `<repo>/AGENTS.md` (rename) | copy + rename |
| `<clone>/judge-arch/assets/decisions.template.md` *(or a preset's `decisions.md`)* | `<repo>/decisions.md` (rename) | copy + rename |
| a preset's `arch-gate.config.json` *(or `assets/arch-gate.config.example.json`)* | `<repo>/arch-gate.config.json` (rename) | copy + rename |
| a preset's `scoped/components.AGENTS.md` | `<repo>/src/components/AGENTS.md` | copy |
| a preset's `scoped/services.AGENTS.md` | `<repo>/src/services/AGENTS.md` | copy |
| a preset's `scoped/functions.AGENTS.md` | `<repo>/supabase/functions/AGENTS.md` | copy |
| `<clone>/judge-arch/assets/arch-gate.workflow.yml` | `<repo>/.github/workflows/arch-gate.yml` | copy |
| — (not copied) `arch-gate.waivers.json` | `<repo>/arch-gate.waivers.json` | **generated:** `node scripts/arch-gate.mjs --baseline > arch-gate.waivers.json` |

> Using a preset (e.g. `assets/presets/react-supabase/`)? It already contains the `arch-gate.config.json`,
> `decisions.md`, and `scoped/` files above — copy those instead of the generic `assets/` versions.

## Table 2 — WHAT to change in each file after you copy it

| File (once in your repo) | Edit it? | What to change |
|---|---|---|
| `.claude/skills/judge-arch/`, `arch-encode/` | **No** | Used as-is. Improvements go upstream as a PR, not a local fork. |
| `scripts/arch-gate.mjs` | **No** | The engine. Your `arch-gate.config.json` drives it — never edit the script per repo. |
| `AGENTS.md` | **Yes** | Below the baseline's divider line, add your stack/preset specifics and point at your real modules. Keep it lean — it loads every session. |
| `decisions.md` | **Yes** | Replace every `<placeholder>` and generic example with ✅/❌ snippets from **your own** code. Grow it one caught mistake at a time. |
| `arch-gate.config.json` | **Yes** | Set `include`/`exclude` globs to your folder names; point the one-client `exclude` at your real client file; point the domain-purity `exclude` at your real adapter dirs; rename the edge helpers in `message` fields; delete rules you don't want. |
| `arch-gate.waivers.json` | **Generated, not edited** | Produced by `--baseline`. Later you only *delete* entries as you clean up (and add a dated, attributed entry for a deliberate exception). |
| `src/**/AGENTS.md` (scoped) | Usually **No** | They're generic to the stack. Tweak wording only if your folder layout differs from the preset's assumptions. |
| `.github/workflows/arch-gate.yml` | **Minor** | Set your Node version; keep `fetch-depth: 0` (needed for `--changed`); it already runs the ratchet. |
| `package.json` (your existing file) | **Yes** | Add `"check:architecture": "node scripts/arch-gate.mjs --changed"` and `"check:architecture:all": "node scripts/arch-gate.mjs"`. Wire `npm run check:architecture` into your pre-push hook. |

## Verify the install
```bash
node scripts/arch-gate.mjs --baseline > arch-gate.waivers.json  # grandfather existing violations
node scripts/arch-gate.mjs                                       # should now PASS (exit 0)
node scripts/arch-gate.mjs --changed                             # the mode CI runs
```
If the first full run isn't PASS after baselining, your config globs don't match your folders —
fix the globs, not the waivers. From here, the gate blocks new violations; the waiver file is your
cleanup backlog.
