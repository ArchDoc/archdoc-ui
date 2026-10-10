export type Severity = "error" | "warning" | "info";

export interface SourceLocation {
  /** File path as given to the loader, usually relative to the working directory. */
  file: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
}

export interface Diagnostic {
  severity: Severity;
  /** Stable machine-readable code, such as `ref/unresolved` or `journey/broken-step`. */
  code: string;
  message: string;
  location?: SourceLocation | undefined;
  /** Dotted path to the offending value inside the file, such as `elements.api.uses.db`. */
  path?: string | undefined;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/** `file:line:column severity code message`, the format most editors and CI annotators understand. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.location ? `${d.location.file}:${d.location.line}:${d.location.column}` : "";
  return `${where ? `${where} ` : ""}${d.severity} ${d.code} ${d.message}`;
}
