import { describe, expect, it } from "vitest";
import { indexCode, indexSource } from "../src/index.js";

const SOURCE = [
  'import { loadModel, type Model } from "@acme/core";', // 1
  'import type { Props } from "./types.js";',
  'import * as path from "node:path";',
  'import def, { helper as h } from "./util/index.js";',
  'export { thing } from "./thing.js";', // 5
  'export * from "./all.js";',
  "",
  "/** Loads it. */",
  "export async function load(dir: string): Promise<Model> {",
  "  return loadModel(dir, { name: h(def) });", // 10
  "}",
  "export class Store {}",
  "export interface Options { dir: string }",
  "export type Kind = 'a' | 'b';",
  "export const TOOL = 'archdoc_check', other = path.sep;", // 15
  "export enum Color { Red }",
  "function local() { return 'view-server'; }",
  "export { local as renamed };",
  "export default Store;",
].join("\n");

describe("indexSource", () => {
  const src = indexSource("pkg/src/a.ts", SOURCE, (s) =>
    s.startsWith(".") ? `pkg/src/${s.replace(/^\.\//, "").replace(/\.js$/, ".ts")}` : undefined,
  );

  it("lists exported declarations with their kind and line", () => {
    expect(src.exports.map((e) => [e.name, e.kind, e.line])).toEqual([
      ["load", "function", 9],
      ["Store", "class", 12],
      ["Options", "interface", 13],
      ["Kind", "type", 14],
      ["TOOL", "const", 15],
      ["other", "const", 15],
      ["Color", "enum", 16],
      ["renamed", "function", 17],
      ["default", "default", 19],
    ]);
  });

  it("lists named imports, where they resolve, and the line each is first used on", () => {
    const [core, types, util] = src.imports;
    expect(core).toMatchObject({
      specifier: "@acme/core",
      line: 1,
      names: [
        { name: "loadModel", line: 10 },
        { name: "Model", typeOnly: true, line: 9 },
      ],
    });
    expect(core?.typeOnly).toBeUndefined();
    expect(types).toMatchObject({ target: "pkg/src/types.ts", typeOnly: true });
    expect(util?.names).toEqual([
      { name: "default", local: "def", line: 10 },
      { name: "helper", local: "h", line: 10 },
    ]);
    // Namespace imports name nothing; re-exports pass names on.
    expect(src.imports.map((i) => i.specifier)).not.toContain("node:path");
    expect(src.imports.filter((i) => i.reexport).map((i) => [i.specifier, i.names])).toEqual([
      ["./thing.js", [{ name: "thing" }]],
      ["./all.js", [{ name: "*" }]],
    ]);
  });

  it("keeps identifier-like literals, such as tool names, with their line", () => {
    expect(src.literals).toEqual([
      { text: "archdoc_check", line: 15 },
      { text: "view-server", line: 17 },
    ]);
  });
});

describe("indexCode", () => {
  it("indexes TS and JS files, resolving workspace packages and relative imports", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "root" }),
      "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
      "packages/core/src/index.ts": 'export { run } from "./run.js";',
      "packages/core/src/run.ts": "export function run() {}",
      "packages/cli/src/main.ts": 'import { run } from "@acme/core";\nrun();',
      "packages/cli/src/types.d.ts": "export type X = 1;",
      "README.md": "# hi",
    };
    const index = await indexCode({
      baseDir: "/",
      files: Object.keys(files),
      read: async (p) => files[p] ?? "",
    });
    expect(index.files).toEqual(Object.keys(files));
    expect(index.sources.map((s) => s.path)).toEqual([
      "packages/core/src/index.ts",
      "packages/core/src/run.ts",
      "packages/cli/src/main.ts",
    ]);
    const main = index.sources.find((s) => s.path === "packages/cli/src/main.ts");
    expect(main?.imports[0]).toMatchObject({
      target: "packages/core",
      names: [{ name: "run", line: 2 }],
    });
    expect(index.sources[0]?.imports[0]).toMatchObject({
      target: "packages/core/src/run.ts",
      reexport: true,
    });
  });
});
