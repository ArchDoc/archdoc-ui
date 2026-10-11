import type { ImportedField } from "@archdoc/core";
import type { AnalyzerContext } from "../api.js";

export type { ImportedField } from "@archdoc/core";

/** What an importer read: the fields of one type, and the files it read them from. */
export interface ImportedType {
  fields: Record<string, ImportedField>;
  files: string[];
}

/**
 * A schema importer reads a data entry's fields from the schema it comes
 * from, named in the entry's `source` (such as prisma: prisma/schema.prisma#Charge).
 * It throws an Error with a readable message when the file or type isn't there.
 */
export interface SchemaImporter {
  /** The key in `source`, such as prisma. */
  kind: string;
  read(
    ctx: AnalyzerContext,
    ref: { path: string; name?: string | undefined },
  ): Promise<ImportedType>;
}

/** Reads a repository file, or explains that it isn't there. */
export async function readSource(ctx: AnalyzerContext, path: string): Promise<string> {
  if (!ctx.files.includes(path)) throw new Error(`${path} isn't in the repository`);
  return ctx.read(path);
}

/** The text between a `{` at `open` and its matching `}`. */
export function block(text: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { body: text.slice(open + 1, i), end: i };
  }
  return { body: text.slice(open + 1), end: text.length };
}

/** Removes // and /* *\/ comments (and -- comments, for SQL). */
export function stripComments(text: string, sql = false): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(sql ? /--[^\n]*/g : /\/\/[^\n]*/g, "");
}
