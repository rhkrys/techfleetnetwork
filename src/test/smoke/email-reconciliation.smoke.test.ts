import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("EMAIL-RECONCILE stuck pending safeguards", () => {
  const shared = read("supabase/functions/_shared/transactional-email.ts");
  const worker = read("supabase/functions/process-email-queue/index.ts");
  const reconciler = read("supabase/functions/reconcile-stuck-emails/index.ts");
  const config = read("supabase/config.toml");
  const latestMigration = read("supabase/migrations/20260603205609_6d46ff02-b247-454d-a1ea-e7f7fb73f2b5.sql");
  const healthPage = read("src/pages/SystemHealthPage.tsx");

  it("EMAIL-RECONCILE-001: duplicate enqueue exits before new pending row or queue insert", () => {
    expect(shared).toMatch(/hasTerminal\s*\|\|\s*hasRecentPending/);
    expect(shared).toMatch(/deduped:\s*true/);
    expect(shared.indexOf("deduped: true")).toBeLessThan(shared.indexOf("const emailPayload ="));
    expect(shared).toMatch(/queue_payload:\s*emailPayload/);
  });

  it("EMAIL-RECONCILE-002: worker duplicate-skip appends a terminal sent row", () => {
    expect(worker).toMatch(/alreadySent/);
    expect(worker).toMatch(/status:\s*['"]sent['"]/);
    expect(worker).toMatch(/Duplicate enqueue reconciled/);
    expect(worker).toMatch(/delete_email/);
  });

  it("EMAIL-RECONCILE-003..006: reconciler has terminal, leave-alone, requeue, and DLQ branches", () => {
    expect(reconciler).toMatch(/reconcile_stuck_emails/);
    expect(config).toMatch(/\[functions\.reconcile-stuck-emails\]/);
    expect(latestMigration).toMatch(/email_message_ids_in_queue/);
    expect(latestMigration).toMatch(/PERFORM public\.enqueue_email\(v_queue_name, v_payload\)/);
    expect(latestMigration).toMatch(/'dlq_lost'/);
    expect(latestMigration).toMatch(/'email_reconciler_run'/);
  });

  it("EMAIL-RECONCILE visibility includes stuck pending, requeued, and dlq_lost counts", () => {
    expect(healthPage).toMatch(/Stuck pending \(>10 min\)/);
    expect(healthPage).toMatch(/requeued/);
    expect(healthPage).toMatch(/dlq_lost/);
  });

  it("EMAIL-RECONCILE BDD records include UI, DB, and Code expectations", () => {
    for (let i = 1; i <= 6; i += 1) {
      expect(latestMigration).toContain(`EMAIL-RECONCILE-00${i}`);
    }
    expect(latestMigration).toMatch(/Then \[UI\]/);
    expect(latestMigration).toMatch(/And \[DB\]/);
    expect(latestMigration).toMatch(/And \[Code\]/);
  });
});