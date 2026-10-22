import { describe, expect, it } from "vitest";
import {
  diffModels,
  formatAnnotations,
  type MarkedFinding,
  prReport,
  REPORT_MARKER,
} from "../src/index.js";
import { model, root } from "./helpers.js";

const before = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { app: Books } }
    elements:
      app: { kind: container, code: apps/mobile/**, owners: [mobile-team], uses: { api: Calls } }
      api: { kind: container, code: services/api/** }
      docs: { kind: container, code: docs/** }
    journeys:
      book:
        actor: rider
        goal: Book a ride
        importance: critical
        steps: [{ from: rider, to: app }, { from: app, to: api }]
      browse:
        actor: rider
        goal: Browse
        steps: [{ from: rider, to: app }]
  `),
});
const after = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { app: Books } }
      mobile-team: { kind: team }
      ops: { kind: team, provenance: { source: suggested, by: agent:test } }
    elements:
      app: { kind: container, code: apps/mobile/**, owners: [mobile-team], uses: { api: Calls, cache: { description: Caches trips, provenance: { source: suggested, by: agent:test } } } }
      api: { kind: container, code: services/api/** }
      cache: { kind: datastore, code: services/cache/** }
      docs: { kind: container, code: docs/** }
    journeys:
      book:
        actor: rider
        goal: Book a ride
        importance: critical
        steps: [{ from: rider, to: app }, { from: app, to: api }]
      browse:
        actor: rider
        goal: Browse
        steps: [{ from: rider, to: app }]
  `),
});

const finding = (introduced: boolean, code = "drift/undeclared-dependency"): MarkedFinding => ({
  severity: "error",
  code,
  message: introduced ? "app depends on api.secret" : "old drift",
  evidence: ["apps/mobile/x.ts:3"],
  files: ["apps/mobile/x.ts"],
  introduced,
});

describe("prReport", () => {
  const r = prReport({
    model: after,
    changedFiles: ["apps/mobile/screens/home.tsx", "apps/mobile/x.ts", "README.md"],
    diff: diffModels(before, after),
    findings: [finding(true), finding(false)],
    label: "main...feature",
  });

  it("finds what the change touches from files and the model diff", () => {
    expect(r.touched).toEqual([
      { id: "app", files: 2, owners: ["mobile-team"] },
      { id: "cache", files: 0, owners: [] },
    ]);
    expect(r.owners).toEqual(["mobile-team"]);
  });

  it("ranks affected journeys, critical first, and names actors", () => {
    expect(r.journeys.map((j) => [j.id, j.importance, j.steps])).toEqual([
      ["book", "critical", [1, 2]],
      ["browse", "normal", [1]],
    ]);
    expect(r.actors).toEqual([{ id: "rider", kind: "person" }]);
  });

  it("lists suggested facts for review", () => {
    expect(r.suggested).toEqual(["actor `ops`", "`app` → `cache`: Caches trips"]);
  });

  it("separates drift the change introduced from drift already there", () => {
    expect(r.introduced).toEqual({ errors: 1, warnings: 0 });
    expect(r.findings.introduced).toHaveLength(1);
    expect(r.findings.existing).toHaveLength(1);
    expect(r.markdown.startsWith(REPORT_MARKER)).toBe(true);
    // The one introduced finding is the blocking issue above, so no fold repeats it.
    expect(r.markdown).not.toContain("More drift and rules");
    expect(r.markdown.match(/app depends on api\.secret/g)).toHaveLength(1);
    expect(r.markdown).toMatch(
      /<details><summary>Already on the base \(1 finding, not from this change\)<\/summary>[\s\S]*old drift/,
    );
    expect(r.markdown).toContain("| book: Book a ride | **critical** | rider | 1, 2 |");
    expect(r.markdown).toContain("for main...feature");
  });

  it("leads with the verdict, what blocks the merge, and who to ask", () => {
    expect(r.verdict).toBe("blocking");
    expect(r.headline).toEqual(["1 blocking issue"]);
    const lines = r.markdown.split("\n");
    expect(lines[1]).toBe("⛔ **ArchDoc:** 1 blocking issue");
    expect(r.markdown).toMatch(/> \[!CAUTION\]\n> \*\*A dependency the model doesn't declare\*\*/);
    // One team owns everything it touches, and book's steps didn't change: nobody extra to ask.
    expect(r.asks).toEqual([]);
    expect(r.markdown).not.toContain("Before merging");
    expect(r.attention.map((c) => c.code)).toEqual(["model/suggested"]);
    expect(r.markdown).toContain(
      "- **2 facts an agent suggested.** Accept or reject them before merging.\n  - actor ops\n  - app → cache: Caches trips",
    );
    expect(r.markdown).not.toContain("Suggested facts to review");
  });

  it("asks for each team when a change spans teams, and checks critical journeys whose steps changed", () => {
    const changed = model({
      "archdoc.yaml": root(`
        actors:
          rider: { kind: person, uses: { app: Books } }
        elements:
          app: { kind: container, code: apps/mobile/**, owners: [mobile-team], uses: { api: Calls } }
          api: { kind: container, code: services/api/**, owners: [api-team] }
          docs: { kind: container, code: docs/** }
        journeys:
          book:
            actor: rider
            goal: Book a ride
            importance: critical
            steps: [{ from: rider, to: app }, { from: app, to: api, action: Books it }]
          browse:
            actor: rider
            goal: Browse
            steps: [{ from: rider, to: app }]
      `),
    });
    const x = prReport({
      model: changed,
      changedFiles: ["apps/mobile/x.ts", "services/api/y.ts"],
      diff: diffModels(before, changed),
      findings: [],
    });
    expect(x.verdict).toBe("attention");
    expect(x.headline).toEqual(["1 critical journey changed", "2 teams to ask"]);
    // Before merging asks about the journey, so To check doesn't repeat it.
    expect(x.markdown).not.toContain("**To check**");
    expect(x.markdown).toContain("- [ ] **book** still works");
    expect(x.attention.map((c) => c.code)).toEqual(["journey/critical-changed"]);
    expect(x.asks).toEqual([
      { kind: "approve", who: "mobile-team", why: "owns app" },
      { kind: "approve", who: "api-team", why: "owns api" },
      { kind: "verify", who: "book", why: "Book a ride; critical, steps 1–2" },
    ]);
  });

  it("is only info when it touches mapped code and there's nothing to check", () => {
    const info = prReport({
      model: before,
      changedFiles: ["apps/mobile/x.ts"],
      diff: diffModels(before, before),
      findings: [],
    });
    expect(info.verdict).toBe("info");
    expect(info.asks).toEqual([]);
    expect(info.headline).toEqual(["Touches app"]);
  });

  it("lists suggested facts without earning a comment when they're all there is", () => {
    const suggested = prReport({
      model: after,
      changedFiles: ["apps/mobile/x.ts"],
      diff: diffModels(before, after),
      findings: [],
    });
    expect(suggested.attention.map((c) => c.code)).toEqual(["model/suggested"]);
    expect(suggested.verdict).toBe("info");
    expect(suggested.markdown).toContain("- **2 facts an agent suggested.**");
  });

  it("draws the change and the most important journeys", () => {
    expect(r.markdown).toMatch(
      /\*\*What changed\*\*\n\n```mermaid\nflowchart TB\n[\s\S]*?```\n\n<sub>🟩 added/,
    );
    expect(r.markdown).toContain(
      "<details open><summary><b>book</b> (critical): steps 1, 2 go through this change</summary>\n\n```mermaid\nsequenceDiagram",
    );
    expect(r.markdown).toContain("<details><summary><b>browse</b> (normal): step 1 goes through");
    // Actors stay with the journey table, above the journey diagrams.
    expect(r.markdown.indexOf("**Actors affected:**")).toBeLessThan(
      r.markdown.indexOf("sequenceDiagram"),
    );
    const plain = prReport({
      model: after,
      changedFiles: ["apps/mobile/x.ts"],
      diff: diffModels(before, after),
      findings: [],
      diagrams: false,
    });
    expect(plain.markdown).not.toContain("```mermaid");
    const one = prReport({
      model: after,
      changedFiles: ["apps/mobile/x.ts"],
      diff: diffModels(before, after),
      findings: [],
      maxJourneyDiagrams: 1,
    });
    expect(one.markdown.match(/sequenceDiagram/g)).toHaveLength(1);
  });

  it("says so when nothing modeled is touched", () => {
    const quiet = prReport({
      model: after,
      changedFiles: ["README.md"],
      diff: diffModels(after, after),
      findings: [],
    });
    expect(quiet.verdict).toBe("none");
    expect(quiet.markdown).toBe(
      `${REPORT_MARKER}\n✅ **ArchDoc:** No architectural impact\n\nNo model change, and nothing this change touches is in the model.\n\n<sub>Generated by [ArchDoc](https://github.com/ArchDoc/archdoc).</sub>\n<!-- archdoc-verdict: none -->`,
    );
  });
});

describe("formatAnnotations", () => {
  it("puts introduced findings on their lines, escaped for workflow commands", () => {
    const out = formatAnnotations([
      {
        severity: "error",
        code: "drift/undeclared-dependency",
        message: "web depends on billing, but the model doesn't declare it.",
        evidence: ["apps/web/src/app.ts:3 (@shop/billing)"],
        files: ["apps/web/src/app.ts"],
        introduced: true,
      },
      {
        severity: "warning",
        code: "rule/violation",
        rule: "no-pii, out",
        message: "50% of\nthis",
        evidence: [],
        files: [".archdoc/archdoc.yaml"],
        location: { file: ".archdoc/archdoc.yaml", line: 34, column: 7 },
        introduced: true,
      },
      {
        severity: "warning",
        code: "drift/stale-path",
        message: "old",
        evidence: [],
        files: [],
        introduced: false,
      },
    ]);
    expect(out.split("\n")).toEqual([
      "::error file=apps/web/src/app.ts,line=3,title=ArchDoc drift/undeclared-dependency::web depends on billing, but the model doesn't declare it.",
      "::warning file=.archdoc/archdoc.yaml,line=34,title=ArchDoc rule no-pii%2C out::50%25 of%0Athis",
    ]);
  });
});
