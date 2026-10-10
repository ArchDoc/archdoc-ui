import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createProgram } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const tmp = await mkdtemp(join(tmpdir(), "archdoc-cli-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

async function run(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd: repo, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

describe("archdoc validate", () => {
  it("passes on ArchDoc's own model", async () => {
    const r = await run("validate");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^✓ archdoc: \d+ actors, \d+ elements/);
  });

  it("fails with file:line diagnostics on a v1 file", async () => {
    const r = await run("validate", "examples/v1/blog.yaml");
    expect(r.code).toBe(1);
    expect(r.err).toContain("examples/v1/blog.yaml:1:1 error spec/v1-model");
  });

  it("prints JSON", async () => {
    const r = await run("validate", "--json");
    const result = JSON.parse(r.out);
    expect(result).toMatchObject({ ok: true, namespace: "archdoc", diagnostics: [] });
  });
});

describe("archdoc migrate", () => {
  it("writes a v2 model that validates", async () => {
    const out = join(tmp, "blog.yaml");
    const r = await run("migrate", "examples/v1/blog.yaml", "-o", out);
    expect(r.code).toBe(0);
    expect(r.err).toContain("note:");
    expect(parse(await readFile(out, "utf8"))).toMatchObject({ archdoc: "2.0", namespace: "blog" });
    expect((await run("validate", out)).code).toBe(0);
  });

  it("refuses files that are already v2", async () => {
    const r = await run("migrate", "examples/blog.yaml");
    expect(r.code).toBe(1);
  });
});

describe("archdoc schema", () => {
  it("prints the JSON Schema", async () => {
    const r = await run("schema");
    expect(JSON.parse(r.out).title).toBe("ArchDoc model file (spec v2)");
  });
});
