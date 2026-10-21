import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram, startViewServer } from "../src/index.js";

// An agent changes code under a sealed fact: check and the PR report flag it,
// verify says what changed, and sealing it again says someone checked.
let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    encoding: "utf8",
  });
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
  repo = await mkdtemp(join(tmpdir(), "archdoc-seal-"));
  git("init", "-q", "-b", "main");
  await write(
    ".archdoc/archdoc.yaml",
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "actors:",
      "  buyer: { kind: person, uses: { api: Buys } }",
      "elements:",
      "  api:",
      "    kind: container",
      "    code:",
      "      - { path: services/api/** }",
      "      - { path: services/api/price.ts, symbol: price, description: Prices an order }",
    ].join("\n"),
  );
  await write("package.json", JSON.stringify({ name: "shop", private: true }));
  await write(
    "services/api/price.ts",
    "export function price(cents: number) {\n  return cents;\n}\n",
  );
  await write("services/api/index.ts", "export const routes = [];\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
});
afterAll(() => rm(repo, { recursive: true, force: true }));

describe("seals", () => {
  it("does nothing until a repository starts sealing", async () => {
    const r = await run("verify");
    expect(r.out).toContain("no .archdoc/archdoc.sum yet");
    expect(r.code).toBe(0);
    expect((await run("check")).out).not.toContain("seal/");
  });

  it("seals every fact, and then everything matches", async () => {
    const r = await run("seal", "--all");
    expect(r.out).toBe(
      "✓ Sealed 2 facts in .archdoc/archdoc.sum: element:api, element:api#services/api/price.ts:price.\nEvery fact that points at code (2) matches its seal.",
    );
    const sum = await readFile(join(repo, ".archdoc/archdoc.sum"), "utf8");
    expect(sum).toContain("element:api#services/api/price.ts:price:");
    expect((await run("check", "--seals")).out).toBe("✓ 2 of 2 facts still match their seal.");
    // verify still works, for one more release.
    const v = await run("verify");
    expect(v.out).toBe("✓ 2 of 2 facts still match their seal.");
    expect(v.err).toContain('"archdoc verify" is part of "archdoc check --seals" now');
    git("add", "-A");
    git("commit", "-q", "-m", "seal");
    git("checkout", "-q", "-b", "feature");
  });

  it("flags facts whose code a change touched, in verify, check, and the report", async () => {
    await write(
      "services/api/price.ts",
      "export function price(cents: number) {\n  return Math.round(cents * 1.2);\n}\n",
    );
    await write("services/api/tax.ts", "export const vat = 0.2;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "tax");

    const v = await run("check", "--seals");
    expect(v.code).toBe(1);
    expect(v.out).toContain("2 facts to check");
    expect(v.out).toContain("  + services/api/tax.ts");
    expect(v.out).toContain("  services/api/price.ts (price) changed");
    expect(v.out).toContain("  → archdoc seal element:api#services/api/price.ts:price");

    const c = await run("check", "--base", "main");
    expect(c.out).toMatch(/To check \(2\)/);
    expect(c.out).toContain(
      "! Code changed under the model: The code element api points at changed",
    );

    const report = await run("report", "--base", "main");
    expect(report.out).toContain("**Code changed under the model.**");

    // The explorer lists the same facts, so a reader sees what to re-check.
    const server = await startViewServer({ target: ".", cwd: repo, webDir: repo });
    try {
      const payload = (await (await fetch(`${server.url}/api/model`)).json()) as {
        seals: { total: number; facts: { key: string; element?: string; changes: string[] }[] };
      };
      expect(payload.seals.total).toBe(2);
      expect(payload.seals.facts.map((f) => [f.key, f.element, f.changes])).toEqual([
        ["element:api", "api", ["+ services/api/tax.ts"]],
        [
          "element:api#services/api/price.ts:price",
          "api",
          ["services/api/price.ts (price) changed"],
        ],
      ]);
    } finally {
      await server.close();
    }
  });

  it("keeps changed facts flagged until named, and records who checked them", async () => {
    const plain = await run("seal");
    expect(plain.out).toContain("2 changed facts are still to check:\nelement:api");
    expect(plain.out).toContain("  + services/api/tax.ts");
    expect((await run("check", "--seals")).code).toBe(1);

    const named = await run("seal", "api", "--by", "agent:test");
    expect(named.out).toContain("✓ Sealed 2 facts");
    expect(named.out).toContain("Every fact that points at code (2) matches its seal.");
    expect((await run("check", "--seals")).code).toBe(0);
    git("add", "-A");
    git("commit", "-q", "-m", "checked the model");

    const c = await run("check", "--base", "main");
    expect(c.out).not.toContain("Code changed under the model");
    const report = await run("report", "--base", "main");
    expect(report.out).toContain(
      "Re-checked against changed code by agent:test: `element:api`, `element:api#services/api/price.ts:price`.",
    );
    expect((await run("seal", "nope")).code).toBe(1);
  });
});
