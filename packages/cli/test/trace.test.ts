import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { traceAnchor } from "../src/commands/trace.js";
import { createProgram } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "archdoc-cli-trace-"));
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

async function run(cwd: string, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

const STACK = [
  'Error: "main" is not a commit, branch, or tag in this repository.',
  "    at readModelSourcesAtRef (file:///home/runner/work/archdoc/archdoc/packages/core/dist/load/git.js:93:15)",
  "    at async loadModelAtRef (file:///home/runner/work/archdoc/archdoc/packages/core/dist/load/git.js:131:16)",
  "    at async report (file:///home/runner/work/archdoc/archdoc/packages/cli/dist/commands/report.js:42:7)",
].join("\n");

describe("archdoc trace check", () => {
  it("checks every trace in .archdoc/traces/", async () => {
    const r = await run(repo, "trace", "check");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "report-false-data-changes · The PR report says data changed when it didn't",
    );
    expect(r.out).toContain("expands review-ai-change#4 (toolchain.cli → toolchain.core)");
    expect(r.out).toMatch(/\d+ traces?: 0 errors/);
  });

  it("prints JSON with the resolved view", async () => {
    const r = await run(repo, "trace", "check", "--format", "json");
    const json = JSON.parse(r.out);
    const t = json.traces.find((x: { id: string }) => x.id === "report-false-data-changes");
    expect(t.view.anchor).toMatchObject({ journey: "review-ai-change", step: 4, status: "found" });
    expect(t.view.steps[1]).toMatchObject({ role: "cause", evidence: "reproduced" });
  });

  it("fails on errors in the files named", async () => {
    const file = join(scratch, "bad.yaml");
    await writeFile(
      file,
      "trace: bad\ntitle: Bad\nsymptom: x\nexpands: no-such-journey#1\nsteps: [{ from: cli, to: nowhere, role: cause, evidence: read }]\n",
    );
    const r = await run(repo, "trace", "check", file);
    expect(r.code).toBe(1);
    expect(r.out).toContain("error trace/unknown-journey");
    expect(r.out).toContain("error trace/unknown-element Step 1:");
    const broken = join(scratch, "broken.yaml");
    await writeFile(broken, "trace: broken\nsteps: nope\n");
    expect((await run(repo, "trace", "check", broken)).code).toBe(1);
  });
});

describe("archdoc trace list and show", () => {
  it("lists traces", async () => {
    const r = await run(repo, "trace", "list");
    expect(r.out).toContain(
      "report-false-data-changes · The PR report says data changed when it didn't · expands review-ai-change#4 (.archdoc/traces/report-false-data-changes.yaml)",
    );
  });

  it("shows a trace, also through archdoc show", async () => {
    const r = await run(repo, "trace", "show", "report-false-data-changes");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Opens up review-ai-change step 4 (critical)");
    expect(r.out).toContain(
      "missing: toolchain.cli → toolchain.analyzers (applySchemas), never called",
    );
    const show = await run(repo, "show", "report-false-data-changes");
    expect(show.out).toBe(r.out);
    expect((await run(repo, "trace", "show", "nope")).code).toBe(1);
  });
});

describe("archdoc trace anchor", () => {
  it("ranks journey steps for a stack trace and suggests a trace", async () => {
    const file = join(scratch, "err.txt");
    await writeFile(file, STACK);
    const r = await run(repo, "trace", "anchor", "--file", file);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /^Where this error belongs, best first:\n {2}1\. review-ai-change#4 \(critical\)/,
    );
    expect(r.out).toContain(
      "toolchain.core.loader · packages/core/src/load/git.ts:93 (frame 1, in readModelSourcesAtRef)",
    );
    expect(r.out).toContain("trace: error-main-is-not-commit");
    expect(r.out).toContain("    code: packages/cli/src/commands/report.ts:42");
    const json = JSON.parse((await run(repo, "trace", "anchor", "--file", file, "--json")).out);
    expect(json.anchors[0]).toMatchObject({ journey: "review-ai-change", step: 4 });
    expect(json.skeleton).toContain("expands: review-ai-change#4");
  });

  it("reads the error from the arguments or stdin", async () => {
    const r = await run(
      repo,
      "trace",
      "anchor",
      "failed",
      "at",
      "packages/mcp/src/server.ts:40",
      "--no-skeleton",
    );
    expect(r.out).toContain("toolchain.mcp · packages/mcp/src/server.ts:40");
    expect(r.out).not.toContain("trace:");
    const out: string[] = [];
    const code = await traceAnchor(
      ["-"],
      {},
      { cwd: repo, out: (t) => out.push(t), err: () => {} },
      async () => "Error at packages/core/src/diff/diff.ts:10",
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("toolchain.core.differ");
    expect((await run(repo, "trace", "anchor", "nothing here maps")).code).toBe(1);
  });
});
