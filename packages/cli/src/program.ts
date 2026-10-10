import { readFileSync } from "node:fs";
import { SPEC_VERSION } from "@archdoc/spec";
import { Command } from "commander";
import { migrate } from "./commands/migrate.js";
import { schema } from "./commands/schema.js";
import { validate } from "./commands/validate.js";
import { type Io, processIo } from "./io.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

/** Builds the `archdoc` program. Each action sets `exitCode` instead of exiting. */
export function createProgram(io: Io = processIo): Command & { exitCode?: number } {
  const program: Command & { exitCode?: number } = new Command("archdoc");
  const run = (code: Promise<number>) =>
    code.then((c) => {
      program.exitCode = c;
    });

  program
    .description("An architecture control plane for AI-assisted development.")
    .version(`${version} (spec ${SPEC_VERSION})`)
    .configureOutput({
      writeOut: (s) => io.out(s.trimEnd()),
      writeErr: (s) => io.err(s.trimEnd()),
    });

  program
    .command("validate")
    .description("Check the model: schema, references, and journeys")
    .argument("[path]", "repository, .archdoc directory, or model file", ".")
    .option("--json", "print the result as JSON")
    .option("--strict", "fail on warnings too")
    .action((path: string, opts: { json?: boolean; strict?: boolean }) =>
      run(validate(path, opts, io)),
    );

  program
    .command("migrate")
    .description("Convert a v1 model (users/components) to spec v2")
    .argument("<file>", "v1 model file")
    .option("-n, --namespace <namespace>", "namespace for the model (default: from the file name)")
    .option("--name <name>", "display name for the model")
    .option("-o, --out <file>", "write to a file instead of stdout")
    .action((file: string, opts: { namespace?: string; name?: string; out?: string }) =>
      run(migrate(file, opts, io)),
    );

  program
    .command("schema")
    .description("Print the JSON Schema for v2 model files, for editor validation")
    .option("-o, --out <file>", "write to a file instead of stdout")
    .action((opts: { out?: string }) => run(schema(opts, io)));

  return program;
}
