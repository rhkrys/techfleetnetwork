// Member-facing staff label: staff are called "Support Agent" to members
// (admins ARE the support agents — this is language only, no scoped role).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const ticketDetail = read("src/pages/community/TicketDetail.tsx");
const worker = read("supabase/functions/process-freescout-events/index.ts");

describe("member-facing 'Support Agent' label (smoke)", () => {
  it("HELP-DESK-070: the ticket thread labels staff 'Support Agent' (not 'Tech Fleet')", () => {
    expect(ticketDetail).toMatch(/\? customerLabel : "Support Agent"/);
    expect(ticketDetail).not.toMatch(/\? customerLabel : "Tech Fleet"/);
  });

  it("HELP-DESK-071: reply notifications name the replier 'Support Agent' generically", () => {
    expect(worker).toMatch(/const replierName = "Support Agent"/);
    // No longer exposes the individual admin's name or "The Tech Fleet team".
    expect(worker).not.toMatch(/replierName =\s*actor/);
    expect(worker).not.toMatch(/"The Tech Fleet team"/);
  });
});
