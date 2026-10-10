import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProgram, startViewServer } from "../src/index.js";

// Phase 4's exit test, on the demo org: a PR that changes a contract in payments
// lists its consumers and affected journeys in the other repos, before merge.
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

/** Syncs a repo's imports, commits them, and tags the release. */
async function release(repo: string, tag: string) {
  const r = await run(repo, "sync");
  if (r.code !== 0) throw new Error(`${repo}: ${r.err}`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", `release ${tag}`);
  git(repo, "tag", tag);
}

const webDirBefore = process.env.ARCHDOC_WEB_DIR;

beforeAll(async () => {
  org = await mkdtemp(join(tmpdir(), "archdoc-landscape-"));
  // A stand-in explorer, so the test doesn't need apps/web built.
  await mkdir(join(org, "web"), { recursive: true });
  await writeFile(join(org, "web/index.html"), "<!doctype html><title>explorer</title>");
  process.env.ARCHDOC_WEB_DIR = join(org, "web");
  await cp(fileURLToPath(new URL("../../../examples/acme/", import.meta.url)), org, {
    recursive: true,
  });
  for (const repo of ["payments", "trips", "rides", "landscape"]) {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
  }
  git("payments", "tag", "v5.0.0");
  await release("trips", "v3.0.0");
  await release("rides", "v1.0.0");
  // The landscape pins every repo's model; payments learns its consumers from it.
  await release("landscape", "v1.0.0");
  await release("payments", "v5.0.1");
}, 60_000);

afterAll(async () => {
  if (webDirBefore === undefined) delete process.env.ARCHDOC_WEB_DIR;
  else process.env.ARCHDOC_WEB_DIR = webDirBefore;
  await rm(org, { recursive: true, force: true });
});

describe("the landscape", () => {
  it("sync vendors the landscape with every repo's model", async () => {
    const lock = await readFile(join(org, "payments/.archdoc/archdoc.lock"), "utf8");
    expect(lock).toContain(
      "landscape:\n  source: git:../landscape\n  requested: ^1\n  version: 1.0.0",
    );
    expect(lock).toContain("namespace: acme");
    expect((await run("payments", "sync")).out).toContain("  landscape acme@1.0.0");
    expect((await run("payments", "sync", "--frozen")).code).toBe(0);
  });

  it("owners resolve against the landscape's teams once it's synced", async () => {
    const r = await run("payments", "validate", "--strict");
    expect(r.err).not.toContain("unresolved-owner");
    expect(r.code).toBe(0);
  });

  it("landscape build checks the whole and writes a static site", async () => {
    const r = await run("landscape", "landscape", "build", "--out", "site");
    expect(r.err).toBe("");
    expect(r.out).toContain(
      "✓ Wrote site/: Acme Rides, 3 repos (payments@5.0.0, rides@1.0.0, trips@3.0.0), 11 elements, 6 actors, 3 journeys, 2 domains.",
    );
    expect((await stat(join(org, "landscape/site/index.html"))).isFile()).toBe(true);
    const payload = JSON.parse(await readFile(join(org, "landscape/site/api/model"), "utf8"));
    expect(payload.landscape.domains).toEqual([
      expect.objectContaining({ id: "rider-experience", members: ["rides", "trips"] }),
      expect.objectContaining({ id: "money", members: ["payments"] }),
    ]);
    expect(payload.root).toBe("acme.landscape.json");
    expect(await readFile(join(org, "landscape/site/.nojekyll"), "utf8")).toBe("");

    // In payments, the landscape isn't composed: it imports no repos.
    const wrong = await run("payments", "landscape", "build");
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain("imports no other repos");
  });

  it("view --landscape serves the composed model", async () => {
    const server = await startViewServer({
      target: ".",
      cwd: join(org, "landscape"),
      webDir: join(org, "landscape/site"),
      landscape: true,
    });
    try {
      const payload = (await (await fetch(`${server.url}/api/model`)).json()) as {
        landscape: { repos: { namespace: string }[] };
        sources: { text: string }[];
      };
      expect(payload.landscape.repos.map((r) => r.namespace)).toEqual([
        "payments",
        "rides",
        "trips",
      ]);
      expect(
        JSON.parse(payload.sources[0]?.text ?? "{}").journeys["goodwill-refund"].steps[1],
      ).toMatchObject({
        from: "rides.api-gateway",
        to: "payments.charges",
      });
    } finally {
      await server.close();
    }
  });

  it("impact and show name consumers and journeys in other repos", async () => {
    const r = await run("payments", "impact", "charges");
    expect(r.out).toContain("Used from other repos (2)");
    expect(r.out).toContain(
      "rides.api-gateway (rides@1.0.0) uses payments.charges via proto/charges.proto: Asks for a refund",
    );
    expect(r.out).toContain("acme.goodwill-refund (critical) · actor support-agent · steps 2, 3");
    expect(r.out).toContain("rides.request-refund (critical) · actor rider · steps 4, 5, 6");
    const show = await run("rides", "show", "payments.charges");
    expect(show.out).toMatch(
      /^payments\.charges \(container\) · in payments@5\.0\.0, another repo/,
    );
  });

  it("a PR that renames a contract lists what it breaks in other repos, before merge", async () => {
    git("payments", "checkout", "-q", "-b", "v2-proto");
    const file = join(org, "payments/.archdoc/archdoc.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "api: proto/charges.proto",
        "api: proto/charges.v2.proto",
      ),
    );
    const r = await run("payments", "report", "--base", "main");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "> [!WARNING]\n> This change breaks 1 consumer in another repo (rides).",
    );
    expect(r.out).toContain(
      "| `rides.api-gateway` (rides@1.0.0) | `charges` via `proto/charges.proto`: Asks for a refund | **breaks**: proto/charges.proto is removed |",
    );
    expect(r.out).toContain("| `trips.trips-api` (trips@3.0.0) | `charges` via `refund.issued`");
    expect(r.out).toContain(
      "| acme.goodwill-refund (another repo): Make a rider whole after a bad trip | **critical** | acme.support-agent | 2, 3 |",
    );
    expect(r.out).toContain(
      "| rides.request-refund (another repo): Get money back for a bad trip | **critical** | rides.rider | 4, 5, 6 |",
    );
    expect(r.out).toContain(
      "changed charges (container): provides -proto/charges.proto +proto/charges.v2.proto",
    );
  });
});
