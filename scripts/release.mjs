// Stages every public package whose version isn't on npm yet, for a maintainer
// to approve (npm stage approve, or on npmjs.com). Run by .github/workflows/release.yml
// after a clean build; trusted publishing (OIDC) authenticates it and adds provenance.
//
// Each package is packed with pnpm first, because pnpm turns the workspace:*
// dependencies into real versions and npm doesn't. With --dry-run it packs and
// lists what it would stage.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dryRun = process.argv.includes("--dry-run");
const out = mkdtempSync(join(tmpdir(), "archdoc-release-"));

// Dependencies first, so a package is never staged before what it needs.
const ORDER = ["spec", "core", "analyzers", "federation", "mcp", "cli"];
const found = readdirSync(join(root, "packages"));
const missing = found.filter((p) => !ORDER.includes(p));
if (missing.length) throw new Error(`Add ${missing.join(", ")} to ORDER in scripts/release.mjs.`);

function onNpm(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

let staged = 0;
for (const dir of ORDER) {
  const cwd = join(root, "packages", dir);
  const {
    name,
    version,
    private: isPrivate,
  } = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  if (isPrivate) continue;
  if (onNpm(name, version)) {
    console.log(`${name}@${version} is already on npm.`);
    continue;
  }
  const before = new Set(readdirSync(out));
  execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd, stdio: "inherit" });
  const tarball = readdirSync(out).find((f) => !before.has(f));
  if (!tarball) throw new Error(`pnpm pack wrote no tarball for ${name}.`);
  if (dryRun) {
    console.log(`Would stage ${name}@${version} from ${tarball}.`);
  } else {
    execFileSync("npm", ["stage", "publish", join(out, tarball), "--access", "public"], {
      stdio: "inherit",
    });
    // changesets/action reads these lines to tag the release on GitHub.
    console.log(`New tag: ${name}@${version}`);
  }
  staged++;
}
console.log(
  staged
    ? `${dryRun ? "Would stage" : "Staged"} ${staged} package${staged === 1 ? "" : "s"}. Approve them with npm stage approve, or on npmjs.com.`
    : "Nothing to release: every package's version is already on npm.",
);
