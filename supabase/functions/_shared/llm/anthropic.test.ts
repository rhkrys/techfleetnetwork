import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { buildAnthropicBody, isAnthropicModel, parseAnthropicToolResult } from "./anthropic.ts";

const REQ = {
  model: "claude-sonnet-5",
  messages: [
    { role: "system" as const, content: "You are a writer." },
    { role: "system" as const, content: "Obey the rules." },
    { role: "user" as const, content: "Produce the doc." },
  ],
  toolName: "emit_handoff_version",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { components: { type: "array" } },
    required: ["components"],
  },
  maxTokens: 4096,
};

Deno.test("isAnthropicModel routes only claude-* to the adapter", () => {
  assert(isAnthropicModel("claude-sonnet-5"));
  assert(isAnthropicModel("claude-opus-5"));
  assert(!isAnthropicModel("openai/gpt-oss-20b"));
  assert(!isAnthropicModel("llama-3.3-70b"));
});

Deno.test("buildAnthropicBody lifts system turns out, forces the tool, disables thinking", () => {
  const body = buildAnthropicBody(REQ) as Record<string, unknown>;
  assertEquals(body.model, "claude-sonnet-5");
  assertEquals(body.max_tokens, 4096);
  // both system messages concatenated into the top-level `system` field
  assertStringIncludes(body.system as string, "You are a writer.");
  assertStringIncludes(body.system as string, "Obey the rules.");
  // only non-system turns remain as messages
  assertEquals((body.messages as unknown[]).length, 1);
  assertEquals((body.messages as Array<{ role: string }>)[0].role, "user");
  // forced tool call = the structured result; thinking disabled (required with forced tool_choice)
  assertEquals((body.tool_choice as { type: string; name: string }).name, "emit_handoff_version");
  assertEquals((body.thinking as { type: string }).type, "disabled");
  assertEquals((body.tools as Array<{ name: string }>)[0].name, "emit_handoff_version");
});

Deno.test("buildAnthropicBody defaults max_tokens when unset", () => {
  const body = buildAnthropicBody({ ...REQ, maxTokens: undefined }) as Record<string, unknown>;
  assert((body.max_tokens as number) >= 4096);
});

Deno.test("parseAnthropicToolResult extracts the tool_use input", () => {
  const json = {
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "ignore me" },
      {
        type: "tool_use",
        name: "emit_handoff_version",
        input: { components: [{ slug: "x", markdown: "hi" }] },
      },
    ],
  };
  const out = parseAnthropicToolResult(json);
  assertEquals((out.components as unknown[]).length, 1);
});

Deno.test("parseAnthropicToolResult surfaces a refusal as an error", () => {
  assertThrows(
    () => parseAnthropicToolResult({ stop_reason: "refusal", content: [] }),
    Error,
    "refused"
  );
});

Deno.test("parseAnthropicToolResult errors when no tool_use block is present", () => {
  assertThrows(
    () =>
      parseAnthropicToolResult({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "no tool" }],
      }),
    Error,
    "no tool_use"
  );
});
