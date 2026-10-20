import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Whether a base given on the command line names a model on disk (a model
 * file, or a directory with one) rather than a git ref, so two versions of
 * a model can be compared without a repository: `archdoc diff a.yaml b.yaml`.
 */
export function isModelPath(cwd: string, arg: string): boolean {
  const path = resolve(cwd, arg);
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (stat.isFile()) return /\.(ya?ml|json)$/i.test(path);
  return stat.isDirectory() && existsSync(resolve(path, ".archdoc"));
}
