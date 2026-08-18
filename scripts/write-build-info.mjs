// Stamp the built bundle with the commit it was built from, so a deploy can be VERIFIED live.
// Writes dist/build-info.json {sha, builtAt} and injects <meta name="app-build-sha"> into
// dist/index.html. Runs on EVERY build path — local, the Cloudflare git-integration (which sets
// CF_PAGES_COMMIT_SHA), and GitHub Actions (GITHUB_SHA) — so whatever ships can be checked against
// main. This is what makes a silent "served the old bundle" failure detectable (see
// .github/workflows/verify-deploy.yml).
import fs from "node:fs";
import { execSync } from "node:child_process";

let sha = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || "";
if (!sha) {
  try {
    sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    /* not a git checkout — leave unknown */
  }
}
const info = { sha: sha || "unknown", builtAt: new Date().toISOString() };

fs.writeFileSync("dist/build-info.json", JSON.stringify(info) + "\n");

// Also embed the sha as a meta tag so it's visible in the served HTML itself.
try {
  const p = "dist/index.html";
  const html = fs.readFileSync(p, "utf8");
  if (!html.includes('name="app-build-sha"')) {
    fs.writeFileSync(
      p,
      html.replace("</head>", `  <meta name="app-build-sha" content="${info.sha}" />\n</head>`)
    );
  }
} catch {
  /* index.html shape changed — build-info.json is still authoritative */
}

console.log(`build-info: sha=${info.sha} builtAt=${info.builtAt}`);
