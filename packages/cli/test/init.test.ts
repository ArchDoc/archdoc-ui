import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

// A repository without a model: init starts one, and the rest of ArchDoc works on it.
let repo: string;
const write = async (path: string, text: string) => {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), text);
};

async function run(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd: repo, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "archdoc-init-"));
  await write("package.json", JSON.stringify({ name: "shop", private: true }));
  await write(
    "apps/web/package.json",
    JSON.stringify({
      name: "@shop/web",
      description: "The storefront",
      dependencies: { react: "19" },
    }),
  );
  await write(
    "apps/web/src/app.tsx",
    'import { trips } from "@shop/api";\nexport const app = trips;\n',
  );
  await write("services/api/package.json", JSON.stringify({ name: "@shop/api" }));
  await write("services/api/src/index.ts", "export const trips = [];\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
});
afterAll(() => rm(repo, { recursive: true, force: true }));

describe("archdoc init", () => {
  it("prints the model with --dry-run, and writes nothing", async () => {
    const r = await run("init", "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Would write \.archdoc\/archdoc\.yaml:/);
    expect(r.out).toContain("description: The storefront");
    expect((await run("check")).err).toContain("Run archdoc init to start one");
  });

  it("writes a model that validates, and that context and check work on", async () => {
    const r = await run("init");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ Wrote .archdoc/archdoc.yaml.");
    expect(r.out).toContain("2 elements, 1 use");
    const yaml = await readFile(join(repo, ".archdoc/archdoc.yaml"), "utf8");
    expect(yaml).toContain("technology: TypeScript, React");
    expect((await run("validate")).code).toBe(0);
    const context = await run("context", "apps/web/src/app.tsx");
    expect(context.out).toContain("(web)");
    // Nothing connects to the elements until someone adds actors and journeys; the use is declared.
    const check = await run("check");
    expect(check.out).not.toContain("doesn't declare");
  });

  it("never writes over a model", async () => {
    const r = await run("init");
    expect(r.code).toBe(1);
    expect(r.err).toContain("already has .archdoc/");
  });
});
