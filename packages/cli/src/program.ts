import { readFileSync } from "node:fs";
import { SPEC_VERSION } from "@archdoc/spec";
import { Command } from "commander";
import { check } from "./commands/check.js";
import { impact, locate, map, search, show } from "./commands/code.js";
import { diff } from "./commands/diff.js";
import { migrate } from "./commands/migrate.js";
import { report } from "./commands/report.js";
import { schema } from "./commands/schema.js";
import { validate } from "./commands/validate.js";
import { view } from "./commands/view.js";
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
    .command("view")
    .description("Open the explorer in your browser")
    .argument("[path]", "repository, .archdoc directory, or model file", ".")
    .option("-w, --watch", "reload the explorer when model files change")
    .option("-p, --port <port>", "port to listen on (default: a free port)")
    .option("--open", "open the explorer in your default browser")
    .action(async (path: string, opts: { watch?: boolean; port?: string; open?: boolean }) => {
      const result = await view(path, opts, io);
      program.exitCode = result.code;
    });

  program
    .command("search")
    .description("Find the elements, actors, and journeys for an area, with their code paths")
    .argument("<words...>", "a few words, such as: cli command")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--json", "print the result as JSON")
    .action((words: string[], opts: { model?: string; json?: boolean }) =>
      run(search(words, opts, io)),
    );

  program
    .command("locate")
    .description("Which element owns these files? (They don't need to exist yet.)")
    .argument("<paths...>", "files or directories")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--json", "print the result as JSON")
    .action((paths: string[], opts: { model?: string; json?: boolean }) =>
      run(locate(paths, opts, io)),
    );

  program
    .command("impact")
    .description("What a change affects: consumers, actors, journeys, owners, and rules")
    .argument("<target>", "element, actor, or file path")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--json", "print the result as JSON")
    .action((target: string, opts: { model?: string; json?: boolean }) =>
      run(impact(target, opts, io)),
    );

  program
    .command("show")
    .description("Print the details of an element, actor, or journey")
    .argument("<id>", "element, actor, or journey ID")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .action((id: string, opts: { model?: string }) => run(show(id, opts, io)));

  program
    .command("map")
    .description(
      "How the repository's files map onto the model: coverage, unmapped files, stale paths",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("--unmapped", "list every unmapped file")
    .option("--json", "print the result as JSON")
    .action((opts: { model?: string; json?: boolean; unmapped?: boolean }) => run(map(opts, io)));

  program
    .command("mcp")
    .description("Start the MCP server on stdio, for coding agents")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .action(async (opts: { model?: string }) => {
      const { runStdio } = await import("@archdoc/mcp");
      await runStdio({ model: opts.model, cwd: io.cwd, version });
    });

  program
    .command("check")
    .description(
      "Compare the model with the code and its rules: undeclared dependencies, rule violations, stale paths",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option(
      "-b, --base <ref>",
      "mark what changed since this ref introduced, and fail only on that",
    )
    .option("-f, --format <format>", "text, markdown, or json", "text")
    .option("--fail-on <severity>", "error, warning, or never", "error")
    .option("--no-code", "check the model only, without analyzing code")
    .action(
      (opts: { model?: string; base?: string; format?: string; failOn?: string; code?: boolean }) =>
        run(check(opts, io)),
    );

  program
    .command("report")
    .description("The architectural impact of a change, as markdown for a pull request comment")
    .requiredOption(
      "-b, --base <ref>",
      "the branch or commit the change is compared with, such as main",
    )
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --format <format>", "markdown or json", "markdown")
    .action((opts: { model?: string; base?: string; format?: string }) => run(report(opts, io)));

  program
    .command("diff")
    .description(
      "What changed in the model: actors, elements, relationships, journeys, data, rules",
    )
    .argument("[range]", "HEAD (default), a ref, a..b, or a...b (what a pull request shows)")
    .option("-m, --model <path>", "repository, .archdoc directory, or model file", ".")
    .option("-f, --format <format>", "text, markdown, mermaid, or json", "text")
    .option("--exit-code", "exit 1 when the model changed")
    .action(
      (range: string | undefined, opts: { model?: string; format?: string; exitCode?: boolean }) =>
        run(diff(range, opts, io)),
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
