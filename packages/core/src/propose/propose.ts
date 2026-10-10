import type { ElementKind } from "@archdoc/spec";
import { formatDiagnostic } from "../diagnostics.js";
import { buildModel, type ModelSource } from "../load/build.js";
import { Resolver } from "../load/resolve.js";
import type { Model } from "../model.js";
import { nodeKey } from "../model.js";
import { insertIntoMap } from "./insert.js";

export type ProposalEdit =
  | {
      op: "add-element";
      /** Key of the new element, such as "search". */
      id: string;
      /** Element to put it inside. Omit for a top-level element. */
      parent?: string | undefined;
      kind: ElementKind;
      description?: string | undefined;
      technology?: string | undefined;
      code?: string[] | undefined;
    }
  | {
      op: "add-relationship";
      /** Element or actor that uses the target. */
      from: string;
      /** Element it uses (in this model, or in an imported namespace). */
      to: string;
      description?: string | undefined;
      technology?: string | undefined;
    };

export interface ProposalPlan {
  ok: boolean;
  /** Files to write, with their new text. */
  changes: { path: string; before: string; after: string }[];
  /** One line per edit that applied. */
  applied: string[];
  /** Why the proposal was refused. Nothing is written when there are errors. */
  errors: string[];
  /** The model as it would be after the proposal. */
  after?: Model | undefined;
}

/**
 * Plans additions to the model as suggestions. Every added element and
 * relationship carries `provenance: { source: suggested, by }`, so a person
 * accepts or rejects it in review. It never changes or removes what's there,
 * never edits another namespace, and refuses the whole proposal if the result
 * doesn't validate. Pure: it returns new file contents and writes nothing.
 */
export function planProposal(
  model: Model,
  sources: readonly ModelSource[],
  root: string,
  edits: readonly ProposalEdit[],
  by: string,
): ProposalPlan {
  const texts = new Map(sources.map((s) => [s.path, s.text]));
  const errors: string[] = [];
  const applied: string[] = [];
  const provenance = { source: "suggested", by };
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
  const newIds = new Set<string>();

  const edit = (file: string, path: (string | number)[], key: string, value: unknown) => {
    const text = texts.get(file);
    if (text === undefined) throw new Error(`Model file ${file} isn't loaded.`);
    texts.set(file, insertIntoMap(text, path, key, value));
  };

  for (const [i, e] of edits.entries()) {
    const label = `Edit ${i + 1} (${e.op})`;
    try {
      if (e.op === "add-element") {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(e.id))
          throw new Error(`"${e.id}" isn't a valid ID.`);
        let parentId: string | undefined;
        if (e.parent) {
          const r = resolver.element(e.parent);
          if (r.status === "external")
            throw new Error(`${e.parent} is in another repo; propose it there.`);
          if (r.status !== "resolved")
            throw new Error(`Parent "${e.parent}" isn't an element in this model.`);
          parentId = r.target.id;
        }
        const id = parentId ? `${parentId}.${e.id}` : e.id;
        if (model.elements.has(id) || newIds.has(id))
          throw new Error(`Element "${id}" already exists.`);
        const spec = clean({
          kind: e.kind,
          description: e.description,
          technology: e.technology,
          code: e.code?.length ? e.code : undefined,
          provenance,
        });
        if (parentId) {
          const where = yamlPathOf(model, parentId);
          edit(where.file, [...where.path, "elements"], e.id, spec);
        } else {
          const top = [...model.elements.values()].find((x) => x.depth === 0);
          edit(top?.location?.file ?? root, ["elements"], e.id, spec);
        }
        newIds.add(id);
        applied.push(`Added element ${id} (${e.kind})${parentId ? ` inside ${parentId}` : ""}.`);
      } else {
        const from = resolver.endpoint(e.from);
        if (from.status === "external")
          throw new Error(`${e.from} is in another repo; propose it there.`);
        const fromNew = newIds.has(e.from) ? { type: "element" as const, id: e.from } : undefined;
        if (from.status !== "resolved" && !fromNew)
          throw new Error(`"${e.from}" isn't an element or actor in this model.`);
        const source =
          from.status === "resolved" ? from.target : (fromNew as { type: "element"; id: string });
        const to = resolver.element(e.to);
        const toNew = [...newIds].find((n) => n === e.to || n.endsWith(`.${e.to}`));
        if (to.status === "ambiguous")
          throw new Error(`"${e.to}" is ambiguous: ${to.candidates.join(", ")}.`);
        if (to.status === "unresolved" && !toNew)
          throw new Error(`"${e.to}" isn't an element here or in an imported namespace.`);
        const toKey =
          to.status === "resolved"
            ? nodeKey(to.target)
            : to.status === "external"
              ? nodeKey(to.target)
              : `element:${toNew}`;
        const exists = model.relationships.some(
          (r) => nodeKey(r.from) === nodeKey(source) && nodeKey(r.to) === toKey,
        );
        if (exists)
          throw new Error(
            `${source.id} already uses ${e.to}. Existing relationships aren't changed.`,
          );
        const where =
          source.type === "actor" ? actorPathOf(model, source.id) : yamlPathOf(model, source.id);
        edit(
          where.file,
          [...where.path, "uses"],
          e.to,
          clean({ description: e.description, technology: e.technology, provenance }),
        );
        applied.push(`Added relationship ${source.id} → ${e.to}.`);
      }
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length) return { ok: false, changes: [], applied, errors };

  const after = buildModel(
    sources.map((s) => ({ path: s.path, text: texts.get(s.path) ?? s.text })),
    { root },
  );
  const before = new Set(
    model.diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic),
  );
  const introduced = after.diagnostics.filter(
    (d) => d.severity === "error" && !before.has(formatDiagnostic(d)),
  );
  if (introduced.length) {
    return {
      ok: false,
      changes: [],
      applied,
      errors: introduced.map((d) => `The model wouldn't validate: ${formatDiagnostic(d)}`),
      after,
    };
  }

  const changes = sources
    .filter((s) => texts.get(s.path) !== s.text)
    .map((s) => ({ path: s.path, before: s.text, after: texts.get(s.path) as string }));
  return { ok: true, changes, applied, errors: [], after };
}

/** File and YAML path where an element is defined: elements.a.elements.b… */
function yamlPathOf(model: Model, id: string): { file: string; path: string[] } {
  const el = model.elements.get(id);
  if (!el?.location) throw new Error(`Can't find where ${id} is defined.`);
  return { file: el.location.file, path: id.split(".").flatMap((k) => ["elements", k]) };
}

function actorPathOf(model: Model, id: string): { file: string; path: string[] } {
  const a = model.actors.get(id);
  if (!a?.location) throw new Error(`Can't find where actor ${id} is defined.`);
  return { file: a.location.file, path: ["actors", id] };
}

function clean<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
