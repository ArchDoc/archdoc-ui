import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("the loop: context, edit, check, seal", () => {
  it("starts where the task is, with who uses it", async () => {
    const r = await call("archdoc_context", { paths: ["apps/web/src/pay.ts"] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Used by: buyer (actor)");
  });

  it("check finds an import the change introduced, and says how to fix it", async () => {
    await write(
      "apps/web/src/pay.ts",
      'import { charge } from "@shop/billing";\nexport const pay = charge;\n',
    );
    const r = await call("archdoc_check", { base: "main" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^⛔ 1 blocking issue/);
    expect(r.text).toContain("web depends on billing, but the model doesn't declare it");
    expect(r.text).toContain("apps/web/src/pay.ts:1 (@shop/billing)");
    expect((await call("archdoc_check", { base: "nope" })).isError).toBe(true);
  });

  it("after the agent edits the model, check lists the suggestion and the model change", async () => {
    await write(
      ".archdoc/archdoc.yaml",
      modelYaml.replace(
        "      api: Calls\n",
        "      api: Calls\n      billing: { description: Charges at checkout, provenance: { source: suggested, by: agent:test } }\n",
      ),
    );
    const r = await call("archdoc_check", { base: "main" });
    expect(r.text).not.toContain("doesn't declare");
    expect(r.text).toContain(
      "1 fact an agent suggested: Accept or reject them before merging.\n    web → billing: Charges at checkout",
    );
    expect(r.text).toContain("Model: 1 use added");
    const comment = await call("archdoc_check", { base: "main", format: "markdown" });
    expect(comment.text).toContain("**ArchDoc:**");
  });

  it("seals what the agent checked, and says what's left", async () => {
    // Sealing starts with a person, or with facts named.
    const none = await call("archdoc_seal");
    expect(none.isError).toBe(true);
    expect(none.text).toContain("no .archdoc/archdoc.sum yet");

    const first = await call("archdoc_seal", { facts: ["web"], by: "agent:test" });
    expect(first.text).toMatch(/^✓ Sealed 1 fact in \.archdoc\/archdoc\.sum: element:web\./);
    expect(first.text).toContain("2 new facts no one has sealed.");

    // The code under a sealed fact changes: check names it, and sealing it again clears it.
    await write("apps/web/src/refund.ts", "export const refund = () => 0;\n");
    const check = await call("archdoc_check", { base: "main" });
    expect(check.text).toContain("Code changed under the model");
    const fact = await call("archdoc_show", { id: "element:web" });
    expect(fact.text).toContain("+ apps/web/src/refund.ts");
    const again = await call("archdoc_seal", { facts: ["element:web"], by: "agent:test" });
    expect(again.text).toContain("✓ Sealed 1 fact");
    expect(again.text).not.toContain("still to check");
    const unknown = await call("archdoc_seal", { facts: ["nope"] });
    expect(unknown.isError).toBe(true);
  });
});
