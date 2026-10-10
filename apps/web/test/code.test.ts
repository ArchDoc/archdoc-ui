import { describe, expect, it } from "vitest";
import { editorLink, linkTarget, webLink } from "../src/components/code.js";

const files = new Set(["packages/cli/src/server.ts"]);

describe("code links", () => {
  it("links a glob to its directory and a file to itself", () => {
    expect(linkTarget("packages/core/src/load/**", files)).toEqual({
      path: "packages/core/src/load",
      isFile: false,
    });
    expect(linkTarget("src/*.ts", files)).toEqual({ path: "src", isFile: false });
    expect(linkTarget("packages/cli/src/server.ts", files)).toEqual({
      path: "packages/cli/src/server.ts",
      isFile: true,
    });
    expect(linkTarget("./lib/util/", files)).toEqual({ path: "lib/util", isFile: false });
  });

  it("builds web links with the branch, keeping its slashes", () => {
    const repo = {
      webUrl: "https://github.com/ArchDoc/archdoc",
      branch: "claude/x",
      commit: "abc",
    };
    expect(webLink(repo, "packages/cli/src/server.ts", true)).toBe(
      "https://github.com/ArchDoc/archdoc/blob/claude/x/packages/cli/src/server.ts",
    );
    expect(webLink({ ...repo, branch: undefined }, "apps/web", false)).toBe(
      "https://github.com/ArchDoc/archdoc/tree/abc/apps/web",
    );
    expect(webLink({}, "x", true)).toBeUndefined();
  });

  it("builds editor links from the repository root", () => {
    expect(editorLink({ root: "/home/me/repo" }, "a/b.ts")).toBe(
      "vscode://file/home/me/repo/a/b.ts",
    );
    expect(editorLink({ root: "C:/repo" }, "a.ts")).toBe("vscode://file/C:/repo/a.ts");
  });
});
