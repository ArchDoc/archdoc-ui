import type { Model } from "@archdoc/core/browser";
import { forwardRef, type ReactNode, useMemo } from "react";
import type { Compare } from "../App.js";

export interface SidebarProps {
  model: Model;
  query: string;
  onQuery: (q: string) => void;
  expanded: ReadonlySet<string>;
  selected?: string | undefined;
  journeyId?: string | undefined;
  onSelect: (key: string) => void;
  onToggle: (elementId: string) => void;
  onJourney: (id: string) => void;
  compare?: Compare | undefined;
}

interface Hit {
  key: string;
  label: string;
  hint: string;
}

export const Sidebar = forwardRef<HTMLInputElement, SidebarProps>(function Sidebar(props, ref) {
  const { model, query } = props;
  const hits = useMemo(() => search(model, query), [model, query]);

  return (
    <nav className="sidebar" aria-label="Model">
      <div className="search">
        <input
          ref={ref}
          type="search"
          placeholder="Search  ⌘K"
          value={query}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              select(hits[0].key);
            } else if (e.key === "Escape") {
              props.onQuery("");
              e.currentTarget.blur();
            }
          }}
          aria-label="Search actors, elements, and journeys"
        />
      </div>

      {query ? (
        <Section title={`${hits.length} result${hits.length === 1 ? "" : "s"}`}>
          {hits.map((h) => (
            <Item key={h.key} active={isActive(h.key)} onClick={() => select(h.key)} hint={h.hint}>
              {h.label}
            </Item>
          ))}
        </Section>
      ) : (
        <>
          {props.compare ? <Changes {...props} compare={props.compare} /> : null}
          <Section title="Journeys">
            {[...model.journeys.values()].map((j) => (
              <Item
                key={j.id}
                active={props.journeyId === j.id}
                onClick={() => props.onJourney(j.id)}
                hint={
                  props.compare?.journeys.has(j.id)
                    ? `affected · ${j.spec.importance ?? "normal"}`
                    : (j.spec.importance ?? "normal")
                }
                hintClass={`importance-${j.spec.importance ?? "normal"}${props.compare?.journeys.has(j.id) ? " is-affected" : ""}`}
              >
                {j.spec.name ?? j.id}
              </Item>
            ))}
            {model.journeys.size === 0 ? <p className="empty">No journeys yet.</p> : null}
          </Section>
          <Section title="Actors">
            {[...model.actors.values()].map((a) => (
              <Item
                key={a.id}
                active={props.selected === `actor:${a.id}`}
                onClick={() => props.onSelect(`actor:${a.id}`)}
                hint={a.spec.kind}
              >
                {a.spec.name ?? a.id}
              </Item>
            ))}
          </Section>
          <Section title="Elements">
            <Tree {...props} parentId={undefined} />
          </Section>
        </>
      )}
    </nav>
  );

  function isActive(key: string) {
    return key.startsWith("journey:") ? props.journeyId === key.slice(8) : props.selected === key;
  }

  function select(key: string) {
    if (key.startsWith("journey:")) props.onJourney(key.slice(8));
    else props.onSelect(key);
  }
});

const MARK = { added: "+", removed: "−", changed: "~", moved: "→" } as const;

/** What changed since the base, as a clickable list. */
function Changes(props: SidebarProps & { compare: Compare }) {
  const { diff, ref } = props.compare;
  const items = [
    ...diff.elements.map((c) => ({
      key: `element:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "element",
    })),
    ...diff.actors.map((c) => ({ key: `actor:${c.id}`, kind: c.kind, label: c.id, hint: "actor" })),
    ...diff.journeys.map((c) => ({
      key: `journey:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "journey",
    })),
  ];
  const rels = diff.relationships.length;
  return (
    <Section title={`Changes since ${ref}`}>
      {items.length === 0 && rels === 0 ? <p className="empty">The model didn't change.</p> : null}
      {items.map((i) => (
        <Item
          key={i.key}
          active={props.selected === i.key || props.journeyId === i.key.slice(8)}
          onClick={() =>
            i.key.startsWith("journey:")
              ? i.kind !== "removed" && props.onJourney(i.key.slice(8))
              : props.onSelect(i.key)
          }
          hint={i.hint}
          hintClass={`change-${i.kind}`}
        >
          <span className={`change-mark change-${i.kind}`}>{MARK[i.kind]}</span> {i.label}
        </Item>
      ))}
      {rels ? (
        <p className="empty">
          {rels} relationship change{rels === 1 ? "" : "s"}, shown on the canvas
        </p>
      ) : null}
    </Section>
  );
}

function Tree(props: SidebarProps & { parentId: string | undefined }) {
  const { model, parentId } = props;
  const ids = parentId
    ? (model.elements.get(parentId)?.childIds ?? [])
    : [...model.elements.values()].filter((e) => e.depth === 0).map((e) => e.id);
  if (ids.length === 0) return null;
  return (
    <ul className="tree">
      {ids.map((id) => {
        const el = model.elements.get(id);
        if (!el) return null;
        const open = props.expanded.has(id);
        const key = `element:${id}`;
        return (
          <li key={id}>
            <div className={`tree-row${props.selected === key ? " is-active" : ""}`}>
              {el.childIds.length ? (
                <button
                  type="button"
                  className="tree-toggle"
                  onClick={() => props.onToggle(id)}
                  aria-expanded={open}
                  aria-label={open ? `Collapse ${el.key}` : `Expand ${el.key}`}
                >
                  {open ? "▾" : "▸"}
                </button>
              ) : (
                <span className="tree-toggle" />
              )}
              <button type="button" className="tree-label" onClick={() => props.onSelect(key)}>
                {el.spec.name ?? el.key}
              </button>
              <span className={`tree-kind kind-${el.spec.kind}`}>{el.spec.kind}</span>
            </div>
            {open ? <Tree {...props} parentId={id} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="side-section">
      <h2>{title}</h2>
      <div className="side-list">{children}</div>
    </section>
  );
}

function Item(props: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  hintClass?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`side-item${props.active ? " is-active" : ""}`}
      onClick={props.onClick}
    >
      <span className="side-item-label">{props.children}</span>
      {props.hint ? (
        <span className={`side-item-hint ${props.hintClass ?? ""}`}>{props.hint}</span>
      ) : null}
    </button>
  );
}

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
  for (const e of model.elements.values()) {
    if (match(e.id, e.spec.name, e.spec.description, e.spec.technology)) {
      hits.push({ key: `element:${e.id}`, label: e.spec.name ?? e.id, hint: e.spec.kind });
    }
  }
  return hits;
}
