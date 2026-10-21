import { describe, expect, it } from "vitest";
import {
  type CodeIndex,
  context,
  evaluate,
  formatContext,
  formatEval,
  isEvalSource,
  queryTerms,
  rankFiles,
  sameWord,
  search,
  splitIdentifier,
  subjectQuery,
} from "../src/index.js";
import { model } from "./helpers.js";

const m = model({
  "archdoc.yaml": `
    archdoc: "2.0"
    namespace: shop
    actors:
      dev: { kind: person, uses: { cli: Runs it } }
    elements:
      cli:
        kind: container
        code: packages/cli/**
        owners: [cli-team]
        uses: { core: { description: Calls core, sends: Sources } }
        elements:
          commands: { kind: component, description: One module per command, code: packages/cli/src/commands/** }
      core:
        kind: container
        code: packages/core/**
        owners: [core-team]
        elements:
          report: { kind: component, description: The PR report, code: packages/core/src/report/** }
          loader: { kind: component, description: Reads models from git, code: packages/core/src/load/** }
      mcp: { kind: container, code: packages/mcp/**, uses: { core: Calls core } }
    journeys:
      review:
        actor: dev
        goal: Review a change
        importance: critical
        steps:
          - { from: dev, to: cli, action: Runs archdoc report, code: packages/cli/src/commands/report.ts }
          - { from: cli, to: core, action: Builds the report, code: packages/core/src/report/pr-report.ts }
      load-it:
        actor: dev
        goal: Load a model
        steps: [{ from: dev, to: cli }, { from: cli, to: core }]
    data:
      Sources: { kind: message, fields: { text: { type: string } } }
    rules:
      - id: core-alone
        description: Core uses nothing
        deny: { from: core, to: cli }
  `,
});

const index: CodeIndex = {
  files: [
    "README.md",
    "packages/core/src/index.ts",
    "packages/core/src/report/pr-report.ts",
    "packages/core/src/load/git.ts",
    "packages/core/test/pr-report.test.ts",
    "packages/cli/src/program.ts",
    "packages/cli/src/commands/report.ts",
    "packages/cli/src/commands/diff.ts",
    "packages/mcp/src/server.ts",
    "pnpm-lock.yaml",
  ],
  sources: [
    {
      path: "packages/core/src/index.ts",
      exports: [],
      imports: [
        {
          specifier: "./report/pr-report.js",
          target: "packages/core/src/report/pr-report.ts",
          line: 1,
          reexport: true,
          names: [{ name: "prReport" }],
        },
        {
          specifier: "./load/git.js",
          target: "packages/core/src/load/git.ts",
          line: 2,
          reexport: true,
          names: [{ name: "*" }],
        },
      ],
    },
    {
      path: "packages/core/src/report/pr-report.ts",
      exports: [
        { name: "PrReportInput", kind: "interface", line: 3 },
        { name: "prReport", kind: "function", line: 10 },
      ],
      imports: [],
    },
    {
      path: "packages/core/src/load/git.ts",
      exports: [{ name: "loadModelAtRef", kind: "function", line: 5 }],
      imports: [],
    },
    {
      path: "packages/core/test/pr-report.test.ts",
      exports: [],
      imports: [
        {
          specifier: "../src/index.js",
          target: "packages/core/src/index.ts",
          line: 1,
          names: [{ name: "prReport", line: 4 }],
        },
      ],
    },
    {
      path: "packages/cli/src/program.ts",
      exports: [{ name: "createProgram", kind: "function", line: 6 }],
      imports: [
        {
          specifier: "./commands/report.js",
          target: "packages/cli/src/commands/report.ts",
          line: 3,
          names: [{ name: "report", line: 9 }],
        },
      ],
    },
    {
      path: "packages/cli/src/commands/report.ts",
      exports: [{ name: "report", kind: "function", line: 8 }],
      imports: [
        {
          specifier: "@shop/core",
          target: "packages/core",
          line: 1,
          names: [
            { name: "loadModelAtRef", line: 12 },
            { name: "prReport", line: 14 },
          ],
        },
      ],
    },
    {
      path: "packages/cli/src/commands/diff.ts",
      exports: [{ name: "diff", kind: "function", line: 4 }],
      imports: [
        {
          specifier: "@shop/core",
          target: "packages/core",
          line: 1,
          names: [{ name: "loadModelAtRef", line: 20 }],
        },
      ],
    },
    {
      path: "packages/mcp/src/server.ts",
      exports: [{ name: "createServer", kind: "function", line: 2 }],
      imports: [
        {
          specifier: "@shop/core",
          target: "packages/core",
          line: 1,
          names: [{ name: "loadModelAtRef", line: 30 }],
        },
      ],
      literals: [{ text: "archdoc_report", line: 40 }],
    },
  ],
};

describe("words", () => {
  it("splits identifiers and paths into words", () => {
    expect(splitIdentifier("loadModelAtRef")).toEqual(["load", "model", "at", "ref"]);
    expect(splitIdentifier("archdoc_check")).toEqual(["archdoc", "check"]);
    expect(splitIdentifier("pr-report.test.ts")).toEqual(["pr", "report", "test", "ts"]);
    expect(splitIdentifier("HTTPServer")).toEqual(["http", "server"]);
    expect(queryTerms("Add the archdoc_check tool for PR reports")).toEqual([
      "archdoc",
      "check",
      "tool",
      "pr",
      "report",
    ]);
  });

  it("treats a word and its common endings as the same, but not words that share a stem", () => {
    expect(sameWord("check", "checker")).toBe(true);
    expect(sameWord("simulate", "simulation")).toBe(true);
    expect(sameWord("map", "mapping")).toBe(true);
    expect(sameWord("data", "database")).toBe(false);
    expect(sameWord("report", "repo")).toBe(false);
  });
});

describe("rankFiles", () => {
  it("ranks by file names and exported symbols, and skips tests and lockfiles", () => {
    const ranked = rankFiles(m, index, "pr report");
    expect(ranked[0]).toMatchObject({
      path: "packages/core/src/report/pr-report.ts",
      // The function, not the interface, when both match.
      symbol: { name: "prReport", line: 10 },
      element: "core.report",
    });
    expect(ranked.map((r) => r.path)).not.toContain("packages/core/test/pr-report.test.ts");
  });

  it("finds a symbol named exactly, and a tool name a file registers", () => {
    expect(rankFiles(m, index, "loadModelAtRef")[0]).toMatchObject({
      path: "packages/core/src/load/git.ts",
      symbol: { name: "loadModelAtRef" },
    });
    expect(rankFiles(m, index, "archdoc_report")[0]).toMatchObject({
      path: "packages/mcp/src/server.ts",
      literal: { text: "archdoc_report", line: 40 },
    });
  });
});

describe("context", () => {
  it("starts from the files a task names, with the narrowest journeys, tests, and owners", () => {
    const b = context(m, "pr report", { index });
    expect(b.start[0]).toMatchObject({
      path: "packages/core/src/report/pr-report.ts",
      line: 10,
      symbol: "prReport",
      element: "core.report",
      // Its container re-exports it: where a new export goes too.
      wiredIn: [{ path: "packages/core/src/index.ts", line: 1 }],
    });
    expect(b.journeys).toEqual([
      {
        id: "review",
        goal: "Review a change",
        importance: "critical",
        // The command that runs it is a start file too (it does the report's job).
        steps: [1, 2],
        file: "packages/core/src/report/pr-report.ts",
      },
    ]);
    expect(b.journeysThrough.map((j) => j.id)).toContain("load-it");
    expect(b.tests[0]).toEqual({
      path: "packages/core/test/pr-report.test.ts",
      why: "same name, imports prReport",
    });
    expect(b.owners).toContain("core-team");
    expect(b.rules.map((r) => r.id)).toEqual(["core-alone"]);
    expect(b.data).toContainEqual({ id: "Sources", kind: "message", how: "cli → core" });
    // A function the start file declares and the question names: who else calls it.
    expect(b.sameJob).toContainEqual(
      expect.objectContaining({
        symbol: "prReport",
        relation: "declares",
        callers: [{ path: "packages/cli/src/commands/report.ts", line: 14 }],
      }),
    );
  });

  it("starts from paths, and lists other callers of what they use from another element", () => {
    const b = context(m, "", { index, paths: ["packages/cli/src/commands/report.ts"] });
    expect(b.start).toEqual([
      expect.objectContaining({
        path: "packages/cli/src/commands/report.ts",
        line: 8,
        symbol: "report",
        why: "you named it",
        wiredIn: [{ path: "packages/cli/src/program.ts", line: 3 }],
      }),
    ]);
    expect(b.sameJob).toContainEqual({
      symbol: "loadModelAtRef",
      declaredIn: "packages/core/src/load/git.ts",
      element: "core.loader",
      relation: "imports",
      via: "packages/cli/src/commands/report.ts",
      callers: [
        { path: "packages/cli/src/commands/diff.ts", line: 20 },
        { path: "packages/mcp/src/server.ts", line: 30 },
      ],
      more: 0,
    });
    expect(b.journeys.map((j) => [j.id, j.steps])).toEqual([["review", [1]]]);
    // Paths in the question count too.
    expect(context(m, "packages/cli/src/commands/report.ts", { index }).paths).toEqual([
      "packages/cli/src/commands/report.ts",
    ]);
  });

  it("works from the model alone without an index", () => {
    const b = context(m, "review a change");
    expect(b.start.map((s) => s.path)).toEqual([
      "packages/cli/src/commands/report.ts",
      "packages/core/src/report/pr-report.ts",
    ]);
    expect(b.sameJob).toEqual([]);
    expect(b.tests).toEqual([]);
  });

  it("reads as a short brief that ends with what to do next", () => {
    const text = formatContext(context(m, "pr report", { index }));
    const sections = ["Start here", "Does the same job elsewhere", "Data:", "Rules", "Journeys"];
    const at = sections.map((s) => text.indexOf(`\n${s}`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toContain(
      "  packages/core/src/report/pr-report.ts:10 prReport — file name: pr, report (core.report) · wired in at packages/core/src/index.ts:1",
    );
    expect(text).toContain(
      "  review (critical) · step 1, 2 names packages/core/src/report/pr-report.ts — Review a change",
    );
    expect(text).toContain("  +1 through core.report");
    expect(text.split("\n").length).toBeLessThanOrEqual(30);
    expect(text.endsWith("Next: after editing, run archdoc check --base main")).toBe(true);
    expect(formatContext(context(m, "kubernetes", { index }))).toContain("Nothing in the model");
  });
});

describe("search with a code index", () => {
  it("splits identifiers in the question, with or without an index", () => {
    expect(search(m, "cli_commands")[0]?.id).toBe("cli.commands");
    expect(search(m, "cliCommands")[0]?.id).toBe("cli.commands");
  });

  it("returns matching files with the symbol to open", () => {
    expect(search(m, "loadModelAtRef").some((h) => h.type === "file")).toBe(false);
    expect(search(m, "loadModelAtRef", 10, index)[0]).toMatchObject({
      type: "file",
      id: "packages/core/src/load/git.ts",
      symbol: "loadModelAtRef",
      line: 5,
      element: "core.loader",
    });
    // The model's own answers still come first.
    expect(search(m, "pr report", 10, index)[0]?.id).toBe("core.report");
  });
});

describe("evaluate", () => {
  it("strips the Conventional Commit prefix and keeps only source files", () => {
    expect(subjectQuery("feat(cli,core)!: add a pr report")).toBe("add a pr report");
    expect(subjectQuery("plain subject")).toBe("plain subject");
    expect(
      [
        "packages/core/src/a.ts",
        "packages/core/test/a.test.ts",
        "src/a.spec.tsx",
        ".archdoc/model.yaml",
        "examples/x.yaml",
        "docs/plan.md",
        "README.md",
        ".changeset/x.md",
        "pnpm-lock.yaml",
        "package.json",
      ].filter(isEvalSource),
    ).toEqual(["packages/core/src/a.ts", "package.json"]);
  });

  it("counts the changed files a brief covers, names, and points at", () => {
    const r = evaluate(m, index, [
      {
        sha: "a".repeat(40),
        subject: "fix(core): pr report",
        files: [
          "packages/core/src/report/pr-report.ts",
          "packages/core/src/index.ts",
          "packages/mcp/src/server.ts",
          "packages/core/test/pr-report.test.ts",
          "docs/x.md",
        ],
      },
      { sha: "b".repeat(40), subject: "docs: words", files: ["README.md"] },
    ]);
    expect(r.skipped).toBe(1);
    expect(r.cases).toHaveLength(1);
    const [c] = r.cases;
    expect(c).toMatchObject({
      query: "pr report",
      changed: [
        "packages/core/src/index.ts",
        "packages/core/src/report/pr-report.ts",
        "packages/mcp/src/server.ts",
      ],
      covered: ["packages/core/src/index.ts", "packages/core/src/report/pr-report.ts"],
      named: ["packages/core/src/index.ts", "packages/core/src/report/pr-report.ts"],
    });
    expect(r.recall).toBeCloseTo(2 / 3);
    expect(r.startRecall).toBeCloseTo(2 / 3);
    expect(r.medianScope).toBe(c?.scope);
    expect(formatEval(r)).toMatch(/Recall: 67% \(2\/3\)/);
    expect(formatEval(r)).toContain("For comparison, word search alone");
  });
});
