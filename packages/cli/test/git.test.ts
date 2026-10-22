import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram, startViewServer } from "../src/index.js";

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
      "  buyer: { kind: person, uses: { web: { description: Shops, sends: Order } } }",
      "elements:",
      "  web: { kind: container, code: apps/web/**, uses: { api: { description: Calls, sends: Order } } }",
      "  api: { kind: container, code: services/api/**, uses: { billing: Charges } }",
      "  billing: { kind: container, code: services/billing/** }",
      "journeys:",
      "  checkout:",
      "    actor: buyer",
      "    goal: Buy something",
      "    importance: critical",
      "    steps: [{ from: buyer, to: web }, { from: web, to: api }]",
      "data:",
      "  Order: { kind: message, fields: { total_cents: { type: int } } }",
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
    expect(r.out).toBe("✓ No problems: the model is valid and matches the code.");
    expect(r.code).toBe(0);
  });

  it("check flags an import the change introduced, and fails only on that", async () => {
    await write(
      "apps/web/src/pay.ts",
      'import { charge } from "@shop/billing";\nexport const pay = charge;\n',
    );
    const r = await run("check", "--base", "main");
    expect(r.code).toBe(1);
    // The import is undeclared and the rule forbids it: one finding, the rule's.
    expect(r.out).toContain("Blocks the merge (1)");
    expect(r.out).not.toContain("web depends on billing, but the model doesn't declare it");
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
    expect(r.out.startsWith("<!-- archdoc-report -->\n⛔ **ArchDoc:** 1 blocking issue")).toBe(
      true,
    );
    expect(r.out).toContain("Remove the dependency from the code.");
    expect(r.out).toContain("Touches `web` (1 file), `search`");
    expect(r.out).toContain("| checkout: Buy something | **critical** | buyer | 1, 2 |");
    expect(r.out).not.toContain("More drift and rules");
    expect(r.out).toContain(
      "- **1 fact an agent suggested.** Accept or reject them before merging.\n  - element search",
    );
    const sha = git("rev-parse", "main").trim();
    expect((await run("report", "--base", sha)).out).toContain(`for ${sha.slice(0, 7)}...HEAD.`);
    expect(r.out).toContain("```mermaid\nflowchart TB");
    expect((await run("report", "--base", "main", "--no-diagrams")).out).not.toContain("mermaid");
  });

  it("view --base serves the model at the ref beside the working tree", async () => {
    const server = await startViewServer({ target: ".", cwd: repo, webDir: repo, base: "main" });
    try {
      type Sources = { path: string }[];
      const payload = (await (await fetch(`${server.url}/api/model`)).json()) as {
        sources: Sources;
        base: { sources: Sources };
      };
      expect(payload.sources.map((s) => s.path)).toContain(".archdoc/more.yaml");
      expect(payload.base).toMatchObject({
        ref: "main",
        commit: git("rev-parse", "main").trim(),
        root: "main:.archdoc/archdoc.yaml",
      });
      expect(payload.base.sources.map((s) => s.path)).toEqual(["main:.archdoc/archdoc.yaml"]);
    } finally {
      await server.close();
    }
    await expect(
      startViewServer({ target: ".", cwd: repo, webDir: repo, base: "nope" }),
    ).rejects.toThrow('"nope" is not a commit');
  });

  it("view lists the branches and sends the model at any two of them", async () => {
    const server = await startViewServer({ target: ".", cwd: repo, webDir: repo, base: "main" });
    try {
      const refs = (await (await fetch(`${server.url}/api/refs`)).json()) as {
        current: string;
        branches: string[];
        base: string;
      };
      expect(refs).toMatchObject({ current: "feature", base: "main" });
      expect(refs.branches).toEqual(expect.arrayContaining(["main", "feature"]));

      type Pair = {
        base: { ref: string; commit: string };
        head?: {
          ref: string;
          files: string[];
          repo: { commit: string; root?: string };
          federation: object;
          schemas: unknown[];
        };
      };
      const pair = (await (
        await fetch(`${server.url}/api/compare?base=main&head=feature`)
      ).json()) as Pair;
      expect(pair.base).toMatchObject({ ref: "main", commit: git("rev-parse", "main").trim() });
      // A branch comes with what the working tree does, read from its commit.
      expect(pair.head).toMatchObject({
        ref: "feature",
        repo: { commit: git("rev-parse", "feature").trim() },
        federation: expect.any(Object),
        schemas: [],
      });
      expect(pair.head?.files).toContain("services/billing/src/index.ts");
      // Files only in the working tree aren't at the commit, and there's no local copy to open.
      expect(pair.head?.files).not.toContain("apps/web/src/pay.ts");
      expect(pair.head?.repo.root).toBeUndefined();
      // Without a head, the explorer compares with the working tree it already has.
      const tree = (await (await fetch(`${server.url}/api/compare?base=main`)).json()) as Pair;
      expect(tree.head).toBeUndefined();

      const bad = await fetch(`${server.url}/api/compare?base=--output=x`);
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toContain("not a branch");
    } finally {
      await server.close();
    }
  });

  it("diff a...b compares from the merge base", async () => {
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    const r = await run("diff", "main...feature");
    expect(r.out).toContain("+ search (container)");
  });
});
