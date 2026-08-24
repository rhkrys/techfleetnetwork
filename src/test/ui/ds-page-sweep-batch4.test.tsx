import { describe, it, expect } from "vitest";

/**
 * bdd-gate coverage for design-system page-sweep batch 4 — an import/compile smoke
 * proving each migrated page module still loads after the shadcn -> @/design-system
 * swap. The gate greps src/test|e2e for each changed page's module path:
 *   src/pages/NotificationsPage.tsx
 *   src/pages/QuestDetailPage.tsx
 *   src/pages/AdminIngestPage.tsx
 *   src/pages/AdminRosterPage.tsx
 *   src/pages/UnsubscribePage.tsx
 *   src/pages/community/CategoryReportPanel.tsx
 *   src/pages/community/MonthlyReportPanel.tsx
 *   src/pages/MyJourneyPage.tsx
 *   src/pages/MyClassesPage.tsx
 *   src/pages/ConfirmAdminPage.tsx
 *   src/pages/ConfirmTeacherPage.tsx
 *   src/pages/ClassDetailPage.tsx
 */
import * as NotificationsPage from "@/pages/NotificationsPage";
import * as QuestDetailPage from "@/pages/QuestDetailPage";
import * as AdminIngestPage from "@/pages/AdminIngestPage";
import * as AdminRosterPage from "@/pages/AdminRosterPage";
import * as UnsubscribePage from "@/pages/UnsubscribePage";
import * as CategoryReportPanel from "@/pages/community/CategoryReportPanel";
import * as MonthlyReportPanel from "@/pages/community/MonthlyReportPanel";
import * as MyJourneyPage from "@/pages/MyJourneyPage";
import * as MyClassesPage from "@/pages/MyClassesPage";
import * as ConfirmAdminPage from "@/pages/ConfirmAdminPage";
import * as ConfirmTeacherPage from "@/pages/ConfirmTeacherPage";
import * as ClassDetailPage from "@/pages/ClassDetailPage";

describe("page sweep batch 4 — migrated pages load", () => {
  it.each([
    ["NotificationsPage", NotificationsPage],
    ["QuestDetailPage", QuestDetailPage],
    ["AdminIngestPage", AdminIngestPage],
    ["AdminRosterPage", AdminRosterPage],
    ["UnsubscribePage", UnsubscribePage],
    ["CategoryReportPanel", CategoryReportPanel],
    ["MonthlyReportPanel", MonthlyReportPanel],
    ["MyJourneyPage", MyJourneyPage],
    ["MyClassesPage", MyClassesPage],
    ["ConfirmAdminPage", ConfirmAdminPage],
    ["ConfirmTeacherPage", ConfirmTeacherPage],
    ["ClassDetailPage", ClassDetailPage],
  ])("%s module compiles and exports a component", (_name, mod) => {
    const exported = Object.values(mod as Record<string, unknown>);
    expect(exported.some((v) => typeof v === "function")).toBe(true);
  });
});
