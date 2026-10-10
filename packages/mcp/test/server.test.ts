import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchdocServer, INSTRUCTIONS } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let client: Client;

beforeAll(async () => {
  const server = createArchdocServer({ cwd: repo });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(() => client.close());

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: r.isError === true };
}

describe("archdoc MCP server", () => {
  it("tells agents to check before editing", () => {
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/before you grep[\s\S]*archdoc_search[\s\S]*archdoc_impact/);
  });

  it("exposes read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "archdoc_get_actor",
      "archdoc_get_element",
      "archdoc_impact",
      "archdoc_journey",
      "archdoc_locate",
      "archdoc_overview",
      "archdoc_search",
      "archdoc_validate",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("finds where an area lives", async () => {
    const r = await call("archdoc_search", { query: "cli command" });
    expect(r.text).toMatch(
      /^Matches for "cli command", best first:\n {2}toolchain\.cli\.commands \(component\)/,
    );
    expect(r.text).toContain("code: packages/cli/src/commands/**");
  });

  it("locates relative and absolute paths", async () => {
    const r = await call("archdoc_locate", {
      paths: ["packages/mcp/src/server.ts", `${repo}apps/web/src/graph/graph.ts`],
    });
    expect(r.text).toContain("packages/mcp/src/server.ts\n  → toolchain.mcp");
    expect(r.text).toContain("apps/web/src/graph/graph.ts\n  → toolchain.web.graph");
  });

  it("reports impact with journeys and actors", async () => {
    const r = await call("archdoc_impact", { target: "packages/cli/src/commands/view.ts" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("explore-architecture (high)");
    expect(r.text).toContain("developer (person)");
  });

  it("answers element, actor, journey, overview, and validate", async () => {
    expect((await call("archdoc_get_element", { id: "core" })).text).toContain(
      "toolchain.core (container)",
    );
    expect((await call("archdoc_get_actor", { id: "coding-agent" })).text).toContain(
      "coding-agent (agent)",
    );
    expect((await call("archdoc_journey", { id: "check-model" })).text).toContain(
      "1. developer → toolchain.cli",
    );
    expect((await call("archdoc_overview")).text).toMatch(/^ArchDoc \(namespace archdoc\)/);
    expect((await call("archdoc_validate")).text).toBe("The model is valid.");
  });

  it("returns errors as tool errors", async () => {
    const r = await call("archdoc_get_element", { id: "nope" });
    expect(r).toMatchObject({ isError: true, text: 'No element "nope".' });
  });
});
