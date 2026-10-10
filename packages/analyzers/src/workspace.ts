import type { AnalyzerContext } from "./api.js";

export interface WorkspacePackage {
  name: string;
  /** Directory relative to the repository root ("" for the root package). */
  dir: string;
  manifest: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

/** Every package.json in the repository with a name, keyed by package name. */
export async function workspacePackages(
  ctx: AnalyzerContext,
): Promise<Map<string, WorkspacePackage>> {
  const out = new Map<string, WorkspacePackage>();
  for (const file of ctx.files) {
    if (!/(^|\/)package\.json$/.test(file)) continue;
    try {
      const json = JSON.parse(await ctx.read(file)) as Record<string, unknown>;
      if (typeof json.name !== "string") continue;
      out.set(json.name, {
        name: json.name,
        dir: file.replace(/\/?package\.json$/, ""),
        manifest: file,
        dependencies: record(json.dependencies),
        devDependencies: record(json.devDependencies),
        peerDependencies: record(json.peerDependencies),
      });
    } catch {
      // Not valid JSON: skip it.
    }
  }
  return out;
}

function record(v: unknown): Record<string, string> {
  return v && typeof v === "object" ? (v as Record<string, string>) : {};
}

/** "@scope/name/sub/path" → "@scope/name"; "name/sub" → "name". */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}
