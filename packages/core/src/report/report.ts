import type { Located } from "../codemap/codemap.js";
import { isSnippet, snippetLabel } from "../codemap/snippet.js";
import { dataFlows, dataStores, stepMessage } from "../data/flows.js";
import type { FieldId, Lineage } from "../data/lineage.js";
import { parseStates, qualifyData, resolveData } from "../data/resolve.js";
import type { Simulation } from "../data/simulate.js";
import { formatDiagnostic } from "../diagnostics.js";
import { consumersElsewhere, otherModels } from "../federation/consumers.js";
import { contractName } from "../load/build.js";
import type { ElementNode, JourneyNode, Model, Relationship, Target } from "../model.js";
import type { Impact } from "../query/impact.js";
import { getActor, getElement, overview } from "../query/index.js";
import type { SearchHit } from "../query/search.js";

// Plain-text reports shared by the CLI and the MCP server, so a person in a
// terminal and an agent over MCP read the same answer in the same words.

export function formatLocate(model: Model, results: Located[]): string {
  return results
    .map((r) => {
      if (!r.element) return `${r.path}\n  not mapped to any element`;
      const lines = [`${r.path}\n  → ${label(r.element)}  (matched ${r.pattern})`];
      const chain = ancestry(model, r.element);
      if (chain.length > 1) lines.push(`  in: ${chain.map((e) => e.key).join(" › ")}`);
      const owners = ownersOf(model, r.element);
      if (owners.length) lines.push(`  owners: ${owners.join(", ")}`);
      if (r.ties.length)
        lines.push(`  also matches equally: ${r.ties.map((t) => t.id).join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function formatImpact(model: Model, i: Impact): string {
  const out: string[] = [];
  const subject = i.element ? label(i.element) : targetLabel(model, i.target);
  out.push(`Impact of ${i.path ? `${i.path} (${subject})` : subject}`);
  if (i.owners.length) out.push(`Owners: ${i.owners.join(", ")}`);
  if (i.code.length) out.push(`Code: ${i.code.join(", ")}`);

  out.push("", `Journeys affected (${i.journeys.length})`);
  if (i.journeys.length === 0) out.push("  none");
  for (const j of i.journeys) {
    const status =
      j.journey.spec.status && j.journey.spec.status !== "active"
        ? `, ${j.journey.spec.status}`
        : "";
    const steps = j.steps.length ? ` · steps ${j.steps.join(", ")}` : "";
    out.push(
      `  ${j.journey.id} (${j.journey.spec.importance ?? "normal"}${status}) · actor ${j.journey.spec.actor}${steps}`,
      `    ${j.journey.spec.goal}`,
    );
  }

  out.push("", `Actors affected (${i.actors.length})`);
  if (i.actors.length === 0) out.push("  none");
  for (const a of i.actors) out.push(`  ${a.id} (${a.kind}) · ${a.via}`);

  const direct = i.consumers.filter((c) => c.depth === 1 && !c.viaParent);
  const viaParent = i.consumers.filter((c) => c.viaParent);
  const indirect = i.consumers.filter((c) => c.depth > 1);
  out.push("", `Used by (${new Set(i.consumers.map((c) => c.relationship.from.id)).size})`);
  if (i.consumers.length === 0) out.push("  nothing in this model");
  if (direct.length)
    out.push(
      `  directly: ${rels(
        direct.map((c) => c.relationship),
        "from",
      )}`,
    );
  if (viaParent.length) {
    out.push(
      `  through a parent (may be affected): ${rels(
        viaParent.map((c) => c.relationship),
        "from",
      )}`,
    );
  }
  if (indirect.length) {
    out.push(
      `  indirectly: ${[...new Set(indirect.map((c) => c.relationship.from.id))].join(", ")}`,
    );
  }

  const { consumers: remote, journeys: remoteJourneys } = i.elsewhere;
  if (remote.length || remoteJourneys.length) {
    out.push("", `Used from other repos (${new Set(remote.map((c) => c.from)).size})`);
    if (remote.length === 0) out.push("  no relationships");
    const reach = {
      direct: "",
      parent: " (through a parent; may be affected)",
      indirect: " (through something here that uses it)",
    };
    for (const c of remote) {
      const r = c.relationship;
      out.push(
        `  ${c.from} (${c.namespace}${c.version ? `@${c.version}` : ""}) uses ${model.namespace}.${c.target}${r.via ? ` via ${r.via}` : ""}${r.description ? `: ${r.description}` : ""}${reach[c.reach]}`,
      );
    }
    out.push("", `Journeys in other repos (${remoteJourneys.length})`);
    if (remoteJourneys.length === 0) out.push("  none");
    for (const j of remoteJourneys) {
      out.push(
        `  ${j.namespace}.${j.journey.id} (${j.journey.spec.importance ?? "normal"}) · actor ${j.journey.spec.actor} · steps ${j.steps.join(", ")}`,
        `    ${j.journey.spec.goal}`,
      );
    }
  }

  if (i.dependencies.length) out.push("", `Depends on: ${rels(i.dependencies, "to")}`);
  if (i.rules.length) {
    out.push("", "Rules that mention it");
    for (const r of i.rules) out.push(`  ${r.id}${r.description ? ` · ${r.description}` : ""}`);
  }
  return out.join("\n");
}

export function formatElement(model: Model, ref: string): string | undefined {
  const v = getElement(model, ref);
  if (!v) {
    // An element in another repo, from the landscape or an import.
    const dot = ref.indexOf(".");
    const dep = dot > 0 ? otherModels(model).get(ref.slice(0, dot)) : undefined;
    const there = dep && formatElement(dep.model, ref.slice(dot + 1));
    if (!dep || !there) return undefined;
    const [first, ...rest] = there.split("\n");
    return [
      `${dep.namespace}.${first} · in ${dep.namespace}@${dep.version ?? dep.commit?.slice(0, 7) ?? "?"}, another repo`,
      ...rest,
    ].join("\n");
  }
  const e = v.element;
  const out = [label(e)];
  if (e.spec.status && e.spec.status !== "active") out.push(`Status: ${e.spec.status}`);
  if (e.spec.technology) out.push(`Technology: ${e.spec.technology}`);
  if (e.spec.description) out.push(e.spec.description);
  if (e.spec.documentation) out.push(e.spec.documentation);
  if (v.ancestors.length) out.push(`Inside: ${v.ancestors.map((a) => a.id).join(" › ")}`);
  if (v.children.length)
    out.push(`Contains: ${v.children.map((c) => `${c.key} (${c.spec.kind})`).join(", ")}`);
  if (v.owners.length) out.push(`Owners: ${v.owners.join(", ")}`);
  if (e.code.length) {
    // Whole paths on one line; snippets, and paths with a description, one each.
    const plain = e.code.filter((c) => !isSnippet(c) && !c.description);
    if (plain.length) out.push(`Code: ${plain.map((c) => c.path).join(", ")}`);
    for (const c of e.code.filter((c) => isSnippet(c) || c.description)) {
      out.push(`Code: ${snippetLabel(c)}${c.description ? ` · ${c.description}` : ""}`);
    }
  }
  if (v.uses.length) out.push(`Uses: ${rels(v.uses, "to")}`);
  if (e.spec.provides?.length) {
    out.push(
      `Provides: ${e.spec.provides
        .map(
          (p) =>
            `${contractName(p)} (${"api" in p ? "api" : "topic" in p ? "topic" : "event"}${p.status === "deprecated" ? ", deprecated" : ""})`,
        )
        .join(", ")}`,
    );
  }
  if (v.usedBy.length) out.push(`Used by: ${rels(v.usedBy, "from")}`);
  const parts = [...model.elements.keys()].filter((id) => id.startsWith(`${e.id}.`));
  const remote = consumersElsewhere(model, new Set([e.id, ...parts])).consumers;
  if (remote.length)
    out.push(`Used from other repos: ${[...new Set(remote.map((c) => c.from))].join(", ")}`);
  if (v.journeys.length) out.push(`Journeys: ${v.journeys.map((j) => j.id).join(", ")}`);
  return out.join("\n");
}

/**
 * A data entry: its fields and classifications, its lifecycle, where it's
 * stored, and where this model sends it. Entries in synced imports show too.
 */
export function formatData(model: Model, ref: string): string | undefined {
  const r = resolveData(model, ref);
  if (r.status !== "found") return undefined;
  const d = r.node;
  const where = r.local
    ? ""
    : ` · in ${r.namespace}@${model.imported?.get(r.namespace)?.version ?? "?"}, another repo`;
  const out = [`${r.local ? d.id : r.ref} (${d.spec.kind})${where}`];
  if (d.spec.status && d.spec.status !== "active") out.push(`Status: ${d.spec.status}`);
  if (d.spec.description) out.push(d.spec.description);
  if (d.spec.owners?.length) out.push(`Owners: ${d.spec.owners.join(", ")}`);
  if (d.spec.source) {
    out.push(
      `Source: ${Object.entries(d.spec.source)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
    );
  }
  const fields = Object.entries(d.spec.fields ?? {});
  if (fields.length) {
    out.push("Fields:");
    for (const [name, f] of fields) {
      const values = f.values ? ` (${f.values.join(", ")})` : "";
      const extra = [f.classification, f.required ? "required" : undefined, f.status]
        .filter((x) => x && x !== "active")
        .join(", ");
      out.push(`  ${name}${f.type ? `: ${f.type}` : ""}${values}${extra ? ` · ${extra}` : ""}`);
    }
  }
  const life = parseStates(d.spec.states ?? []);
  if (life.states.size) {
    out.push(
      `States: ${[...life.next].map(([a, b]) => `${a} → ${[...b].join(" | ")}`).join("; ")}`,
    );
  }
  const same = (data: string) => qualifyData(data, model.namespace) === r.ref;
  const stored = dataStores(model).filter((s) => same(s.data));
  if (stored.length)
    out.push(`Stored in: ${stored.map((s) => `${s.element} (${s.table})`).join(", ")}`);
  const flows = dataFlows(model).filter((f) => same(f.data));
  if (flows.length) {
    out.push("Sent:");
    const name = (t: Target) => (t.type === "external" ? t.ref : t.id);
    for (const f of flows) {
      const how =
        f.how === "step"
          ? `journey ${f.journey}, step ${f.step}`
          : f.how === "sends"
            ? "sends"
            : `${f.how} through ${f.via}`;
      out.push(`  ${name(f.from)} → ${name(f.to)} (${how})`);
    }
  }
  return out.join("\n");
}

export function formatActor(model: Model, ref: string): string | undefined {
  const v = getActor(model, ref);
  if (!v) return undefined;
  const a = v.actor;
  const out = [`${a.id} (${a.spec.kind})`];
  if (a.spec.description) out.push(a.spec.description);
  if (a.spec.members?.length) out.push(`Members: ${a.spec.members.join(", ")}`);
  if (v.uses.length) out.push(`Uses: ${rels(v.uses, "to")}`);
  if (v.owns.length) out.push(`Owns: ${v.owns.map((e) => e.id).join(", ")}`);
  if (v.journeys.length) {
    out.push(`Journeys: ${v.journeys.map((j) => `${j.journey.id} (${j.role})`).join(", ")}`);
  }
  return out.join("\n");
}

/** Where a step's message comes from, when the step doesn't say. */
const MESSAGE_FROM: Record<string, string> = {
  sends: "from the relationship",
  accepts: "the API accepts it",
  returns: "the API returns it",
  carries: "the topic carries it",
  writes: "what it writes",
};

export function formatJourney(model: Model, journey: JourneyNode): string {
  const s = journey.spec;
  const out = [
    `${journey.id}: ${s.goal}`,
    `Actor: ${s.actor} · importance: ${s.importance ?? "normal"}${s.status && s.status !== "active" ? ` · ${s.status}` : ""}`,
  ];
  if (s.description) out.push(s.description);
  const flows = dataFlows(model);
  for (const step of journey.steps) {
    const from = step.from ? targetLabel(model, step.from, false) : step.spec.from;
    const to = step.to ? targetLabel(model, step.to, false) : step.spec.to;
    out.push(
      `  ${step.index + 1}. ${from} → ${to}${step.spec.action ? `: ${step.spec.action}` : ""}`,
    );
    const message = stepMessage(model, step, flows);
    out.push(
      message
        ? `     sends: ${message.data.join(", ")}${message.how === "step" ? "" : ` (${MESSAGE_FROM[message.how]})`}`
        : "     sends: nothing the model says",
    );
    if (step.spec.code) out.push(`     code: ${step.spec.code}`);
  }
  return out.join("\n");
}

export function formatOverview(model: Model, maxDepth = 1): string {
  const o = overview(model, maxDepth);
  const out = [
    `${o.name ?? o.namespace} (namespace ${o.namespace}): ${o.counts.actors} actors, ${o.counts.elements} elements, ${o.counts.relationships} relationships, ${o.counts.journeys} journeys`,
  ];
  if (model.description) out.push(model.description.trim());
  out.push("", "Actors");
  for (const a of o.actors)
    out.push(`  ${a.id} (${a.kind})${a.description ? `: ${a.description}` : ""}`);
  out.push("", `Elements (to depth ${maxDepth})`);
  for (const e of o.elements) {
    const el = model.elements.get(e.id);
    const status = el?.spec.status && el.spec.status !== "active" ? ` [${el.spec.status}]` : "";
    out.push(
      `  ${"  ".repeat(e.depth)}${e.id} (${e.kind})${status}${e.description ? `: ${e.description}` : ""}`,
    );
  }
  out.push("", "Journeys");
  for (const j of o.journeys) out.push(`  ${j.id} (${j.importance}) · ${j.actor}: ${j.goal}`);
  return out.join("\n");
}

export function formatSearch(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return `Nothing in the model matches "${query}". Try other words, or call archdoc_overview.`;
  }
  const out = [`Matches for "${query}", best first:`];
  for (const h of hits) {
    out.push(
      `  ${h.id} (${h.type === "element" ? h.kind : `${h.type}, ${h.kind}`})${h.description ? `: ${h.description}` : ""}`,
    );
    if (h.code.length) out.push(`    code: ${h.code.join(", ")}`);
  }
  out.push(
    "",
    "Next: check the impact of the element or the files you plan to change (archdoc_impact, or archdoc impact).",
  );
  return out.join("\n");
}

export function formatDiagnostics(model: Model): string {
  const errors = model.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = model.diagnostics.filter((d) => d.severity === "warning").length;
  if (model.diagnostics.length === 0) return "The model is valid.";
  return [
    `${errors} error(s), ${warnings} warning(s):`,
    ...model.diagnostics.map((d) => `  ${formatDiagnostic(d)}`),
  ].join("\n");
}

/** Plain JSON for --json output and MCP structured content. */
export function impactToJSON(i: Impact) {
  return {
    target: i.target,
    path: i.path,
    element: i.element?.id,
    owners: i.owners,
    code: i.code,
    journeys: i.journeys.map((j) => ({
      id: j.journey.id,
      goal: j.journey.spec.goal,
      actor: j.journey.spec.actor,
      importance: j.journey.spec.importance ?? "normal",
      status: j.journey.spec.status ?? "active",
      steps: j.steps,
    })),
    actors: i.actors,
    consumers: i.consumers.map((c) => ({
      from: c.relationship.from,
      to: c.relationship.to,
      description: c.relationship.description,
      depth: c.depth,
      viaParent: c.viaParent,
    })),
    dependencies: i.dependencies.map((r) => ({ to: r.to, description: r.description })),
    rules: i.rules.map((r) => ({ id: r.id, description: r.description })),
  };
}

export function locatedToJSON(model: Model, r: Located) {
  return {
    path: r.path,
    element: r.element?.id,
    kind: r.element?.spec.kind,
    pattern: r.pattern,
    owners: r.element ? ownersOf(model, r.element) : [],
    ties: r.ties.map((t) => t.id),
  };
}

function label(e: ElementNode): string {
  return `${e.id} (${e.spec.kind}${e.spec.name ? `, "${e.spec.name}"` : ""})`;
}

function targetLabel(model: Model, t: Target, withKind = true): string {
  if (t.type === "external") return `${t.ref}${withKind ? " (in another repo)" : ""}`;
  if (t.type === "actor") {
    return withKind ? `${t.id} (actor, ${model.actors.get(t.id)?.spec.kind ?? "?"})` : t.id;
  }
  const e = model.elements.get(t.id);
  return withKind && e ? label(e) : t.id;
}

function rels(list: Relationship[], side: "from" | "to"): string {
  return list
    .map((r) => {
      const t = side === "from" ? r.from : r.to;
      const name = t.type === "external" ? t.ref : t.id;
      return r.status === "planned" ? `${name} (planned)` : name;
    })
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");
}

function ancestry(model: Model, e: ElementNode): ElementNode[] {
  const chain = [e];
  for (let p = e.parentId; p; p = model.elements.get(p)?.parentId) {
    const parent = model.elements.get(p);
    if (parent) chain.unshift(parent);
  }
  return chain;
}

function ownersOf(model: Model, e: ElementNode): string[] {
  return [...new Set(ancestry(model, e).flatMap((x) => x.spec.owners ?? []))];
}

/** Field lineage as text: where a value comes from and where it goes, with the tables it lands in. */
export function formatLineage(l: Lineage): string {
  const key = (f: FieldId) => `${f.entry}.${f.field}`;
  const label = (f: FieldId) => {
    const c = l.classifications.get(key(f));
    return `${key(f)}${c ? ` (${c})` : ""}`;
  };
  const tables = (entry: string) => {
    const t = l.stored.get(entry) ?? [];
    return t.length
      ? ` · stored in ${t.map((s) => `${s.namespace}.${s.element} (${s.table})`).join(", ")}`
      : "";
  };
  const out = [label(l.field) + tables(l.field.entry)];
  out.push("", "Comes from:");
  if (!l.upstream.length) out.push("  nothing a mapping declares");
  for (const e of l.upstream) {
    out.push(
      `  ${label(e.to)} = ${e.expression}  (${e.mapping}${e.copy ? ", copied" : ""})`,
      `    reads ${e.from.map(label).join(", ") || "no input fields"}`,
    );
  }
  out.push("", "Goes to:");
  if (!l.downstream.length) out.push("  nothing a mapping declares");
  for (const e of l.downstream) {
    const table = e.table
      ? ` · written to ${e.table.namespace}.${e.table.element} (${e.table.table})`
      : tables(e.to.entry);
    out.push(
      `  ${label(e.to)} = ${e.expression}  (${e.mapping}${e.copy ? ", copied" : ""})${table}`,
    );
  }
  return out.join("\n");
}

/** A simulation as text: the path, each decision and why, and the records at each step. */
export function formatSimulation(s: Simulation): string {
  const value = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const out = [
    `Journey ${s.journey}${s.outcomes.length ? ` · decided: ${s.outcomes.join(", ")}` : ""}`,
  ];
  for (const step of s.steps) {
    out.push(`  ${step.step}. ${step.from} → ${step.to}${step.action ? `: ${step.action}` : ""}`);
    if (!step.ran) {
      out.push(`     skipped: ${step.skipped}`);
      continue;
    }
    const d = step.decision;
    if (d) {
      out.push(
        d.outcome
          ? `     decides ${d.logic} → ${d.outcome} (${d.rule === "else" ? "else" : `rule ${d.rule}: ${d.when}`})`
          : `     decides ${d.logic} → no outcome`,
      );
    }
    for (const e of step.events) {
      const where = e.tables.length
        ? ` → ${e.tables.map((t) => `${t.namespace}.${t.element} (${t.table})`).join(", ")}`
        : "";
      if (e.kind === "sent") {
        out.push(`     sends ${e.entry}`);
      } else if (e.kind === "created") {
        const fields = Object.entries(e.record)
          .map(([k, v]) => `${k}: ${value(v)}`)
          .join(", ");
        out.push(`     + creates ${e.entry} { ${fields} }${e.via ? ` via ${e.via}` : ""}${where}`);
      } else {
        for (const f of e.fields) {
          out.push(
            `     ~ changes ${e.entry}.${f.field}: ${value(f.from)} → ${value(f.to)}${where}`,
          );
        }
      }
    }
    if (step.next) out.push(`     continues as journey ${step.next}`);
    for (const p of step.problems) out.push(`     ! ${p}`);
  }
  return out.join("\n");
}
