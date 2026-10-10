import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against workspace sources, so they don't need a build first.
    alias: {
      "@archdoc/spec": src("spec"),
      "@archdoc/core": src("core"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
