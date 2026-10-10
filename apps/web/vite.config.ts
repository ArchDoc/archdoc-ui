import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development, run `pnpm archdoc view --watch --port 4321` and this dev server
// proxies the model API to it. Set ARCHDOC_API to use another address.
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the explorer works from a static host at any path (archdoc landscape build).
  base: "./",
  server: {
    proxy: { "/api": process.env.ARCHDOC_API ?? "http://127.0.0.1:4321" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // elkjs is one large module; splitting it buys nothing for a local tool.
    chunkSizeWarningLimit: 2500,
  },
});
