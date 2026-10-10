import { builtinModules } from "node:module";
import { posix } from "node:path";
import ts from "typescript";
import type { Analyzer, ObservedDependency } from "./api.js";
import { packageNameOf, workspacePackages } from "./workspace.js";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const BUILTINS = new Set(builtinModules);

/**
 * Imports between files in TypeScript and JavaScript: `import`, `export … from`,
 * `require()`, and dynamic `import()`. Uses TypeScript's own pre-processor, so
 * it understands TS syntax without type-checking. Imports of other workspace
 * packages resolve to that package's directory; relative imports resolve to
 * files. Imports of third-party packages are ignored.
 */
export const tsImports: Analyzer = {
  name: "ts-imports",
  async analyze(ctx) {
    const packages = await workspacePackages(ctx);
    const files = new Set(ctx.files);
    const out: ObservedDependency[] = [];

    for (const file of ctx.files) {
      if (!SOURCE.test(file) || file.endsWith(".d.ts")) continue;
      const text = await ctx.read(file);
      const info = ts.preProcessFile(text, true, true);
      for (const imp of info.importedFiles) {
        const spec = imp.fileName;
        const to = resolve(file, spec, files, packages);
        if (!to) continue;
        const line = text.slice(0, imp.pos).split("\n").length;
        out.push({
          from: file,
          to,
          analyzer: "ts-imports",
          specifier: spec,
          line,
          typeOnly: isTypeOnly(text, imp.pos) || undefined,
        });
      }
    }
    return out;
  },
};

function resolve(
  from: string,
  spec: string,
  files: ReadonlySet<string>,
  packages: Map<string, { dir: string }>,
): string | undefined {
  if (spec.startsWith(".")) {
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    if (base.startsWith("..")) return undefined;
    return resolveFile(base, files) ?? base;
  }
  if (spec.startsWith("node:") || BUILTINS.has(spec)) return undefined;
  const pkg = packages.get(packageNameOf(spec));
  return pkg ? pkg.dir || "." : undefined;
}

/** "./x.js" written in TS source means "./x.ts", and "./dir" can mean "./dir/index.ts". */
function resolveFile(base: string, files: ReadonlySet<string>): string | undefined {
  if (files.has(base)) return base;
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
  for (const candidate of [
    ...EXTENSIONS.map((e) => stem + e),
    ...EXTENSIONS.map((e) => `${base}/index${e}`),
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/** `import type …` and `export type … from`, including multi-line statements. */
function isTypeOnly(text: string, pos: number): boolean {
  const stmt = Math.max(text.lastIndexOf("import", pos), text.lastIndexOf("export", pos));
  if (stmt < 0) return false;
  const head = text.slice(stmt, pos);
  // A ";" in between means the keyword belongs to an earlier statement.
  return !head.includes(";") && /^(?:import|export)\s+type\b/.test(head);
}
