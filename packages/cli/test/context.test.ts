import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

// A small repository with a model and a history of commits, for context and eval.
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
const commit = (message: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", message);
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
  repo = await mkdtemp(join(tmpdir(), "archdoc-context-"));
  git("init", "-q", "-b", "main");
  await write(
    ".archdoc/archdoc.yaml",
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "actors:",
      "  buyer: { kind: person, uses: { web: Shops } }",
      "elements:",
      "  web: { kind: container, code: apps/web/**, owners: [web-team], uses: { billing: Charges } }",
      "  billing: { kind: container, code: services/billing/**, owners: [billing-team] }",
      "journeys:",
      "  checkout:",
      "    actor: buyer",
      "    goal: Buy something",
      "    importance: critical",
      "    steps:",
      "      - { from: buyer, to: web, code: apps/web/src/cart.ts }",
      "      - { from: web, to: billing, code: services/billing/src/charge.ts }",
    ].join("\n"),
  );
  await write("package.json", JSON.stringify({ name: "shop", private: true }));
  await write("apps/web/package.json", JSON.stringify({ name: "@shop/web" }));
  await write("services/billing/package.json", JSON.stringify({ name: "@shop/billing" }));
  await write("services/billing/src/index.ts", 'export { chargeCard } from "./charge.js";\n');
  await write("services/billing/src/charge.ts", "export function chargeCard() {\n  return 1;\n}\n");
  commit("chore: set up");
  await write(
    "apps/web/src/cart.ts",
    'import { chargeCard } from "@shop/billing";\n\nexport function checkoutCart() {\n  return chargeCard();\n}\n',
  );
  await write("apps/web/test/cart.test.ts", 'import { checkoutCart } from "../src/cart.js";\n');
  commit("feat(web): checkout cart");
  await write("services/billing/src/charge.ts", "export function chargeCard() {\n  return 2;\n}\n");
  await write("docs/billing.md", "# Billing\n");
  commit("fix(billing): charge card twice");
  await write("README.md", "# Shop\n");
  commit("docs: readme");
});
afterAll(() => rm(repo, { recursive: true, force: true }));

describe("archdoc context", () => {
  it("briefs a task in words", async () => {
    const r = await run("context", "charge", "card");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /Start here\n {2}services\/billing\/src\/charge\.ts:1 chargeCard — file name: charge; exports chargeCard \(billing\)\n/,
    );
    expect(r.out).toContain("chargeCard is called from apps/web/src/cart.ts:4");
    expect(r.out).toContain(
      "checkout (critical) · step 2 names services/billing/src/charge.ts — Buy something",
    );
    expect(r.out).toContain("Owners: billing-team");
    expect(r.out).toContain("Next: after editing, run archdoc check --base main");
  });

  it("starts from paths, relative to where it runs, and prints JSON", async () => {
    const r = await run("context", "apps/web/src/cart.ts", "--format", "json");
    const brief = JSON.parse(r.out);
    expect(brief.paths).toEqual(["apps/web/src/cart.ts"]);
    expect(brief.start[0]).toMatchObject({ path: "apps/web/src/cart.ts", why: "you named it" });
    expect(brief.sameJob).toEqual([]);
    expect(brief.tests).toEqual([
      { path: "apps/web/test/cart.test.ts", why: "same name, imports checkoutCart" },
    ]);
    expect(brief.journeys[0]).toMatchObject({ id: "checkout", steps: [1] });
  });

  it("rejects an unknown format", async () => {
    expect((await run("context", "cart", "--format", "xml")).code).toBe(2);
  });
});

describe("archdoc eval", () => {
  it("replays commits and reports recall, skipping commits without source changes", async () => {
    const r = await run("eval");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /^[0-9a-f]{7} 1\/1 covered, 1 in Start here, scope \d+ · charge card twice/,
    );
    expect(r.out).toContain("· checkout cart");
    // The first commit's manifests count as source; the readme commit has none.
    expect(r.out).toContain("· set up");
    expect(r.out).toContain("3 commits replayed (1 with no source changes skipped)");
    expect(r.out).toMatch(/Recall: \d+% \(2\/7\)/);
    expect(r.out).toContain("For comparison, word search alone");
  });

  it("prints JSON, limits the commits, and fails below --min-recall", async () => {
    const json = JSON.parse((await run("eval", "--commits", "2", "--format", "json")).out);
    expect(json.cases).toHaveLength(1);
    expect(json.skipped).toBe(1);
    expect(json.cases[0]).toMatchObject({
      query: "charge card twice",
      changed: ["services/billing/src/charge.ts"],
      named: ["services/billing/src/charge.ts"],
    });
    expect(json.recall).toBe(1);

    expect((await run("eval", "--commits", "2", "--min-recall", "1")).code).toBe(0);
    const strict = await run("eval", "--min-recall", "0.9");
    expect(strict.code).toBe(1);
    expect(strict.err).toContain("Recall 29% is below --min-recall 90%.");
    // Another ref's history.
    expect((await run("eval", "HEAD~2")).out).not.toContain("charge card twice");
    expect((await run("eval", "--min-recall", "2")).code).toBe(2);
    expect((await run("eval", "nope")).code).toBe(2);
  });

  it("is read-only", async () => {
    await run("eval");
    expect(git("status", "--porcelain")).toBe("");
  });
});
