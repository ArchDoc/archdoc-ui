// Stages every public package whose version isn't on npm yet, for a maintainer
// to approve (npm stage approve, or on npmjs.com). Run by .github/workflows/release.yml
// after a clean build; trusted publishing (OIDC) authenticates it and adds provenance.
//
// Each package is packed with pnpm first, because pnpm turns the workspace:*
// dependencies into real versions and npm doesn't. With --dry-run it packs and
// lists what it would stage.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dryRun = process.argv.includes("--dry-run");
const out = mkdtempSync(join(tmpdir(), "archdoc-release-"));

// Dependencies first, so a package is never staged before what it needs.
const ORDER = ["spec", "core", "analyzers", "federation", "mcp", "cli"];
const found = readdirSync(join(root, "packages"));
const missing = found.filter((p) => !ORDER.includes(p));
if (missing.length) throw new Error(`Add ${missing.join(", ")} to ORDER in scripts/release.mjs.`);

/**
 * In GitHub Actions, checks the workflow can get an identity for npm's trusted
 * publishing, and prints what npm will compare with each package's trusted
 * publisher: the repository, the workflow file, and the environment. npm skips
 * trusted publishing silently when any of these is off, then asks for a login.
 */
async function identity() {
  if (!process.env.GITHUB_ACTIONS) return;
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "This workflow can't get an identity for npm: give the job `permissions: id-token: write`.",
    );
  }
  const res = await fetch(`${url}&audience=npm:registry.npmjs.org`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GitHub didn't issue an identity token (${res.status}).`);
  const { value } = await res.json();
  const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
  const workflow = String(claims.workflow_ref ?? "")
    .replace(/@.*$/, "")
    .split("/")
    .pop();
  console.log(
    [
      "npm will check each package's trusted publisher against this run:",
      `  repository:  ${claims.repository}`,
      `  workflow:    ${workflow}`,
      `  environment: ${claims.environment ?? "(none)"}`,
      `  ref:         ${claims.ref}`,
    ].join("\n"),
  );
}

/** npm's own trusted-publishing log lines from its newest debug log, which say where the exchange stopped. */
function oidcLog() {
  try {
    const dir = join(homedir(), ".npm", "_logs");
    const newest = readdirSync(dir).sort().pop();
    if (!newest) return [];
    return readFileSync(join(dir, newest), "utf8")
      .split("\n")
      .filter((l) => /oidc|exchange|ENEEDAUTH|E40[134]/i.test(l));
  } catch {
    return [];
  }
}

function onNpm(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

if (!dryRun) await identity();

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
    try {
      execFileSync("npm", ["stage", "publish", join(out, tarball), "--access", "public"], {
        stdio: "inherit",
      });
    } catch {
      const lines = oidcLog();
      const exchange = lines.find((l) => l.includes("oidc/token/exchange"));
      const status = Number(exchange?.match(/ (\d{3}) /)?.[1]);
      const why =
        status >= 500
          ? `npm's token exchange failed on npm's side (${status}). Nothing to fix here: re-run the failed job in a few minutes, and check https://status.npmjs.org.`
          : status === 404 || status === 401 || status === 403
            ? `npm found no trusted publisher on ${name} that matches this run (above). Check it with: npx npm@latest trust list ${name}. The workflow is release.yml and the environment is empty.`
            : "npm didn't use trusted publishing; its log above says why.";
      console.error(
        [
          `Couldn't stage ${name}@${version}.`,
          ...(lines.length ? ["npm's trusted publishing log:", ...lines.map((l) => `  ${l}`)] : []),
          why,
          "Stopped here, so nothing after this package was attempted.",
        ].join("\n"),
      );
      process.exit(1);
    }
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
