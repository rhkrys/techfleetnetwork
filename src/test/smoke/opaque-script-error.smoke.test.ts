// Smoke test for the opaque "Script error." filter.
// Ensures the multi-line payload that production browsers emit when CORS hides
// a cross-origin error is dropped at the source — never reaching audit_log
// or the Triage queue.

import { describe, it, expect } from "vitest";
import { isOpaqueScriptErrorMessage } from "@/services/error-reporter.service";

describe("isOpaqueScriptErrorMessage", () => {
  it("matches the plain literal", () => {
    expect(isOpaqueScriptErrorMessage("Script error.")).toBe(true);
    expect(isOpaqueScriptErrorMessage("Script error")).toBe(true);
  });

  it("matches the Error-wrapped literal", () => {
    expect(isOpaqueScriptErrorMessage("Error: Script error.")).toBe(true);
    expect(isOpaqueScriptErrorMessage("error: Script error")).toBe(true);
  });

  it("matches the multi-line production payload (the regression)", () => {
    const payload = [
      "Error: Script error.",
      " ih@https://techfleet.network/assets/index-xwXUwr4r.js:2:23615",
      " ri@https://techfleet.network/assets/index-xwXUwr4r.js:2:23978",
      " @https://techfleet.network/assets/index-xwXUwr4r.js:3:7453",
      " dispatchEvent@[native code]",
    ].join("\n");
    expect(isOpaqueScriptErrorMessage(payload)).toBe(true);
  });

  it("matches when the first line is preceded by blank lines", () => {
    expect(isOpaqueScriptErrorMessage("\n\n  Script error.  \nstack…")).toBe(true);
  });

  it("ignores real errors that happen to mention 'script error' inside", () => {
    expect(
      isOpaqueScriptErrorMessage("TypeError: cannot read 'script error' of undefined"),
    ).toBe(false);
    expect(isOpaqueScriptErrorMessage("Failed to fetch")).toBe(false);
    expect(isOpaqueScriptErrorMessage("")).toBe(false);
  });
});
