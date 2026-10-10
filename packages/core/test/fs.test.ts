import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getElement, loadModel } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

describe("loadModel", () => {
  it("loads ArchDoc's own model with no diagnostics", async () => {
    const m = await loadModel(".", { cwd: repo });
    expect(m.diagnostics).toEqual([]);
    expect(m.namespace).toBe("archdoc");
    expect(m.files[0]).toBe(".archdoc/archdoc.yaml");
    expect(m.baseDir).toBe(repo.replace(/\/$/, ""));
    // Phase 1 exit: at least three levels and a journey.
    expect(Math.max(...[...m.elements.values()].map((e) => e.depth))).toBeGreaterThanOrEqual(2);
    expect(m.journeys.size).toBeGreaterThan(0);
    expect(getElement(m, "loader")?.ancestors.map((e) => e.id)).toEqual([
      "toolchain",
      "toolchain.core",
    ]);
  });

  it("loads a single file", async () => {
    const m = await loadModel("examples/blog.yaml", { cwd: repo });
    expect(m.diagnostics).toEqual([]);
    expect(m.files).toEqual(["examples/blog.yaml"]);
  });

  it("reports a missing model", async () => {
    const m = await loadModel("packages", { cwd: repo });
    expect(m.diagnostics).toMatchObject([{ code: "model/not-found" }]);
  });
});
