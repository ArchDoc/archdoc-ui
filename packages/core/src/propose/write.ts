import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { loadModel, readModelSources } from "../load/fs.js";
import { type ProposalEdit, type ProposalPlan, planProposal } from "./propose.js";

export interface ProposeOptions {
  /** Repository, .archdoc directory, or model file. */
  model?: string;
  cwd: string;
  edits: ProposalEdit[];
  /** Why: written to the proposal note. */
  rationale: string;
  /** Who proposes, such as agent:claude-code. */
  by: string;
  /** Plan only; write nothing. */
  dryRun?: boolean;
}

export interface ProposeResult extends ProposalPlan {
  /** The proposal note that was written, relative to cwd. */
  note?: string | undefined;
}

/**
 * Applies a proposal: writes the suggested additions into the model files and
 * a note to .archdoc/proposals/. Writes nothing if any edit is refused or the
 * result doesn't validate.
 */
export async function propose(options: ProposeOptions): Promise<ProposeResult> {
  const { cwd } = options;
  const read = await readModelSources(options.model ?? ".", { cwd });
  if (!read) return { ok: false, changes: [], applied: [], errors: ["No ArchDoc model found."] };
  const model = await loadModel(options.model ?? ".", { cwd });
  const plan = planProposal(model, read.sources, read.root, options.edits, options.by);
  if (!plan.ok || options.dryRun) return plan;

  for (const c of plan.changes) await writeFile(resolve(cwd, c.path), c.after);

  const dir =
    read.source.endsWith(".yaml") || read.source.endsWith(".yml")
      ? dirname(read.source)
      : read.source;
  const date = new Date().toISOString().slice(0, 10);
  const slug = (plan.applied[0] ?? "proposal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const note = join(dir, "proposals", `${date}-${slug}.md`);
  await mkdir(dirname(note), { recursive: true });
  await writeFile(
    note,
    [
      `# Proposal: ${plan.applied[0]?.replace(/\.$/, "") ?? "model changes"}`,
      "",
      `Proposed by ${options.by} on ${date}. The additions are marked \`provenance: { source: suggested }\` until a person accepts them (by removing the provenance block) or rejects them (by deleting them).`,
      "",
      "## Why",
      "",
      options.rationale.trim(),
      "",
      "## Changes",
      "",
      ...plan.applied.map((a) => `- ${a}`),
      "",
    ].join("\n"),
  );
  return { ...plan, note: relative(cwd, note) };
}
