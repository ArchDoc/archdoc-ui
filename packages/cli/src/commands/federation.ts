import { formatDiagnostic, loadModel } from "@archdoc/core";
import { publish as publishModel, sync as syncModel } from "@archdoc/federation";
import type { Io } from "../io.js";

export interface SyncCommandOptions {
  model?: string;
  /** true for every import, or a list of namespaces. */
  update?: boolean | string[];
  frozen?: boolean;
}

/**
 * `archdoc sync`: pin the model's imports in archdoc.lock and vendor their
 * models, then report references into them that don't resolve.
 */
export async function sync(options: SyncCommandOptions, io: Io): Promise<number> {
  try {
    const result = await syncModel({
      model: options.model,
      cwd: io.cwd,
      update: options.update,
      frozen: options.frozen,
    });
    if (options.frozen) {
      if (result.problems.length) {
        for (const p of result.problems) io.err(`✗ ${p}`);
        io.err("\nRun archdoc sync and commit archdoc.lock and .archdoc/vendor/.");
        return 1;
      }
      io.out(`✓ ${result.lockPath} matches imports.`);
      return 0;
    }
    if (result.changes.length === 0) {
      io.out("Nothing to sync: the model has no imports.");
      return 0;
    }
    for (const c of result.changes) {
      const at = c.version ? `@${c.version}` : c.ref ? ` at ${c.ref}` : "";
      const line = {
        kept: `  ${c.namespace}${at}`,
        added: `+ ${c.namespace}${at} (${c.source})`,
        updated: `↑ ${c.namespace}${c.previous && c.version ? ` ${c.previous} → ${c.version}` : at}`,
        removed: `- ${c.namespace}${at}`,
      }[c.action];
      io.out(line);
    }
    const changed = result.changes.filter((c) => c.action !== "kept").length;
    io.out(
      changed
        ? `\nWrote ${result.lockPath}. Commit it with .archdoc/vendor/.`
        : `\n${result.lockPath} is up to date.`,
    );

    // What the pinned versions mean for this model.
    const model = await loadModel(options.model ?? ".", { cwd: io.cwd });
    const crossRepo = model.diagnostics.filter(
      (d) =>
        d.severity !== "info" &&
        /^(import|ref\/unknown-in-import|ref\/deprecated|ref\/unknown-contract|journey\/broken-step)/.test(
          d.code,
        ),
    );
    if (crossRepo.length) {
      io.err("");
      for (const d of crossRepo) io.err(formatDiagnostic(d));
      return crossRepo.some((d) => d.severity === "error") ? 1 : 0;
    }
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

export interface PublishCommandOptions {
  model?: string;
  version?: string;
  out?: string;
}

/** `archdoc publish`: write a versioned, validated bundle of the model for other repos. */
export async function publish(options: PublishCommandOptions, io: Io): Promise<number> {
  try {
    const result = await publishModel({
      model: options.model,
      cwd: io.cwd,
      version: options.version,
      out: options.out === "-" ? undefined : options.out,
      dryRun: options.out === "-",
    });
    if (result.errors.length) {
      for (const d of result.errors) io.err(formatDiagnostic(d));
      io.err(
        `\n✗ Not published: the model has ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`,
      );
      return 1;
    }
    if (options.out === "-") {
      io.out(result.text?.trimEnd() ?? "");
      return 0;
    }
    const b = result.bundle;
    io.out(
      `✓ Wrote ${result.path} (${b?.namespace}${b?.version ? `@${b.version}` : ""}, ${b?.sources.length} file${b?.sources.length === 1 ? "" : "s"}).`,
    );
    if (!b?.version) {
      io.err(
        "  It has no version. Tag the commit (such as v1.0.0) or pass one (archdoc publish 1.0.0), so other repos can pin it.",
      );
    } else {
      io.out(
        `  Other repos import it with git: (the tag is enough) or url: (attach ${result.path} to the release).`,
      );
    }
    return 0;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
