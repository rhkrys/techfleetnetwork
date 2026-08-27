# The mechanical gate

> Load this reference when installing, configuring, or running the deterministic gate — the
> `scripts/arch-gate.mjs` scanner bundled with this skill. `judge-arch` is the *judgment* half of
> the gate; this is the *mechanical* half that a CI job can pass or fail on.

## Where it lives, where it goes
Inside this skill:
```
judge-arch/
  scripts/arch-gate.mjs                 # the scanner (dependency-free, Node 18+)
  assets/arch-gate.config.example.json  # a generic starter config
  assets/arch-gate.waivers.example.json # the waiver-file schema
  assets/arch-gate.workflow.yml         # a CI job template
  assets/presets/<stack>/               # batteries-included configs per stack
```
Adopting a repo means **copying** `arch-gate.mjs` into that repo's `scripts/`, plus a config, then
running it. See the "Adopt the architecture gate" steps in the repo README, or a preset's own
README, for the full sequence. Nothing to `npm install` — it uses only Node built-ins.

## Running it
```bash
node scripts/arch-gate.mjs                 # scan everything the config targets; exit 1 on any violation
node scripts/arch-gate.mjs --changed       # scan ONLY files changed vs the trunk merge-base (the PR ratchet)
node scripts/arch-gate.mjs --baseline      # emit a waiver file (to stdout) grandfathering today's violations
node scripts/arch-gate.mjs --config <path> --waivers <path>   # override the default file locations
```
Defaults: config `arch-gate.config.json`, waivers `arch-gate.waivers.json`, both resolved from the
current working directory. **Exit codes:** `0` pass (or `--baseline` emitted), `1` violations
found, `2` the config file couldn't be read. Files are read BOM-tolerant, so a config or waiver
file saved by a Windows editor still parses.

## Config format (`arch-gate.config.json`)
```jsonc
{
  "ignore": ["src/generated"],                 // extra dirs to skip (on top of node_modules, dist, .git, …)
  "builtins": { "emptyCatch": true, "swallowReturn": true, "keepInSync": true },
  "rules": [
    {
      "name": "UI must not access the database directly",   // STABLE id — a waiver's "rule" must match it exactly
      "include": ["src/components/**", "src/pages/**"],      // globs: ** * ? and {a,b}
      "exclude": ["**/*.test.{ts,tsx}"],                     // globs that override include
      "forbid": ["db\\.(from|rpc)\\b"],                      // JS regex sources; any match in an included file = a violation
      "message": "Route data access through the owning hook/service."
    }
  ]
}
```
- **Globs** match against POSIX-style relative paths (`**` spans directories, `*` one segment,
  `{a,b}` alternation). A file is scanned by a rule when it matches an `include` and no `exclude`.
- **`forbid`** entries are regular-expression *sources* (escape backslashes for JSON). Each hit is
  reported with `path:line` and a short snippet.
- **Built-ins** run on code files regardless of rules: `emptyCatch` (a `catch` whose body is empty
  or comment-only), `swallowReturn` (`catch { return null/false/undefined }`), `keepInSync` (a
  "keep in sync" marker — a data-ownership smell). Toggle any off in `builtins`.

## Waivers — the only sanctioned bypass (`arch-gate.waivers.json`)
```jsonc
[
  {
    "rule": "UI must not access the database directly",  // must match a rule name (or built-in label) exactly
    "path": "src/pages/LegacyReport.tsx",                // a glob or a substring of the file path
    "reason": "pre-existing; cleanup tracked in TICKET-123",
    "approvedBy": "your-name",
    "expires": "2026-12-31"                              // past this date the waiver stops suppressing; "" = never
  }
]
```
A waiver is explicit, attributed, and (ideally) dated. That is the whole bypass mechanism — there
is no "skip because it's trivial." An expired waiver goes red again, so the set of exceptions can
only shrink.

## The ratchet — how to go blocking without a big-bang cleanup
1. Write the rules for the standard you want.
2. `node scripts/arch-gate.mjs --baseline > arch-gate.waivers.json` — this grandfathers **every
   current violation** into the waiver file (one entry per rule × file).
3. Run the gate on CI with `--changed`. It now blocks **new** violations in touched files, while
   the baseline suppresses the pre-existing ones.
4. Your `arch-gate.waivers.json` is your cleanup backlog. As you fix files, delete their waivers;
   the ratchet only tightens.

## Two tiers of rules
- **Clean-invariant rules** protect something already true (e.g. "exactly one DB client", "no
  empty catches"). These have *zero* baseline waivers — turn them on blocking immediately, for
  free.
- **Ratchet rules** describe a standard the codebase doesn't fully meet yet (e.g. "no data access
  in components"). These get a baseline; they block new code and enumerate the debt.

## Mechanical vs judgment — what belongs here vs in the review
Put a rule in the gate when it's **"pattern X must not appear in glob Y"** — import boundaries,
web concerns in domain code, direct DB access in the UI, empty catches, duplicated-fact markers.
Leave to the `judge-arch` review the rules that need judgment — *is this the right owner for this
data, is this workflow trapped in one caller, is this abstraction premature*. The gate catches the
mechanical; the review catches the structural. A complete gate needs both halves: it is green only
when `arch-gate.mjs` exits 0 **and** the review is PASS-or-all-waived.

## Adding a rule later
When you catch a new bad pattern, use the `arch-encode` skill: it writes the rule as a negative
example in the right file and, if the pattern is greppable, adds it here as a new `rules[]` entry —
then proves it holds. A rule that *can* be mechanical *should* be; that's the difference between
"less likely" and "cannot merge."
