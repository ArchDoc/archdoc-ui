import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context } from "../src/commands/context.js";
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

describe("archdoc trace list and show", () => {
  it("lists traces", async () => {
    const r = await run(repo, "trace", "list");
    expect(r.out).toContain(
      "report-false-data-changes · The PR report says data changed when it didn't · expands review-ai-change#4 (.archdoc/traces/report-false-data-changes.yaml)",
    );
  });

  it("shows a trace through archdoc show", async () => {
    const r = await run(repo, "show", "report-false-data-changes");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Opens up review-ai-change step 4 (critical)");
    expect(r.out).toContain(
      "missing: toolchain.cli → toolchain.analyzers (applySchemas), never called",
    );
  });
});

describe("archdoc context --error", () => {
  it("ranks journey steps for a stack trace and suggests a trace", async () => {
    const file = join(scratch, "err.txt");
    await writeFile(file, STACK);
    const r = await run(repo, "context", "--error", file);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /^Where this error belongs, best first:\n {2}1\. review-ai-change#4 \(critical\)/,
    );
    expect(r.out).toContain(
      "toolchain.core.loader · packages/core/src/load/git.ts:93 (frame 1, in readModelSourcesAtRef)",
    );
    expect(r.out).toContain("trace: error-main-is-not-commit");
    expect(r.out).toContain("# Suggested by archdoc context --error.");
    expect(r.out).toContain("    code: packages/cli/src/commands/report.ts:42");
  });

  it("reads the error from stdin, and says when nothing in it maps", async () => {
    const out: string[] = [];
    const code = await context(
      [],
      { error: "-" },
      { cwd: repo, out: (t) => out.push(t), err: () => {} },
      async () => "Error at packages/core/src/diff/diff.ts:10",
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("toolchain.core.differ");
    const none = join(scratch, "none.txt");
    await writeFile(none, "nothing here maps");
    expect((await run(repo, "context", "--error", none)).out).toContain(
      "Nothing in the error maps to the model",
    );
  });

  it("says --format json doesn't work with --error", async () => {
    const file = join(scratch, "err2.txt");
    await writeFile(file, STACK);
    const r = await run(repo, "context", "--error", file, "--format", "json");
    expect(r.code).toBe(2);
    expect(r.err).toContain("--format json works with a task or paths");
  });
});
