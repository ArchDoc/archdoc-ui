// Packs every public package, installs the tarballs into an empty project the
// way a user's npx would, and runs the installed CLI: --version, validate on
// ArchDoc's own model, an MCP handshake, and site (which needs the bundled
// explorer). A file missing from a package's `files`, or a workspace:* left in
// a dependency, fails here instead of after a release. Run after `pnpm build`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "archdoc-smoke-"));
const tarballs = join(work, "tarballs");
const app = join(work, "app");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

for (const dir of readdirSync(join(root, "packages"))) {
  const cwd = join(root, "packages", dir);
  if (JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).private) continue;
  run("pnpm", ["pack", "--pack-destination", tarballs], cwd);
}
for (const t of readdirSync(tarballs)) {
  const manifest = execFileSync("tar", ["-xOzf", join(tarballs, t), "package/package.json"], {
    encoding: "utf8",
  });
  if (manifest.includes("workspace:")) throw new Error(`${t} still has a workspace: dependency.`);
}

// Install all the tarballs together, so the CLI gets this build's packages, not npm's.
run("mkdir", ["-p", app], work);
writeFileSync(join(app, "package.json"), '{ "name": "smoke", "private": true }\n');
run(
  "npm",
  ["install", "--no-audit", "--no-fund", ...readdirSync(tarballs).map((t) => join(tarballs, t))],
  app,
);

const archdoc = join(app, "node_modules", ".bin", "archdoc");
run(archdoc, ["--version"], app);
run(archdoc, ["validate", root], app);
// The MCP server answers an initialize request on stdio.
const hello = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  },
};
const mcp = spawnSync(archdoc, ["mcp", "--model", root], {
  cwd: app,
  input: `${JSON.stringify(hello)}\n`,
  encoding: "utf8",
  timeout: 30_000,
});
if (!mcp.stdout.includes('"serverInfo"')) {
  throw new Error(`archdoc mcp didn't answer initialize:\n${mcp.stdout}\n${mcp.stderr}`);
}
console.log("✓ archdoc mcp answers initialize.");
const site = join(work, "site");
run(archdoc, ["site", root, "--out", site], app);
if (!existsSync(join(site, "index.html"))) throw new Error("archdoc site wrote no index.html.");
console.log("✓ The packed packages install and run.");
