import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { archdocJsonSchema } from "@archdoc/spec";
import type { Io } from "../io.js";

export async function schema(options: { out?: string }, io: Io): Promise<number> {
  const json = `${JSON.stringify(archdocJsonSchema(), null, 2)}\n`;
  if (options.out) {
    await writeFile(resolve(io.cwd, options.out), json);
    io.err(`Wrote ${options.out}.`);
  } else {
    io.out(json.trimEnd());
  }
  return 0;
}
