import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { check, formatDiagnostic } from "@archdoc/core";
import type { Io } from "../io.js";
import { landscapePayload, loadLandscape } from "../landscape.js";
import { findWebDir } from "../server.js";

export interface LandscapeBuildOptions {
  out?: string;
  /** Write the site even when the composed model has errors. */
  force?: boolean;
}

/**
 * `archdoc landscape build`: composes the landscape repo's model with every
 * model it imports, checks the whole (journeys across repos, owners, org
 * rules on declared relationships), and writes a static explorer site for
 * GitHub Pages or any static host.
 */
export async function landscapeBuild(
  target: string,
  options: LandscapeBuildOptions,
  io: Io,
): Promise<number> {
  try {
    const { model, composed } = await loadLandscape(target, io.cwd);
    const findings = check(composed.model).findings.filter(
      (f) => f.code !== "model/orphan-element",
    );
    for (const f of findings) {
      io.err(
        formatDiagnostic({
          severity: f.severity,
          code: f.code,
          message: f.message,
          location: f.location,
        }),
      );
    }
    const errors = findings.filter((f) => f.severity === "error").length;
    if (errors && !options.force) {
      io.err(
        `\n✗ Not built: the landscape has ${errors} error${errors === 1 ? "" : "s"}. Fix them, or pass --force.`,
      );
      return 1;
    }

    const webDir = findWebDir();
    if (!webDir) {
      io.err(
        "The explorer isn't built. In the ArchDoc repo, run `pnpm build`, or set ARCHDOC_WEB_DIR.",
      );
      return 2;
    }
    const out = resolve(io.cwd, options.out ?? "site");
    await rm(out, { recursive: true, force: true });
    await mkdir(join(out, "api"), { recursive: true });
    await cp(webDir, out, { recursive: true });
    const payload = await landscapePayload(model, composed, false);
    await writeFile(join(out, "api", "model"), JSON.stringify(payload));
    // GitHub Pages serves files and folders as they are.
    await writeFile(join(out, ".nojekyll"), "");

    const m = composed.model;
    io.out(
      `✓ Wrote ${relative(io.cwd, out) || "."}/: ${model.name ?? model.namespace}, ${composed.repos.length} repos (${composed.repos.map((r) => `${r.namespace}@${r.version ?? "?"}`).join(", ")}), ${m.elements.size} elements, ${m.actors.size} actors, ${m.journeys.size} journeys${composed.domains.length ? `, ${composed.domains.length} domains` : ""}.`,
    );
    io.out("  Publish the folder with GitHub Pages or any static host.");
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
