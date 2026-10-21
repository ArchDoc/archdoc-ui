import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

// Both sides of a comparison are read the same way: schema sources and
// findings at the base included, so a PR is told only what it changed.
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

const model = (description: string) =>
  [
    'archdoc: "2.0"',
    "namespace: pay",
    "elements:",
    `  charges: { kind: container, description: ${description}, code: services/charges/**, uses: { ledger: { description: Records, sends: Charge } } }`,
    "  ledger: { kind: datastore, code: db/**, stores: { charges: { entity: Charge } } }",
    // Nothing matches this path, before or after the change.
    "  reports: { kind: container, code: apps/reports/**, uses: { ledger: Reads } }",
    "data:",
    "  Charge:",
    "    kind: entity",
    "    source: { prisma: prisma/schema.prisma#Charge }",
    "    fields:",
    "      card_last4: { classification: pci }",
  ].join("\n");

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "archdoc-revision-"));
  git("init", "-q", "-b", "main");
  await write(".archdoc/archdoc.yaml", model("Charges cards"));
  await write(
    "prisma/schema.prisma",
    [
      "model Charge {",
      "  id          String @id @default(uuid())",
      "  amount_cents Int",
      "  card_last4  String",
      "}",
    ].join("\n"),
  );
  await write("services/charges/main.go", "package main\n");
  await write("db/schema.sql", "-- the ledger\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  await write(".archdoc/archdoc.yaml", model("Charges riders' cards"));
  git("commit", "-q", "-am", "reword");
});
afterAll(() => rm(repo, { recursive: true, force: true }));

describe("comparing revisions", () => {
  it("doesn't report fields from a schema source as changed", async () => {
    const r = await run("report", "--base", "main", "--format", "json");
    const report = JSON.parse(r.out) as { introduced: { errors: number; warnings: number } };
    expect(r.code).toBe(0);
    expect(report.introduced).toEqual({ errors: 0, warnings: 0 });
    const md = await run("report", "--base", "main");
    expect(md.out).not.toMatch(/Data entries changed/);
    expect(md.out).not.toMatch(/type undefined/);
  });

  it("marks a finding the base already had as already there, even when the model file changed", async () => {
    const r = await run("check", "--base", "main", "--all");
    expect(r.out).toMatch(/Already on the base \(\d+\)/);
    expect(r.out).not.toMatch(/Blocks the merge|To check/);
    expect(r.out).toMatch(/reports maps "apps\/reports\/\*\*"/);
    expect(r.code).toBe(0);
  });

  it("diff reads schema sources on both sides", async () => {
    const r = await run("diff", "main");
    expect(r.out).not.toMatch(/type undefined/);
    expect(r.out).toMatch(/charges/);
  });

  it("still marks what the change did introduce", async () => {
    await write(".archdoc/archdoc.yaml", `${model("Charges cards")}\n  Orphan: { kind: entity }`);
    await write(
      ".archdoc/extra.yaml",
      "elements:\n  audit: { kind: container, code: services/audit/** }\n",
    );
    const r = await run("check", "--base", "main");
    expect(r.out).toMatch(/To check \(\d+\)/);
    expect(r.out).toMatch(/audit maps "services\/audit\/\*\*"/);
    git("checkout", "-q", "--", ".");
    git("clean", "-qfd");
  });
});

describe("archdoc site", () => {
  it("writes the explorer with the change since a base, for a static host", async () => {
    const { mkdtemp: tmp, readFile } = await import("node:fs/promises");
    const webDir = await tmp(join(tmpdir(), "archdoc-web-"));
    await writeFile(join(webDir, "index.html"), "<!doctype html>");
    const out = join(await tmp(join(tmpdir(), "archdoc-site-")), "site");
    process.env.ARCHDOC_WEB_DIR = webDir;
    try {
      const r = await run("site", "--base", "main", "--out", out);
      expect(r.code).toBe(0);
      const body = JSON.parse(await readFile(join(out, "api", "model"), "utf8")) as {
        watch: boolean;
        base: { ref: string; root: string; schemas: unknown[] };
        change: { findings: { introduced?: boolean }[] };
      };
      expect(body.watch).toBe(false);
      expect(body.base.ref).toBe("main");
      expect(body.base.root).toBe("main:.archdoc/archdoc.yaml");
      expect(body.base.schemas.length).toBeGreaterThan(0);
      expect(body.change.findings.some((f) => f.introduced === false)).toBe(true);
    } finally {
      delete process.env.ARCHDOC_WEB_DIR;
      await rm(webDir, { recursive: true, force: true });
    }
  });
});
