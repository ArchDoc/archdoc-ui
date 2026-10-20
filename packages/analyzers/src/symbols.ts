import {
  type CodeIndex,
  type IndexedImport,
  type IndexedSource,
  type IndexedSymbol,
  listRepoFiles,
} from "@archdoc/core";
import ts from "typescript";
import { type AnalyzerContext, contextFor } from "./api.js";
import { resolveSpecifier } from "./ts-imports.js";
import { workspacePackages } from "./workspace.js";

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
/** String literals that read as identifiers with parts, such as archdoc_check or view-server. */
const LITERAL = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;
const MAX_LITERALS = 100;

/**
 * An index of the repository's code for ranking: every file, and for each
 * TS/JS file the declarations it exports (with line numbers), the names it
 * imports (resolved to a repository file or workspace package, with the line
 * each name is first used on), and identifier-like string literals such as
 * tool names. Parses each file with TypeScript, without type-checking, so it
 * is deterministic and fast. Core ranks it (`search`, `context`).
 */
export async function indexCode(ctx: AnalyzerContext): Promise<CodeIndex> {
  const packages = await workspacePackages(ctx);
  const files = new Set(ctx.files);
  const sources: IndexedSource[] = [];
  for (const path of ctx.files) {
    if (!SOURCE.test(path) || path.endsWith(".d.ts") || /(^|\/)node_modules\//.test(path)) {
      continue;
    }
    let text: string;
    try {
      text = await ctx.read(path);
    } catch {
      continue;
    }
    sources.push(indexSource(path, text, (spec) => resolveSpecifier(path, spec, files, packages)));
  }
  return { files: [...ctx.files], sources };
}

/** Indexes the repository at `baseDir` (its git files, or every file outside node_modules). */
export async function indexRepository(baseDir: string): Promise<CodeIndex> {
  return indexCode(contextFor(baseDir, await listRepoFiles(baseDir)));
}

/** One file's exports, named imports, and literals. `resolve` maps an import specifier to a repo path. */
export function indexSource(
  path: string,
  text: string,
  resolve: (specifier: string) => string | undefined = () => undefined,
): IndexedSource {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, scriptKind(path));
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const exports: IndexedSymbol[] = [];
  const imports: IndexedImport[] = [];
  // Local declarations, so `export { a }` gets a's kind and line.
  const locals = new Map<string, IndexedSymbol>();
  const localExports: { name: string; local: string; line: number }[] = [];
  /** Imported local names → the import entry that brought them, for their first use. */
  const importedLocals = new Map<string, { imp: IndexedImport; index: number }>();

  const add = (name: string, kind: IndexedSymbol["kind"], node: ts.Node, exported: boolean) => {
    const sym = { name, kind, line: lineOf(node) };
    locals.set(name, sym);
    if (exported) exports.push(sym);
  };

  for (const stmt of sf.statements) {
    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      const kind = ts.isFunctionDeclaration(stmt) ? "function" : "class";
      const name = stmt.name?.text ?? (isDefault ? "default" : undefined);
      if (name) add(name, kind, stmt, exported);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      add(stmt.name.text, "interface", stmt, exported);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      add(stmt.name.text, "type", stmt, exported);
    } else if (ts.isEnumDeclaration(stmt)) {
      add(stmt.name.text, "enum", stmt, exported);
    } else if (ts.isVariableStatement(stmt)) {
      const flags = stmt.declarationList.flags;
      const kind = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) add(d.name.text, kind, d, exported);
      }
    } else if (ts.isExportAssignment(stmt)) {
      exports.push({ name: "default", kind: "default", line: lineOf(stmt) });
    } else if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      if (!clause) continue;
      const specifier = stmt.moduleSpecifier.text;
      const imp: IndexedImport = {
        specifier,
        target: resolve(specifier),
        line: lineOf(stmt),
        names: [],
      };
      if (clause.isTypeOnly) imp.typeOnly = true;
      if (clause.name) imp.names.push({ name: "default", local: clause.name.text });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = (el.propertyName ?? el.name).text;
          const entry: IndexedImport["names"][number] = { name };
          if (el.name.text !== name) entry.local = el.name.text;
          if (el.isTypeOnly) entry.typeOnly = true;
          imp.names.push(entry);
        }
      }
      if (imp.names.length === 0) continue;
      if (!clause.isTypeOnly && imp.names.every((n) => n.typeOnly)) imp.typeOnly = true;
      imp.names.forEach((n, index) => {
        importedLocals.set(n.local ?? n.name, { imp, index });
      });
      imports.push(imp);
    } else if (ts.isExportDeclaration(stmt)) {
      const clause = stmt.exportClause;
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const specifier = stmt.moduleSpecifier.text;
        const imp: IndexedImport = {
          specifier,
          target: resolve(specifier),
          line: lineOf(stmt),
          reexport: true,
          names: [],
        };
        if (stmt.isTypeOnly) imp.typeOnly = true;
        if (!clause) {
          imp.names.push({ name: "*" });
        } else if (ts.isNamedExports(clause)) {
          for (const el of clause.elements) {
            const name = (el.propertyName ?? el.name).text;
            const entry: IndexedImport["names"][number] = { name };
            if (el.name.text !== name) entry.local = el.name.text;
            if (el.isTypeOnly) entry.typeOnly = true;
            imp.names.push(entry);
          }
        }
        if (imp.names.length) imports.push(imp);
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          localExports.push({
            name: el.name.text,
            local: (el.propertyName ?? el.name).text,
            line: lineOf(el),
          });
        }
      }
    }
  }
  for (const e of localExports) {
    const local = locals.get(e.local);
    exports.push({ name: e.name, kind: local?.kind ?? "const", line: local?.line ?? e.line });
  }

  // The first line each imported name is used on, and identifier-like literals.
  const literals = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      const hit = importedLocals.get(node.text);
      const entry = hit?.imp.names[hit.index];
      if (entry && entry.line === undefined) entry.line = lineOf(node);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      literals.size < MAX_LITERALS &&
      LITERAL.test(node.text) &&
      !literals.has(node.text)
    ) {
      literals.set(node.text, lineOf(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const out: IndexedSource = {
    path,
    exports: exports.sort((a, b) => a.line - b.line),
    imports,
  };
  if (literals.size) {
    out.literals = [...literals]
      .map(([text, line]) => ({ text, line }))
      .sort((a, b) => a.line - b.line || a.text.localeCompare(b.text));
  }
  return out;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false)
  );
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
