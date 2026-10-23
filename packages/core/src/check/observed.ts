/**
 * A dependency seen in the code, between two repository paths. Analyzers
 * produce these; core maps them onto elements and compares them with the
 * model. Paths are relative to the repository root, with forward slashes.
 */
export interface ObservedDependency {
  /** File that depends on something, such as packages/cli/src/program.ts. */
  from: string;
  /** File or directory it depends on, such as packages/core. */
  to: string;
  /** Which analyzer saw it, such as "ts-imports". */
  analyzer: string;
  /** The import specifier or manifest entry, such as "@archdoc/core". */
  specifier?: string | undefined;
  /** 1-based line in `from`. */
  line?: number | undefined;
  /** A type-only import: a compile-time dependency, but no runtime call. */
  typeOnly?: boolean | undefined;
}

/**
 * Build and test tooling, not a dependency between parts of the system: a
 * devDependency in a manifest, or an import in a tool's config file
 * (eslint.config.js, tailwind.config.ts, vite.config.ts). check and init
 * leave it out; an import of the same package from the code still counts.
 */
export function isDevTooling(d: ObservedDependency): boolean {
  return (d.analyzer === "manifests" && d.typeOnly === true) || CONFIG_FILE.test(d.from);
}

const CONFIG_FILE = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/;

export function evidenceOf(d: ObservedDependency): string {
  return `${d.from}${d.line ? `:${d.line}` : ""}${d.specifier ? ` (${d.specifier})` : ""}`;
}
