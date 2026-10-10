import { isAbsolute, relative, resolve } from "node:path";
import {
  formatActor,
  formatDiagnostics,
  formatElement,
  formatImpact,
  formatJourney,
  formatLocate,
  formatOverview,
  impact,
  type LoadedModel,
  loadModel,
  locate,
  resolveRef,
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

export const INSTRUCTIONS = `ArchDoc holds a human-owned architecture model of this repository: who uses the system (actors), what it's made of (elements, mapped to code paths), and how people use it (journeys).

Before you edit code:
1. Call archdoc_locate with the files you plan to change, to learn which part of the architecture they belong to.
2. Call archdoc_impact on those files (or their elements) to learn who depends on them, which actors and journeys a change affects, who owns them, and which rules apply.
Mention the affected journeys and actors when you describe your change.

After you edit: if you added, removed, or moved a component, or added a dependency between components, update the model in .archdoc/ and call archdoc_validate.`;

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
    "archdoc_locate",
    {
      title: "Locate files in the architecture",
      description:
        "Which element owns each file: its place in the hierarchy and its owners. Call this before editing. Files don't need to exist yet.",
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
        "The blast radius of changing an element, actor, or file: what uses it (directly and indirectly), which actors and journeys are affected (most important first), what it depends on, owners, and rules that mention it. Call this before editing.",
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
        "Everything about one element: description, technology, parents and children, owners, code paths, what it uses, what uses it (including actors), and journeys through it.",
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
