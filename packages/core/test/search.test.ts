import { describe, expect, it } from "vitest";
import { search } from "../src/index.js";
import { model, root } from "./helpers.js";

const m = model({
  "archdoc.yaml": root(`
    actors:
      support: { kind: team, description: Handles refunds and rider issues }
    elements:
      cli:
        kind: container
        description: The command-line tool
        code: packages/cli/**
        elements:
          commands: { kind: component, description: One module per command, code: packages/cli/src/commands/** }
      payments:
        kind: container
        technology: Go
        code: services/payments/**
        elements:
          refunds: { kind: component, description: Refund approval rules, code: services/payments/refunds/** }
    journeys:
      refund-a-fare:
        actor: support
        goal: Refund a fare after a bad trip
        steps: [{ from: support, to: payments, action: Issues the refund, code: services/payments/refunds/api.go }]
  `),
});

const ids = (q: string) => search(m, q).map((h) => h.id);

describe("search", () => {
  it("finds the most specific element first, with its code paths", () => {
    const [first] = search(m, "cli command");
    expect(first).toMatchObject({
      id: "cli.commands",
      type: "element",
      code: ["packages/cli/src/commands/**"],
    });
    expect(ids("cli command")).toContain("cli");
  });

  it("ignores filler words and plurals", () => {
    expect(ids("add a new command to the CLI")[0]).toBe("cli.commands");
    expect(ids("refunds")).toEqual(
      expect.arrayContaining(["payments.refunds", "refund-a-fare", "support"]),
    );
  });

  it("matches code paths and technology", () => {
    expect(ids("services/payments")[0]).toBe("payments.refunds");
    expect(ids("go")).toContain("payments");
  });

  it("returns journeys with their step code", () => {
    expect(search(m, "refund fare").find((h) => h.type === "journey")).toMatchObject({
      id: "refund-a-fare",
      kind: "normal",
      code: ["services/payments/refunds/api.go"],
    });
  });

  it("falls back to the closest matches for a long sentence", () => {
    expect(
      ids("please add a command that prints every refund approval rule for operators"),
    ).not.toEqual([]);
  });

  it("returns nothing for unrelated words or only filler", () => {
    expect(ids("kubernetes")).toEqual([]);
    expect(ids("the a to")).toEqual([]);
  });
});
