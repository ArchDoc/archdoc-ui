import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchdocServer } from "../src/index.js";

// A small repository with history, for the tools that read git or write the model.
let repo: string;
let client: Client;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: repo,
    encoding: "utf8",
  });
const write = async (path: string, text: string) => {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), text);
};
const modelYaml = `archdoc: "2.0"
namespace: shop
# Who shops
actors:
  buyer: { kind: person, uses: { web: Shops } }
elements:
  web:
    kind: container
    code: apps/web/**
    uses:
      api: Calls
  api: { kind: container, code: services/api/** }
  billing: { kind: container, code: services/billing/** }
`;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: r.isError === true };
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "archdoc-mcp-"));
  git("init", "-q", "-b", "main");
  await write(".archdoc/archdoc.yaml", modelYaml);
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

  const server = createArchdocServer({ cwd: repo });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
  await rm(repo, { recursive: true, force: true });
});

describe("the check, propose, diff loop", () => {
  it("check finds an import the change introduced and points at propose", async () => {
    await write(
      "apps/web/src/pay.ts",
      'import { charge } from "@shop/billing";\nexport const pay = charge;\n',
    );
    const r = await call("archdoc_check", { base: "main" });
    expect(r.text).toContain("web depends on billing, but the model doesn't declare it");
    expect(r.text).toContain("call archdoc_propose");
  });

  it("propose refuses changes and writes nothing on a dry run", async () => {
    const refused = await call("archdoc_propose", {
      edits: [{ op: "add-relationship", from: "web", to: "api", description: "Again" }],
      rationale: "Test",
    });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain("Nothing was written.");
    expect(refused.text).toContain("Existing relationships aren't changed.");

    const dry = await call("archdoc_propose", {
      edits: [{ op: "add-relationship", from: "web", to: "billing", description: "Charges" }],
      rationale: "Test",
      dryRun: true,
    });
    expect(dry.text).toContain("Dry run: nothing was written.");
    expect(await readFile(join(repo, ".archdoc/archdoc.yaml"), "utf8")).toBe(modelYaml);
  });

  it("propose adds suggestions and a note, keeping the file's formatting", async () => {
    const r = await call("archdoc_propose", {
      edits: [
        { op: "add-relationship", from: "web", to: "billing", description: "Charges at checkout" },
        {
          op: "add-element",
          id: "ledger",
          parent: "billing",
          kind: "component",
          description: "Records charges",
          code: ["services/billing/src/ledger/**"],
        },
      ],
      rationale: "The web app now charges directly.",
      by: "agent:test",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Added relationship web → billing.");
    expect(r.text).toContain("Changed: .archdoc/archdoc.yaml");

    const after = await readFile(join(repo, ".archdoc/archdoc.yaml"), "utf8");
    expect(after).toContain(
      "# Who shops\nactors:\n  buyer: { kind: person, uses: { web: Shops } }\n",
    );
    expect(after).toContain("      api: Calls\n      billing:\n");
    expect(after).toContain("by: agent:test");

    const notes = await readdir(join(repo, ".archdoc/proposals"));
    expect(notes).toHaveLength(1);
    const note = await readFile(join(repo, ".archdoc/proposals", notes[0] ?? ""), "utf8");
    expect(note).toContain("The web app now charges directly.");

    expect((await call("archdoc_validate")).text).toBe("The model is valid.");
    const check = await call("archdoc_check", { base: "main" });
    expect(check.text).not.toContain("doesn't declare");
  });

  it("diff describes the model changes", async () => {
    const r = await call("archdoc_diff", { base: "main" });
    expect(r.text).toContain("main → working tree");
    expect(r.text).toContain("billing.ledger");
    expect(r.text).toContain("web → billing");
    expect((await call("archdoc_diff", { base: "nope" })).isError).toBe(true);
  });
});
