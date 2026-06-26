import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const indexHtml = read("index.html");
const main = read("src/main.tsx");

describe("Firefox stale-chunk redirect loop (smoke)", () => {
  it("FIREFOX-CHUNK-001: inline reloader only fires before app mounts", () => {
    expect(indexHtml).toContain("function appMounted()");
    expect(indexHtml).toContain("if (appMounted()) return;");
    expect(indexHtml).toContain("data-tfn-mounted");
  });

  it("FIREFOX-CHUNK-002: inline reloader ignores lazyWithRetry retry URLs", () => {
    expect(indexHtml).toContain("/[?&](_n|__r|_r)=/.test(src)");
  });

  it("FIREFOX-CHUNK-003: recovery flag is cleared only after mount + 10s", () => {
    expect(indexHtml).toMatch(/setTimeout\(function\s*\(\)\s*\{\s*if \(appMounted\(\)\)/);
  });

  it("FIREFOX-CHUNK-004: main.tsx sets the mounted beacon after render", () => {
    expect(main).toContain("__tfnAppMounted = true");
    expect(main).toContain('setAttribute("data-tfn-mounted", "1")');
  });
});
