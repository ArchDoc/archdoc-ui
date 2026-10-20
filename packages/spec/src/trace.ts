import { z } from "zod";
import {
  CodeRefSchema,
  IdSchema,
  JourneyStepSchema,
  ProvenanceSchema,
  RefSchema,
} from "./schema.js";

/** Where trace files live, inside the model directory. They're never part of the model. */
export const TRACES_DIR = "traces";

/** What a step did in the failing run. */
export const TraceRoleSchema = z
  .enum(["ok", "cause", "spreads", "symptom"])
  .describe(
    "ok: worked as designed (the default). cause: where it went wrong. spreads: carries the wrong value on. symptom: where the error shows.",
  );

/** How the trace's author knows a step happened as written. */
export const TraceEvidenceSchema = z
  .enum(["reproduced", "read", "inferred"])
  .describe(
    "reproduced: seen in a run (a log, a test, a debugger). read: followed in the code. inferred: reasoned from the model or the symptom (the default).",
  );

/**
 * A code reference in a trace: `path`, `path:line`, `path:40-88`, or the
 * object form model files use ({ path, lines, symbol }).
 */
export const TraceCodeSchema = z
  .union([CodeRefSchema, z.array(CodeRefSchema)])
  .describe(
    "The code this happens in: path, path:line, path:40-88, or { path, lines, symbol }, relative to the repo root",
  );

/** A call that should have happened in a step and didn't. */
export const MissingHopSchema = z
  .strictObject({
    from: RefSchema.optional().describe("Who should have made it. Defaults to the step's from."),
    to: RefSchema.describe("The element it should have gone to"),
    call: z.string().optional().describe("The function or endpoint, such as applySchemas"),
    description: z.string().optional(),
  })
  .describe("A call that should have happened and didn't");

const Values = z
  .record(z.string(), z.unknown())
  .describe("Values by name, such as { Charge.id.type: undefined }");

/** One hop of the failing run, in journey step syntax plus what went wrong. */
export const TraceStepSchema = JourneyStepSchema.extend({
  code: TraceCodeSchema.optional(),
  role: TraceRoleSchema.optional(),
  evidence: TraceEvidenceSchema.optional(),
  observed: Values.optional().describe("What the run had at this step"),
  expected: Values.optional().describe("What it should have had"),
  missing: MissingHopSchema.optional(),
});

/** Where the same job is done right, to compare with. */
export const WorksInSchema = z
  .strictObject({
    element: RefSchema.describe("The element that does it right"),
    code: TraceCodeSchema.optional(),
    note: z.string().optional(),
  })
  .describe("Where the same job is done right, for comparison");

/**
 * A trace: the path one failing request actually took, as evidence for a bug,
 * attached to the journey step where the error showed up. It's never loaded
 * into the model: the journey is the design, the trace is one run.
 */
export const TraceFileSchema = z.strictObject({
  $schema: z.string().optional(),
  archdoc: z
    .string()
    .regex(/^2(\.\d+)?$/)
    .optional(),
  trace: IdSchema.describe("The trace's ID, usually its file name"),
  title: z.string().min(1).describe("The bug in one line, as a user would say it"),
  symptom: z.string().min(1).describe("What the user saw: the log line, error, or wrong output"),
  reproduce: z.string().optional().describe("How to see it again: a command, a request, a test"),
  expands: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*#[1-9]\d*$/,
      "Write the journey step as <journey>#<step>, such as book-a-ride#2 or payments.month-end#1",
    )
    .optional()
    .describe(
      "The journey step this run opens up, as <journey>#<step> (1-based). A journey in another repo is named by namespace, such as payments.month-end#2.",
    ),
  diagnosis: z.string().optional().describe("Why it happens, in a sentence or two"),
  actor: RefSchema.optional().describe("For a trace no journey covers: whose request it was"),
  goal: z.string().optional().describe("For a trace no journey covers: what they were doing"),
  steps: z.array(TraceStepSchema).min(1),
  "works-in": WorksInSchema.optional(),
  fix: z.string().optional().describe("What fixes it"),
  tags: z.array(z.string()).optional(),
  provenance: ProvenanceSchema.optional(),
});

export type TraceRole = z.infer<typeof TraceRoleSchema>;
export type TraceEvidence = z.infer<typeof TraceEvidenceSchema>;
export type TraceCodeSpec = z.infer<typeof TraceCodeSchema>;
export type MissingHopSpec = z.infer<typeof MissingHopSchema>;
export type TraceStepSpec = z.infer<typeof TraceStepSchema>;
export type WorksInSpec = z.infer<typeof WorksInSchema>;
export type TraceFile = z.infer<typeof TraceFileSchema>;
