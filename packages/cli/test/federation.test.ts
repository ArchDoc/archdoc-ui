import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

// Two repos from the demo org: rides imports payments (and trips, which we drop here).
let org: string;
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: join(org, repo),
    encoding: "utf8",
  });

async function run(repo: string, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({
    cwd: join(org, repo),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

beforeAll(async () => {
  org = await mkdtemp(join(tmpdir(), "archdoc-cli-fed-"));
  const examples = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
  for (const repo of ["payments", "rides"]) {
    await cp(join(examples, repo), join(org, repo), { recursive: true });
    git(repo, "init", "-q", "-b", "main");
  }
  const rides = join(org, "rides", ".archdoc", "archdoc.yaml");
  const text = (await readFile(rides, "utf8"))
    .replace("  trips: { git: ../trips, version: ^3 }\n", "")
    .replace(/ {6}trips\.trips-api:\n(?: {8}.*\n)+/, "")
    .replace(/ {6}- \{ from: api-gateway, to: trips\.trips-api.*\n/, "")
    .replace(/ {6}- \{ from: payments\.charges, to: trips\.trips-api.*\n/, "");
  await writeFile(rides, text);
  for (const repo of ["payments", "rides"]) {
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
  }
  git("payments", "tag", "v5.0.0");
});

afterAll(() => rm(org, { recursive: true, force: true }));

describe("archdoc sync and publish", () => {
  it("sync pins imports and says what to commit", async () => {
    const r = await run("rides", "sync");
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "+ payments@5.0.0 (git:../payments)\n\nWrote .archdoc/archdoc.lock. Commit it with .archdoc/vendor/.",
    );
    expect((await run("rides", "validate", "--strict")).code).toBe(0);
    expect((await run("rides", "sync", "--frozen")).out).toBe(
      "✓ .archdoc/archdoc.lock matches imports.",
    );
    git("rides", "add", "-A");
    git("rides", "commit", "-q", "-m", "sync");
  });

  it("sync --update reports a reference the new release breaks, and check fails on it", async () => {
    const file = join(org, "payments", ".archdoc", "archdoc.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("proto/charges.proto", "proto/charges.v2.proto"),
    );
    git("payments", "commit", "-q", "-am", "v2");
    git("payments", "tag", "v5.1.0");
    git("rides", "checkout", "-q", "-b", "bump");

    const r = await run("rides", "sync", "--update");
    expect(r.code).toBe(1);
    expect(r.out).toContain("↑ payments 5.0.0 → 5.1.0");
    expect(r.err).toContain(
      'error ref/unknown-contract api-gateway uses payments.charges via "proto/charges.proto", but payments.charges doesn\'t provide it.',
    );
    const check = await run("rides", "check", "--base", "main", "--no-code");
    expect(check.code).toBe(1);
    expect(check.out).toMatch(/^Introduced by this change \(1\)\n\n✗ error ref\/unknown-contract/);
    expect((await run("rides", "sync", "--frozen")).code).toBe(0);
  });

  it("publish writes a bundle, or prints it with --out -", async () => {
    const r = await run("payments", "publish");
    expect(r.out).toContain("✓ Wrote dist/payments@5.1.0.json (payments@5.1.0, 1 file).");
    const printed = await run("payments", "publish", "5.1.1", "--out", "-");
    expect(JSON.parse(printed.out)).toMatchObject({ namespace: "payments", version: "5.1.1" });
    const broken = await run("rides", "publish", "1.1.0");
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("✗ Not published: the model has 1 error.");
  });
});
