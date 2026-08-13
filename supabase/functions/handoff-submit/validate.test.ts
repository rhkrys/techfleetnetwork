// Unit tests for supabase/functions/handoff-submit (intake validation).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkSubmissionUrl,
  checkText,
  checkUpload,
  MAX_FILE_BYTES,
  MAX_TEXT_LEN,
  safeObjectName,
  sniffCategory,
} from "./validate.ts";

const bytes = (...b: number[]) => new Uint8Array(b);
const pdf = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0);
const zip = bytes(0x50, 0x4b, 0x03, 0x04);
const csv = new TextEncoder().encode("name,role\nAda,UX\n");

Deno.test("sniffCategory detects by magic bytes, text by content, null for binary garbage", () => {
  assertEquals(sniffCategory(pdf), "pdf");
  assertEquals(sniffCategory(png), "png");
  assertEquals(sniffCategory(jpeg), "jpeg");
  assertEquals(sniffCategory(zip), "zip-office");
  assertEquals(sniffCategory(csv), "text");
  assertEquals(sniffCategory(bytes(0x00, 0x01, 0x02, 0x03)), null);
  assertEquals(sniffCategory(bytes()), null);
});

Deno.test("checkUpload accepts pdf/png/jpeg/csv", () => {
  for (const b of [pdf, png, jpeg, csv]) assert(checkUpload(b).ok, "should accept");
});

Deno.test(
  "checkUpload rejects a .png that is really a disguised type (content wins over claim)",
  () => {
    // A file the client might call image/png but whose CONTENT is binary garbage -> rejected.
    const r = checkUpload(bytes(0x00, 0x11, 0x22, 0x33));
    assertEquals(r.ok, false);
  }
);

Deno.test("checkUpload refuses zip-office (xlsx/docx) for now, with a helpful message", () => {
  const r = checkUpload(zip);
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.error.includes("Word/Excel"));
});

Deno.test("checkUpload rejects empty and oversize files (boundary)", () => {
  assertEquals(checkUpload(bytes()).ok, false);
  const tooBig = new Uint8Array(MAX_FILE_BYTES + 1);
  tooBig.set(pdf, 0); // valid header, but over the size cap
  const r = checkUpload(tooBig);
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.error.includes("50 MB"));
});

Deno.test("checkSubmissionUrl: figma host required for figma/figjam", () => {
  assert(checkSubmissionUrl("figma", "https://figma.com/file/abc").ok);
  assert(checkSubmissionUrl("figjam", "https://www.figma.com/board/xyz").ok);
  assertEquals(checkSubmissionUrl("figma", "https://evil.example.com/file").ok, false);
});

Deno.test("checkSubmissionUrl: generic url must be https and non-internal", () => {
  assert(checkSubmissionUrl("url", "https://example.com/doc").ok);
  assertEquals(checkSubmissionUrl("url", "http://example.com").ok, false);
  assertEquals(checkSubmissionUrl("url", "https://localhost/x").ok, false);
  assertEquals(checkSubmissionUrl("url", "https://169.254.169.254/latest").ok, false);
  assertEquals(checkSubmissionUrl("url", "https://10.0.0.5/x").ok, false);
  assertEquals(checkSubmissionUrl("url", "not a url").ok, false);
});

Deno.test("checkText enforces non-empty and the 10k cap (boundary)", () => {
  assert(checkText("hello").ok);
  assertEquals(checkText("   ").ok, false);
  assert(checkText("a".repeat(MAX_TEXT_LEN)).ok);
  assertEquals(checkText("a".repeat(MAX_TEXT_LEN + 1)).ok, false);
});

Deno.test("safeObjectName never trusts the client name and maps extensions", () => {
  assertEquals(safeObjectName("jpeg", "../../etc/passwd"), "etcpasswd.jpg");
  assertEquals(safeObjectName("text", "a b c"), "abc.txt");
  assert(safeObjectName("pdf", "").endsWith(".pdf"));
});
