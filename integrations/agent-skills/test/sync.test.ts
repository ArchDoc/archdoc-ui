import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("agent integrations", () => {
  it("this repo uses the same skill it ships", () => {
    expect(read("../../../.claude/skills/archdoc/SKILL.md")).toBe(
      read("../claude-code/archdoc/SKILL.md"),
    );
  });

  it("this repo's AGENTS.md carries the shipped workflow", () => {
    const shipped = read("../AGENTS.md");
    const own = read("../../../AGENTS.md");
    for (const line of [
      "## Architecture model (ArchDoc)",
      "Before editing code:",
      "After editing:",
    ]) {
      expect(shipped).toContain(line);
      expect(own).toContain(line);
    }
  });

  it("the skill has the frontmatter Claude Code needs", () => {
    expect(read("../claude-code/archdoc/SKILL.md")).toMatch(
      /^---\nname: archdoc\ndescription: .+\n---\n/,
    );
  });
});
