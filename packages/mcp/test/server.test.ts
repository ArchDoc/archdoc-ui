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
    expect(INSTRUCTIONS).toMatch(
      /before you grep[\s\S]*archdoc_context[\s\S]*archdoc_impact[\s\S]*archdoc_search/,
    );
  });

  it("exposes its tools, all read-only except propose", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "archdoc_anchor",
      "archdoc_check",
      "archdoc_code",
      "archdoc_context",
      "archdoc_data",
      "archdoc_diff",
      "archdoc_get_actor",
      "archdoc_get_element",
      "archdoc_impact",
      "archdoc_journey",
      "archdoc_lineage",
      "archdoc_locate",
      "archdoc_overview",
      "archdoc_propose",
      "archdoc_report",
      "archdoc_search",
      "archdoc_simulate",
      "archdoc_trace_check",
      "archdoc_validate",
    ]);
    const writers = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writers).toEqual(["archdoc_propose"]);
    expect(tools.find((t) => t.name === "archdoc_propose")?.annotations?.destructiveHint).toBe(
      false,
    );
  });

  it("finds where an area lives", async () => {
    const r = await call("archdoc_search", { query: "cli command" });
    expect(r.text).toMatch(
      /^Matches for "cli command", best first:\n {2}toolchain\.cli\.commands \(component\)/,
    );
    expect(r.text).toContain("code: packages/cli/src/commands/**");
  });

  it("finds files and tool names too", async () => {
    const r = await call("archdoc_search", { query: "archdoc_check" });
    expect(r.text).toMatch(
      /packages\/mcp\/src\/server\.ts:\d+ "archdoc_check" \(file in toolchain\.mcp\)/,
    );
  });

  it("briefs a task from words or paths", async () => {
    const byPath = await call("archdoc_context", {
      paths: ["packages/cli/src/commands/report.ts"],
    });
    expect(byPath.isError).toBe(false);
    expect(byPath.text).toMatch(
      /^Context for "packages\/cli\/src\/commands\/report\.ts"\n\nStart here\n {2}packages\/cli\/src\/commands\/report\.ts:\d+ report — you named it/,
    );
    // Other callers of what it uses from core: the bug class where surfaces load revisions differently.
    expect(byPath.text).toMatch(
      /\(toolchain\.core\.[a-z]+\) is also called from .*packages\/mcp\/src\/server\.ts:\d+/,
    );
    expect(byPath.text).toContain("Next: after editing, run archdoc check --base main");

    const byWords = await call("archdoc_context", { query: "pr report" });
    expect(byWords.text).toMatch(
      /Start here\n {2}packages\/core\/src\/report\/pr-report\.ts:\d+ prReport/,
    );
    expect(byWords.text).toMatch(
      /review-ai-change \(critical\) · step \d+ names packages\/core\/src\/report\/pr-report\.ts/,
    );
    expect(byWords.text).toContain("packages/core/test/pr-report.test.ts — same name");

    expect((await call("archdoc_context", {})).isError).toBe(true);
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
    // A component's code: what each path is for, and its snippets' text.
    const code = (await call("archdoc_code", { id: "toolchain.core.codemap" })).text;
    expect(code).toContain(
      "packages/core/src/codemap/codemap.ts (locate) · Which element owns a path",
    );
    expect(code).toMatch(/\d+ \| export function locate\(model: Model, path: string\): Located \{/);
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

  it("anchors an error and starts a trace", async () => {
    const r = await call("archdoc_anchor", {
      text: "TypeError: x is undefined\n    at diffModels (/ci/repo/packages/core/dist/diff/diff.js:12:3)\n    at report (/ci/repo/packages/cli/dist/commands/report.js:50:20)",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^Where this error belongs, best first:\n {2}1\. review-ai-change#4/);
    expect(r.text).toContain("toolchain.core.differ · packages/core/src/diff/diff.ts:12");
    expect(r.text).toContain("  - from: toolchain.cli.commands\n    to: toolchain.core.differ");
    expect(INSTRUCTIONS).toContain("archdoc_anchor");
  });

  it("checks a trace's YAML, a trace file, or every trace", async () => {
    const draft = await call("archdoc_trace_check", {
      trace:
        "trace: draft\ntitle: Draft\nsymptom: x\nexpands: check-model#2\nsteps:\n  - { from: mcp, to: web, role: cause, evidence: read }\n",
    });
    expect(draft.text).toContain(
      "warning trace/undeclared-hop Step 1: toolchain.mcp → toolchain.web",
    );
    expect(draft.text).toContain("Opens up check-model step 2");
    const file = await call("archdoc_trace_check", {
      path: ".archdoc/traces/report-false-data-changes.yaml",
    });
    expect(file.text).toContain("2. ✗ cause  toolchain.cli → toolchain.core.loader");
    const all = await call("archdoc_trace_check");
    expect(all.text).toMatch(/\d+ traces?: 0 errors/);
    expect(all.text).not.toContain("What happened:");
  });

  it("gives the verdict the PR comment will give", async () => {
    const r = await call("archdoc_report", { base: "HEAD" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^(⛔|⚠️|ℹ️|✅) \*\*ArchDoc:\*\* /);
    expect(r.text).not.toContain("<!--");
  });

  it("returns errors as tool errors", async () => {
    const r = await call("archdoc_get_element", { id: "nope" });
    expect(r).toMatchObject({ isError: true, text: 'No element "nope".' });
  });
});
