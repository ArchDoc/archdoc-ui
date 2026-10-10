import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against workspace sources, so they don't need a build first.
    alias: {
      "@archdoc/spec": src("spec/src/index.ts"),
      "@archdoc/core/browser": src("core/src/browser.ts"),
      "@archdoc/core": src("core/src/index.ts"),
      "@archdoc/federation": src("federation/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "integrations/*/test/**/*.test.ts",
    ],
    passWithNoTests: true,
  },
});
