import { describe, expect, it } from "vitest";
import { buildModel, check, findSnippet, formatCode } from "../src/index.js";

const ts = `import { x } from "y";

export class Refunds {
  approve(amount: number) {
    return amount < 100;
  }

  reject() {}
}

export function refund(id: string) {
  const r = lookup(id);
  return r;
}
`;

describe("code snippets", () => {
  it("take a line range, or the declaration a symbol names, to where it ends", () => {
    expect(findSnippet({ path: "a.ts", lines: "3-4" }, ts)).toMatchObject({
      start: 3,
      end: 4,
      text: "export class Refunds {\n  approve(amount: number) {",
    });
    expect(findSnippet({ path: "a.ts", symbol: "refund" }, ts)).toMatchObject({
      start: 11,
      end: 14,
    });
    // Type.member finds the member inside the type.
    expect(findSnippet({ path: "a.ts", symbol: "Refunds.approve" }, ts)).toMatchObject({
      start: 4,
      end: 6,
      text: "  approve(amount: number) {\n    return amount < 100;\n  }",
    });
    expect(
      findSnippet(
        { path: "a.py", symbol: "score" },
        "x = 1\n\ndef score(claim):\n    return 1\n\ny = 2\n",
      ),
    ).toMatchObject({ start: 3, end: 4 });
    expect(
      findSnippet(
        { path: "a.go", symbol: "Approve" },
        "func (r *Refunds) Approve(a int) bool {\n\treturn true\n}\n",
      ),
    ).toMatchObject({ start: 1, end: 3 });
  });

  it("say what's wrong when the code no longer matches", () => {
    expect(findSnippet({ path: "a.ts", lines: "10-40" }, ts)).toEqual({
      problem: "has 14 lines, not 10-40",
    });
    expect(findSnippet({ path: "a.ts", symbol: "cancel" }, ts)).toEqual({
      problem: "doesn't declare cancel",
    });
  });

  it("are checked against the repository, and read out for agents", () => {
    const m = buildModel([
      {
        path: "archdoc.yaml",
        text: `
archdoc: "2.0"
namespace: shop
elements:
  app:
    kind: container
    uses: { db: Saves }
    elements:
      refunds:
        kind: component
        code:
          - { path: src/refunds.ts, symbol: Refunds.approve, description: The approval rule }
          - { path: src/refunds.ts, symbol: cancel }
          - { path: src/refunds.ts, lines: 11-14 }
  db: { kind: datastore }
`,
      },
    ]);
    const read = (path: string) => (path === "src/refunds.ts" ? ts : undefined);
    const findings = check(m, { files: ["src/refunds.ts"], read }).findings;
    expect(findings.filter((f) => f.code === "drift/stale-snippet").map((f) => f.message)).toEqual([
      "app.refunds points at src/refunds.ts (cancel), but src/refunds.ts doesn't declare cancel. Update the snippet.",
    ]);
    const refs = m.elements.get("app.refunds")?.code ?? [];
    expect(formatCode("app.refunds", refs, read)).toBe(
      [
        "Code for app.refunds",
        "",
        "src/refunds.ts (Refunds.approve) · The approval rule",
        "4 |   approve(amount: number) {",
        "5 |     return amount < 100;",
        "6 |   }",
        "",
        "src/refunds.ts (cancel)",
        "  (src/refunds.ts doesn't declare cancel)",
        "",
        "src/refunds.ts:11-14",
        "11 | export function refund(id: string) {",
        "12 |   const r = lookup(id);",
        "13 |   return r;",
        "14 | }",
      ].join("\n"),
    );
  });
});
