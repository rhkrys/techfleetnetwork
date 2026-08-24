# ADR 0014 — Fleety file/image uploads (ephemeral extract-and-discard)

- Status: Accepted
- Date: 2026-08-19
- Deciders: TechFleet (owner)
- Related: `fleety-extract` (new edge fn); `techfleet-chat` material path; ADR 0010 (Figma extraction); hand-off `handoff-submit/validate.ts` (magic-byte typing it mirrors); the "no way to upload a file to Fleety" gap

## Context

Members could share a Figma/URL link for Fleety to review (2.2-A/B), but there was **no way to upload a file** — a PDF deliverable, a screenshot, a spec, a code file. The initial assumption was to reuse the hand-off generator's extraction engine; investigation showed that engine **does not exist yet** — ADR-0006 designed PDF/image/OCR parsers but ADR-0007 lists them as "not yet addressed," and hand-off today stores uploaded bytes without reading them (they degrade to `file: <name>`). Only Figma text extraction is real. So the extraction had to be **built**, reusing hand-off's _discipline_ (magic-byte typing + office-file refusal from `validate.ts`, the FormData→edge pattern) rather than a non-existent engine.

The answer model is **DeepSeek via OpenRouter, which is text-only** — it cannot read image pixels. Extraction therefore splits by what the file actually is.

## Decision

New member-facing edge function **`fleety-extract`** turns an uploaded file into text; the three chat surfaces send that text to `techfleet-chat` as an `attachment`, framed there as **UNTRUSTED material** (identical discipline to a shared link). Extraction by true (magic-byte) type:

- **text / code** → decoded locally as UTF-8 (no LLM, no cost).
- **PDF with a text layer** → parsed locally via `unpdf` (no LLM, no cost). A scanned/no-text-layer PDF returns a friendly "upload as image or paste text" note.
- **image (PNG/JPEG)** → OCR + short visual description via **Gemini Flash vision** (the only external dependency; DeepSeek can't read pixels). Fails **gracefully** — quota/misconfig/empty returns a "paste the text" note, never a hard block.
- **docx/xlsx/zip-office** → **refused** (decompression-bomb + XXE not yet guarded), with "export to PDF" guidance — same posture as hand-off.

**Retention: ephemeral.** Bytes live only for the extraction request; nothing is written to Storage or the DB. This was an explicit owner choice (most privacy-preserving, smallest change, no bucket/RLS/retention surface).

**UI:** one shared client (`src/lib/fleety/attachment.ts`), hook (`useFleetyAttachment`), and components (`FleetyAttach.tsx`) wired identically into all three surfaces (ChatPage, FleetyChatWidget, GuidanceEmbed) — the "change all three Fleety surfaces together" rule. An attachment alone can be sent (a default review prompt is synthesized); uploaded material bypasses the L2/L3/canned caches via the existing `hasMaterial` gate.

## Security (OWASP file-upload + LLM)

- Type decided by **magic bytes**, never the client filename/Content-Type (`sniffCategory`). Unrecognized → 415.
- Size capped at **10 MB**, checked from `Content-Length` (413 before buffering) **and** actual byte length.
- **Member JWT** required (`getUser` → 401) + **per-user rate limit** (20 / 10 min) — extraction is costlier than a chat turn.
- Vision prompt frames the image strictly as content to transcribe, **never instructions**; the extracted text is wrapped in `techfleet-chat`'s UNTRUSTED-material block, so prompt-injection in a file/image is data, not commands.
- Filename sanitized for display only (never a storage path — nothing is stored).

## Consequences

- Members can upload PDFs/images/text on every Fleety surface; DeepSeek does the review, Gemini is only "eyes" for pixels (same split as Gemini=embeddings / DeepSeek=answers).
- New dependency `npm:unpdf` (serverless PDF text layer) — pure-JS, no native deps.
- Reintroduces a _narrow_ Gemini dependency for image OCR only; it degrades gracefully and never blocks text/code/PDF uploads, so it is not a retrieval-style SPOF.
- `verify_jwt = false` in `config.toml` with in-code auth (matches the Fleety/auth function pattern).
- Rollback = remove the attach control from the three surfaces + drop the function; the `attachment` field on `techfleet-chat` is optional and backward-compatible.
- **Not in scope:** persistence/retention of uploads, docx/xlsx support (needs decompression/XXE hardening first), and image-model choice beyond `FLEETY_VISION_MODEL` (env-overridable).
