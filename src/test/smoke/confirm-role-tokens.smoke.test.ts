// Smoke coverage for audit Wave 1 role-confirmation hardening (H12/H13/T-G).
// Hermetic file-content invariants (no DB/network — the DB behavior is proven in
// supabase/tests/confirm_role_tokens_test.sql and the decision logic in
// supabase/functions/_shared/confirm-role.test.ts). Each test guards a SECURITY
// invariant; if one fails, a fix has regressed — repair the source, not the test.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const migrationsDir = resolve(REPO, "supabase/migrations");
const hardeningMigration =
  readdirSync(migrationsDir)
    .filter((f) => /harden_role_confirmation_tokens\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

const confirmAdmin = read("supabase/functions/confirm-admin-role/index.ts");
const confirmTeacher = read("supabase/functions/confirm-teacher-role/index.ts");
const shared = read("supabase/functions/_shared/confirm-role.ts");
const promoteAdmin = read("supabase/functions/promote-to-admin/index.ts");
const promoteTeacher = read("supabase/functions/promote-to-teacher/index.ts");
const adminPage = read("src/pages/ConfirmAdminPage.tsx");
const teacherPage = read("src/pages/ConfirmTeacherPage.tsx");

describe("Role-confirmation token hardening (smoke)", () => {
  it("CONFIRM-ROLE-001: migration adds expires_at to both promotion tables", () => {
    expect(hardeningMigration).toBeTruthy();
    expect(hardeningMigration).toMatch(
      /alter table public\.admin_promotions\s+add column if not exists expires_at/i
    );
    expect(hardeningMigration).toMatch(
      /alter table public\.teacher_promotions\s+add column if not exists expires_at/i
    );
  });

  it("CONFIRM-ROLE-002: teacher token is hashed at rest (H13) — trigger + hashed verifier, REVOKEd", () => {
    expect(hardeningMigration).toMatch(/create trigger hash_teacher_promotion_token/i);
    expect(hardeningMigration).toMatch(/create function public\.verify_teacher_promotion_token/i);
    expect(hardeningMigration).toMatch(/digest\(p_token, 'sha256'\)/i);
    expect(hardeningMigration).toMatch(
      /revoke all on function public\.verify_teacher_promotion_token\(text\) from public, anon, authenticated/i
    );
  });

  it("CONFIRM-ROLE-003: admin verifier now surfaces expires_at (H12)", () => {
    expect(hardeningMigration).toMatch(
      /create function public\.verify_admin_promotion_token[\s\S]*expires_at timestamptz/i
    );
  });

  it("CONFIRM-ROLE-004: both verify RPCs pin an empty/explicit search_path (no hijack)", () => {
    const verifiers =
      hardeningMigration.match(
        /create function public\.verify_\w+_promotion_token[\s\S]*?\$\$;/gi
      ) ?? [];
    expect(verifiers.length).toBe(2);
    for (const v of verifiers) expect(v).toMatch(/set search_path = public/i);
  });

  it("CONFIRM-ROLE-010: confirm-admin-role is POST-only, JWT-gated, ownership-checked, single-use", () => {
    // T-G: never grants on GET; requires the decision engine + hashed verify RPC.
    expect(confirmAdmin).toMatch(/from "\.\.\/_shared\/confirm-role\.ts"/);
    expect(confirmAdmin).toMatch(/evaluateConfirmation/);
    expect(confirmAdmin).toMatch(/verify_admin_promotion_token/);
    expect(confirmAdmin).toMatch(/auth\.getUser\(\)/);
    // Single-use atomic claim before the grant.
    expect(confirmAdmin).toMatch(/\.is\(\s*['"]confirmed_at['"]\s*,\s*null\s*\)/);
    // Must NOT read the plaintext token column.
    expect(confirmAdmin).not.toMatch(/\.eq\(\s*['"]token['"]/);
  });

  it("CONFIRM-ROLE-011: confirm-teacher-role uses the hashed RPC, not plaintext .eq('token')", () => {
    expect(confirmTeacher).toMatch(/verify_teacher_promotion_token/);
    expect(confirmTeacher).toMatch(/evaluateConfirmation/);
    expect(confirmTeacher).toMatch(/\.is\(\s*['"]confirmed_at['"]\s*,\s*null\s*\)/);
    expect(confirmTeacher).not.toMatch(/\.eq\(\s*['"]token['"]/); // H13: no plaintext lookup
  });

  it("CONFIRM-ROLE-012: the shared decision engine enforces method+auth+ownership+expiry", () => {
    expect(shared).toMatch(/method !== "POST"/);
    expect(shared).toMatch(/if \(!callerId\) return \{ kind: "unauthenticated"/);
    expect(shared).toMatch(/promotion\.user_id !== callerId/); // ownership proof (T-G/H11)
    expect(shared).toMatch(/Date\.parse\(promotion\.expires_at\) < nowMs/); // expiry (H12)
  });

  it("CONFIRM-ROLE-020: invitation emails link to the SPA confirm page, not the edge GET", () => {
    expect(promoteAdmin).toMatch(/\/confirm-admin\?token=/);
    expect(promoteAdmin).not.toMatch(/functions\/v1\/confirm-admin-role\?token=/);
    expect(promoteTeacher).toMatch(/\/confirm-teacher\?token=/);
    expect(promoteTeacher).not.toMatch(/functions\/v1\/confirm-teacher-role\?token=/);
  });

  it("CONFIRM-ROLE-021: confirm pages require sign-in and never auto-confirm on load", () => {
    for (const page of [adminPage, teacherPage]) {
      expect(page).toMatch(/useAuth\(\)/);
      expect(page).toMatch(/\/login\?redirect=/); // gate unauthenticated users
      expect(page).toMatch(/onConfirm/); // button-driven, explicit
      expect(page).not.toMatch(/useEffect\([\s\S]*functions\.invoke/); // no on-mount grant
    }
  });
});
