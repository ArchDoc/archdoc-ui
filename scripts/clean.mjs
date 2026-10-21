// Removes every build output, so a build (and a published package) only holds
// what the current source compiles to. `tsc -b --clean` only removes outputs of
// files that still exist, so a deleted source file's .js would otherwise ship.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const targets = ["apps/web/dist", "packages/cli/web"];
for (const pkg of readdirSync(join(root, "packages"))) {
  targets.push(`packages/${pkg}/dist`, `packages/${pkg}/tsconfig.tsbuildinfo`);
}
for (const t of targets) rmSync(join(root, t), { recursive: true, force: true });
console.log(`Removed build outputs in ${targets.length} places.`);
