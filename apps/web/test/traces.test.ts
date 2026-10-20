import { buildModel } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import {
  anchorChip,
  firstCause,
  observedExpected,
  readTraces,
  traceChips,
  traceLanes,
} from "../src/model/traces.js";
import { hashOf, readHash } from "../src/model/useCompare.js";

const model = buildModel([
  {
    path: "archdoc.yaml",
    text: `
archdoc: "2.0"
namespace: tools
actors:
  dev: { kind: person, uses: { cli: Runs } }
elements:
  cli: { kind: container, code: cli/**, uses: { core: Delegates, analyzers: Reads } }
  analyzers: { kind: container, code: analyzers/** }
  core:
    kind: container
    code: core/**
    elements:
      loader: { kind: component, code: core/loader/** }
      differ: { kind: component, code: core/differ/** }
  bot: { kind: container }
journeys:
  review:
    actor: dev
    goal: Review a change
    importance: critical
    steps:
      - { from: dev, to: cli, action: Runs report }
      - { from: cli, to: core, action: Diffs base vs. head }
`,
  },
]);

const trace = {
  path: ".archdoc/traces/false-changes.yaml",
  text: `
trace: false-changes
title: The report says data changed when it didn't
symptom: "Data entries changed (5)"
reproduce: archdoc report --base main
expands: review#2
diagnosis: The base is loaded without its schemas.
steps:
  - { from: cli, to: analyzers, action: Loads head, code: analyzers/check.ts:5, evidence: read }
  - from: cli
    to: core.loader
    action: Loads base
    code: cli/report.ts:42
    role: cause
    evidence: reproduced
    observed: { Charge.id.type: undefined }
    expected: { Charge.id.type: uuid }
    missing: { to: analyzers, call: applySchemas }
  - { from: cli, to: core.differ, action: Diffs, role: spreads, evidence: read }
  - { from: core.differ, to: bot, action: Prints the comment, role: symptom, evidence: reproduced }
works-in: { element: analyzers, note: applies schemas to both sides }
`,
};

const { checks, problems } = readTraces(model, [trace], ["analyzers/check.ts", "cli/report.ts"]);
const check = checks[0];
if (!check) throw new Error("no trace");
const view = check.view;

describe("readTraces", () => {
  it("reads and checks the trace files the server sends", () => {
    expect(problems).toEqual([]);
    expect(view.id).toBe("false-changes");
    expect(view.causes).toEqual([2]);
    expect(view.undeclared).toEqual([4]);
  });

  it("reports files that aren't traces instead of failing", () => {
    const r = readTraces(model, [{ path: "bad.yaml", text: "title: no steps" }]);
    expect(r.checks).toEqual([]);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe("the trace view", () => {
  it("names the step it opens up, and what makes it trustworthy or not", () => {
    expect(anchorChip(view)).toBe("on review · step 2 · critical");
    expect(traceChips(view).map((c) => c.label)).toEqual([
      "on review · step 2 · critical",
      "reproduced",
      "1 hop the model doesn't declare",
    ]);
  });

  it("opens on the first cause", () => {
    expect(firstCause(view)).toBe(1);
  });

  it("draws the modeled step, the run's hops, a missing call, and where it works", () => {
    const lanes = traceLanes(model, view);
    expect(lanes.lanes.map((l) => l.label)).toEqual([
      "cli",
      "analyzers",
      "core.loader",
      "core.differ",
      "bot",
      "core",
    ]);
    const rows = lanes.rows;
    expect(rows[0]).toMatchObject({ kind: "band", tone: "modeled", from: 0, to: 5 });
    expect(rows[0]?.kind === "band" && rows[0].text).toContain(
      'As modeled, step 2: cli → core "Diffs base vs. head"',
    );
    const steps = rows.filter((r) => r.kind === "step");
    expect(steps.map((r) => [r.label, r.tone, r.dashed, r.tags?.map((t) => t.label)])).toEqual([
      ["1", undefined, false, []],
      ["2", "cause", false, ["cause"]],
      ["", "missing", true, undefined],
      ["3", "spreads", false, ["spreads"]],
      ["4", "symptom", true, ["matches your log", "not in the model"]],
    ]);
    // The missing call belongs to its step: selecting either selects step 2.
    expect(steps[2]).toMatchObject({ at: 1, action: "missing: applySchemas", from: 0, to: 1 });
    expect(rows.at(-1)).toMatchObject({ kind: "band", tone: "works" });
  });

  it("puts observed and expected side by side", () => {
    expect(observedExpected(view.steps[1] as (typeof view.steps)[number])).toEqual([
      { key: "Charge.id.type", observed: "undefined", expected: "uuid" },
    ]);
  });
});

describe("the address", () => {
  it("opens a trace", () => {
    expect(readHash("#traces=false-changes")).toEqual({ tab: "traces", trace: "false-changes" });
    expect(hashOf({ tab: "traces", trace: "false-changes" })).toBe("#traces=false-changes");
  });
});
