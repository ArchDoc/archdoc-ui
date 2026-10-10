import { describe, expect, it } from "vitest";
import { countChanges, diffModels, formatDiff, isEmptyDiff } from "../src/index.js";
import { model, root } from "./helpers.js";

const base = model({
  "archdoc.yaml": root(`
    actors:
      dev: { kind: person, uses: { app: Uses } }
    elements:
      app: { kind: container, description: The app, uses: { api: Calls } }
      platform:
        kind: system
        elements:
          api: { kind: container, status: planned }
          old: { kind: component }
    journeys:
      j:
        actor: dev
        goal: Do it
        steps: [{ from: dev, to: app }, { from: app, to: api, action: Calls }]
    rules:
      - { id: r1, deny: { from: app, to: old } }
  `),
});

const head = model({
  "archdoc.yaml": root(`
    actors:
      dev: { kind: person, uses: { app: Uses a lot } }
      ops: { kind: team }
    elements:
      app: { description: The app, kind: container, uses: { api: Calls, worker: { description: Queues, provenance: { source: suggested, by: agent:x } } } }
      platform:
        kind: system
        elements:
          api: { kind: container }
          worker: { kind: container }
      old: { kind: component }
    journeys:
      j:
        actor: dev
        goal: Do it
        steps: [{ from: dev, to: app }, { from: app, to: worker, action: Queues }, { from: app, to: api, action: Calls }]
  `),
});

const d = diffModels(base, head);

describe("diffModels", () => {
  it("finds added, changed, and moved elements, ignoring field order", () => {
    expect(d.elements.map((c) => [c.kind, c.id, c.from, c.fields])).toEqual([
      ["moved", "old", "platform.old", ["parent"]],
      ["changed", "platform.api", undefined, ["status"]],
      ["added", "platform.worker", undefined, []],
    ]);
  });

  it("diffs relationships on their own, not as part of actors", () => {
    expect(d.actors.map((c) => [c.kind, c.id])).toEqual([["added", "ops"]]);
    expect(d.relationships.map((c) => [c.kind, c.id, c.fields])).toEqual([
      ["changed", "actor:dev->element:app", ["description"]],
      ["added", "element:app->element:platform.worker", []],
    ]);
  });

  it("reports journey steps added and removed", () => {
    expect(d.journeys).toMatchObject([
      {
        kind: "changed",
        id: "j",
        fields: ["steps"],
        steps: [{ kind: "added", step: 2, from: "app", to: "worker" }],
      },
    ]);
  });

  it("reports removed rules and counts everything", () => {
    expect(d.rules.map((c) => [c.kind, c.id])).toEqual([["removed", "r1"]]);
    expect(countChanges(d)).toBe(8);
    expect(isEmptyDiff(diffModels(head, head))).toBe(true);
  });

  it("renders text, markdown, mermaid, and json", () => {
    const text = formatDiff(d, "text", "a → b");
    expect(text).toMatch(/^Model changes \(a → b\): elements 1 added, 1 changed, 1 moved;/);
    expect(text).toContain("→ old (component) moved from platform.old");
    expect(text).toContain("~ platform.api (container): status planned → active");
    expect(text).toContain("+ step 2: app → worker (Queues)");
    expect(formatDiff(d, "markdown")).toContain("- **added** platform.worker (container)");
    expect(formatDiff(d, "mermaid")).toMatch(
      /^flowchart LR\n[\s\S]*element_platform_worker\["platform.worker"\]:::added/,
    );
    expect(JSON.parse(formatDiff(d, "json")).elements).toHaveLength(3);
    expect(formatDiff(diffModels(head, head), "text")).toBe("Model changes: none.");
  });
});
