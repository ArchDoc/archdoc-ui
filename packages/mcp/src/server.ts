import {
  type Answer,
  checkAnswer,
  contextAnswer,
  sealAnswer,
  showAnswer,
  type Where,
} from "@archdoc/analyzers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ArchdocServerOptions {
  /** Repository, .archdoc directory, or model file. */
  model?: string;
  /** Directory relative paths are resolved from. */
  cwd?: string;
  version?: string;
}

export const INSTRUCTIONS = `This repository's architecture is modeled in .archdoc/: actors, elements mapped to code, journeys, and data. People own it. Use it before you grep.

- archdoc_context: start every task here, with the task in words, the files you'll change, or an error. It says which files and functions to open, what else does the same job, the journeys, data, rules, tests, owners, and who uses it. Name the affected journeys in your plan; ask before changing a critical one.
- archdoc_show: one thing by ID (element, actor, journey, data entry, Entry.field, trace, or a fact like element:<id>).
- archdoc_check: after you edit, with base "main". It lists what your change broke or made stale, each with its fix, and facts whose code changed. Edit .archdoc/ to fix the model, with provenance: { source: suggested, by: agent:<name> } on what you add.
- archdoc_seal: once you've checked each changed fact against its code, seal it. Never seal a fact you haven't read.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** An MCP server with one tool per question an agent asks. Reloads the model on every call. */
export function createArchdocServer(options: ArchdocServerOptions = {}): McpServer {
  const where: Where = { model: options.model, cwd: options.cwd ?? process.cwd() };
  const server = new McpServer(
    { name: "archdoc", version: options.version ?? "0.0.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "archdoc_context",
    {
      title: "Where to start",
      description:
        "Before you grep: the files and functions to open first, other code that does the same job, data, rules, journeys (critical first), tests, owners, and who uses it, other repos included. Pass the task in words, the paths you'll change, or both; or an error (log, stack trace) for the journey steps it showed up in. Nothing: an overview.",
      inputSchema: {
        task: z.string().optional().describe('The task in a few words, such as "refund rounding"'),
        paths: z.array(z.string()).optional().describe("Files or directories you'll change"),
        error: z.string().optional().describe("An error, log lines, or a stack trace, as given"),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(contextAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_show",
    {
      title: "One thing in the model",
      description:
        "Everything about one ID: an element (code: true adds its snippets' text), actor, journey (sample runs it), data entry, Entry.field (its lineage), trace, or a fact archdoc_check names (element:<id>, step:<journey>#<n>).",
      inputSchema: {
        id: z
          .string()
          .describe("An ID, such as payments.charges, Refund.amount_cents, or step:refund#2"),
        code: z.boolean().optional().describe("For an element: include its code snippets"),
        sample: z
          .union([z.string(), z.record(z.string(), z.unknown())])
          .optional()
          .describe(
            'For a journey: records by data entry, such as { "RefundRequest": { "amount_cents": 400 } }, or a sample file',
          ),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(showAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_check",
    {
      title: "What's wrong or stale",
      description:
        'After you edit: model problems, imports the model doesn\'t declare, broken rules and journeys, stale paths, traces, and facts whose sealed code changed, each with its fix. With base (such as "main"): only what your change caused, plus the verdict the PR comment will give, journeys, and who to ask. format "markdown" returns that comment, for a PR description.',
      inputSchema: {
        base: z.string().optional().describe("Branch or commit to compare with, such as main"),
        all: z.boolean().optional().describe("List every finding, not only the change's"),
        format: z.enum(["text", "markdown"]).optional(),
      },
      annotations: READ_ONLY,
    },
    (input) => respond(checkAnswer(where, input)),
  );

  server.registerTool(
    "archdoc_seal",
    {
      title: "Seal facts you checked",
      description:
        "Record in archdoc.sum that the model still describes the code these facts point at, after you read them (and fixed the model where it didn't). An element ID seals all its facts. Without facts, seals only new ones. Writes archdoc.sum only. Returns what's still to check.",
      inputSchema: {
        facts: z.array(z.string()).optional().describe("Facts archdoc_check named, or element IDs"),
        by: z.string().optional().describe("Who checked, such as agent:claude-code"),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => respond(sealAnswer(where, { ...input, requireSum: true })),
  );

  return server;
}

async function respond(answer: Promise<Answer>) {
  try {
    const r = await answer;
    return { content: [{ type: "text" as const, text: r.text }], isError: !r.ok || undefined };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
}
