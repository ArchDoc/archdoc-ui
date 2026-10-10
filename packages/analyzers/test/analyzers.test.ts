import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyze, contextFor, manifests, packageNameOf, tsImports } from "../src/index.js";

let dir: string;
const files: Record<string, string> = {
  "package.json": JSON.stringify({ name: "root", private: true }),
  "packages/ui/package.json": JSON.stringify(
    {
      name: "@acme/ui",
      dependencies: { "@acme/core": "workspace:*", react: "^19" },
      devDependencies: { "@acme/testkit": "workspace:*" },
    },
    null,
    2,
  ),
  "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
  "packages/testkit/package.json": JSON.stringify({ name: "@acme/testkit" }),
  "packages/ui/src/index.ts": [
    'import { thing } from "@acme/core";',
    'import type { Props } from "./types.js";',
    'import React from "react";',
    'import { readFile } from "node:fs";',
    'export { helper } from "./util";',
    'const lazy = () => import("@acme/core/sub/path");',
    'const old = require("./legacy.cjs");',
    "import type {",
    "  A,",
    '} from "./types.js";',
  ].join("\n"),
  "packages/ui/src/types.ts": "export type Props = {};",
  "packages/ui/src/util/index.ts": "export const helper = 1;",
  "packages/ui/src/legacy.cjs": "module.exports = {};",
  "packages/core/src/index.ts": 'import x from "../../../../outside/x";',
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "archdoc-analyzers-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const ctx = () => contextFor(dir, Object.keys(files).sort());

describe("tsImports", () => {
  it("resolves workspace packages and relative files, and skips third-party and built-ins", async () => {
    const deps = await tsImports.analyze(ctx());
    const ui = deps.filter((d) => d.from === "packages/ui/src/index.ts");
    expect(ui.map((d) => [d.line, d.specifier, d.to, d.typeOnly ?? false])).toEqual([
      [1, "@acme/core", "packages/core", false],
      [2, "./types.js", "packages/ui/src/types.ts", true],
      [5, "./util", "packages/ui/src/util/index.ts", false],
      [6, "@acme/core/sub/path", "packages/core", false],
      [7, "./legacy.cjs", "packages/ui/src/legacy.cjs", false],
      [10, "./types.js", "packages/ui/src/types.ts", true],
    ]);
  });

  it("drops imports that leave the repository", async () => {
    const deps = await tsImports.analyze(ctx());
    expect(deps.filter((d) => d.from === "packages/core/src/index.ts")).toEqual([]);
  });
});

describe("manifests", () => {
  it("finds workspace dependencies, marking dev ones", async () => {
    const deps = await manifests.analyze(ctx());
    expect(deps.map((d) => [d.from, d.to, d.specifier, d.typeOnly ?? false])).toEqual([
      ["packages/ui/package.json", "packages/core", "@acme/core", false],
      ["packages/ui/package.json", "packages/testkit", "@acme/testkit", true],
    ]);
    expect(deps[0]?.line).toBeGreaterThan(1);
  });
});

describe("analyze", () => {
  it("runs the built-in analyzers and sorts the result", async () => {
    const deps = await analyze(ctx());
    expect(deps.length).toBe(8);
    expect(deps.map((d) => d.from)).toEqual([...deps.map((d) => d.from)].sort());
  });

  it("names packages", () => {
    expect(packageNameOf("@a/b/c")).toBe("@a/b");
    expect(packageNameOf("lodash/fp")).toBe("lodash");
  });
});
