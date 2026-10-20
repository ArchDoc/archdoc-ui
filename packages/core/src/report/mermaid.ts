import { DataRegistry } from "../data/registry.js";
import type { ModelDiff, RelationshipView, StepChange } from "../diff/diff.js";
import { type Model, nodeKey, type Target } from "../model.js";

/** How a box or arrow in a change diagram reads. */
type Mark = "added" | "removed" | "changed" | "context";

interface Box {
  key: string;
  label: string;
  kind: string;
  shape: "actor" | "datastore" | "queue" | "external" | "box";
  mark: Mark;
  /** Top-level element the box sits inside, drawn as a group. */
  group?: string | undefined;
  files: number;
}

interface Arrow {
  from: string;
  to: string;
  /** broken: a consumer in another repo that the change breaks. */
  mark: Mark | "broken";
  suggested: boolean;
  label?: string | undefined;
}

export interface ChangeDiagramInput {
  model: Model;
  diff: ModelDiff;
  /** Changed files per element ID, from the pull request. */
  touched: Map<string, number>;
  /** Most boxes to draw; past this, unchanged neighbors are left out, actors last. Default 14. */
  maxBoxes?: number;
  /** Consumers in other repos, drawn in a frame per repo. At most 8, breaking ones first. */
  remote?: RemoteUse[] | undefined;
}

/** A consumer in another repo, and what the change does to it. */
export interface RemoteUse {
  /** Fully qualified, such as rides.api-gateway. */
  from: string;
  namespace: string;
  /** The element of this model it uses. */
  target: string;
  effect: "breaks" | "deprecated" | "affected";
  /** Why it breaks, such as "proto/charges.proto is removed". */
  why?: string | undefined;
}

/** Shared by the change diagram and the legend under it. */
const CLASSES = [
  "classDef added fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#1f2328",
  "classDef changed fill:#fff8c5,stroke:#9a6700,stroke-width:2px,color:#1f2328",
  "classDef removed fill:#ffebe9,stroke:#cf222e,stroke-width:2px,stroke-dasharray:5 4,color:#1f2328",
  "classDef context fill:#f6f8fa,stroke:#8c959f,color:#57606a",
];

const LINK = {
  broken: "stroke:#cf222e,stroke-width:3px",
  added: "stroke:#1a7f37,stroke-width:3px",
  removed: "stroke:#cf222e,stroke-width:2px",
  changed: "stroke:#9a6700,stroke-width:2px",
  context: "stroke:#afb8c1,stroke-width:1px",
};

export const CHANGE_LEGEND =
  "🟩 added · 🟨 changed · 🟥 removed · ⬜ unchanged, for context · dotted arrow: suggested by an agent, waiting for review";

/**
 * A Mermaid flowchart of what a change does to the architecture: the elements
 * it touches and the model changes, colored by what happened to them, with
 * their unchanged neighbors for context. Parts are drawn at container level
 * (inside their top-level element), so a large change stays readable. Returns
 * undefined when there's nothing to draw.
 */
export function changeDiagram(input: ChangeDiagramInput): string | undefined {
  const { model, diff, touched } = input;
  const maxBoxes = input.maxBoxes ?? 14;
  const boxes = new Map<string, Box>();

  // Draw elements at depth 0 or 1, so parts lift onto their container.
  const shown = (id: string) => id.split(".").slice(0, 2).join(".");
  const groupOf = (id: string) => {
    const [top, second] = id.split(".");
    return second ? top : undefined;
  };

  const elementBox = (id: string, mark: Mark, kindBefore?: string): Box => {
    const key = `element:${id}`;
    const existing = boxes.get(key);
    if (existing) {
      existing.mark = stronger(existing.mark, mark);
      return existing;
    }
    const e = model.elements.get(id);
    const kind = e?.spec.kind ?? kindBefore ?? "element";
    const box: Box = {
      key,
      label: e?.spec.name ?? id.split(".").pop() ?? id,
      kind,
      shape: kind === "datastore" || kind === "queue" || kind === "external" ? kind : "box",
      mark,
      group: groupOf(id),
      files: 0,
    };
    boxes.set(key, box);
    return box;
  };
  const actorBox = (id: string, mark: Mark, kindBefore?: string): Box => {
    const key = `actor:${id}`;
    const existing = boxes.get(key);
    if (existing) {
      existing.mark = stronger(existing.mark, mark);
      return existing;
    }
    const a = model.actors.get(id);
    const box: Box = {
      key,
      label: a?.spec.name ?? id,
      kind: a?.spec.kind ?? kindBefore ?? "actor",
      shape: "actor",
      mark,
      files: 0,
    };
    boxes.set(key, box);
    return box;
  };
  const targetBox = (t: Target, mark: Mark, kindBefore?: string): Box => {
    if (t.type === "actor") return actorBox(t.id, mark);
    if (t.type === "element") {
      const id = shown(t.id);
      // A part's change shows as a change inside its container.
      if (id === t.id) return elementBox(id, mark, kindBefore);
      return elementBox(id, mark === "context" ? "context" : "changed");
    }
    const key = nodeKey(t);
    const box = boxes.get(key) ?? {
      key,
      label: key.replace(/^external:/, ""),
      kind: "external",
      shape: "external" as const,
      mark,
      files: 0,
    };
    box.mark = stronger(box.mark, mark);
    boxes.set(key, box);
    return box;
  };

  // What the change touches: code, then the model's own changes.
  for (const [id, files] of touched) {
    const box = targetBox({ type: "element", id }, "changed");
    box.files += files;
  }
  for (const c of diff.elements) {
    const mark: Mark = c.kind === "added" || c.kind === "removed" ? c.kind : "changed";
    const before = c.before as { kind?: string } | undefined;
    targetBox({ type: "element", id: c.id }, mark, before?.kind);
  }
  for (const c of diff.actors) {
    const before = c.before as { kind?: string } | undefined;
    actorBox(c.id, c.kind === "added" || c.kind === "removed" ? c.kind : "changed", before?.kind);
  }

  // Relationships, lifted onto the boxes. Changed ones first, so they count.
  const arrows = new Map<string, Arrow & { all: Mark[] }>();
  const addArrow = (r: RelationshipView, mark: Mark) => {
    const from = targetBox(r.from, "context");
    const to = targetBox(r.to, "context");
    if (from.key === to.key) return;
    const key = `${from.key}->${to.key}`;
    const suggested =
      mark === "added" &&
      (r as RelationshipView & { provenance?: { source?: string } }).provenance?.source ===
        "suggested";
    const prev = arrows.get(key);
    if (prev) {
      prev.all.push(mark);
      prev.suggested &&= suggested;
      prev.label = undefined;
      return;
    }
    arrows.set(key, {
      from: from.key,
      to: to.key,
      mark,
      all: [mark],
      suggested,
      label: mark === "context" ? undefined : r.description,
    });
  };
  const focus = new Set(boxes.keys());
  const changedRelationships = new Set<string>();
  for (const c of diff.relationships) {
    const mark: Mark = c.kind === "added" || c.kind === "removed" ? c.kind : "changed";
    const r = (c.after ?? c.before) as RelationshipView;
    addArrow(r, mark);
    if (c.kind !== "removed") changedRelationships.add(c.id);
  }
  for (const k of [...arrows.values()].flatMap((a) => [a.from, a.to])) focus.add(k);

  // Unchanged relationships to and from what changed, for context: first
  // between changed boxes, then to neighbors (actors first) while there's room.
  const context = model.relationships
    .filter((r) => !changedRelationships.has(`${nodeKey(r.from)}->${nodeKey(r.to)}`))
    .map((r) => ({ r, from: boxKey(r.from, shown), to: boxKey(r.to, shown) }))
    .filter(({ from, to }) => from !== to && (focus.has(from) || focus.has(to)));
  const neighborRank = (c: { from: string; to: string }) =>
    focus.has(c.from) && focus.has(c.to) ? 0 : c.from.startsWith("actor:") ? 1 : 2;
  for (const c of context.sort((a, b) => neighborRank(a) - neighborRank(b))) {
    if (neighborRank(c) > 0 && boxes.size >= maxBoxes && !(boxes.has(c.from) && boxes.has(c.to)))
      continue;
    const { r } = c;
    addArrow({ from: r.from, to: r.to, description: r.description, status: r.status }, "context");
  }

  // An arrow is added only if everything behind it is new, and removed only if all of it went.
  for (const a of arrows.values()) {
    if (new Set(a.all).size > 1) a.mark = "changed";
  }

  // Consumers in other repos, framed by repo, breaking ones first.
  const order = { breaks: 0, deprecated: 1, affected: 2 };
  const remote = [...(input.remote ?? [])].sort((a, b) => order[a.effect] - order[b.effect]);
  const shownRemote = new Set<string>();
  for (const use of remote) {
    const key = `remote:${use.from}`;
    if (!boxes.has(key) && shownRemote.size >= 8) continue;
    shownRemote.add(key);
    boxes.set(
      key,
      boxes.get(key) ?? {
        key,
        label: use.from.slice(use.namespace.length + 1),
        kind: use.namespace,
        shape: "box",
        mark: "context",
        group: `repo:${use.namespace}`,
        files: 0,
      },
    );
    const to = targetBox({ type: "element", id: use.target }, "context");
    const arrowKey = `${key}->${to.key}`;
    const mark =
      use.effect === "breaks" ? "broken" : use.effect === "deprecated" ? "changed" : "context";
    const prev = arrows.get(arrowKey);
    if (prev && prev.mark === "broken") continue;
    arrows.set(arrowKey, {
      from: key,
      to: to.key,
      mark,
      all: [mark === "broken" ? "removed" : mark],
      suggested: false,
      label:
        use.effect === "breaks"
          ? `breaks: ${use.why ?? ""}`
          : use.effect === "deprecated"
            ? use.why
            : undefined,
    });
  }

  if (boxes.size === 0) return undefined;
  return render([...boxes.values()], [...arrows.values()], model);
}

function render(boxes: Box[], arrows: Arrow[], model: Model): string {
  const groups = new Map<string, Box[]>();
  for (const b of boxes) {
    if (b.group) groups.set(b.group, [...(groups.get(b.group) ?? []), b]);
  }
  // A top-level element with parts on the diagram is drawn as a group, and arrows to it point at the group.
  const groupIds = new Map([...groups.keys()].map((g, i) => [g, `g${i}`]));
  const ids = new Map(
    boxes.map((b, i) => [b.key, groupIds.get(b.key.replace(/^element:/, "")) ?? `n${i}`]),
  );
  const lines = ["flowchart TB"];
  const node = (b: Box) => {
    const id = ids.get(b.key) ?? "";
    const detail = [b.kind, b.files ? `${b.files} file${b.files === 1 ? "" : "s"}` : ""]
      .filter(Boolean)
      .join(" · ");
    const text = `"${label(b.label)}<br/><small>${label(detail)}</small>"`;
    const shape = {
      actor: `([${text}])`,
      datastore: `[(${text})]`,
      queue: `[/${text}/]`,
      external: `{{${text}}}`,
      box: `[${text}]`,
    }[b.shape];
    return `${id}${shape}:::${b.mark}`;
  };

  // Actors and loose boxes first, then one group per top-level element.
  for (const b of boxes) {
    if (b.group || groups.has(b.key.replace(/^element:/, ""))) continue;
    lines.push(`  ${node(b)}`);
  }
  for (const [group, members] of groups) {
    const id = groupIds.get(group) ?? "";
    if (group.startsWith("repo:")) {
      lines.push(`  subgraph ${id}["${label(group.slice(5))} · another repo"]`);
      for (const b of members) lines.push(`    ${node(b)}`);
      lines.push(
        "  end",
        `  style ${id} fill:none,stroke:#8c959f,stroke-width:1px,stroke-dasharray:4 3`,
      );
      continue;
    }
    const top = model.elements.get(group);
    const own = boxes.find((b) => b.key === `element:${group}`);
    lines.push(`  subgraph ${id}["${label(top?.spec.name ?? group)}"]`);
    for (const b of members) lines.push(`    ${node(b)}`);
    lines.push("  end");
    // Groups are frames, not changes, unless the top-level element itself changed.
    const stroke = { added: "#1a7f37", removed: "#cf222e", changed: "#9a6700", context: "#d0d7de" }[
      own?.mark ?? "context"
    ];
    lines.push(
      `  style ${id} fill:none,stroke:${stroke},stroke-width:${own?.mark === "context" || !own ? 1 : 2}px`,
    );
  }

  const styles: string[] = [];
  arrows.forEach((a, i) => {
    const from = ids.get(a.from);
    const to = ids.get(a.to);
    const text = a.label ? `|"${label(truncate(a.label, 40))}"|` : "";
    const tag = a.suggested
      ? `|"suggested${a.label ? `: ${label(truncate(a.label, 30))}` : ""}"|`
      : text;
    const arrow = a.mark === "removed" || a.suggested ? "-.->" : a.mark === "added" ? "==>" : "-->";
    lines.push(`  ${from} ${arrow}${tag} ${to}`);
    styles.push(`  linkStyle ${i} ${LINK[a.mark]}`);
  });
  lines.push(...styles, ...CLASSES.map((c) => `  ${c}`));
  return lines.join("\n");
}

export interface JourneyDiagramInput {
  model: Model;
  journeyId: string;
  /** 1-based steps that pass through what the change touches. */
  steps: number[];
  /** Steps the change added or removed, from the model diff. */
  changes?: StepChange[] | undefined;
  /** For another repo's journey: the model it was found from, which may know its logic. */
  from?: Model | undefined;
}

/**
 * A Mermaid sequence diagram of a journey, with the steps a change passes
 * through highlighted, new steps marked, and removed steps noted. Returns
 * undefined for a journey without steps.
 */
export function journeyDiagram(input: JourneyDiagramInput): string | undefined {
  const j = input.model.journeys.get(input.journeyId);
  if (!j || j.steps.length === 0) return undefined;
  const affected = new Set(input.steps);
  const added = new Set((input.changes ?? []).filter((c) => c.kind === "added").map((c) => c.step));
  const removed = (input.changes ?? []).filter((c) => c.kind === "removed");

  const participants = new Map<string, { id: string; actor: boolean; label: string }>();
  // Steps name participants as written; removed steps only have that.
  const byName = new Map<string, string>();
  const participant = (t: Target | undefined, raw: string) => {
    const key = t ? nodeKey(t) : (byName.get(raw) ?? raw);
    let p = participants.get(key);
    if (!p) {
      const name =
        t?.type === "actor"
          ? (input.model.actors.get(t.id)?.spec.name ?? t.id)
          : t?.type === "element"
            ? (input.model.elements.get(t.id)?.spec.name ?? t.id.split(".").pop() ?? t.id)
            : t
              ? key.replace(/^external:/, "")
              : (raw.split(".").pop() ?? raw);
      p = { id: `p${participants.size}`, actor: t?.type === "actor", label: name };
      participants.set(key, p);
    }
    byName.set(raw, key);
    return p.id;
  };

  // Steps that run only for one outcome of an earlier decision are drawn as
  // alt / else blocks, labeled with the decision's conditions, so branches
  // don't read as steps that all happen.
  const items = branchItems([input.model, input.from], j.steps);
  const branched = items.some((it) => it.kind === "alt");
  const line = (i: number, indent: string) => {
    const s = j.steps[i];
    if (!s) return "";
    const n = i + 1;
    const from = participant(s.from, s.spec.from);
    const to = participant(s.to, s.spec.to);
    const text = `${branched ? `${n}. ` : ""}${added.has(n) ? "🆕 " : ""}${message(s.spec.action ?? "")}`;
    return `${indent}${from}->>${to}: ${wrap(text) || " "}`;
  };
  // Runs of steps the change passes through are highlighted.
  const steps = (list: number[], indent: string): string[] => {
    const out: string[] = [];
    let inside = false;
    for (const i of list) {
      const hit = affected.has(i + 1);
      if (hit && !inside) out.push(`${indent}rect rgba(212, 167, 44, 0.18)`);
      else if (!hit && inside) out.push(`${indent}end`);
      inside = hit;
      out.push(line(i, inside ? `${indent}  ` : indent));
    }
    if (inside) out.push(`${indent}end`);
    return out;
  };
  const body: string[] = [];
  let plain: number[] = [];
  const flush = () => {
    body.push(...steps(plain, "  "));
    plain = [];
  };
  for (const it of items) {
    if (it.kind === "step") {
      plain.push(it.index);
      continue;
    }
    flush();
    it.outcomes.forEach((o, k) => {
      const head = `${o.name}${o.condition ? `: ${o.condition}` : ""}`;
      body.push(`  ${k === 0 ? "alt" : "else"} ${message(head)}`);
      body.push(...steps(o.steps, "    "));
    });
    body.push("  end");
  }
  flush();
  for (const r of removed) {
    const from = participant(undefined, r.from);
    const to = participant(undefined, r.to);
    body.push(
      `  Note over ${from},${to}: ${wrap(`Removed step ${r.step}: ${message(r.action ?? `${r.from} → ${r.to}`)}`, 48)}`,
    );
  }

  const lines = branched ? ["sequenceDiagram"] : ["sequenceDiagram", "  autonumber"];
  for (const p of participants.values()) {
    lines.push(`  ${p.actor ? "actor" : "participant"} ${p.id} as ${message(p.label)}`);
  }
  return [...lines, ...body].join("\n");
}

type BranchItem =
  | { kind: "step"; index: number }
  | {
      kind: "alt";
      outcomes: { name: string; condition?: string | undefined; steps: number[] }[];
    };

/**
 * A journey's steps in drawing order: plain steps, and for each run of steps
 * with `when:`, one block per outcome of the decision before them, in the
 * order the decision's rules list them.
 */
function branchItems(
  models: (Model | undefined)[],
  steps: { spec: { when?: string | undefined; decides?: string | undefined } }[],
): BranchItem[] {
  const items: BranchItem[] = [];
  const registries = models.filter((m): m is Model => !!m).map((m) => new DataRegistry(m));
  const logic = (ref: string) => {
    for (const r of registries) {
      const found = r.logic(ref);
      if (found) return found;
    }
    return undefined;
  };
  let decision: string | undefined;
  for (let i = 0; i < steps.length; i++) {
    const spec = steps[i]?.spec;
    if (!spec?.when) {
      items.push({ kind: "step", index: i });
      if (spec?.decides) decision = spec.decides;
      continue;
    }
    const run: number[] = [];
    while (i < steps.length && steps[i]?.spec.when) run.push(i++);
    i--;
    const rules = decision ? (logic(decision)?.node.spec.rules ?? []) : [];
    const order = rules.map((r) => ("then" in r ? r.then : r.else));
    const conditionOf = (name: string) => {
      const rule = rules.find((r) => ("then" in r ? r.then : r.else) === name);
      if (!rule) return undefined;
      return "when" in rule ? readable(rule.when) : "otherwise";
    };
    const names = [...new Set(run.map((k) => steps[k]?.spec.when ?? ""))].sort(
      (a, b) => rank(order, a) - rank(order, b),
    );
    items.push({
      kind: "alt",
      outcomes: names.map((name) => ({
        name,
        condition: conditionOf(name),
        steps: run.filter((k) => steps[k]?.spec.when === name),
      })),
    });
  }
  return items;
}

/** A CEL condition with comparison operators Mermaid can show. */
function readable(cel: string): string {
  return cel
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/!=/g, "≠")
    .replace(/</g, "＜")
    .replace(/>/g, "＞");
}

function rank(order: string[], name: string): number {
  const i = order.indexOf(name);
  return i < 0 ? order.length : i;
}

function boxKey(t: Target, shown: (id: string) => string): string {
  return t.type === "element" ? `element:${shown(t.id)}` : nodeKey(t);
}

const RANK: Record<Mark, number> = { context: 0, changed: 1, removed: 2, added: 3 };

function stronger(a: Mark, b: Mark): Mark {
  return RANK[b] > RANK[a] ? b : a;
}

/** Text that is safe inside a quoted Mermaid flowchart label. */
function label(text: string): string {
  return text
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text that is safe as a Mermaid sequence diagram message. */
function message(text: string): string {
  return truncate(
    text
      .replace(/;/g, ",")
      .replace(/[#<>`]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    90,
  );
}

/** Breaks a sequence diagram message into short lines, so the diagram stays narrow. */
function wrap(text: string, width = 36): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("<br/>");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
