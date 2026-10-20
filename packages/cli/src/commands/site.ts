import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Io } from "../io.js";
import { findWebDir, modelResponse } from "../server.js";

export interface SiteOptions {
  out?: string;
  /** Compare with this branch or commit, as `archdoc view --base` does. */
  base?: string;
}

/**
 * `archdoc site`: the explorer as a static site for this repository, for any
 * static host. With --base, it opens on the change since the merge base with
 * that ref, with the same verdict and findings as the PR comment, so a pull
 * request can link to it.
 */
export async function site(target: string, options: SiteOptions, io: Io): Promise<number> {
  try {
    const webDir = findWebDir();
    if (!webDir) {
      io.err(
        "The explorer isn't built. In the ArchDoc repo, run `pnpm build`, or set ARCHDOC_WEB_DIR.",
      );
      return 2;
    }
    const body = await modelResponse({ target, cwd: io.cwd, base: options.base });
    if (!body) {
      io.err(`No ArchDoc model at ${target}. Expected .archdoc/archdoc.yaml.`);
      return 1;
    }
    const out = resolve(io.cwd, options.out ?? "site");
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    await cp(webDir, out, { recursive: true });
    await mkdir(join(out, "api"), { recursive: true });
    await writeFile(join(out, "api", "model"), JSON.stringify({ ...body, watch: false }));
    // GitHub Pages serves files and folders as they are.
    await writeFile(join(out, ".nojekyll"), "");
    const where = relative(io.cwd, out) || ".";
    io.out(`✓ Wrote ${where}/.`);
    io.out(
      options.base
        ? `  Publish the folder with any static host, and link to it with #changes to open the change since ${options.base}.`
        : "  Publish the folder with any static host.",
    );
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
