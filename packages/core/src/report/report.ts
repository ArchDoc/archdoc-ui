import type { Located } from "../codemap/codemap.js";
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
  if (e.code.length) out.push(`Code: ${e.code.map((c) => c.path).join(", ")}`);
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

export function formatJourney(model: Model, journey: JourneyNode): string {
  const s = journey.spec;
  const out = [
    `${journey.id}: ${s.goal}`,
    `Actor: ${s.actor} · importance: ${s.importance ?? "normal"}${s.status && s.status !== "active" ? ` · ${s.status}` : ""}`,
  ];
  if (s.description) out.push(s.description);
  for (const step of journey.steps) {
    const from = step.from ? targetLabel(model, step.from, false) : step.spec.from;
    const to = step.to ? targetLabel(model, step.to, false) : step.spec.to;
    out.push(
      `  ${step.index + 1}. ${from} → ${to}${step.spec.action ? `: ${step.spec.action}` : ""}`,
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
