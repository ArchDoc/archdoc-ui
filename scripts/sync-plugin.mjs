// Pins the Claude Code plugin to the CLI version released from the same
// commit: its version in plugin.json, and the @archdoc/cli version its MCP
// server runs. Runs after `changeset version` (pnpm version-packages) and in
// set-version; integrations/agent-skills/test/sync.test.ts checks it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const plugin = join(root, "integrations/claude-plugin");
const { version } = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));

// Only the version strings change, so the files keep the repo's formatting.
const manifest = join(plugin, ".claude-plugin/plugin.json");
writeFileSync(
  manifest,
  readFileSync(manifest, "utf8").replace(/"version": "[^"]+"/, `"version": "${version}"`),
);

const mcp = join(plugin, ".mcp.json");
writeFileSync(
  mcp,
  readFileSync(mcp, "utf8").replace(/@archdoc\/cli@[^"]+/, `@archdoc/cli@${version}`),
);
console.log(`The Claude Code plugin is at ${version}, and runs @archdoc/cli@${version}.`);
