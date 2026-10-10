import { isAbsolute, relative, resolve } from "node:path";
import { checkRepository } from "@archdoc/analyzers";
import {
  diffModels,
  formatActor,
  formatDiagnostics,
  formatDiff,
  formatElement,
  formatFindings,
  formatImpact,
  formatJourney,
  formatLocate,
  formatOverview,
  formatSearch,
  impact,
  type LoadedModel,
  loadModel,
  loadModelAtRef,
  locate,
  propose,
  resolveRef,
  search,
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
1. Call archdoc_search with a few words for the area you're changing (for example "cli command"). It returns the elements involved and their code paths, so you know where to look.
2. Call archdoc_impact on the element or the files you plan to change. It returns what depends on them, which actors and journeys the change affects (most important first), owners, and rules.
3. Name the affected journeys and actors when you share your plan. Ask the user before changing a critical journey.

archdoc_locate tells you which element owns a file.

After you edit, call archdoc_check with base "main" (or the branch you started from). It lists what your change introduced: imports the model doesn't declare, broken rules, broken journeys. If a new dependency or component is intended, call archdoc_propose to add it to the model as a suggestion for a person to review; otherwise remove it. Use archdoc_diff to describe your model changes in the PR.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** An MCP server exposing ArchDoc's read-only queries. Reloads the model on every call. */
export function createArchdocServer(options: ArchdocServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const server = new McpServer(
    { name: "archdoc", version: options.version ?? "0.0.0" },
    { instructions: INSTRUCTIONS },
  );

  const withModel = async (fn: (model: LoadedModel) => string) => {
    const model = await loadModel(options.model ?? ".", { cwd });
    if (model.diagnostics.some((d) => d.code === "model/not-found")) {
      return error(model.diagnostics[0]?.message ?? "No ArchDoc model found.");
    }
    const errors = model.diagnostics.filter((d) => d.severity === "error").length;
    const note = errors
      ? `\n\nNote: the model has ${errors} error(s), so this may be incomplete. Call archdoc_validate for details.`
      : "";
    try {
      return text(fn(model) + note);
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
    ({ query }) => withModel((m) => formatSearch(query, search(m, query, 8))),
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
        const [before, after] = await Promise.all([
          loadModelAtRef(options.model ?? ".", ref, { cwd }),
          loadModel(options.model ?? ".", { cwd }),
        ]);
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
