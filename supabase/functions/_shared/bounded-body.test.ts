// Audit T-C regression — the bounded reader enforces the cap while streaming,
// even when Content-Length is absent/understated.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BodyTooLargeError, readBoundedJson, readBoundedText } from "./bounded-body.ts";

Deno.test("reads a small body", async () => {
  const req = new Request("https://x/", { method: "POST", body: "hello" });
  assertEquals(await readBoundedText(req, 1024), "hello");
});

Deno.test("rejects an honest oversized Content-Length (fast path)", async () => {
  const req = new Request("https://x/", { method: "POST", body: "x".repeat(100) });
  await assertRejects(() => readBoundedText(req, 10), BodyTooLargeError);
});

Deno.test("enforces the cap while streaming when Content-Length is absent", async () => {
  // A stream body has no Content-Length; the reader must still stop at the cap.
  const stream = new ReadableStream({
    start(controller) {
      const chunk = new TextEncoder().encode("x".repeat(64));
      for (let i = 0; i < 100; i++) controller.enqueue(chunk); // 6400 bytes
      controller.close();
    },
  });
  const req = new Request("https://x/", { method: "POST", body: stream });
  assertEquals(req.headers.get("content-length"), null); // no declared length
  await assertRejects(() => readBoundedText(req, 1024), BodyTooLargeError);
});

Deno.test("readBoundedJson parses under the cap", async () => {
  const req = new Request("https://x/", { method: "POST", body: JSON.stringify({ ok: true }) });
  const parsed = await readBoundedJson<{ ok: boolean }>(req, 1024);
  assert(parsed.ok);
});
