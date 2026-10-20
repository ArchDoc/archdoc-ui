import { describe, expect, it } from "vitest";
import { journeyBranches } from "../src/index.js";
import { model, root } from "./helpers.js";

const refunds = model({
  "archdoc.yaml": root(`
    actors:
      rider: { kind: person, uses: { api: Asks } }
    elements:
      api: { kind: container, uses: { db: { description: Saves, sends: Refund } } }
      db: { kind: datastore }
    data:
      Request: { kind: message, fields: { amount: { type: int }, reason: { type: string } } }
      Refund: { kind: entity, fields: { amount: { type: int } } }
    logic:
      approval:
        runs-in: api
        input: { request: Request }
        rules:
          - { when: "request.reason == 'safety'", then: escalate }
          - { when: "request.amount <= 100", then: approve }
          - { when: "request.amount > 5000", then: reject }
          - { else: review }
    journeys:
      refund:
        actor: rider
        goal: Get money back
        steps:
          - from: rider
            to: api
            action: Asks for a refund
            sends: Request
            decides: approval
            branches: { escalate: { next: safety-review } }
          - { from: api, to: db, action: Saves the approved refund, when: approve }
          - { from: api, to: db, action: Saves it for review, when: review }
          - { from: api, to: db, action: Saves it for safety, when: escalate }
          - { from: api, to: db, action: Records the payout, when: approve }
      plain:
        actor: rider
        goal: Ask
        steps:
          - { from: rider, to: api, decides: approval }
          - { from: api, to: db, when: approve }
          - { from: api, to: db, action: Always }
  `),
});

describe("journeyBranches", () => {
  it("groups steps after a decision by outcome, in the order of its rules", () => {
    const items = journeyBranches(refunds, "refund");
    expect(items[0]).toEqual({ kind: "step", index: 0 });
    const block = items[1];
    if (block?.kind !== "branches") throw new Error("expected branches");
    expect(block.decision).toBe("approval");
    expect(block.decidedAt).toBe(0);
    expect(block.last).toBe(true);
    expect(block.outcomes.map((o) => [o.name, o.condition, o.steps])).toEqual([
      ["escalate", "request.reason == 'safety'", [3]],
      ["approve", "request.amount <= 100", [1, 4]],
      // An outcome no step runs for is listed too, with no steps.
      ["reject", "request.amount > 5000", []],
      ["review", "otherwise", [2]],
    ]);
    expect(block.outcomes[0]?.next).toBe("safety-review");
    expect(items).toHaveLength(2);
  });

  it("says when steps follow the branches", () => {
    const items = journeyBranches(refunds, "plain");
    expect(items.map((i) => i.kind)).toEqual(["step", "branches", "step"]);
    const block = items[1];
    expect(block?.kind === "branches" && block.last).toBe(false);
  });

  it("is empty for a journey it doesn't know", () => {
    expect(journeyBranches(refunds, "nope")).toEqual([]);
  });
});
