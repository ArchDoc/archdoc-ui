import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface CommitFiles {
  sha: string;
  subject: string;
  /** Files the commit changed, relative to `cwd`. */
  files: string[];
}

/**
 * The last `count` non-merge commits on a ref, with their subjects and the
 * files each changed (relative to `cwd`, and below it). Read-only: git log.
 */
export async function recentCommits(cwd: string, ref = "HEAD", count = 50): Promise<CommitFiles[]> {
  if (ref.startsWith("-")) throw new Error(`"${ref}" is not a commit, branch, or tag.`);
  const { stdout } = await run(
    "git",
    [
      "log",
      "--no-merges",
      `--max-count=${Math.max(1, Math.floor(count))}`,
      "--format=%x1e%H%x1f%s",
      "--name-only",
      "--relative",
      ref,
      "--",
    ],
    { cwd, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout
    .split("\x1e")
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [head = "", ...rest] = chunk.split("\n");
      const [sha = "", subject = ""] = head.split("\x1f");
      return { sha, subject, files: rest.map((l) => l.trim()).filter(Boolean) };
    });
}
