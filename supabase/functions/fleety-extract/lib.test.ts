// Deno tests for the Fleety upload core (2.2-F). Run in CI:
//   deno test supabase/functions/fleety-extract/lib.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACCEPTED_CATEGORIES,
  capText,
  checkUpload,
  MAX_EXTRACTED_CHARS,
  MAX_UPLOAD_BYTES,
  routeFor,
  safeDisplayName,
  sniffCategory,
} from "./lib.ts";

const bytes = (arr: number[]) => new Uint8Array(arr);
const PDF = bytes([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const ZIP_OFFICE = bytes([0x50, 0x4b, 0x03, 0x04]); // docx/xlsx
const TEXT = new TextEncoder().encode("hello world\nthis is plain text");

Deno.test("sniffCategory identifies types by magic bytes, not extension", () => {
  assertEquals(sniffCategory(PDF), "pdf");
  assertEquals(sniffCategory(PNG), "png");
  assertEquals(sniffCategory(JPEG), "jpeg");
  assertEquals(sniffCategory(ZIP_OFFICE), "zip-office");
  assertEquals(sniffCategory(TEXT), "text");
});

Deno.test(
  "sniffCategory returns null for binary garbage that is neither a known type nor UTF-8",
  () => {
    assertEquals(sniffCategory(bytes([0x00, 0x01, 0x02, 0x03, 0xfe])), null);
  }
);

Deno.test("routeFor sends images to vision, everything else local", () => {
  assertEquals(routeFor("text"), "text");
  assertEquals(routeFor("pdf"), "pdf");
  assertEquals(routeFor("png"), "vision");
  assertEquals(routeFor("jpeg"), "vision");
  assertEquals(routeFor("zip-office"), null);
});

Deno.test("checkUpload accepts pdf/png/jpeg/text with the right route", () => {
  for (const [b, cat, route] of [
    [PDF, "pdf", "pdf"],
    [PNG, "png", "vision"],
    [JPEG, "jpeg", "vision"],
    [TEXT, "text", "text"],
  ] as const) {
    const r = checkUpload(b);
    assert(r.ok, `expected ${cat} to be accepted`);
    if (r.ok) {
      assertEquals(r.category, cat);
      assertEquals(r.route, route);
    }
  }
});

Deno.test("checkUpload REFUSES docx/xlsx (zip-office) with export-to-PDF guidance", () => {
  const r = checkUpload(ZIP_OFFICE);
  assert(!r.ok);
  if (!r.ok) assert(/Word\/Excel/.test(r.error));
});

Deno.test("checkUpload rejects empty and oversized files", () => {
  const empty = checkUpload(new Uint8Array(0));
  assert(!empty.ok);
  const huge = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  huge.set(PDF, 0);
  const r = checkUpload(huge);
  assert(!r.ok);
  if (!r.ok) assert(/10 MB/.test(r.error));
});

Deno.test("checkUpload rejects unrecognized types", () => {
  const r = checkUpload(bytes([0x00, 0xff, 0x00, 0xff]));
  assert(!r.ok);
});

Deno.test("ACCEPTED_CATEGORIES excludes zip-office", () => {
  assert(!ACCEPTED_CATEGORIES.has("zip-office"));
  assert(ACCEPTED_CATEGORIES.has("pdf"));
});

Deno.test("capText trims to the cap and flags truncation", () => {
  const short = capText("  hi  ");
  assertEquals(short.text, "hi");
  assertEquals(short.truncated, false);

  const long = capText("x".repeat(MAX_EXTRACTED_CHARS + 500));
  assertEquals(long.text.length, MAX_EXTRACTED_CHARS);
  assertEquals(long.truncated, true);
});

Deno.test("capText does not mangle normal spacing", () => {
  assertEquals(capText("a b  c\td").text, "a b  c\td");
});

Deno.test("safeDisplayName strips path separators + control chars and caps length", () => {
  const out = safeDisplayName("../../etc/passwd");
  assertEquals(out, ".. .. etc passwd");
  assert(!out.includes("/"));
  // A normal filename with a space keeps the space.
  assertEquals(safeDisplayName("report v2 draft.pdf"), "report v2 draft.pdf");
  // A raw control char (0x1F) is removed.
  assertEquals(safeDisplayName("a\x1Fb.txt"), "ab.txt");
  assertEquals(safeDisplayName(""), "upload");
  assertEquals(safeDisplayName(123 as unknown), "upload");
  assertEquals(safeDisplayName("a".repeat(200)).length, 120);
});
