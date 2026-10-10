import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { isV1Model, migrateV1 } from "@archdoc/spec";
import { parse, stringify } from "yaml";
import type { Io } from "../io.js";

export interface MigrateOptions {
  namespace?: string;
  name?: string;
  out?: string;
}

export async function migrate(file: string, options: MigrateOptions, io: Io): Promise<number> {
  const path = resolve(io.cwd, file);
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) {
    io.err(`Can't read ${file}.`);
    return 1;
  }
  const doc = parse(text);
  if (!isV1Model(doc)) {
    io.err(`${file} is not a v1 model (no users or components). Nothing to migrate.`);
    return 1;
  }

  const namespace = options.namespace ?? slug(basename(file, extname(file)));
  const { model, notes } = migrateV1(doc, { namespace, name: options.name });
  const yaml = `# Migrated from v1 by "archdoc migrate".\n${stringify(model, { lineWidth: 100 })}`;

  if (options.out) {
    await writeFile(resolve(io.cwd, options.out), yaml);
    io.err(`Wrote ${options.out}.`);
  } else {
    io.out(yaml.trimEnd());
  }
  for (const note of notes) io.err(`note: ${note}`);
  return 0;
}

function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "");
  return out || "model";
}
