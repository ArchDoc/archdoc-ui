import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readModelSourcesAtRef } from "../src/index.js";

// A repository reached through a symlink, as macOS's /var is /private/var:
// git reports its top level with the symlink resolved.
let dir: string;
let link: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "archdoc-core-git-"));
  const real = join(dir, "real");
  link = join(dir, "link");
  await mkdir(join(real, ".archdoc"), { recursive: true });
  await symlink(real, link);
  await writeFile(
    join(real, ".archdoc/archdoc.yaml"),
    'archdoc: "2.0"\nnamespace: shop\nelements:\n  api: { kind: container }\n',
  );
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
      cwd: real,
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readModelSourcesAtRef through a symlinked path", () => {
  it("reads the model when it's in the working tree", async () => {
    const at = await readModelSourcesAtRef(".archdoc", "main", { cwd: link });
    expect(at.root).toBe("main:.archdoc/archdoc.yaml");
    expect(at.sources).toHaveLength(1);
  });

  it("reads the model when it's only in the commit", async () => {
    await rm(join(link, ".archdoc"), { recursive: true });
    const at = await readModelSourcesAtRef(".archdoc", "main", { cwd: link });
    expect(at.sources.map((s) => s.path)).toEqual(["main:.archdoc/archdoc.yaml"]);
  });
});
