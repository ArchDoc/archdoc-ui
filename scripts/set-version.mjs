// Sets all six @archdoc packages to one version by hand, with a changelog
// entry, keeps them on one version from then on (a Changesets "fixed" group),
// and validates the result: lint, a clean build, tests, the model, the packed
// packages, and what a release would stage. Doesn't commit.
//
// For a version Changesets can't reach, such as 0.3.0 after 0.1.1, which skips
// the 0.2.x whose git tags (v0.1.2 to v0.2.0) belong to the v0 viewer:
//
//   pnpm set-version 0.3.0 "Skips 0.2.x, whose tags belong to the v0 viewer."
//
// Every other release goes through changesets (see CONTRIBUTING.md).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const PKGS = ["spec", "core", "analyzers", "federation", "mcp", "cli"];
const [version, note] = process.argv.slice(2);

const step = (s) => console.log(`\n\x1b[1m== ${s}\x1b[0m`);
const ok = (s) => console.log(`✓ ${s}`);
function fail(s) {
  console.error(`\x1b[31m✗ ${s}\x1b[0m`);
  process.exit(1);
}
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: "pipe", ...opts });
const quiet = (cmd, args) => {
  try {
    sh(cmd, args);
    return true;
  } catch {
    return false;
  }
};
const readJson = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));
const writeJson = (f, v) => writeFileSync(join(root, f), `${JSON.stringify(v, null, 2)}\n`);
const semver = (v) => v.split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  fail('Usage: pnpm set-version <x.y.z> ["changelog note"]');
}

step("Preconditions");
if (sh("git", ["status", "--porcelain"]).trim()) {
  fail("The working tree has changes. Commit or stash them first.");
}
sh("git", ["fetch", "-q", "origin", "--tags"]);
if (
  quiet("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}`]) ||
  quiet("git", ["ls-remote", "--exit-code", "--tags", "origin", `v${version}`])
) {
  fail(`Tag v${version} already exists.`);
}
const current = new Set(PKGS.map((p) => readJson(`packages/${p}/package.json`).version));
if (current.size !== 1) fail(`The packages are on different versions: ${[...current].join(", ")}.`);
const [from] = current;
if (!newer(version, from)) fail(`${version} isn't newer than the current ${from}.`);
for (const p of PKGS) {
  if (quiet("npm", ["view", `@archdoc/${p}@${version}`, "version"])) {
    fail(`@archdoc/${p}@${version} is already on npm.`);
  }
}
const pending = readdirSync(join(root, ".changeset")).filter(
  (f) => f.endsWith(".md") && f !== "README.md",
);
if (pending.length) {
  fail(
    `There are pending changesets (${pending.join(", ")}). Release them first, so they don't bump past ${version}.`,
  );
}
ok(
  `On ${sh("git", ["branch", "--show-current"]).trim()}, clean, all six at ${from}, v${version} free.`,
);

step("Keep the six packages on one version (Changesets fixed group)");
const names = PKGS.map((p) => readJson(`packages/${p}/package.json`).name);
const config = readJson(".changeset/config.json");
config.fixed = [names];
writeJson(".changeset/config.json", config);
ok(".changeset/config.json");

step(`Set the versions to ${version}, with a changelog entry`);
const entry = [
  `## ${version}`,
  "",
  "### Minor Changes",
  "",
  `- Moves to ${version}${note ? `. ${note}` : ""}. From now on, all six @archdoc packages share one version.`,
  "",
].join("\n");
for (const p of PKGS) {
  const file = `packages/${p}/package.json`;
  const pkg = readJson(file);
  pkg.version = version;
  writeJson(file, pkg);
  const log = join(root, "packages", p, "CHANGELOG.md");
  if (existsSync(log)) {
    const [title, ...rest] = readFileSync(log, "utf8").split("\n");
    writeFileSync(log, [title, "", entry, ...rest.slice(rest[0] === "" ? 1 : 0)].join("\n"));
  } else {
    writeFileSync(log, `# ${pkg.name}\n\n${entry}`);
  }
  ok(`${pkg.name} → ${version}`);
}

step("Pin the Claude Code plugin to it");
sh("node", ["scripts/sync-plugin.mjs"]);
ok(`integrations/claude-plugin → ${version}`);

step("Validate");
const run = (label, cmd, args) => {
  try {
    sh(cmd, args);
    ok(label);
  } catch (e) {
    console.error(e.stdout ?? "", e.stderr ?? "");
    fail(`${label} failed (${cmd} ${args.join(" ")}).`);
  }
};
run("Lockfile still matches", "pnpm", ["install", "--frozen-lockfile"]);
if (PKGS.some((p) => readJson(`packages/${p}/package.json`).version !== version)) {
  fail(`Not every package is at ${version}.`);
}
ok(`All six at ${version}`);
if (!names.every((n) => readJson(".changeset/config.json").fixed?.[0]?.includes(n))) {
  fail("The fixed group in .changeset/config.json doesn't name all six packages.");
}
ok("The fixed group names all six packages");
run("Lint", "pnpm", ["-s", "lint"]);
run("Clean build", "sh", ["-c", "pnpm -s clean && pnpm -s build"]);
run("Tests", "pnpm", ["-s", "test"]);
run("ArchDoc's own model", "pnpm", ["-s", "archdoc", "validate", "--strict"]);
run("Packed packages install and run", "pnpm", ["-s", "smoke"]);
const smoke = readdirSync(tmpdir())
  .filter((d) => d.startsWith("archdoc-smoke-"))
  .map((d) => join(tmpdir(), d, "tarballs"))
  .filter((d) => existsSync(d))
  .sort()
  .pop();
for (const t of smoke ? readdirSync(smoke) : []) {
  const manifest = sh("tar", ["-xOzf", join(smoke, t), "package/package.json"]);
  if (manifest.includes(`"${from}"`)) fail(`${t} still depends on ${from}.`);
}
ok(`Packed packages depend on ${version}`);
const dry = sh("pnpm", ["-s", "release", "--dry-run"]);
for (const line of dry.split("\n")) {
  if (/Would stage|already on npm|Nothing to release/.test(line)) console.log(`  ${line}`);
}

step("Done. Review, then commit and push");
console.log(sh("git", ["status", "--short"]));
console.log(`  git diff
  git add -A && git commit -m "chore: release ${version}"
  git push

Merging to main runs the release: it stages ${version} for all six packages,
tags v${version}, and you approve them on npm as before.`);
