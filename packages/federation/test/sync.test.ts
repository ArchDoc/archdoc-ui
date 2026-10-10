import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel } from "@archdoc/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listTags, publish, resolveVersion, sync } from "../src/index.js";

// The demo org from examples/acme, as four git repositories side by side.
const examples = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
let org: string;
const at = (repo: string) => join(org, repo);
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: at(repo),
    encoding: "utf8",
  });
const edit = async (repo: string, from: string, to: string) => {
  const file = join(at(repo), ".archdoc", "archdoc.yaml");
  const text = await readFile(file, "utf8");
  if (!text.includes(from)) throw new Error(`${from} isn't in ${repo}`);
  await writeFile(file, text.replace(from, to));
};
const problems = async (repo: string) =>
  (await loadModel(".", { cwd: at(repo) })).diagnostics
    .filter((d) => d.severity !== "info")
    .map((d) => `${d.code}: ${d.message}`);

beforeAll(async () => {
  org = await mkdtemp(join(tmpdir(), "archdoc-acme-"));
  await cp(examples, org, { recursive: true });
  for (const repo of ["payments", "trips", "rides", "landscape"]) {
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
  }
  git("payments", "tag", "v5.0.0");
  git("payments", "tag", "-a", "v5.1.0", "-m", "Release 5.1.0");
  git("payments", "tag", "v6.0.0-rc.1");
  git("payments", "tag", "not-a-release");
  git("trips", "tag", "trips@3.0.0");
  git("rides", "tag", "v1.0.0");
});

afterAll(() => rm(org, { recursive: true, force: true }));

describe("release tags", () => {
  it("lists releases, including annotated and monorepo-style tags", async () => {
    const tags = await listTags(at("payments"), "payments", org);
    expect(tags.map((t) => [t.name, t.version]).sort()).toEqual([
      ["not-a-release", undefined],
      ["v5.0.0", "5.0.0"],
      ["v5.1.0", "5.1.0"],
      ["v6.0.0-rc.1", "6.0.0-rc.1"],
    ]);
    // An annotated tag resolves to its commit, not the tag object.
    expect(tags.find((t) => t.name === "v5.1.0")?.commit).toBe(
      git("payments", "rev-parse", "HEAD").trim(),
    );
    expect((await listTags(at("trips"), "trips", org))[0]?.version).toBe("3.0.0");
  });

  it("picks the newest release a range allows", async () => {
    expect(await resolveVersion(at("payments"), "payments", "^5", org)).toMatchObject({
      ref: "v5.1.0",
      version: "5.1.0",
    });
    expect(await resolveVersion(at("payments"), "payments", "main", org)).toMatchObject({
      ref: "main",
    });
    await expect(resolveVersion(at("payments"), "payments", "^7", org)).rejects.toThrow(
      "No release of payments matches ^7",
    );
  });
});

describe("sync", () => {
  it("pins imports in archdoc.lock and vendors their models", async () => {
    const r = await sync({ cwd: at("rides") });
    expect(r.changes.map((c) => [c.action, c.namespace, c.version, c.ref])).toEqual([
      ["added", "payments", "5.1.0", "v5.1.0"],
      ["added", "trips", "3.0.0", "trips@3.0.0"],
    ]);
    expect(r.lockPath).toBe(".archdoc/archdoc.lock");
    const lock = await readFile(join(at("rides"), ".archdoc", "archdoc.lock"), "utf8");
    expect(lock).toMatch(/^# Written by archdoc sync/);
    expect(lock).toContain("    bundle: vendor/payments@5.1.0.json\n    integrity: sha256-");
    expect((await readdir(join(at("rides"), ".archdoc", "vendor"))).sort()).toEqual([
      "payments@5.1.0.json",
      "trips@3.0.0.json",
    ]);
    // Every cross-repo reference, contract, and journey step resolves.
    expect(await problems("rides")).toEqual([]);
    const trips = JSON.parse(
      await readFile(join(at("rides"), ".archdoc", "vendor", "trips@3.0.0.json"), "utf8"),
    );
    expect(trips).toMatchObject({
      namespace: "trips",
      source: "git:../trips",
      root: "archdoc.yaml",
    });
  });

  it("keeps what's pinned without fetching, so it works offline", async () => {
    await cp(at("payments"), join(org, "payments-away"), { recursive: true });
    await rm(at("payments"), { recursive: true });
    try {
      const r = await sync({ cwd: at("rides") });
      expect(r.changes.map((c) => c.action)).toEqual(["kept", "kept"]);
      expect((await sync({ cwd: at("rides"), frozen: true })).problems).toEqual([]);
    } finally {
      await cp(join(org, "payments-away"), at("payments"), { recursive: true });
    }
  });

  it("checks the lock in CI with frozen, without writing", async () => {
    await edit(
      "rides",
      "payments: { git: ../payments, version: ^5 }",
      "payments: { git: ../payments, version: ^5.1 }",
    );
    const vendor = join(at("rides"), ".archdoc", "vendor", "trips@3.0.0.json");
    await writeFile(vendor, `${await readFile(vendor, "utf8")} `);
    const r = await sync({ cwd: at("rides"), frozen: true });
    expect(r.problems).toEqual([
      "payments changed in imports since archdoc.lock was written.",
      "trips's bundle doesn't match its hash in archdoc.lock.",
    ]);
    expect(await problems("rides")).toEqual([
      expect.stringMatching(/^import\/out-of-date: The import of "payments" changed/),
      expect.stringMatching(/^import\/modified-bundle: .*trips@3.0.0.json doesn't match the hash/),
    ]);
    // A plain sync repairs both.
    // payments' range changed (same version); trips' bundle is restored.
    expect((await sync({ cwd: at("rides") })).changes.map((c) => c.action)).toEqual([
      "updated",
      "updated",
    ]);
    expect(await problems("rides")).toEqual([]);
    git("rides", "add", "-A");
    git("rides", "commit", "-q", "-m", "sync");
  });

  it("flags a reference that a new release breaks, once it's synced", async () => {
    await edit("payments", "api: proto/charges.proto", "api: proto/charges.v2.proto");
    git("payments", "commit", "-q", "-am", "Rename the proto");
    git("payments", "tag", "v5.2.0");

    // Pinned at 5.1.0, nothing changes until the consumer updates.
    expect((await sync({ cwd: at("rides") })).changes[0]).toMatchObject({
      action: "kept",
      version: "5.1.0",
    });
    const r = await sync({ cwd: at("rides"), update: ["payments"] });
    expect(r.changes[0]).toMatchObject({ action: "updated", previous: "5.1.0", version: "5.2.0" });
    expect(await problems("rides")).toEqual([
      'ref/unknown-contract: api-gateway uses payments.charges via "proto/charges.proto", but payments.charges doesn\'t provide it. It provides: proto/charges.v2.proto, refund.issued.',
    ]);
    expect(await readdir(join(at("rides"), ".archdoc", "vendor"))).not.toContain(
      "payments@5.1.0.json",
    );
  });

  it("vendors file: stubs and url: bundles, and drops imports that are gone", async () => {
    await writeFile(
      join(at("rides"), "zendesk.yaml"),
      'archdoc: "2.0"\nnamespace: zendesk\nelements:\n  tickets: { kind: external }\n',
    );
    const bundle = (await publish({ cwd: at("payments"), dryRun: true })).text as string;
    await edit(
      "rides",
      "  trips: { git: ../trips, version: ^3 }",
      "  zendesk: { file: zendesk.yaml }\n  billing: { url: https://example.com/payments.json, version: ^5 }",
    );
    const urls: string[] = [];
    const fetchStub = (async (url: string) => {
      urls.push(url);
      return new Response(bundle.replace('"namespace": "payments"', '"namespace": "billing"'));
    }) as unknown as typeof fetch;
    const r = await sync({ cwd: at("rides"), fetch: fetchStub });
    expect(r.changes.map((c) => [c.action, c.namespace, c.version])).toEqual([
      ["added", "billing", "5.2.0"],
      ["kept", "payments", "5.2.0"],
      ["added", "zendesk", undefined],
      ["removed", "trips", "3.0.0"],
    ]);
    expect(urls).toEqual(["https://example.com/payments.json"]);
    expect((await readdir(join(at("rides"), ".archdoc", "vendor"))).sort()).toEqual([
      "billing@5.2.0.json",
      "payments@5.2.0.json",
      "zendesk.json",
    ]);
    await expect(
      sync({
        cwd: at("rides"),
        update: ["billing"],
        fetch: (async () => new Response(bundle)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(
      'url:https://example.com/payments.json is namespace "payments", not "billing"',
    );
    git("rides", "checkout", "-q", "--", ".");
    git("rides", "clean", "-qfd");
  });
});

describe("publish", () => {
  it("writes a bundle versioned by the release tag on HEAD", async () => {
    const r = await publish({ cwd: at("payments") });
    expect(r.path).toBe("dist/payments@5.2.0.json");
    expect(r.bundle).toMatchObject({
      namespace: "payments",
      version: "5.2.0",
      root: "archdoc.yaml",
    });
    expect(r.bundle?.commit).toBe(git("payments", "rev-parse", "HEAD").trim());
    expect(
      JSON.parse(await readFile(join(at("payments"), "dist/payments@5.2.0.json"), "utf8")),
    ).toEqual(r.bundle);
  });

  it("records what it was built against, and refuses a model with errors", async () => {
    await sync({ cwd: at("trips") });
    const r = await publish({ cwd: at("trips"), version: "3.1.0", dryRun: true });
    expect(r.bundle?.imports).toEqual({ payments: "5.2.0" });

    await edit("trips", "via: refund.issued", "via: refund.sent");
    const bad = await publish({ cwd: at("trips"), version: "3.2.0" });
    expect(bad.bundle).toBeUndefined();
    expect(bad.errors.map((d) => d.code)).toEqual(["ref/unknown-contract"]);
    await expect(publish({ cwd: at("payments"), version: "five" })).rejects.toThrow(
      "isn't a version",
    );
  });
});

describe("untrusted model files", () => {
  it("never pass a URL or ref to git as an option", async () => {
    await expect(listTags("--upload-pack=touch /tmp/pwned", "x", org)).rejects.toThrow(
      'Refusing "--upload-pack=touch /tmp/pwned"',
    );
    await expect(
      resolveVersion(at("payments"), "payments", "--output=/tmp/x", org),
    ).rejects.toThrow("Refusing");
    await expect(listTags("ext::sh -c touch% /tmp/pwned", "x", org)).rejects.toThrow("Refusing");
  });
});
