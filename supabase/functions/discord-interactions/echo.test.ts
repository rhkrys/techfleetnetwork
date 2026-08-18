// The /fleety bot echoes the asked question into a public channel, so the echo must neutralize raw
// user input (mentions, markdown, control chars) and stay bounded.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeEcho, withQuestionEcho } from "./echo.ts";

const ZWSP = String.fromCharCode(0x200b);

Deno.test("withQuestionEcho prepends a 'You asked:' block above the answer", () => {
  assertEquals(
    withQuestionEcho("What is a sprint?", "A sprint is..."),
    "**You asked:** What is a sprint?\n\nA sprint is..."
  );
});

Deno.test("empty/whitespace question -> no echo, answer unchanged", () => {
  assertEquals(withQuestionEcho("", "answer"), "answer");
  assertEquals(withQuestionEcho("   \n  ", "answer"), "answer");
});

Deno.test("defuses @everyone / @here / <@id> pings", () => {
  const out = sanitizeEcho("hey @everyone and <@123> look");
  assertStringIncludes(out, "@" + ZWSP); // every @ is broken with a zero-width space
  assertEquals(out.includes("@everyone"), false);
});

Deno.test("strips markdown control chars and collapses whitespace/newlines", () => {
  assertEquals(sanitizeEcho("**bold**  _x_\n\n> quote|pipe`code`"), "bold x quotepipecode");
});

Deno.test("bounds length with an ellipsis", () => {
  const long = "a".repeat(400);
  const out = sanitizeEcho(long);
  assertEquals(out.length <= 281, true); // 280 + ellipsis
  assertEquals(out.endsWith(String.fromCharCode(0x2026)), true);
});
