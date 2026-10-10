import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

// A small repository with a model, real code, and history, for the commands that read git.
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
  repo = await mkdtemp(join(tmpdir(), "archdoc-git-"));
  git("init", "-q", "-b", "main");
  await write(
    ".archdoc/archdoc.yaml",
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "actors:",
      "  buyer: { kind: person, uses: { web: Shops } }",
      "elements:",
      "  web: { kind: container, code: apps/web/**, uses: { api: Calls } }",
      "  api: { kind: container, code: services/api/**, uses: { billing: Charges } }",
      "  billing: { kind: container, code: services/billing/** }",
      "journeys:",
      "  checkout:",
      "    actor: buyer",
      "    goal: Buy something",
      "    importance: critical",
      "    steps: [{ from: buyer, to: web }, { from: web, to: api }]",
      "rules:",
      "  - id: web-never-bills",
      "    deny: { from: web, to: billing }",
    ].join("\n"),
  );
  await write("package.json", JSON.stringify({ name: "shop", private: true }));
  await write("apps/web/package.json", JSON.stringify({ name: "@shop/web" }));
  await write("services/api/package.json", JSON.stringify({ name: "@shop/api" }));
  await write("services/billing/package.json", JSON.stringify({ name: "@shop/billing" }));
  await write(
    "apps/web/src/app.ts",
    'import { trips } from "@shop/api";\nexport const app = trips;\n',
  );
  await write("services/api/src/index.ts", "export const trips = [];\n");
  await write("services/billing/src/index.ts", "export const charge = () => 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
});
afterAll(() => rm(repo, { recursive: true, force: true }));

describe("against a git history", () => {
  it("check passes on a clean model", async () => {
    const r = await run("check");
    expect(r.out).toBe("✓ No drift or rule problems found.");
    expect(r.code).toBe(0);
  });

  it("check flags an import the change introduced, and fails only on that", async () => {
    await write(
      "apps/web/src/pay.ts",
      'import { charge } from "@shop/billing";\nexport const pay = charge;\n',
    );
    const r = await run("check", "--base", "main");
    expect(r.code).toBe(1);
    expect(r.out).toContain("Introduced by this change (2)");
    expect(r.out).toContain("web depends on billing, but the model doesn't declare it");
    expect(r.out).toContain('breaks rule "web-never-bills"');
    expect(r.out).toContain("apps/web/src/pay.ts:1 (@shop/billing)");
    expect((await run("check", "--base", "main", "--fail-on", "never")).code).toBe(0);
  });

  it("diff shows model changes against a ref", async () => {
    await write(
      ".archdoc/more.yaml",
      "elements:\n  search: { kind: container, code: services/search/**, provenance: { source: suggested, by: agent:test } }\n",
    );
    const r = await run("diff", "main", "--format", "json");
    expect(JSON.parse(r.out).elements).toMatchObject([{ kind: "added", id: "search" }]);
    expect((await run("diff", "main", "--exit-code")).code).toBe(1);
  });

  it("report names the touched elements, the critical journey, and the drift", async () => {
    const r = await run("report", "--base", "main");
    expect(r.code).toBe(0);
    expect(r.out.startsWith("<!-- archdoc-report -->\n## Architectural impact")).toBe(true);
    expect(r.out).toContain("**Touches:** `web` (1 file), `search`");
    expect(r.out).toContain("| checkout: Buy something | **critical** | buyer | 1, 2 |");
    expect(r.out).toContain("This change introduces 2 errors");
    expect(r.out).toContain("### Suggested facts to review (1)");
    const sha = git("rev-parse", "main").trim();
    expect((await run("report", "--base", sha)).out).toContain(`for ${sha.slice(0, 7)}...HEAD.`);
  });

  it("diff a...b compares from the merge base", async () => {
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    const r = await run("diff", "main...feature");
    expect(r.out).toContain("+ search (container)");
  });
});
