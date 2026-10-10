import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SKIP = new Set(["node_modules", ".git", "dist", "coverage"]);

/**
 * Files in the repository, relative to `baseDir`. Uses `git ls-files` so
 * .gitignore is respected, and falls back to walking the directory.
 */
export async function listRepoFiles(baseDir: string): Promise<string[]> {
  try {
    const { stdout } = await run(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: baseDir, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout.split("\0").filter(Boolean).sort();
  } catch {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (SKIP.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) out.push(relative(baseDir, full).replace(/\\/g, "/"));
      }
    };
    await walk(baseDir);
    return out.sort();
  }
}

export interface RepoInfo {
  /** Web URL of the repository, for code links (GitHub, GitLab, and similar). */
  webUrl?: string | undefined;
  /** Commit to link to. */
  commit?: string | undefined;
  branch?: string | undefined;
}

/** Remote URL and current commit, when `baseDir` is a git checkout. */
export async function repoInfo(baseDir: string): Promise<RepoInfo> {
  const git = async (...args: string[]) =>
    (await run("git", args, { cwd: baseDir }).catch(() => ({ stdout: "" }))).stdout.trim();
  const [remote, commit, branch] = await Promise.all([
    git("remote", "get-url", "origin"),
    git("rev-parse", "HEAD"),
    git("rev-parse", "--abbrev-ref", "HEAD"),
  ]);
  return {
    webUrl: remote ? webUrlOf(remote) : undefined,
    commit: commit || undefined,
    branch: branch && branch !== "HEAD" ? branch : undefined,
  };
}

/** `git@github.com:o/r.git` or `https://github.com/o/r.git` → `https://github.com/o/r`. */
export function webUrlOf(remote: string): string | undefined {
  const ssh = remote.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?\/?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  try {
    const url = new URL(remote);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    // Drop credentials, and proxy prefixes like /git/ that some environments add.
    return `https://${url.host}${url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")}`;
  } catch {
    return undefined;
  }
}
