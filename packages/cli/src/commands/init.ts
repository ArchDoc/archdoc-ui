import { resolve } from "node:path";
import { formatInit, initModel } from "@archdoc/analyzers";
import type { Io } from "../io.js";

export interface InitOptions {
  name?: string;
  dryRun?: boolean;
  json?: boolean;
}

/**
 * `archdoc init [path]`: a starting model for a repository without one, from
 * its manifests, compose files, imports, and schema files, every fact marked
 * inferred. Never writes over a model.
 */
export async function init(path: string, options: InitOptions, io: Io): Promise<number> {
  try {
    const r = await initModel(resolve(io.cwd, path), options);
    if (options.json) {
      io.out(JSON.stringify(r, null, 2));
    } else {
      (r.refused ? io.err : io.out)(formatInit(r));
    }
    return r.refused || r.problems.length ? 1 : 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
