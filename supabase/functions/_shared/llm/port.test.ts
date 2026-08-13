import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStructuredBody,
  LlmRateLimitError,
  LlmTerminalError,
  parseStructuredArguments,
  withRetries,
} from "./port.ts";

Deno.test("buildStructuredBody forces the structured-output tool call", () => {
  const body = buildStructuredBody({
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: "hi" }],
    toolName: "emit_x",
    schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
    reasoningEffort: "low",
  }) as Record<string, any>;
  assertEquals(body.model, "openai/gpt-oss-20b");
  assertEquals(body.reasoning_effort, "low");
  assertEquals(body.tool_choice.function.name, "emit_x");
  assertEquals(body.tools[0].function.name, "emit_x");
  assertEquals(body.tools[0].function.parameters.required, ["a"]);
  // A non-DeepSeek model must NOT carry a provider pin (Anthropic/OpenAI are already US).
  assertEquals(body.provider, undefined);
});

Deno.test("buildStructuredBody pins DeepSeek to US inference providers (data residency)", () => {
  const body = buildStructuredBody({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    toolName: "emit_x",
    schema: { type: "object" },
  }) as Record<string, any>;
  assert(
    Array.isArray(body.provider?.only) && body.provider.only.length > 0,
    "DeepSeek gets a US provider allow-list"
  );
  // No non-US provider may appear (keeps raw personal data out of China jurisdiction).
  for (const p of body.provider.only)
    assert(!/deepseek/i.test(p), "the pin never allows DeepSeek's own (China) endpoint");
});

Deno.test("parseStructuredArguments extracts the JSON args from a tool-call response", () => {
  const resp = {
    choices: [
      { message: { tool_calls: [{ function: { arguments: '{"facts":["x"],"gaps":[]}' } }] } },
    ],
  };
  const args = parseStructuredArguments(resp);
  assertEquals(args.facts, ["x"]);
});

Deno.test("parseStructuredArguments throws when no tool call is present", () => {
  assertThrows(() => parseStructuredArguments({ choices: [{ message: { content: "plain" } }] }));
});

Deno.test("parseStructuredArguments throws on non-JSON arguments", () => {
  const resp = {
    choices: [{ message: { tool_calls: [{ function: { arguments: "not json" } }] } }],
  };
  assertThrows(() => parseStructuredArguments(resp));
});

Deno.test(
  "parseStructuredArguments: finish_reason 'length' is a TERMINAL truncation, not a retryable miss",
  () => {
    // No output at all, cut off at max_tokens.
    assertThrows(
      () =>
        parseStructuredArguments({
          choices: [{ finish_reason: "length", message: { content: "" } }],
        }),
      LlmTerminalError,
      "truncated"
    );
    // Partial, invalid JSON in the tool args, cut off at max_tokens.
    assertThrows(
      () =>
        parseStructuredArguments({
          choices: [
            {
              finish_reason: "length",
              message: { tool_calls: [{ function: { arguments: '{"components":[{"slug":"a"' } }] },
            },
          ],
        }),
      LlmTerminalError,
      "truncated"
    );
  }
);

Deno.test("withRetries returns the first success without retrying", async () => {
  let calls = 0;
  const out = await withRetries(
    "t",
    () => {
      calls++;
      return Promise.resolve("ok");
    },
    { timeoutMs: 1000, deadlineMs: 5000 }
  );
  assertEquals(out, "ok");
  assertEquals(calls, 1);
});

Deno.test(
  "withRetries FAILS FAST on a terminal error — exactly one attempt, no wasted retries",
  async () => {
    let calls = 0;
    await assertRejects(
      () =>
        withRetries(
          "t",
          () => {
            calls++;
            return Promise.reject(new LlmTerminalError("HTTP 400: bad request"));
          },
          { timeoutMs: 1000, deadlineMs: 5000 }
        ),
      LlmTerminalError,
      "bad request"
    );
    assertEquals(calls, 1); // the whole point: a 4xx / truncation / refusal is never retried
  }
);

Deno.test("withRetries retries a transient error, then succeeds", async () => {
  let calls = 0;
  const out = await withRetries(
    "t",
    () => {
      calls++;
      if (calls < 3) return Promise.reject(new Error("transient HTTP 503"));
      return Promise.resolve("recovered");
    },
    { timeoutMs: 1000, deadlineMs: 10_000 }
  );
  assertEquals(out, "recovered");
  assertEquals(calls, 3);
});

Deno.test("withRetries honors a rate-limit wait, then retries", async () => {
  let calls = 0;
  const out = await withRetries(
    "t",
    () => {
      calls++;
      if (calls === 1) return Promise.reject(new LlmRateLimitError(20));
      return Promise.resolve("after wait");
    },
    { timeoutMs: 1000, deadlineMs: 10_000 }
  );
  assertEquals(out, "after wait");
  assertEquals(calls, 2);
});

Deno.test(
  "withRetries is BOUNDED by the deadline — a persistent hang cannot be amplified",
  async () => {
    let calls = 0;
    const started = Date.now();
    await assertRejects(
      () =>
        withRetries(
          "t",
          () => {
            calls++;
            return Promise.reject(new Error("transient always"));
          },
          { timeoutMs: 1000, deadlineMs: 300 }
        ),
      Error,
      "budget"
    );
    const elapsed = Date.now() - started;
    assert(elapsed < 2000, `must fail within the deadline budget, took ${elapsed}ms`);
    assert(calls < 6, `must not burn all MAX_RETRIES when out of budget, made ${calls} calls`);
  }
);
