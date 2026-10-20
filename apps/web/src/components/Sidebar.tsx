import type { Model } from "@archdoc/core/browser";
import { forwardRef, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { sensitivity } from "../graph/data.js";
import type { GroupBy } from "../graph/groups.js";
import type { ChangeItem, Compare } from "../model/compare.js";
import type { LandscapeInfo } from "../model/useModel.js";

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
  /** On the Changes tab, why there's no comparison yet. */
  changesNote?: string | undefined;
  landscape?: LandscapeInfo | undefined;
  onGroupBy?: ((by: GroupBy) => void) | undefined;
}

interface Hit {
  key: string;
  label: string;
  hint: string;
}

export const Sidebar = forwardRef<HTMLInputElement, SidebarProps>(function Sidebar(props, ref) {
  const { model, query } = props;
  const hits = useMemo(() => search(model, query), [model, query]);
  const [open, toggleSection, openSection] = useOpenSections();
  const section = (id: SectionId, title: string, count: number) => ({
    id,
    title,
    count,
    open: open.has(id),
    onToggle: () => toggleSection(id),
  });

  // Picking something on the canvas opens the section that lists it.
  const selectedSection = sectionOf(props.selected, props.journeyId, !!props.landscape);
  useEffect(() => {
    if (selectedSection) openSection(selectedSection);
  }, [selectedSection, openSection]);

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
        <Section id="results" title="Results" count={hits.length} open onToggle={() => {}}>
          {hits.map((h) => (
            <Item key={h.key} active={isActive(h.key)} onClick={() => select(h.key)} hint={h.hint}>
              {h.label}
            </Item>
          ))}
        </Section>
      ) : (
        <>
          {props.compare ? (
            <Changes {...props} compare={props.compare} section={section} />
          ) : props.changesNote ? (
            <Section {...section("changes", "Changes", 0)}>
              <p className="empty">{props.changesNote}</p>
            </Section>
          ) : null}
          {props.landscape ? (
            <Landscape {...props} landscape={props.landscape} section={section} />
          ) : null}
          <Section {...section("journeys", "Journeys", model.journeys.size)}>
            {[...model.journeys.values()].map((j) => (
              <Item
                key={j.id}
                active={props.journeyId === j.id}
                onClick={() => props.onJourney(j.id)}
                hint={
                  props.compare?.journeys.has(j.id) ? "affected" : (j.spec.importance ?? "normal")
                }
                hintClass={`importance-${j.spec.importance ?? "normal"}${props.compare?.journeys.has(j.id) ? " is-affected" : ""}`}
              >
                {j.spec.name ?? j.id}
                {props.landscape && crossesRepos(model, j.id) ? (
                  <span className="cross-mark" title="Goes through more than one repo">
                    {" "}
                    ⇄
                  </span>
                ) : null}
              </Item>
            ))}
            {model.journeys.size === 0 ? <p className="empty">No journeys yet.</p> : null}
          </Section>
          <Section {...section("actors", "Actors", model.actors.size)}>
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
          {model.data.size ? (
            <Section {...section("data", "Data", model.data.size)}>
              {[...model.data.values()].map((d) => {
                const key = `data:${model.namespace}.${d.id}`;
                const sensitive = sensitivity(d);
                return (
                  <Item
                    key={d.id}
                    active={
                      props.selected === key ||
                      props.selected?.startsWith(`field:${model.namespace}.${d.id}.`) === true
                    }
                    onClick={() => props.onSelect(key)}
                    hint={
                      sensitive.length ? `${d.spec.kind} · ${sensitive.join(", ")}` : d.spec.kind
                    }
                    hintClass={sensitive.length ? "is-sensitive" : undefined}
                  >
                    {d.spec.name ?? d.id}
                  </Item>
                );
              })}
            </Section>
          ) : null}
          <Section
            {...section(
              "elements",
              "Elements",
              [...model.elements.values()].filter((e) => e.depth === 0).length,
            )}
          >
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

/** A landscape's repos and domains. */
function Landscape(props: SidebarProps & { landscape: LandscapeInfo; section: SectionFor }) {
  const { landscape } = props;
  return (
    <>
      <Section {...props.section("repos", "Repos", landscape.repos.length)}>
        {landscape.repos.map((r) => (
          <Item
            key={r.namespace}
            active={props.selected === `element:${r.namespace}`}
            onClick={() => {
              props.onGroupBy?.("repo");
              props.onSelect(`element:${r.namespace}`);
            }}
            hint={r.version ?? r.commit?.slice(0, 7)}
          >
            {r.name ?? r.namespace}
          </Item>
        ))}
      </Section>
      {landscape.domains.length ? (
        <Section {...props.section("domains", "Domains", landscape.domains.length)}>
          {landscape.domains.map((d) => (
            <Item
              key={d.id}
              active={props.selected === `domain:${d.id}`}
              onClick={() => props.onSelect(`domain:${d.id}`)}
              hint={`${d.members.length} member${d.members.length === 1 ? "" : "s"}`}
            >
              {d.name ?? d.id}
            </Item>
          ))}
        </Section>
      ) : null}
    </>
  );
}

/** True when a journey's steps touch more than one repo. */
function crossesRepos(model: Model, journeyId: string): boolean {
  const repos = new Set<string>();
  for (const s of model.journeys.get(journeyId)?.steps ?? []) {
    for (const t of [s.from, s.to]) {
      if (t?.type !== "element") continue;
      let top = model.elements.get(t.id);
      while (top?.parentId) top = model.elements.get(top.parentId);
      if (top?.spec.tags?.includes("repo")) repos.add(top.id);
    }
  }
  return repos.size > 1;
}

const MARK = {
  added: "+",
  removed: "−",
  changed: "~",
  moved: "→",
  error: "✗",
  warning: "!",
} as const;

const GROUPS = [
  ["breaks", "What breaks"],
  ["journeys", "Journeys affected"],
  ["elements", "Elements and arrows"],
  ["data", "Data"],
  ["suggested", "Suggested facts to review"],
] as const;

/** What changed since the base, grouped by what to look at first. */
function Changes(props: SidebarProps & { compare: Compare; section: SectionFor }) {
  const { groups, ref, head, count, diff } = props.compare;
  const pick = (i: ChangeItem) => {
    if (!i.key) return;
    if (i.key.startsWith("journey:")) props.onJourney(i.key.slice(8));
    else props.onSelect(i.key);
  };
  const other = diff.mappings.length + diff.logic.length + diff.rules.length;
  return (
    <Section {...props.section("changes", `${head ?? "Changes"} since ${ref}`, count)}>
      {count === 0 && groups.suggested.length === 0 ? (
        <p className="empty">The model didn't change.</p>
      ) : null}
      {GROUPS.map(([id, title]) =>
        groups[id].length ? (
          <div key={id} className={`change-group change-group-${id}`}>
            <h3>
              {title} <span className="count">{groups[id].length}</span>
            </h3>
            {groups[id].map((i) => (
              <Item
                key={`${i.kind} ${i.key} ${i.label}`}
                active={
                  !!i.key && (props.selected === i.key || `journey:${props.journeyId}` === i.key)
                }
                onClick={() => pick(i)}
                hint={i.hint}
                hintClass={`change-${i.kind}`}
                disabled={!i.key}
              >
                <span className={`change-mark change-${i.kind}`}>{MARK[i.kind]}</span> {i.label}
                {i.detail ? <span className="change-detail">{i.detail}</span> : null}
              </Item>
            ))}
          </div>
        ) : null,
      )}
      {other ? (
        <p className="empty">
          Also {other} change{other === 1 ? "" : "s"} to mappings, logic, or rules.
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

type SectionId =
  | "results"
  | "changes"
  | "repos"
  | "domains"
  | "journeys"
  | "actors"
  | "data"
  | "elements";

interface SectionProps {
  id: SectionId;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}

type SectionFor = (id: SectionId, title: string, count: number) => SectionProps;

/** A sidebar section that opens and closes, like an accordion. */
function Section(props: SectionProps & { children: ReactNode }) {
  const body = `side-${props.id}`;
  return (
    <section className={`side-section${props.open ? " is-open" : ""}`}>
      <h2>
        <button
          type="button"
          className="side-head"
          aria-expanded={props.open}
          aria-controls={body}
          onClick={props.onToggle}
        >
          <span className="side-chevron" aria-hidden="true">
            ▸
          </span>
          <span className="side-title">{props.title}</span>
          <span className="side-count">{props.count}</span>
        </button>
      </h2>
      {props.open ? (
        <div className="side-list" id={body}>
          {props.children}
        </div>
      ) : null}
    </section>
  );
}

const OPEN_KEY = "archdoc:sidebar-open";
const DEFAULT_OPEN: SectionId[] = ["changes", "journeys", "data"];

/** Which sections are open, remembered across visits. */
function useOpenSections(): [
  ReadonlySet<SectionId>,
  (id: SectionId) => void,
  (id: SectionId) => void,
] {
  const [open, setOpen] = useState<ReadonlySet<SectionId>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null") as unknown;
      if (Array.isArray(saved)) return new Set(saved as SectionId[]);
    } catch {
      // Storage can be unavailable or hold something else; the default is fine.
    }
    return new Set(DEFAULT_OPEN);
  });
  const save = useCallback((next: ReadonlySet<SectionId>) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // Ignore: the sections just won't be remembered.
    }
    return next;
  }, []);
  const toggle = useCallback(
    (id: SectionId) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return save(next);
      }),
    [save],
  );
  const openOne = useCallback(
    (id: SectionId) => setOpen((prev) => (prev.has(id) ? prev : save(new Set([...prev, id])))),
    [save],
  );
  return [open, toggle, openOne];
}

/** The section that lists a selection, if any. */
function sectionOf(
  selected: string | undefined,
  journeyId: string | undefined,
  landscape: boolean,
): SectionId | undefined {
  if (journeyId) return "journeys";
  if (!selected) return undefined;
  if (selected.startsWith("actor:")) return "actors";
  if (selected.startsWith("data:") || selected.startsWith("field:")) return "data";
  if (selected.startsWith("domain:")) return "domains";
  if (selected.startsWith("element:")) {
    // In a landscape, a repo's box is listed under Repos.
    return landscape && !selected.slice(8).includes(".") ? "repos" : "elements";
  }
  return undefined;
}

function Item(props: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  hintClass?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`side-item${props.active ? " is-active" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
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
  for (const d of model.data.values()) {
    if (match(d.id, d.spec.name, d.spec.description, ...Object.keys(d.spec.fields ?? {}))) {
      hits.push({
        key: `data:${model.namespace}.${d.id}`,
        label: d.spec.name ?? d.id,
        hint: d.spec.kind,
      });
    }
  }
  for (const e of model.elements.values()) {
    if (match(e.id, e.spec.name, e.spec.description, e.spec.technology)) {
      hits.push({ key: `element:${e.id}`, label: e.spec.name ?? e.id, hint: e.spec.kind });
    }
  }
  return hits;
}
