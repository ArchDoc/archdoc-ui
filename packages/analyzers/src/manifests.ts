import type { Analyzer, ObservedDependency } from "./api.js";
import { workspacePackages } from "./workspace.js";

/** Dependencies between packages in the same repository, from package.json. */
export const manifests: Analyzer = {
  name: "manifests",
  async analyze(ctx) {
    const packages = await workspacePackages(ctx);
    const out: ObservedDependency[] = [];
    for (const pkg of packages.values()) {
      const text = await ctx.read(pkg.manifest);
      const lines = text.split("\n");
      for (const field of ["dependencies", "peerDependencies", "devDependencies"] as const) {
        for (const name of Object.keys(pkg[field])) {
          const target = packages.get(name);
          if (!target || target === pkg) continue;
          const line = lines.findIndex((l) => l.includes(`"${name}"`)) + 1;
          out.push({
            from: pkg.manifest,
            to: target.dir || ".",
            analyzer: "manifests",
            specifier: name,
            line: line || undefined,
            // Development dependencies don't ship, much like type-only imports.
            typeOnly: field === "devDependencies" || undefined,
          });
        }
      }
    }
    return out;
  },
};
