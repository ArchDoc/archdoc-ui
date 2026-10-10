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

export function evidenceOf(d: ObservedDependency): string {
  return `${d.from}${d.line ? `:${d.line}` : ""}${d.specifier ? ` (${d.specifier})` : ""}`;
}
