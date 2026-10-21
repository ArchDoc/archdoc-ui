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

describe("archdoc context with paths", () => {
  it("finds the owning element, relative to where it runs", async () => {
    const r = await run(
      `${repo}packages/core`,
      "context",
      "src/load/fs.ts",
      "--model",
      "../..",
      "--format",
      "json",
    );
    expect(r.code).toBe(0);
    const brief = JSON.parse(r.out);
    expect(brief.paths).toEqual(["packages/core/src/load/fs.ts"]);
    expect(brief.start[0]).toMatchObject({
      path: "packages/core/src/load/fs.ts",
      element: "toolchain.core.loader",
    });
  });

  it("names the journeys and actors a file affects", async () => {
    const r = await run(repo, "context", "packages/cli/src/commands/validate.ts");
    expect(r.out).toContain(
      "check-model (high) · step 1 names packages/cli/src/commands/validate.ts",
    );
    expect(r.out).toContain("developer (actor)");
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

describe("archdoc show", () => {
  it("prints an element, an actor, or a journey by ID", async () => {
    const element = await run(repo, "show", "toolchain.cli.commands");
    expect(element.code).toBe(0);
    expect(element.out).toContain("packages/cli/src/commands/**");
    expect((await run(repo, "show", "developer")).out).toContain("person");
    expect((await run(repo, "show", "check-model")).out).toContain("check-model:");
  });

  it("reads the model given with --model", async () => {
    const r = await run(`${repo}packages/core`, "show", "check-model", "--model", "../..");
    expect(r.code).toBe(0);
  });

  it("fails with suggestions when the ID doesn't exist", async () => {
    const r = await run(repo, "show", "cli-commands");
    expect(r.code).toBe(1);
    expect(r.err).toContain(
      'Nothing is called "cli-commands". Did you mean toolchain.cli.commands',
    );
    expect(r.err).toContain("archdoc context");
  });
});
