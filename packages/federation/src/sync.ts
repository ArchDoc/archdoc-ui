import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  buildModel,
  createBundle,
  federationDir,
  integrityOf,
  parseBundle,
  readFederationInput,
  readModelSources,
  serializeBundle,
} from "@archdoc/core";
import {
  type Bundle,
  type ImportSpec,
  importRange,
  importSource,
  LOCK_FILE,
  type Lock,
  type LockEntry,
  LockSchema,
  VENDOR_DIR,
} from "@archdoc/spec";
import semver from "semver";
import { parse, stringify } from "yaml";
import { gitUrl, readRemoteModel, resolveVersion } from "./git.js";

export interface SyncOptions {
  /** Repository, .archdoc directory, or model file. Defaults to ".". */
  model?: string;
  cwd: string;
  /** Move these namespaces (or all, with true) to the newest version their range allows. */
  update?: boolean | string[];
  /** Write nothing, and report what doesn't match: for CI. */
  frozen?: boolean;
  /** For url: imports. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface SyncChange {
  namespace: string;
  action: "kept" | "added" | "updated" | "removed";
  source: string;
  version?: string | undefined;
  ref?: string | undefined;
  /** For updates: the version (or commit) it had before. */
  previous?: string | undefined;
}

export interface SyncResult {
  changes: SyncChange[];
  /** Display path of archdoc.lock. */
  lockPath: string;
  /** With frozen: why the lockfile doesn't match. Empty when it does. */
  problems: string[];
}

/**
 * Resolves the model's `imports` and pins them: each import's model at the
 * version its range allows is vendored as a bundle in `.archdoc/vendor/`, and
 * `.archdoc/archdoc.lock` records the version, commit, and hash. Imports that
 * already match the lock are kept without fetching anything.
 */
export async function sync(options: SyncOptions): Promise<SyncResult> {
  const { cwd } = options;
  const read = await readModelSources(options.model ?? ".", { cwd });
  if (!read) throw new Error(`No ArchDoc model at ${options.model ?? "."}.`);
  const model = buildModel(read.sources, { root: read.root });
  const dir = await federationDir(read.source);
  const current = await readFederationInput(dir, cwd);
  const lock = current.lock;

  const changes: SyncChange[] = [];
  const problems: string[] = [];
  const next: Lock = { lockfileVersion: 1, imports: {} };
  const writes = new Map<string, string>();

  for (const [ns, spec] of Object.entries(model.imports).sort(([a], [b]) => a.localeCompare(b))) {
    const entry = lock?.imports[ns];
    const source = importSource(spec);
    const requested = importRange(spec);
    const vendored = current.bundles.get(ns);
    const matches = entry?.source === source && entry.requested === requested;
    const intact = matches && vendored?.integrity === entry?.integrity;
    const wantsUpdate =
      options.update === true || (Array.isArray(options.update) && options.update.includes(ns));

    if (entry && intact && !wantsUpdate) {
      next.imports[ns] = entry;
      changes.push({
        namespace: ns,
        action: "kept",
        source,
        version: entry.version,
        ref: entry.ref,
      });
      continue;
    }
    if (options.frozen) {
      problems.push(
        !entry
          ? `${ns} isn't in archdoc.lock.`
          : !matches
            ? `${ns} changed in imports since archdoc.lock was written.`
            : vendored?.text === undefined
              ? `${ns}'s bundle is missing (${vendored?.path ?? entry.bundle}).`
              : `${ns}'s bundle doesn't match its hash in archdoc.lock.`,
      );
      continue;
    }

    const resolved = await fetchImport(ns, spec, read.baseDir, cwd, options.fetch ?? fetch);
    const text = serializeBundle(resolved.bundle);
    const file = `${VENDOR_DIR}/${ns}${resolved.bundle.version ? `@${resolved.bundle.version}` : ""}.json`;
    const pinned: LockEntry = {
      source,
      ...(requested ? { requested } : {}),
      ...(resolved.bundle.version ? { version: resolved.bundle.version } : {}),
      ...(resolved.ref ? { ref: resolved.ref } : {}),
      ...(resolved.bundle.commit ? { commit: resolved.bundle.commit } : {}),
      bundle: file,
      integrity: integrityOf(text),
    };
    next.imports[ns] = pinned;
    writes.set(file, text);
    const before = entry?.version ?? entry?.commit?.slice(0, 7);
    const after = pinned.version ?? pinned.commit?.slice(0, 7);
    changes.push({
      namespace: ns,
      action: !entry ? "added" : before !== after || !intact ? "updated" : "kept",
      source,
      version: pinned.version,
      ref: pinned.ref,
      ...(entry && before !== after ? { previous: before } : {}),
    });
  }

  for (const [ns, entry] of Object.entries(lock?.imports ?? {})) {
    if (model.imports[ns]) continue;
    if (options.frozen) problems.push(`archdoc.lock pins ${ns}, which isn't imported anymore.`);
    changes.push({
      namespace: ns,
      action: "removed",
      source: entry.source,
      version: entry.version,
    });
  }

  const lockFile = join(dir, LOCK_FILE);
  const lockPath = relative(cwd, lockFile) || LOCK_FILE;
  if (options.frozen) return { changes, lockPath, problems };

  // Write the bundles, then the lock, then drop bundles nothing pins anymore.
  for (const [file, text] of writes) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), text);
  }
  if (Object.keys(next.imports).length === 0) {
    await rm(lockFile, { force: true });
  } else {
    await writeFile(lockFile, formatLock(next));
  }
  const keep = new Set(Object.values(next.imports).map((e) => resolve(dir, e.bundle)));
  const vendor = join(dir, VENDOR_DIR);
  for (const name of await readdir(vendor).catch(() => [] as string[])) {
    const file = join(vendor, name);
    if (name.endsWith(".json") && !keep.has(file)) await rm(file, { force: true });
  }
  if (keep.size === 0) await rm(vendor, { recursive: true, force: true });
  return { changes, lockPath, problems };
}

/** archdoc.lock as YAML, with a header so nobody edits it by hand. */
export function formatLock(lock: Lock): string {
  const valid = LockSchema.parse(lock);
  return `# Written by archdoc sync. Don't edit it by hand: change imports in archdoc.yaml and run archdoc sync.\n${stringify(valid, { lineWidth: 0 })}`;
}

async function fetchImport(
  ns: string,
  spec: ImportSpec,
  repoRoot: string,
  cwd: string,
  fetchFn: typeof fetch,
): Promise<{ bundle: Bundle; ref?: string | undefined }> {
  const source = importSource(spec);
  const checkNamespace = (bundle: Bundle) => {
    if (bundle.namespace !== ns) {
      throw new Error(
        `${source} is namespace "${bundle.namespace}", not "${ns}". Import it as ${bundle.namespace}.`,
      );
    }
    return bundle;
  };

  if ("github" in spec || "git" in spec) {
    const url = gitUrl(spec, repoRoot);
    const at = await resolveVersion(url, ns, spec.version, cwd);
    const remote = await readRemoteModel(url, at.ref, spec.path ?? ".archdoc");
    const { bundle, model } = createBundle(remote.sources, remote.root, {
      version: at.version,
      commit: remote.commit,
      source,
      imports: lockedVersions(remote.lock),
    });
    if (!bundle) {
      const first = model.diagnostics.find((d) => d.severity === "error");
      throw new Error(
        `${ns} at ${at.ref} doesn't validate${first ? `: ${first.location?.file ?? ""}:${first.location?.line ?? ""} ${first.message}` : "."}`,
      );
    }
    return { bundle: checkNamespace(bundle), ref: at.ref };
  }

  if ("url" in spec) {
    const res = await fetchFn(spec.url);
    if (!res.ok) throw new Error(`Couldn't download ${spec.url}: HTTP ${res.status}.`);
    const parsed = parseBundle(await res.text());
    if ("error" in parsed) throw new Error(`${spec.url} is ${parsed.error}.`);
    const bundle = checkNamespace(parsed.bundle);
    if (spec.version && (!bundle.version || !semver.satisfies(bundle.version, spec.version))) {
      throw new Error(
        `${spec.url} is ${ns} ${bundle.version ?? "without a version"}, which doesn't match ${spec.version}.`,
      );
    }
    return { bundle: { ...bundle, source } };
  }

  // file: a bundle, a model file, or a model directory, relative to the repository root.
  const path = resolve(repoRoot, spec.file);
  if (path.endsWith(".json")) {
    const parsed = parseBundle(await readFile(path, "utf8"));
    if ("error" in parsed) throw new Error(`${spec.file} is ${parsed.error}.`);
    return { bundle: { ...checkNamespace(parsed.bundle), source } };
  }
  const local = await readModelSources(path, {
    cwd: path.endsWith("yaml") || path.endsWith("yml") ? dirname(path) : path,
  });
  if (!local) throw new Error(`No ArchDoc model at ${spec.file}.`);
  const { bundle, model } = createBundle(local.sources, local.root, { source });
  if (!bundle) {
    const first = model.diagnostics.find((d) => d.severity === "error");
    throw new Error(`${spec.file} doesn't validate${first ? `: ${first.message}` : "."}`);
  }
  return { bundle: checkNamespace(bundle) };
}

/** What a repo's own archdoc.lock pinned, as { namespace: version }. */
function lockedVersions(text: string | undefined): Record<string, string> | undefined {
  if (!text) return undefined;
  const result = LockSchema.safeParse(parse(text));
  if (!result.success) return undefined;
  const out: Record<string, string> = {};
  for (const [ns, e] of Object.entries(result.data.imports)) {
    const v = e.version ?? e.commit;
    if (v) out[ns] = v;
  }
  return out;
}
