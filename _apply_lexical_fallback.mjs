// Apply the 2.2-D lexical-fallback migration to prod (migrations are applied manually on this
// project — no schema_migrations ledger). Idempotent: CREATE EXTENSION/INDEX IF NOT EXISTS +
// CREATE OR REPLACE FUNCTION + REVOKE/GRANT. Safe to re-run.
//   cd C:\Users\morga\Documents\techfleetnetwork
//   $env:PGPASSWORD="<db pw>"; node _apply_lexical_fallback.mjs
import fs from "node:fs";
import pg from "pg";
if (!process.env.PGPASSWORD) {
  console.error("Set PGPASSWORD first.");
  process.exit(1);
}
const ssl =
  process.env.CA_PATH && fs.existsSync(process.env.CA_PATH)
    ? { ca: fs.readFileSync(process.env.CA_PATH, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: false };
const sql = fs.readFileSync(
  "supabase/migrations/20260818140000_fleety_kb_lexical_fallback.sql",
  "utf8"
);
const c = new pg.Client({
  host: "aws-1-us-east-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.pzvqxdgoztbfikfuifix",
  password: process.env.PGPASSWORD,
  database: "postgres",
  ssl,
});
await c.connect();
console.log("Applying 20260818140000_fleety_kb_lexical_fallback.sql …");
await c.query(sql);
// Smoke: the function exists and returns rows for a plain lexical query (no embedding involved).
const { rows } = await c.query(
  "select count(*)::int as n from public.fleety_kb_lexical_search('skills practices career', 6)"
);
console.log(
  `OK. fleety_kb_lexical_search('skills practices career') -> ${rows[0].n} hits (embedding NOT used).`
);
await c.end();
