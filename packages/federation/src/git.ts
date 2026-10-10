import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { type ModelSource, readModelSourcesAtRef } from "@archdoc/core";
import semver from "semver";

const run = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * Git against another repository named in a model file. Model files come from
 * pull requests, so a URL or ref must never become a git option, and
 * transports that run commands (ext::) stay off.
 */
async function remoteGit(cwd: string, args: string[], untrusted: string[]): Promise<string> {
  for (const value of untrusted) {
    if (value.startsWith("-") || /^ext::/i.test(value)) {
      throw new Error(`Refusing "${value}" as a git repository or ref.`);
    }
  }
  return git(cwd, "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=always", ...args);
}

/** A git URL for an import: GitHub, any git URL, or a path relative to the repository root. */
export function gitUrl(spec: { github: string } | { git: string }, repoRoot: string): string {
  if ("github" in spec) return `https://github.com/${spec.github.replace(/\.git$/, "")}.git`;
  const url = spec.git;
  // scp-like (git@host:path) and URLs (https://, ssh://, file://) pass through; the rest are paths.
  if (/^[\w+.-]+:\/\//.test(url) || /^[^/\\]+@[^:]+:/.test(url) || isAbsolute(url)) return url;
  return resolve(repoRoot, url);
}

export interface Tag {
  name: string;
  commit: string;
  /** The semver it stands for, if it's a release tag. */
  version?: string | undefined;
}

/**
 * Release tags of a repository: v5.2.0, 5.2.0, or (for monorepos that
 * publish several namespaces) payments@5.2.0 and payments-v5.2.0.
 */
export async function listTags(url: string, namespace: string, cwd: string): Promise<Tag[]> {
  const out = await remoteGit(cwd, ["ls-remote", "--tags", url], [url]);
  const tags = new Map<string, Tag>();
  for (const line of out.split("\n")) {
    const [commit, ref] = line.split("\t");
    if (!commit || !ref?.startsWith("refs/tags/")) continue;
    const peeled = ref.endsWith("^{}");
    const name = ref.slice("refs/tags/".length).replace(/\^\{\}$/, "");
    // Annotated tags list the tag object, then the commit it points to (peeled).
    if (tags.has(name) && !peeled) continue;
    const match =
      name.match(/^v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/) ??
      name.match(new RegExp(`^${namespace}(?:@|-v)(\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?)$`));
    tags.set(name, {
      name,
      commit,
      version: match?.[1] && semver.valid(match[1]) ? match[1] : undefined,
    });
  }
  return [...tags.values()];
}

/**
 * The newest release tag that satisfies a version range. A version that
 * isn't a range (such as main) names a branch or tag directly.
 */
export async function resolveVersion(
  url: string,
  namespace: string,
  range: string,
  cwd: string,
): Promise<{ ref: string; commit: string; version?: string | undefined }> {
  if (!semver.validRange(range)) {
    const out = await remoteGit(cwd, ["ls-remote", url, range], [url, range]);
    const [commit] = out.split("\n")[0]?.split("\t") ?? [];
    if (!commit)
      throw new Error(`"${range}" is neither a version range nor a branch or tag in ${url}.`);
    return { ref: range, commit };
  }
  const tags = (await listTags(url, namespace, cwd)).filter((t) => t.version);
  const best = semver.maxSatisfying(
    tags.map((t) => t.version as string),
    range,
  );
  // Prefer the plain tag (v5.2.0) when a repo has several for one version.
  const tag = tags
    .filter((t) => t.version === best)
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (!best || !tag) {
    const known = tags.map((t) => t.version).filter(Boolean);
    throw new Error(
      `No release of ${namespace} matches ${range} in ${url}.${known.length ? ` Releases: ${semver.sort(known as string[]).join(", ")}.` : " It has no release tags (such as v1.0.0)."}`,
    );
  }
  return { ref: tag.name, commit: tag.commit, version: best };
}

export interface RemoteModel {
  sources: ModelSource[];
  root: string;
  commit: string;
  /** The repo's archdoc.lock at that ref, if it has one. */
  lock?: string | undefined;
  /** The bundles that lock points to, by path relative to the model directory. */
  vendored: Map<string, string>;
}

/** The model files of a repository at a ref, read without checking it out. */
export async function readRemoteModel(
  url: string,
  ref: string,
  path: string,
): Promise<RemoteModel> {
  const tmp = await mkdtemp(join(tmpdir(), "archdoc-sync-"));
  try {
    await git(tmp, "init", "-q");
    await remoteGit(tmp, ["fetch", "-q", "--depth", "1", url, ref], [url, ref]).catch(
      (err: Error) => {
        throw new Error(
          `Couldn't fetch ${ref} from ${url}: ${err.message.split("\n").find((l) => l.startsWith("fatal")) ?? err.message}`,
        );
      },
    );
    const commit = (await git(tmp, "rev-parse", "FETCH_HEAD")).trim();
    const at = await readModelSourcesAtRef(path, commit, { cwd: tmp });
    if (!at.sources.length) throw new Error(`No ArchDoc model at ${path} in ${url} at ${ref}.`);
    const dir = `${path.replace(/^\.\/|\/$/g, "")}/`;
    const strip = (p: string) => {
      const file = p.slice(commit.length + 1);
      return file.startsWith(dir) ? file.slice(dir.length) : file;
    };
    const lock = await git(tmp, "show", `${commit}:${dir}archdoc.lock`).catch(() => undefined);
    const vendored = new Map<string, string>();
    const listing = await git(
      tmp,
      "ls-tree",
      "-r",
      "--name-only",
      commit,
      "--",
      `${dir}vendor`,
    ).catch(() => "");
    for (const file of listing.split("\n").filter((f) => f.endsWith(".json"))) {
      vendored.set(file.slice(dir.length), await git(tmp, "show", `${commit}:${file}`));
    }
    return {
      vendored,
      sources: at.sources.map((s) => ({ path: strip(s.path), text: s.text })),
      root: strip(at.root),
      commit,
      lock,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
