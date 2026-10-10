import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

async function run(cwd: string, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

describe("archdoc search", () => {
  it("finds elements for a few words, and fails when nothing matches", async () => {
    const r = await run(repo, "search", "cli", "command", "--json");
    expect(JSON.parse(r.out)[0]).toMatchObject({ id: "toolchain.cli.commands", type: "element" });
    expect((await run(repo, "search", "kubernetes")).code).toBe(1);
  });
});

describe("archdoc locate", () => {
  it("finds the owning element, relative to where it runs", async () => {
    const r = await run(
      `${repo}packages/core`,
      "locate",
      "src/load/fs.ts",
      "--model",
      "../..",
      "--json",
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual([
      {
        path: "packages/core/src/load/fs.ts",
        element: "toolchain.core.loader",
        kind: "component",
        pattern: "packages/core/src/load/**",
        owners: ["maintainers"],
        ties: [],
      },
    ]);
  });

  it("says when a path isn't mapped", async () => {
    const r = await run(repo, "locate", "README.md");
    expect(r.out).toContain("README.md\n  not mapped to any element");
  });
});

describe("archdoc impact", () => {
  it("reports journeys and actors for a file", async () => {
    const r = await run(repo, "impact", "packages/cli/src/commands/validate.ts", "--json");
    const result = JSON.parse(r.out);
    expect(result.element).toBe("toolchain.cli.commands");
    expect(result.journeys.map((j: { id: string }) => j.id)).toContain("check-model");
    expect(result.actors.map((a: { id: string }) => a.id)).toContain("developer");
  });

  it("fails with a reason for unknown targets", async () => {
    const r = await run(repo, "impact", "no-such-thing");
    expect(r.code).toBe(1);
    expect(r.err).toContain("not an element, actor, or mapped file");
  });
});

describe("archdoc map", () => {
  it("summarizes coverage", async () => {
    const r = await run(repo, "map", "--json");
    const result = JSON.parse(r.out);
    expect(result.mapped).toBeGreaterThan(0);
    expect(result.elements["toolchain.core"]).toBeGreaterThan(0);
    expect(result.stale).toEqual([]);
  });
});
