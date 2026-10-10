import { describe, expect, it } from "vitest";
import { compileGlob, filesUnder, literalPrefix, locate, resolveCodeMap } from "../src/index.js";
import { model, root } from "./helpers.js";

describe("compileGlob", () => {
  it.each([
    ["src/**", ["src", "src/a.ts", "src/x/y/z.ts"], ["srcx/a.ts", "lib/src/a.ts"]],
    ["src/*.ts", ["src/a.ts"], ["src/x/a.ts", "src/a.tsx"]],
    ["**/*.test.ts", ["a.test.ts", "x/y/a.test.ts"], ["a.ts"]],
    ["src/{a,b}/**", ["src/a/1", "src/b/2/3"], ["src/c/1"]],
    ["src/file?.ts", ["src/file1.ts"], ["src/file10.ts"]],
    ["lib/util", ["lib/util", "lib/util/x.ts"], ["lib/utils.ts"]],
    ["./apps/web/", ["apps/web/index.html"], ["apps/website"]],
  ])("%s", (glob, yes, no) => {
    const re = compileGlob(glob);
    for (const p of yes) expect(re.test(p), p).toBe(true);
    for (const p of no) expect(re.test(p), p).toBe(false);
  });

  it("escapes regex characters in literal parts", () => {
    expect(compileGlob("a.b/(c)/**").test("a.b/(c)/d")).toBe(true);
    expect(compileGlob("a.b/**").test("axb/c")).toBe(false);
  });

  it("finds the literal prefix", () => {
    expect(literalPrefix("packages/core/src/**")).toBe("packages/core/src/");
    expect(literalPrefix("README.md")).toBe("README.md");
  });
});

const m = model({
  "archdoc.yaml": root(`
    elements:
      app:
        kind: system
        code: apps/**
        elements:
          web: { kind: container, code: apps/web/** }
          api:
            kind: container
            code: [apps/api/**, shared/types.ts]
            elements:
              routes: { kind: component, code: apps/api/src/routes/** }
          worker: { kind: container, status: planned, code: apps/worker/** }
      lib: { kind: container, code: [lib/**, gone/**] }
      twin-a: { kind: container, code: dup/** }
      twin-b: { kind: container, code: dup/** }
  `),
});

describe("locate", () => {
  it("picks the most specific element", () => {
    expect(locate(m, "apps/api/src/routes/trips.ts").element?.id).toBe("app.api.routes");
    expect(locate(m, "apps/api/src/db.ts").element?.id).toBe("app.api");
    expect(locate(m, "apps/README.md").element?.id).toBe("app");
    expect(locate(m, "shared/types.ts")).toMatchObject({
      element: { id: "app.api" },
      pattern: "shared/types.ts",
    });
  });

  it("works for files that don't exist yet, and normalizes paths", () => {
    expect(locate(m, "./apps\\web\\new-page.tsx")).toMatchObject({
      path: "apps/web/new-page.tsx",
      element: { id: "app.web" },
    });
  });

  it("lists every match and reports ties", () => {
    expect(locate(m, "apps/api/src/routes/x.ts").matches.map((x) => x.element.id)).toEqual([
      "app.api.routes",
      "app.api",
      "app",
    ]);
    const tie = locate(m, "dup/a.ts");
    expect(tie.element?.id).toBe("twin-a");
    expect(tie.ties.map((t) => t.id)).toEqual(["twin-b"]);
  });

  it("returns no element for unmapped paths", () => {
    expect(locate(m, "README.md")).toMatchObject({ element: undefined, matches: [] });
  });
});

describe("resolveCodeMap", () => {
  const files = [
    "apps/web/a.tsx",
    "apps/api/src/routes/r.ts",
    "apps/api/x.ts",
    "lib/u.ts",
    "README.md",
  ];
  const map = resolveCodeMap(m, files);

  it("assigns each file to its most specific owner", () => {
    expect(map.files.get("app.web")).toEqual(["apps/web/a.tsx"]);
    expect(map.files.get("app.api")).toEqual(["apps/api/x.ts"]);
    expect(map.files.get("app.api.routes")).toEqual(["apps/api/src/routes/r.ts"]);
    expect(map.unmapped).toEqual(["README.md"]);
  });

  it("reports stale paths, but not for planned elements", () => {
    expect(map.stale).toEqual([
      { element: "app.api", pattern: "shared/types.ts" },
      { element: "lib", pattern: "gone/**" },
      { element: "twin-a", pattern: "dup/**" },
      { element: "twin-b", pattern: "dup/**" },
    ]);
  });

  it("rolls files up through the hierarchy", () => {
    expect(filesUnder(m, map, "app")).toEqual([
      "apps/api/src/routes/r.ts",
      "apps/api/x.ts",
      "apps/web/a.tsx",
    ]);
  });
});
