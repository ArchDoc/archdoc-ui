import { buildModel, type Model } from "../src/index.js";

/** Builds a model from inline YAML files. The first file is the root. */
export function model(files: Record<string, string>): Model {
  const sources = Object.entries(files).map(([path, text]) => ({ path, text: dedent(text) }));
  return buildModel(sources, { root: sources[0]?.path });
}

export function codes(m: Model, severity?: string): string[] {
  return m.diagnostics.filter((d) => !severity || d.severity === severity).map((d) => d.code);
}

export function dedent(text: string): string {
  const lines = text.replace(/^\n/, "").split("\n");
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
  );
  return lines.map((l) => l.slice(indent)).join("\n");
}

/** A root file for namespace "rides" that imports "payments", plus extra YAML. */
export function root(extra = ""): string {
  return `${dedent(ROOT)}\n${dedent(extra)}`;
}

const ROOT = `
  archdoc: "2.0"
  namespace: rides
  imports:
    payments: { github: acme/payments, version: ^5 }
`;
