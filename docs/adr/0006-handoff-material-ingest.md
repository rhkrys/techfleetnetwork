# ADR-0006: Hand-off material ingest — durable, checkpointed, hardened multi-format extraction

- **Status:** Accepted (2026-08-13)
- **Related:** [ADR-0004](0004-handoff-pipeline-async.md) (async pipeline), [ADR-0005](0005-llm-model-capability-port.md) (model port)

## Context

The hand-off writer is only as good as the material it reads. Teams submit their real work as
**Figma / FigJam boards, uploaded files (PDF, Word, Excel, CSV, text), and links**. The first
production build only read text a teammate typed and Figma node-links; **uploaded files reached the
pipeline as their filename string, not their content**, and links were stored as deep-links, never
read. So most sections wrote as `_Awaiting content._`.

Two hard lessons from live testing (2026-08-13) shape this ADR:

1. **Fetching many sources before the first checkpoint kills the worker.** `loadRunContext` fetched
   all Figma boards inline, on every tick, _before_ any checkpoint. A ~30-board run exceeded the
   edge invocation limit and was killed pre-progress; `handoff_claim_run` counted each reclaim as a
   crash and failed the run at the recovery cap ("exceeded max recovery attempts"). Confirmed from
   the failed run's own state (`pipeline_state = null`, `cursor = null`, `attempts = 6`) plus the
   absence of any application error log (a resource kill throws no exception). Turning `FIGMA_TOKEN`
   off made an identical run complete cleanly (`attempts = 0`, 26 facts) — isolating the load as the
   sole cause.
2. **Speed tracks material.** A fast run means thin material, not a healthy one — the same signal
   that first read as "too fast / fishy".

## Decision

Build a **material-ingest engine** with these properties. Each is locked.

### 1. Checkpointed ingest stage — one source per unit

Material acquisition becomes an ordered set of **ingest units** in the resumable step machine
(`pipeline-steps.ts`), running **before** extraction: one unit per source (one Figma/FigJam file,
one uploaded file, one link). Each unit fetches/parses exactly one source and **checkpoints**. No
tick ever does unbounded pre-checkpoint work, so any number of sources is safe. This supersedes the
interim bound (`fetchFigmaBounded`, PR #201): the durable fix is that the load is _behind_
checkpoints, not merely time-boxed.

### 2. Durable per-source material — `extracted_text` on the submission row

Parsed/fetched text is stored on a new **`handoff_deliverable_submissions.extracted_text`** column
(+ `extracted_at`), next to the link/file it came from — **not** in transient `pipeline_state`.
Rationale (owner call): captured once and **never re-fetched** (idempotent ingest; a re-produce
reuses it for free — no repeat Figma calls or PDF parsing), **survives** run completion / worker
death / resume, is **inspectable** (`select external_url, extracted_text` to see exactly what a
source yielded — an observability win), and is **deleted with its source** (DSAR/erasure of a
submission takes its material, no side cache to hunt). `pipeline_state` stays small.

### 3. Source-type-aware extraction

DeepSeek (the extractor) only ever sees **plain text** — the code parsers normalize every type to
text first (§4); the LLM never parses bytes. Each source's text is handed to the extractor **labeled
with its true type** (`figma_design`, `figjam_board`, `pdf`, `spreadsheet`, `docx`, `csv`,
`web_page`) plus a one-line **reading hint** for that shape (a board is discrete fragments; a
spreadsheet is rows-are-records; a PDF is continuous prose). The extraction prompt already supports a
per-item `kind`; the fix is to **stop flattening every chunk to `"material"`** and carry the real
type end to end. The type label is **trusted metadata we set** (from `submission_type` + extension),
placed in the instruction position; source content stays delimited as UNTRUSTED data with the
existing anti-injection rules.

### 4. Code parsers, hardened per OWASP — never an LLM

Parsing is deterministic code (faithful, cheap, hardenable), run in-memory in the Deno edge sandbox
(no shell-out, no `eval`, no filesystem write). Cross-cutting: magic-byte typing (never
extension/Content-Type), size cap, **hard cap on extracted-text length per source**, per-source
parse deadline, and **fail-closed** (a parser error yields no material, logged; never crashes the
run). Per type:

| Type                  | Threat                          | Control                                                                                                                                  |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| PDF                   | embedded JS, decompression bomb | pure-JS/wasm parser with JS execution disabled; cap pages + decompressed size; ignore embedded files                                     |
| DOCX / XLSX (zip+XML) | XXE, zip bomb, zip-slip         | XML with DTD + external entities OFF; cap entry count / uncompressed size / compression ratio; read only known OOXML paths               |
| CSV                   | formula injection               | cells inert for extraction (we never re-export); neutralize `= + - @` only if ever surfaced as a file                                    |
| TXT / MD              | XSS if rendered                 | raw text only, never rendered; cap length                                                                                                |
| Figma / FigJam        | SSRF via URL                    | host-locked to `api.figma.com`, URL parsed by `parseFigmaUrl`; cap node count / output                                                   |
| public web link       | SSRF, malicious HTML            | host allow-list + https-only + private/metadata IP block + no auto-redirect + DNS-rebinding re-check; strip scripts, text only, cap size |

Each control ships with an `@security` BDD scenario wired into `security.yml`.

### 5. Accept / refuse matrix — with helpful upload errors

Enforced at upload (magic bytes) so errors are instant.

- **✅ Parsed:** PDF, DOCX, XLSX, CSV, TXT, MD.
- **🖼️ Stored, no text (yet):** PNG, JPEG — kept as a deliverable, but **shown a helpful note at
  upload**: images can't be read for text yet; to have their text included, **upload a PDF instead**.
  (OCR is deferred; when built it uses a **vision** model — Gemini Flash, whose key is already set —
  never DeepSeek, which is verified text-only.)
- **⛔ Refused with a helpful error:**
  - Legacy `.doc` / `.xls` (OLE compound, magic `D0 CF 11 E0…`): _"This looks like an older Word or
    Excel file (.doc or .xls). Those aren't supported. Please save it as a PDF, or as a newer .docx,
    .xlsx, or .csv, then upload again."_
  - Macro-enabled `.docm` / `.xlsm` (detected by a bounded peek for `vbaProject.bin`, same pass as
    the zip-bomb caps): _"Files with macros (.docm, .xlsm) aren't supported. Please save a copy
    without macros as .docx, .xlsx, PDF, or .csv, then upload again."_
  - Anything unrecognized by content.

  Refusing legacy binary + macros removes a whole class of parser attack surface for formats that are
  rare today; users are told exactly what to upload instead.

## Alternatives considered

1. **Material in `pipeline_state` (side cache).** Ephemeral — cleared on `complete`, lost on a lost
   run, re-fetched on re-produce, not inspectable. Rejected in favor of the durable `extracted_text`
   column (owner call).
2. **LLM-based parsing** (hand files to a model). Non-deterministic, can hallucinate/omit content,
   costlier/slower, and can't be hardened like code. Rejected — code parses, the LLM only interprets.
3. **Full legacy `.doc`/`.xls` + macro support.** Weak/risky parsers for rare formats. Rejected;
   refuse with guidance instead.
4. **Time-boxed inline load only** (`fetchFigmaBounded`, PR #201). Interim mitigation; superseded
   here because bounding a pre-checkpoint load still risks the ceiling — the durable fix moves the
   load _behind_ checkpoints.

## Consequences

- **Easier:** uploads and links become real, extracted material; runs can't be killed by source
  volume; re-produce is cheap (no re-fetch); you can inspect exactly what each source yielded.
- **Harder / accepted:** a schema migration (`extracted_text`), per-format parsers each with their
  own hardening + `@security` tests, and a slightly larger ingest surface. Slides (`figma.com/slides`)
  and OCR for images/scanned PDFs remain follow-ups, explicitly out of this scope.
