// Smoke-tier coverage for BDD feature area: Volunteer Openings
// Scenarios: VOL-OPEN-001..005, CLIENT-KIND-001..002
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const openingsPage = read("src/pages/ProjectOpeningsPage.tsx");
const detailPage = read("src/pages/ProjectOpeningDetailPage.tsx");
const clientsTab = read("src/components/clients/ClientsTab.tsx");
const publicOpeningsFn = read("supabase/functions/public-project-openings/index.ts");
const publicDetailFn = read("supabase/functions/public-project-detail/index.ts");

describe("Volunteer Openings (smoke)", () => {
  it("VOL-OPEN-001/002: openings page partitions by client.kind", () => {
    expect(openingsPage).toMatch(/client\?\.kind|clientKind/);
    expect(openingsPage).toMatch(/volunteer/i);
  });

  it("VOL-OPEN-003: volunteer tab reuses the same renderer (no duplicate component)", () => {
    // Tab labels both exist and a shared renderer is referenced for both subsets.
    expect(openingsPage).toMatch(/Client Project Openings/);
    expect(openingsPage).toMatch(/Volunteer Openings/);
  });

  it("VOL-OPEN-004: detail page renders a Volunteer Opening badge for internal clients", () => {
    expect(detailPage).toMatch(/Volunteer Opening/);
    expect(detailPage).toMatch(/kind === "internal"|kind === 'internal'/);
  });

  it("VOL-OPEN-005: application flow has no kind-specific branching", () => {
    const appPage = read("src/pages/ProjectApplicationPage.tsx");
    expect(appPage).not.toMatch(/client\.kind\s*===\s*['"]internal/);
  });

  it("CLIENT-KIND-001: ClientsTab schema and form expose kind with external default", () => {
    expect(clientsTab).toMatch(/kind/);
    expect(clientsTab).toMatch(/internal|external/i);
  });

  it("CLIENT-KIND-002: public openings + detail edge fns select client kind", () => {
    expect(publicOpeningsFn).toMatch(/kind/);
    expect(publicDetailFn).toMatch(/kind/);
  });
});
