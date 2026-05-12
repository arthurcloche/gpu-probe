// Publishes the current main branch + a fresh dist/ to the public CDN repo
// (jsDelivr serves files from there). main here stays clean — dist/ remains
// gitignored. The public remote's main = source commits + one publish commit
// with dist/ on top, force-pushed each time we publish.
//
// Run: pnpm publish-cdn

import { execSync } from "node:child_process";
import fs from "node:fs";

const REMOTE = "public";
const PUBLISH_BRANCH = "publish-dist-tmp";

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: opts.silent ? "pipe" : "inherit", encoding: "utf8", ...opts });
}
function shOut(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
}

const dirty = shOut("git status --porcelain");
if (dirty) {
  console.error("✗ working tree has uncommitted changes — commit or stash first:");
  console.error(dirty);
  process.exit(1);
}

const branch = shOut("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.error(`✗ must run from main (currently on ${branch})`);
  process.exit(1);
}

const remotes = shOut("git remote");
if (!remotes.split("\n").includes(REMOTE)) {
  console.error(`✗ remote "${REMOTE}" not configured. Add with:`);
  console.error(`    git remote add ${REMOTE} https://github.com/arthurcloche/gpu-probe.git`);
  process.exit(1);
}

console.log("→ build");
sh("node build.mjs");

console.log(`→ push source to ${REMOTE}/main`);
sh(`git push ${REMOTE} main --force`);

console.log(`→ create publish branch with dist/`);
const branches = shOut("git branch --list " + PUBLISH_BRANCH);
if (branches) sh(`git branch -D ${PUBLISH_BRANCH}`);
sh(`git checkout -b ${PUBLISH_BRANCH}`);

const gitignore = fs.readFileSync(".gitignore", "utf8");
const stripped = gitignore.split("\n").filter((l) => l.trim() !== "dist/").join("\n");
fs.writeFileSync(".gitignore", stripped);

let bkmCdnLen = 0;
try {
  sh("git add .gitignore dist/");
  sh('git commit -m "Publish dist/ for CDN bookmarklet"');
  sh(`git push ${REMOTE} ${PUBLISH_BRANCH}:main --force`);
  // Read while dist/ is still on disk — checkout to main removes the
  // tracked dist files since main has dist/ gitignored.
  bkmCdnLen = fs.readFileSync("dist/bookmarklet-cdn.url.txt", "utf8").length;
} finally {
  sh("git checkout main");
  sh(`git branch -D ${PUBLISH_BRANCH}`);
}

console.log(`\n✓ published. jsDelivr will serve fresh files in ~1 min.`);
if (bkmCdnLen) console.log(`  CDN bookmarklet URL: ${bkmCdnLen} chars (in dist/bookmarklet-cdn.url.txt after next build)`);
