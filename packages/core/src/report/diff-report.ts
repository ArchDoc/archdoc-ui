import type { ProvideSpec } from "@archdoc/spec";
import type { Change, ModelDiff, RelationshipView, StepChange } from "../diff/diff.js";
import { contractName } from "../load/build.js";
import type { Target } from "../model.js";

export type DiffFormat = "text" | "markdown" | "mermaid" | "json";

const SECTIONS = ["elements", "relationships", "actors", "journeys", "data", "rules"] as const;
const SYMBOL = { added: "+", removed: "-", changed: "~", moved: "→" } as const;

/** Renders a model diff. `label` names the two sides, such as "main → working tree". */
export function formatDiff(diff: ModelDiff, format: DiffFormat, label = ""): string {
  if (format === "json") return JSON.stringify(diff, null, 2);
  if (format === "mermaid") return mermaid(diff);

  const md = format === "markdown";
  const total = SECTIONS.reduce((n, s) => n + diff[s].length, 0);
  const head = `${md ? "**Model changes**" : "Model changes"}${label ? ` (${label})` : ""}`;
  if (total === 0) return `${head}: none.`;

  const out = [`${head}: ${summary(diff)}`];
  for (const section of SECTIONS) {
    const list = diff[section] as Change<unknown>[];
    if (list.length === 0) continue;
    out.push("", md ? `**${title(section)}**` : title(section));
    for (const c of list) {
      const line = describeChange(section, c);
      out.push(md ? `- ${markdownSymbol(c.kind)} ${line}` : `  ${SYMBOL[c.kind]} ${line}`);
      const steps = (c as { steps?: StepChange[] }).steps;
      for (const s of steps ?? []) {
        const step = `${s.kind === "added" ? "+" : "-"} step ${s.step}: ${s.from} → ${s.to}${s.action ? ` (${s.action})` : ""}`;
        out.push(md ? `  - ${step}` : `      ${step}`);
      }
    }
  }
  return out.join("\n");
}

export function summary(diff: ModelDiff): string {
  const parts: string[] = [];
  for (const section of SECTIONS) {
    const list = diff[section] as Change<unknown>[];
    if (list.length === 0) continue;
    const counts = (["added", "changed", "moved", "removed"] as const)
      .map((k) => [k, list.filter((c) => c.kind === k).length] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`);
    parts.push(`${section} ${counts.join(", ")}`);
  }
  return parts.join("; ");
}

/** One change as a line, such as "Charge (entity): fields +card_last4 (pci)". */
export function describeChange(section: (typeof SECTIONS)[number], c: Change<unknown>): string {
  if (section === "relationships") {
    const r = (c.after ?? c.before) as RelationshipView;
    const text = `${ref(r.from)} → ${ref(r.to)}${r.description ? `: ${r.description}` : ""}`;
    return c.kind === "changed" ? `${text} (${fieldChanges(c)})` : text;
  }
  const spec = (c.after ?? c.before ?? {}) as Record<string, unknown>;
  const kind =
    typeof spec.kind === "string"
      ? spec.kind
      : typeof spec.importance === "string"
        ? spec.importance
        : "";
  const name = `${c.id}${kind ? ` (${kind})` : ""}`;
  if (c.kind === "moved")
    return `${name} moved from ${c.from}${c.fields.length > 1 ? `; ${fieldChanges(c, ["parent"])}` : ""}`;
  if (c.kind === "changed") return `${name}: ${fieldChanges(c)}`;
  if (c.kind === "added" && spec.status === "planned") return `${name}, planned`;
  return name;
}

/** "status planned → active, description" */
function fieldChanges(c: Change<unknown>, skip: string[] = []): string {
  const before = (c.before ?? {}) as Record<string, unknown>;
  const after = (c.after ?? {}) as Record<string, unknown>;
  return c.fields
    .filter((f) => !skip.includes(f))
    .map((f) => {
      const a = before[f];
      const b = after[f];
      if (f === "provides") return contractDelta(a, b);
      if (f === "fields") return fieldDelta(a, b);
      if (f === "sends") return listDelta("sends", a, b);
      if (f === "stores") return storeDelta(a, b);
      const short = (v: unknown) => (typeof v === "string" && v.length <= 24 ? v : undefined);
      return short(a ?? "active") &&
        short(b ?? "active") &&
        ["status", "kind", "importance"].includes(f)
        ? `${f} ${a ?? "active"} → ${b ?? "active"}`
        : f;
    })
    .join(", ");
}

/** "provides -proto/charges.proto +proto/charges.v2.proto", naming the contracts that changed. */
function contractDelta(before: unknown, after: unknown): string {
  const names = (v: unknown) =>
    new Map(
      (Array.isArray(v) ? (v as ProvideSpec[]) : []).map((p) => [
        contractName(p),
        p.status ?? "active",
      ]),
    );
  const a = names(before);
  const b = names(after);
  const parts = [
    ...[...a.keys()].filter((n) => !b.has(n)).map((n) => `-${n}`),
    ...[...b.keys()].filter((n) => !a.has(n)).map((n) => `+${n}`),
    ...[...b]
      .filter(([n, st]) => a.has(n) && a.get(n) !== st)
      .map(([n, st]) => `${n} ${a.get(n)} → ${st}`),
  ];
  return parts.length ? `provides ${parts.join(" ")}` : "provides";
}

/** "fields +card_last4 (pci) -legacy_id ~email (classification internal → pii)" */
function fieldDelta(before: unknown, after: unknown): string {
  type Field = { type?: string; classification?: string };
  const a = (before ?? {}) as Record<string, Field>;
  const b = (after ?? {}) as Record<string, Field>;
  const parts = [
    ...Object.keys(b)
      .filter((k) => !(k in a))
      .map((k) => `+${k}${b[k]?.classification ? ` (${b[k]?.classification})` : ""}`),
    ...Object.keys(a)
      .filter((k) => !(k in b))
      .map((k) => `-${k}`),
    ...Object.keys(b)
      .filter((k) => k in a && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => {
        const x = a[k] ?? {};
        const y = b[k] ?? {};
        const what = [
          x.classification !== y.classification
            ? `classification ${x.classification ?? "none"} → ${y.classification ?? "none"}`
            : "",
          x.type !== y.type ? `type ${x.type} → ${y.type}` : "",
        ].filter(Boolean);
        return `~${k}${what.length ? ` (${what.join(", ")})` : ""}`;
      }),
  ];
  return parts.length ? `fields ${parts.join(" ")}` : "fields";
}

/** "sends +RideRequest -Ping" */
function listDelta(name: string, before: unknown, after: unknown): string {
  const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
  const a = list(before);
  const b = list(after);
  const parts = [
    ...b.filter((x) => !a.includes(x)).map((x) => `+${x}`),
    ...a.filter((x) => !b.includes(x)).map((x) => `-${x}`),
  ];
  return parts.length ? `${name} ${parts.join(" ")}` : name;
}

/** "stores +ledger_entries (LedgerEntry) -old_table" */
function storeDelta(before: unknown, after: unknown): string {
  const a = (before ?? {}) as Record<string, { entity?: string }>;
  const b = (after ?? {}) as Record<string, { entity?: string }>;
  const parts = [
    ...Object.keys(b)
      .filter((k) => !(k in a) || a[k]?.entity !== b[k]?.entity)
      .map((k) => `+${k} (${b[k]?.entity})`),
    ...Object.keys(a)
      .filter((k) => !(k in b))
      .map((k) => `-${k}`),
  ];
  return parts.length ? `stores ${parts.join(" ")}` : "stores";
}

function mermaid(diff: ModelDiff): string {
  const lines = ["flowchart LR"];
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");
  const seen = new Set<string>();
  const node = (key: string, label: string, cls?: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`  ${id(key)}["${label.replace(/"/g, "'")}"]${cls ? `:::${cls}` : ""}`);
  };
  for (const c of diff.elements)
    node(`element:${c.id}`, c.id, c.kind === "moved" ? "changed" : c.kind);
  for (const c of diff.actors) node(`actor:${c.id}`, c.id, c.kind === "moved" ? "changed" : c.kind);
  for (const c of diff.relationships) {
    const r = (c.after ?? c.before) as RelationshipView;
    const from = keyOf(r.from);
    const to = keyOf(r.to);
    node(from, ref(r.from));
    node(to, ref(r.to));
    const arrow =
      c.kind === "removed"
        ? "-. removed .->"
        : c.kind === "added"
          ? "== added ==>"
          : "-- changed -->";
    lines.push(`  ${id(from)} ${arrow} ${id(to)}`);
  }
  lines.push(
    "  classDef added fill:#e1f3ea,stroke:#18865a",
    "  classDef removed fill:#fbe3e1,stroke:#c0362c,stroke-dasharray: 4 3",
    "  classDef changed fill:#fbefd9,stroke:#b26a00",
  );
  return lines.join("\n");
}

function keyOf(t: Target): string {
  return t.type === "external" ? `external:${t.ref}` : `${t.type}:${t.id}`;
}

function ref(t: Target): string {
  return t.type === "external" ? t.ref : t.id;
}

function title(section: string): string {
  return section.charAt(0).toUpperCase() + section.slice(1);
}

function markdownSymbol(kind: Change<unknown>["kind"]): string {
  return { added: "**added**", removed: "**removed**", changed: "changed", moved: "moved" }[kind];
}
