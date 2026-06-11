#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const checks = [
  {
    file: "src/services/auth.service.ts",
    forbidden: [
      "login-with-captcha",
      "setSessionSafe",
      "supabase.functions.invoke<{ session: AuthSession",
    ],
  },
  {
    file: "src/features/auth/flows/sign-in-password.flow.ts",
    forbidden: ["setSessionSafe", "login-with-captcha"],
  },
];

const failures = [];

for (const check of checks) {
  const text = readFileSync(resolve(root, check.file), "utf8");
  for (const token of check.forbidden) {
    if (text.includes(token)) failures.push(`${check.file}: forbidden auth-token-handoff reference '${token}'`);
  }
}

if (failures.length) {
  console.error("\nDirect password sign-in guard failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nPassword sign-in must use supabase.auth.signInWithPassword directly; do not restore the edge-token handoff.\n");
  process.exit(1);
}

console.log("Direct password sign-in guard passed.");