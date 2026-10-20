import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { checkRepository, indexRepository, loadRevision } from "@archdoc/analyzers";
import {
  anchorError,
  checkTrace,
  context,
  diffModels,
  formatActor,
  formatAnchors,
  formatCode,
  formatContext,
  formatData,
  formatDiagnostics,
  formatDiff,
  formatElement,
  formatFindings,
  formatImpact,
  formatJourney,
  formatLineage,
  formatLocate,
  formatOverview,
  formatSearch,
  formatSimulation,
  formatTrace,
  formatTraceChecks,
  getElement,
  impact,
  type LoadedModel,
  lineage,
  listRepoFiles,
  loadModel,
  loadTraces,
  locate,
  propose,
  readTraceSources,
  resolveRef,
  search,
  simulate,
  traceSkeleton,
} from "@archdoc/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ArchdocServerOptions {
  /** Repository, .archdoc directory, or model file. */
  model?: string;
  /** Directory relative paths are resolved from. */
  cwd?: string;
  version?: string;
}

export const INSTRUCTIONS = `This repository has an ArchDoc architecture model in .archdoc/: who uses the system (actors), what it's made of (elements, each mapped to code paths), and how people use it (journeys). People own it. It's the fastest way to find where code lives and what a change affects.

Start every coding task here, before you grep or read files:
1. Call archdoc_context with the task in a few words, or the files you plan to change (or both). It returns the files and functions to open first, other code that does the same job (other callers of the same functions, which a fix usually needs too), the data, rules, and journeys involved, the tests to run, and owners.
2. For the wider blast radius, call archdoc_impact on the element or the files you plan to change. It returns what depends on them, which actors and journeys the change affects (most important first), owners, and rules. archdoc_search finds elements, journeys, and files by words when you only need where something lives.
3. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey.

archdoc_locate tells you which element owns a file. archdoc_code returns the code a component points at, with the text of its snippets, so read it before searching the files yourself.

When a change touches data (what a component sends or stores, how a record is mapped, or a decision such as an approval rule), call archdoc_data on the entry to see its fields, classifications, and where it's stored and sent; archdoc_lineage on a field to see every place its value is copied or derived, across repos; and archdoc_simulate to see which branch a journey takes for a sample request and which records it writes.

When you're asked to explain or fix a bug, call archdoc_anchor with the error (a log line, a stack trace, or the wrong output). It names the journey step it showed up in and the elements involved, and starts a trace for you. Follow the code from there, write the path the failing request took to .archdoc/traces/<id>.yaml with evidence on every step, and call archdoc_trace_check on it. Commit it with the fix.

After you edit, call archdoc_check with base "main" (or the branch you started from). It lists what your change introduced: imports the model doesn't declare, broken rules, broken journeys. If a new dependency or component is intended, call archdoc_propose to add it to the model as a suggestion for a person to review; otherwise remove it. Use archdoc_diff to describe your model changes in the PR.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** An MCP server exposing ArchDoc's read-only queries. Reloads the model on every call. */
export function createArchdocServer(options: ArchdocServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const server = new McpServer(
    { name: "archdoc", version: options.version ?? "0.0.0" },
    { instructions: INSTRUCTIONS },
  );

  const withModel = async (fn: (model: LoadedModel) => string | Promise<string>) => {
    const model = await loadModel(options.model ?? ".", { cwd });
    if (model.diagnostics.some((d) => d.code === "model/not-found")) {
      return error(model.diagnostics[0]?.message ?? "No ArchDoc model found.");
    }
    const errors = model.diagnostics.filter((d) => d.severity === "error").length;
    const note = errors
      ? `\n\nNote: the model has ${errors} error(s), so this may be incomplete. Call archdoc_validate for details.`
      : "";
    try {
      return text((await fn(model)) + note);
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
  };

  /** Agents send absolute paths or paths relative to the repo; core wants repo-relative. */
  const repoPath = (model: LoadedModel, path: string) => {
    const absolute = isAbsolute(path) ? path : resolve(model.baseDir, path);
    return relative(model.baseDir, absolute).replace(/\\/g, "/");
  };

  server.registerTool(
    "archdoc_overview",
    {
      title: "Architecture overview",
      description:
        "A compact summary of the system: actors, elements down to a depth, and journeys. Call this first to orient yourself in an unfamiliar repository.",
      inputSchema: {
        depth: z
          .number()
          .int()
          .min(0)
          .max(5)
          .optional()
          .describe("Element levels to include (default 1)"),
      },
      annotations: READ_ONLY,
    },
    ({ depth }) => withModel((m) => formatOverview(m, depth ?? 1)),
  );

  server.registerTool(
    "archdoc_search",
    {
      title: "Find where something lives",
      description:
        'Find the elements, actors, and journeys for an area of the system, with their code paths. Use this at the start of a task, before grepping, to learn where a change belongs. Pass a few words, such as "cli command" or "payment refunds".',
      inputSchema: {
        query: z.string().min(1).describe("A few words naming the feature or area"),
      },
      annotations: READ_ONLY,
    },
    ({ query }) =>
      withModel(async (m) =>
        formatSearch(query, search(m, query, 8, await indexRepository(m.baseDir))),
      ),
  );

  server.registerTool(
    "archdoc_context",
    {
      title: "Where to start a task",
      description:
        "A short brief for starting a task, before you grep: the files and functions to open first (ranked, with line numbers), other code that does the same job (other callers of the functions the start files use), data, rules, the narrowest journeys (those whose steps name the files), tests to run, and owners. Pass the task in a few words, the files you plan to change, or both.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'The task in a few words, such as "pr report shows type undefined for data fields"',
          ),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            "Files or directories you plan to change, relative to the repository root or absolute",
          ),
      },
      annotations: READ_ONLY,
    },
    ({ query, paths }) =>
      withModel(async (m) => {
        if (!query?.trim() && !paths?.length) throw new Error("Pass a query, paths, or both.");
        const index = await indexRepository(m.baseDir);
        return formatContext(
          context(m, query ?? "", { index, paths: paths?.map((p) => repoPath(m, p)) }),
        );
      }),
  );

  server.registerTool(
    "archdoc_locate",
    {
      title: "Locate files in the architecture",
      description:
        "Which element owns each file: its place in the hierarchy and its owners. Use it on files you plan to change or create; they don't need to exist yet.",
      inputSchema: {
        paths: z
          .array(z.string())
          .min(1)
          .describe("File or directory paths, relative to the repository root or absolute"),
      },
      annotations: READ_ONLY,
    },
    ({ paths }) =>
      withModel((m) =>
        formatLocate(
          m,
          paths.map((p) => locate(m, repoPath(m, p))),
        ),
      ),
  );

  server.registerTool(
    "archdoc_impact",
    {
      title: "Impact of a change",
      description:
        "The blast radius of changing an element, actor, or file: what uses it (directly and indirectly), which actors and journeys are affected (most important first), what it depends on, owners, and rules that mention it. With a landscape or imports synced, also who uses it from other repos and which of their journeys pass through it. Call it while planning, before you edit.",
      inputSchema: {
        target: z.string().describe("Element ID (e.g. core.loader), actor ID, or file path"),
      },
      annotations: READ_ONLY,
    },
    ({ target }) =>
      withModel((m) => {
        let r = impact(m, target);
        if (!r.ok && (target.includes("/") || isAbsolute(target)))
          r = impact(m, repoPath(m, target));
        if (!r.ok) {
          throw new Error(
            `${r.reason}${r.candidates ? ` Candidates: ${r.candidates.join(", ")}.` : ""}`,
          );
        }
        return formatImpact(m, r.impact);
      }),
  );

  server.registerTool(
    "archdoc_get_element",
    {
      title: "Element details",
      description:
        "Everything about one element: description, technology, parents and children, owners, code paths, contracts it provides, what it uses, what uses it (including actors and other repos), and journeys through it. Works for elements in other repos too, such as payments.charges, once they're synced.",
      inputSchema: { id: z.string().describe("Element ID, e.g. toolchain.core or just core") },
      annotations: READ_ONLY,
    },
    ({ id }) =>
      withModel((m) => {
        const out = formatElement(m, id);
        if (!out) throw new Error(notFound(m, id, "element"));
        return out;
      }),
  );

  server.registerTool(
    "archdoc_code",
    {
      title: "An element's code",
      description:
        "The code an element points at, to read before searching: each path with what it's for, and the text of each snippet (a line range or a declared symbol, such as the function a component's logic lives in), numbered by line. Use it on the components a change touches.",
      inputSchema: { id: z.string().describe("Element ID, e.g. toolchain.core.data") },
      annotations: READ_ONLY,
    },
    ({ id }) =>
      withModel((m) => {
        const e = getElement(m, id)?.element;
        if (!e) throw new Error(notFound(m, id, "element"));
        return formatCode(e.id, e.code, (path) => readRepoFile(m.baseDir, path));
      }),
  );

  server.registerTool(
    "archdoc_get_actor",
    {
      title: "Actor details",
      description:
        "What an actor (person, role, team, organization, or agent) uses, owns, and which journeys it takes part in.",
      inputSchema: { id: z.string().describe("Actor ID") },
      annotations: READ_ONLY,
    },
    ({ id }) =>
      withModel((m) => {
        const out = formatActor(m, id);
        if (!out) throw new Error(notFound(m, id, "actor"));
        return out;
      }),
  );

  server.registerTool(
    "archdoc_journey",
    {
      title: "Journey steps",
      description:
        "The steps of a journey (how an actor reaches a goal across elements), with code entry points. Without an ID, lists all journeys.",
      inputSchema: { id: z.string().optional().describe("Journey ID; omit to list journeys") },
      annotations: READ_ONLY,
    },
    ({ id }) =>
      withModel((m) => {
        if (!id) {
          return (
            [...m.journeys.values()]
              .map(
                (j) =>
                  `${j.id} (${j.spec.importance ?? "normal"}) · ${j.spec.actor}: ${j.spec.goal}`,
              )
              .join("\n") || "No journeys in this model."
          );
        }
        const j = m.journeys.get(id);
        if (!j)
          throw new Error(
            `No journey "${id}". Known: ${[...m.journeys.keys()].join(", ") || "none"}.`,
          );
        return formatJourney(m, j);
      }),
  );

  server.registerTool(
    "archdoc_data",
    {
      title: "Data entry",
      description:
        "A data entry (a stored record, a message, or an event): its fields and their classifications (pii, pci, ...), its lifecycle, the schema it comes from, where it's stored, and where it's sent. Works for entries in other repos too, such as payments.Charge. Without an ID, lists the data entries.",
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe("Data entry, such as Charge or payments.RefundRequest; omit to list them"),
      },
      annotations: READ_ONLY,
    },
    ({ id }) =>
      withModel((m) => {
        if (!id) {
          return (
            [...m.data.values()]
              .map((d) => {
                const classified = Object.entries(d.spec.fields ?? {})
                  .filter(([, f]) => f.classification)
                  .map(([n, f]) => `${n}: ${f.classification}`);
                return `${d.id} (${d.spec.kind})${classified.length ? ` · ${classified.join(", ")}` : ""}${d.spec.description ? `: ${d.spec.description}` : ""}`;
              })
              .join("\n") || "No data entries in this model."
          );
        }
        const out = formatData(m, id);
        if (!out) {
          throw new Error(
            `No data entry "${id}". Known: ${[...m.data.keys()].join(", ") || "none"}. Entries in other repos are named by namespace, such as payments.Charge.`,
          );
        }
        return out;
      }),
  );

  server.registerTool(
    "archdoc_lineage",
    {
      title: "Field lineage",
      description:
        "Where a field's value comes from and where it goes: every mapping that copies or derives it, across repos, with the expression and the tables it lands in. Use it before changing or renaming a field, or a mapping.",
      inputSchema: {
        field: z
          .string()
          .describe("Entry.field, such as Refund.amount_cents or payments.Refund.amount_cents"),
      },
      annotations: READ_ONLY,
    },
    ({ field }) =>
      withModel((m) => {
        const l = lineage(m, field);
        if (!l) throw new Error(`No data entry for "${field}". Name a field as Entry.field.`);
        return formatLineage(l);
      }),
  );

  server.registerTool(
    "archdoc_simulate",
    {
      title: "Simulate a journey",
      description:
        'Run a journey against sample records without running the system: the branch each decision takes and why, the records each step creates and changes, and the tables they land in. Use it to answer "what happens if..." before changing logic or mappings.',
      inputSchema: {
        journey: z.string().describe("Journey ID"),
        sample: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .describe(
            'Records that exist when the journey starts, by data entry, such as { "payments.RefundRequest": { "amount_cents": 400 }, "payments.Charge": { "amount_cents": 1200 } }',
          ),
      },
      annotations: READ_ONLY,
    },
    ({ journey, sample }) =>
      withModel((m) => {
        const result = simulate(m, journey, sample);
        if (!result) {
          throw new Error(
            `No journey "${journey}". Known: ${[...m.journeys.keys()].join(", ") || "none"}.`,
          );
        }
        return formatSimulation(result);
      }),
  );

  server.registerTool(
    "archdoc_check",
    {
      title: "Check for drift",
      description:
        'Compare the model with the code and its rules: imports between elements the model doesn\'t declare, broken rules, broken journeys, stale code paths, and orphan elements. Call this after editing. Pass base (such as "main") to see what your change introduced.',
      inputSchema: {
        base: z.string().optional().describe("Branch or commit to compare with, such as main"),
      },
      annotations: READ_ONLY,
    },
    async ({ base }) => {
      try {
        const { findings } = await checkRepository({ model: options.model, cwd, base });
        const introduced = findings.filter((f) => f.introduced);
        const next =
          base && introduced.some((f) => f.code === "drift/undeclared-dependency")
            ? "\n\nIf a new dependency is intended, call archdoc_propose to add it to the model as a suggestion. If not, remove the import."
            : "";
        return text(formatFindings(findings, "text") + next);
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "archdoc_diff",
    {
      title: "Model changes",
      description:
        "What changed in the model (actors, elements, relationships, journeys, data, rules) between a ref and the working tree. Use it to describe your model changes in a PR.",
      inputSchema: {
        base: z.string().optional().describe("Branch or commit to compare with (default HEAD)"),
        format: z.enum(["text", "markdown"]).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ base, format }) => {
      try {
        const ref = base ?? "HEAD";
        const at = async (r: string | undefined) => {
          const rev = await loadRevision(options.model ?? ".", { cwd, ref: r });
          if (!rev) throw new Error("No ArchDoc model here. Expected .archdoc/archdoc.yaml.");
          return rev.model;
        };
        const [before, after] = await Promise.all([at(ref), at(undefined)]);
        return text(
          formatDiff(diffModels(before, after), format ?? "text", `${ref} → working tree`),
        );
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "archdoc_propose",
    {
      title: "Propose model additions",
      description:
        "Add elements and relationships to the model as suggestions, marked provenance: suggested, for a person to accept or reject in review. Use it when your change adds a component or a dependency the model doesn't declare. It only adds: it never changes or removes what's there, never edits other repos' namespaces, and writes nothing if the result wouldn't validate. Writes a note with your rationale to .archdoc/proposals/.",
      inputSchema: {
        edits: z
          .array(
            z.discriminatedUnion("op", [
              z.object({
                op: z.literal("add-relationship"),
                from: z.string().describe("Element or actor that uses the target"),
                to: z.string().describe("Element it uses"),
                description: z.string().describe("What the relationship is for"),
                technology: z.string().optional(),
              }),
              z.object({
                op: z.literal("add-element"),
                id: z.string().describe("Key of the new element, such as search"),
                parent: z
                  .string()
                  .optional()
                  .describe("Element to put it inside; omit for top level"),
                kind: z.enum([
                  "system",
                  "container",
                  "component",
                  "datastore",
                  "queue",
                  "external",
                ]),
                description: z.string(),
                technology: z.string().optional(),
                code: z.array(z.string()).optional().describe("Code paths (globs) for the element"),
              }),
            ]),
          )
          .min(1),
        rationale: z.string().describe("Why the model should change; goes into the proposal note"),
        by: z.string().optional().describe("Who proposes, such as agent:claude-code"),
        dryRun: z.boolean().optional().describe("Check the proposal without writing anything"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ edits, rationale, by, dryRun }) => {
      try {
        const r = await propose({
          model: options.model,
          cwd,
          edits,
          rationale,
          by: by ?? "agent:unknown",
          dryRun,
        });
        if (!r.ok) return error(["Nothing was written.", ...r.errors].join("\n"));
        const lines = [
          dryRun
            ? "Dry run: nothing was written. These edits would apply:"
            : "Proposed, as suggestions for review:",
          ...r.applied.map((a) => `  ${a}`),
        ];
        if (!dryRun) {
          lines.push("", `Changed: ${r.changes.map((c) => c.path).join(", ")}`);
          if (r.note) lines.push(`Note: ${r.note}`);
          lines.push(
            "",
            "Mention these suggestions in your PR description; a person accepts or rejects them.",
          );
        }
        return text(lines.join("\n"));
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "archdoc_anchor",
    {
      title: "Where an error belongs",
      description:
        "Map an error (a log line, a stack trace, or wrong output) onto the model: the elements its stack frames and paths point at, the journey steps it most likely showed up in (best first, with why), and a trace to start from. Call it first when you're asked to explain or fix a bug.",
      inputSchema: {
        text: z
          .string()
          .min(1)
          .describe("The error, log lines, or stack trace, as the user gave it"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Journey steps to list (default 5)"),
      },
      annotations: READ_ONLY,
    },
    async ({ text: errorText, limit }) => {
      const model = await loadModel(options.model ?? ".", { cwd });
      if (model.diagnostics.some((d) => d.code === "model/not-found")) {
        return error(model.diagnostics[0]?.message ?? "No ArchDoc model found.");
      }
      const files = await listRepoFiles(model.baseDir);
      const result = anchorError(model, errorText, { files, root: model.baseDir, limit });
      return text(formatAnchors(result, traceSkeleton(result, errorText)));
    },
  );

  server.registerTool(
    "archdoc_trace_check",
    {
      title: "Check a trace",
      description:
        "Check a trace (the path a failing request took, in .archdoc/traces/<id>.yaml) against the model and the code: its elements, the journey step it expands, code references, and hops the model doesn't declare. Returns the findings and the trace resolved against the model. Pass the YAML you're writing, a path, or nothing to check every trace.",
      inputSchema: {
        trace: z.string().optional().describe("A trace's YAML, to check before you save it"),
        path: z
          .string()
          .optional()
          .describe("A trace file, relative to the repository root or absolute"),
      },
      annotations: READ_ONLY,
    },
    async ({ trace, path }) => {
      try {
        const model = await loadModel(options.model ?? ".", { cwd });
        if (model.diagnostics.some((d) => d.code === "model/not-found")) {
          return error(model.diagnostics[0]?.message ?? "No ArchDoc model found.");
        }
        const sources =
          trace !== undefined
            ? [{ path: "trace.yaml", text: trace }]
            : path
              ? [
                  {
                    path: repoPath(model, path),
                    text: readFileSync(resolve(model.baseDir, repoPath(model, path)), "utf8"),
                  },
                ]
              : await readTraceSources(options.model ?? ".", { cwd });
        const { traces, diagnostics } = loadTraces(sources);
        const files = await listRepoFiles(model.baseDir);
        const inRepo = new Set(files);
        const checks = traces.map((t) =>
          checkTrace(model, t, {
            files,
            read: (p) => (inRepo.has(p) ? readRepoFile(model.baseDir, p) : undefined),
          }),
        );
        const out = [formatTraceChecks(checks, diagnostics)];
        if (trace !== undefined || path) for (const c of checks) out.push("", formatTrace(c.view));
        return text(out.join("\n"));
      } catch (err) {
        return error(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "archdoc_validate",
    {
      title: "Validate the model",
      description:
        "Check the model in .archdoc/: schema, references, and journey steps. Each problem has a file and line. Call this after editing the model.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      const model = await loadModel(options.model ?? ".", { cwd });
      return text(formatDiagnostics(model));
    },
  );

  return server;
}

/** A file in the repository, or undefined when there's none (or it's outside it). */
function readRepoFile(baseDir: string, path: string): string | undefined {
  const absolute = resolve(baseDir, path);
  if (relative(baseDir, absolute).startsWith("..")) return undefined;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return undefined;
  }
}

function notFound(model: LoadedModel, id: string, what: string): string {
  const r = resolveRef(model, id);
  if (r.status === "ambiguous") return `"${id}" is ambiguous: ${r.candidates.join(", ")}.`;
  return `No ${what} "${id}".${r.status === "unresolved" && r.hint ? ` ${r.hint}` : ""}`;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

function error(t: string) {
  return { content: [{ type: "text" as const, text: t }], isError: true };
}
