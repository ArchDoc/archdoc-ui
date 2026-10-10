import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { LOCK_FILE, type Lock, LockSchema } from "@archdoc/spec";
import { parse } from "yaml";
import type { FederationInput, VendoredBundle } from "./federate.js";

/** sha256 of a file's text, as written in archdoc.lock. */
export function integrityOf(text: string): string {
  return `sha256-${createHash("sha256").update(text).digest("base64")}`;
}

/** The directory archdoc.lock and vendor/ live in: the model directory, or a single model file's directory. */
export async function federationDir(modelSource: string): Promise<string> {
  const info = await stat(modelSource).catch(() => undefined);
  return info?.isDirectory() ? modelSource : dirname(modelSource);
}

/** Reads archdoc.lock and the bundles it points to, for {@link federate}. */
export async function readFederationInput(dir: string, cwd: string): Promise<FederationInput> {
  const lockFile = join(dir, LOCK_FILE);
  const display = (p: string) => relative(cwd, p) || basename(p);
  const lockPath = display(lockFile);
  const text = await readFile(lockFile, "utf8").catch(() => undefined);
  if (text === undefined) return { lockPath, bundles: new Map() };

  let lock: Lock;
  try {
    const result = LockSchema.safeParse(parse(text));
    if (!result.success) {
      const issue = result.error.issues[0];
      return {
        lockPath,
        lockError: `${issue?.path.join(".") || "root"}: ${issue?.message}`,
        bundles: new Map(),
      };
    }
    lock = result.data;
  } catch (err) {
    return {
      lockPath,
      lockError: err instanceof Error ? err.message : String(err),
      bundles: new Map(),
    };
  }

  const bundles = new Map<string, VendoredBundle>();
  for (const [ns, entry] of Object.entries(lock.imports)) {
    const file = resolve(dir, entry.bundle);
    // Bundles live under the model directory; a lockfile can't point elsewhere.
    const inside = file.startsWith(resolve(dir) + sep);
    const body = inside ? await readFile(file, "utf8").catch(() => undefined) : undefined;
    bundles.set(ns, {
      path: display(file),
      text: body,
      integrity: body === undefined ? undefined : integrityOf(body),
    });
  }
  return { lockPath, lock, bundles };
}
