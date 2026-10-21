import { ASKED_CONCERNS, DataRegistry, type Model } from "@archdoc/core/browser";
import { forwardRef, type ReactNode, useMemo, useState } from "react";
import { sensitivity } from "../graph/data.js";
import type { ChangeItem, Compare } from "../model/compare.js";
import { journeysByImportance } from "../model/stories.js";
import type { LandscapeInfo } from "../model/useModel.js";

/* The left column of the Journeys, Data, and Changes tabs, and the search in the top bar. */

/** The journeys, most important first: pick one to read it as a story. */
export function JourneyList(props: {
  model: Model;
  journeyId?: string | undefined;
  onJourney: (id: string) => void;
  /** Journeys a comparison affects. */
  affected?: ReadonlySet<string> | undefined;
  landscape?: LandscapeInfo | undefined;
}) {
  const journeys = useMemo(() => journeysByImportance(props.model), [props.model]);
  return (
    <nav className="side-list" aria-label="Journeys">
      <h2 className="side-title">Journeys</h2>
      {journeys.length === 0 ? <p className="empty">No journeys yet.</p> : null}
      {journeys.map((j) => (
        <Item
          key={j.id}
          active={props.journeyId === j.id}
          onClick={() => props.onJourney(j.id)}
          sub={j.spec.goal && j.spec.name ? j.spec.goal : undefined}
          tag={
            <span className={`importance importance-${j.spec.importance ?? "normal"}`}>
              {j.spec.importance ?? "normal"}
            </span>
          }
        >
          {j.spec.name ?? j.spec.goal ?? j.id}
          {props.affected?.has(j.id) ? <span className="badge-changed"> · affected</span> : null}
        </Item>
      ))}
    </nav>
  );
}

/** One data entry, from this model or another repo's. */
interface DataItem {
  key: string;
  label: string;
  kind: string;
  marks: string[];
}

/** The data the model knows: every entry, by repo, with what's sensitive marked. */
export function DataList(props: {
  model: Model;
  selected?: string | undefined;
  onSelect: (key: string) => void;
}) {
  const { model } = props;
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => dataGroups(model), [model]);
  const q = filter.trim().toLowerCase();
  const shown = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !q || `${i.key} ${i.label}`.toLowerCase().includes(q)),
    }))
    .filter((g) => g.items.length);
  const active = (key: string) =>
    props.selected === key || props.selected?.startsWith(`field:${key.slice(5)}.`) === true;
  return (
    <nav className="side-list" aria-label="Data">
      <h2 className="side-title">Data</h2>
      <input
        type="search"
        className="side-filter"
        placeholder="Filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter data entries"
      />
      {shown.length === 0 ? <p className="empty">No data entries.</p> : null}
      {shown.map((g) => (
        <section key={g.namespace} className="side-group">
          {groups.length > 1 ? <h3>{g.name}</h3> : null}
          {g.items.map((d) => (
            <Item
              key={d.key}
              active={active(d.key)}
              onClick={() => props.onSelect(d.key)}
              tag={
                <span className="side-tags">
                  {d.marks.map((m) => (
                    <span key={m} className="mark-sensitive">
                      {m}
                    </span>
                  ))}
                  <span className="muted">{d.kind}</span>
                </span>
              }
            >
              {d.label}
            </Item>
          ))}
        </section>
      ))}
    </nav>
  );
}

/** Data entries by repo, this model's first. */
export function dataGroups(model: Model): { namespace: string; name: string; items: DataItem[] }[] {
  const registry = new DataRegistry(model);
  const spaces = [...registry.models].sort(([a], [b]) =>
    a === model.namespace ? -1 : b === model.namespace ? 1 : a.localeCompare(b),
  );
  return spaces
    .map(([ns, m]) => ({
      namespace: ns,
      name: m.name ?? ns,
      items: [...m.data.values()].map((d) => ({
        key: `data:${ns}.${d.id}`,
        label: d.spec.name ?? d.id,
        kind: d.spec.kind,
        marks: sensitivity(d),
      })),
    }))
    .filter((g) => g.items.length);
}

const MARK = {
  added: "+",
  removed: "−",
  changed: "~",
  moved: "→",
  error: "✗",
  warning: "!",
} as const;

/**
 * What changed since the base, in the order a reviewer needs it: the verdict
 * (the same words as the PR comment), what blocks, what to check and how to
 * fix it, who to ask, then the journeys, elements, uses, and data.
 */
export function ChangesList(props: {
  compare?: Compare | undefined;
  /** Why there's no comparison yet. */
  note?: string | undefined;
  selected?: string | undefined;
  journeyId?: string | undefined;
  onSelect: (key: string) => void;
  onJourney: (id: string) => void;
}) {
  const c = props.compare;
  if (!c) {
    return (
      <nav className="side-list changes" aria-label="Changes">
        <h2 className="side-title">Changes</h2>
        <p className="empty">{props.note ?? "Pick a branch to compare with."}</p>
      </nav>
    );
  }
  const { summary, groups } = c;
  const pick = (i: ChangeItem) => {
    if (!i.key) return;
    if (i.key.startsWith("journey:")) props.onJourney(i.key.slice(8));
    else props.onSelect(i.key);
  };
  const attention = summary.attention.filter(
    (a) => a.code !== "model/suggested" && !ASKED_CONCERNS.has(a.code),
  );
  const verb = { approve: "approves", inform: "knows", verify: "still works" };
  const other = c.diff.mappings.length + c.diff.logic.length + c.diff.rules.length;
  const list = (title: string, items: ChangeItem[]) =>
    items.length ? (
      <section className="change-group">
        <h3>
          {title} <span className="count">{items.length}</span>
        </h3>
        <ul>
          {items.map((i) => (
            <li key={`${i.kind} ${i.key} ${i.label} ${i.repo ?? ""}`}>
              <button
                type="button"
                className={`change-item${props.selected === i.key || `journey:${props.journeyId}` === i.key ? " is-active" : ""}`}
                onClick={() => pick(i)}
                disabled={!i.key}
              >
                <span className={`change-mark change-${i.kind}`} title={i.kind}>
                  {MARK[i.kind]}
                </span>
                <span className="change-text">
                  <span className="change-label">{i.label}</span>
                  <span className="change-detail">
                    {[i.repo, i.hint, i.detail].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
  return (
    <nav className="side-list changes" aria-label="Changes">
      <h2 className="side-title">
        {c.head ?? "Working tree"} since {c.ref}
      </h2>
      <p className={`verdict verdict-${summary.verdict}`}>{summary.headline.join(" · ")}</p>
      {summary.blocking.length ? (
        <section className="change-group">
          <h3>
            Blocking <span className="count">{summary.blocking.length}</span>
          </h3>
          {summary.blocking.map((b) => (
            <Concern
              key={`${b.code}${b.detail}`}
              tone="breaks"
              concern={b}
              onSelect={b.element ? () => props.onSelect(`element:${b.element}`) : undefined}
            />
          ))}
        </section>
      ) : null}
      {attention.length ? (
        <section className="change-group">
          <h3>
            To check <span className="count">{attention.length}</span>
          </h3>
          {attention.map((a) => (
            <Concern
              key={`${a.code}${a.detail}`}
              tone="check"
              concern={a}
              onSelect={a.element ? () => props.onSelect(`element:${a.element}`) : undefined}
            />
          ))}
        </section>
      ) : null}
      {summary.asks.length ? (
        <section className="change-group">
          <h3>Before merging</h3>
          <ul className="asks">
            {summary.asks.map((a) => (
              <li key={`${a.kind}${a.who}`}>
                <strong>{a.who}</strong> {verb[a.kind]} <span className="muted">· {a.why}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {list("Journeys affected", groups.journeys)}
      {list("Elements and uses", groups.elements)}
      {list("Data", groups.data)}
      {list("Suggested facts to review", groups.suggested)}
      {c.count === 0 && groups.suggested.length === 0 ? (
        <p className="empty">The model didn't change.</p>
      ) : null}
      {other ? (
        <p className="empty">
          Also {other} change{other === 1 ? "" : "s"} to mappings, logic, or rules.
        </p>
      ) : null}
    </nav>
  );
}

function Concern(props: {
  tone: "breaks" | "check";
  concern: Compare["summary"]["blocking"][number];
  onSelect?: (() => void) | undefined;
}) {
  const { concern: c } = props;
  return (
    <div className={`concern concern-${props.tone}`}>
      <p className="concern-title">
        {props.onSelect ? (
          <button type="button" className="link" onClick={props.onSelect}>
            {c.title}
          </button>
        ) : (
          c.title
        )}
      </p>
      <p className="concern-detail">{c.detail}</p>
      {c.fix ? <p className="concern-fix">To fix: {c.fix}</p> : null}
      {c.where ? <code className="concern-where">{c.where}</code> : null}
    </div>
  );
}

function Item(props: {
  active: boolean;
  onClick: () => void;
  sub?: string | undefined;
  tag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`side-item${props.active ? " is-active" : ""}`}
      onClick={props.onClick}
      aria-current={props.active ? "true" : undefined}
    >
      <span className="side-item-label">
        {props.children}
        {props.sub ? <span className="side-item-sub">{props.sub}</span> : null}
      </span>
      {props.tag ?? null}
    </button>
  );
}

interface Hit {
  key: string;
  label: string;
  hint: string;
}

/** Search in the top bar: journeys, actors, data, and elements by name, description, or technology. */
export const SearchBox = forwardRef<
  HTMLInputElement,
  { model: Model; onPick: (key: string) => void }
>(function SearchBox(props, ref) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => search(props.model, query).slice(0, 12), [props.model, query]);
  const pick = (key: string) => {
    props.onPick(key);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="search">
      <input
        ref={ref}
        type="search"
        placeholder="Search  ⌘K"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) pick(hits[0].key);
          else if (e.key === "Escape") {
            setQuery("");
            e.currentTarget.blur();
          }
        }}
        aria-label="Search journeys, actors, data, and elements"
      />
      {open && query ? (
        <ul className="search-results">
          {hits.length === 0 ? <li className="empty">Nothing matches.</li> : null}
          {hits.map((h) => (
            <li key={h.key}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h.key)}
              >
                <span>{h.label}</span>
                <span className="muted">{h.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

/** Case-insensitive match on IDs, names, descriptions, and technology. */
export function search(model: Model, query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const match = (...fields: (string | undefined)[]) =>
    fields.some((f) => f?.toLowerCase().includes(q));
  const hits: Hit[] = [];
  for (const j of model.journeys.values()) {
    if (match(j.id, j.spec.name, j.spec.goal)) {
      hits.push({ key: `journey:${j.id}`, label: j.spec.name ?? j.id, hint: "journey" });
    }
  }
  for (const a of model.actors.values()) {
    if (match(a.id, a.spec.name, a.spec.description)) {
      hits.push({ key: `actor:${a.id}`, label: a.spec.name ?? a.id, hint: a.spec.kind });
    }
  }
  for (const g of dataGroups(model)) {
    for (const d of g.items) {
      if (match(d.key.slice(5), d.label)) hits.push({ key: d.key, label: d.label, hint: d.kind });
    }
  }
  for (const e of model.elements.values()) {
    if (match(e.id, e.spec.name, e.spec.description, e.spec.technology)) {
      hits.push({ key: `element:${e.id}`, label: e.spec.name ?? e.id, hint: e.spec.kind });
    }
  }
  return hits;
}
