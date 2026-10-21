import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("agent integrations", () => {
  it("this repo uses the same skill it ships", () => {
    expect(read("../../../.claude/skills/archdoc/SKILL.md")).toBe(
      read("../claude-code/archdoc/SKILL.md"),
    );
  });

  it("this repo's AGENTS.md carries the shipped workflow, word for word", () => {
    // The shipped snippet, without the line that says where to paste it.
    const shipped = read("../AGENTS.md").replace(/^<!--.*-->\n\n/, "");
    // This repo runs the CLI from its build.
    const own = read("../../../AGENTS.md").replaceAll("pnpm -s archdoc", "archdoc");
    expect(shipped).toContain("Every task: context, edit, check, seal.");
    expect(own).toContain(shipped.trim());
  });

  it("the skill has the frontmatter Claude Code needs", () => {
    expect(read("../claude-code/archdoc/SKILL.md")).toMatch(
      /^---\nname: archdoc\ndescription: .+\n---\n/,
    );
  });
});
