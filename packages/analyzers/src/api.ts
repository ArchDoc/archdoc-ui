import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ObservedDependency } from "@archdoc/core";

export type { ObservedDependency } from "@archdoc/core";

export interface AnalyzerContext {
  /** Absolute repository root. */
  baseDir: string;
  /** Repository files, relative to `baseDir`, with forward slashes. */
  files: readonly string[];
  /** Reads a repository file. */
  read(path: string): Promise<string>;
}

/**
 * An analyzer turns source files into observed dependencies. Add one for a
 * new language or ecosystem; ArchDoc maps what it finds onto the model.
 */
export interface Analyzer {
  name: string;
  analyze(ctx: AnalyzerContext): Promise<ObservedDependency[]>;
}

export function contextFor(baseDir: string, files: readonly string[]): AnalyzerContext {
  return { baseDir, files, read: (path) => readFile(join(baseDir, path), "utf8") };
}
