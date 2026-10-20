import {
  DataRegistry,
  filesUnder,
  getActor,
  getElement,
  type JourneyNode,
  type Model,
  nodeKey,
  type Relationship,
  type Target,
} from "@archdoc/core/browser";
import type { ReactNode } from "react";
import type { Compare } from "../model/compare.js";
import { targetLabel } from "../model/stories.js";
import type { LandscapeInfo } from "../model/useModel.js";
import { type CodeContext, CodeSection } from "./code.js";
import { DataDetails, FieldDetails } from "./DataPanels.js";

export interface DetailsProps {
  model: Model;
  selected?: string | undefined;
  focused: boolean;
  expanded: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onJourney: (id: string) => void;
  onFocus: (on: boolean) => void;
  onToggle: (elementId: string) => void;
  code: CodeContext;
  compare?: Compare | undefined;
  landscape?: LandscapeInfo | undefined;
}

/** What's selected: an element, actor, other repo's element, domain, data entry, or field. */
export function Details(props: DetailsProps) {
  const { model, selected } = props;
  if (selected?.startsWith("element:") && !model.elements.has(selected.slice(8)) && props.compare) {
    return <RemovedDetails {...props} compare={props.compare} id={selected} />;
  }
  if (selected?.startsWith("element:")) return <ElementDetails {...props} id={selected.slice(8)} />;
  if (selected?.startsWith("actor:")) return <ActorDetails {...props} id={selected.slice(6)} />;
  if (selected?.startsWith("external:"))
    return <ExternalDetails {...props} ref_={selected.slice(9)} />;
  if (selected?.startsWith("domain:")) return <DomainDetails {...props} id={selected.slice(7)} />;
  if (selected?.startsWith("data:"))
    return <DataDetails model={model} entry={selected.slice(5)} onSelect={props.onSelect} />;
  if (selected?.startsWith("field:"))
    return <FieldDetails model={model} field={selected.slice(6)} onSelect={props.onSelect} />;

  return null;
}

function ElementDetails(props: DetailsProps & { id: string }) {
  const view = getElement(props.model, props.id);
  if (!view) return <Missing />;
  const { element: el } = view;
  const open = props.expanded.has(el.id);
  return (
    <div className="details">
      <Breadcrumbs
        items={view.ancestors.map((a) => ({ key: `element:${a.id}`, label: a.spec.name ?? a.key }))}
        onSelect={props.onSelect}
      />
      <p className="eyebrow">{el.spec.kind}</p>
      <h1>{el.spec.name ?? el.key}</h1>
      <Chips
        items={[
          el.spec.technology,
          statusLabel(el.spec.status),
          provenanceLabel(el.spec.provenance),
        ]}
      />
      <ChangeNote compare={props.compare} id={el.id} />
      {el.spec.description ? <p className="lede">{el.spec.description}</p> : null}
      {el.spec.documentation ? <p>{el.spec.documentation}</p> : null}
      <Actions>
        <FocusButton {...props} />
        {el.childIds.length ? (
          <button type="button" className="btn" onClick={() => props.onToggle(el.id)}>
            {open ? "Collapse" : `Open (${el.childIds.length} inside)`}
          </button>
        ) : null}
      </Actions>

      {view.owners.length ? (
        <Block title="Owners">
          <Links
            items={view.owners.map((o) => ({
              key: `actor:${o}`,
              label: o,
              missing: !props.model.actors.has(o),
            }))}
            onSelect={props.onSelect}
          />
        </Block>
      ) : null}
      {el.code.length || el.childIds.length ? (
        <Block title="Code">
          {el.code.length === 0 ? (
            <p className="muted">No code paths of its own. Its parts have them.</p>
          ) : null}
          <CodeSection
            model={props.model}
            elementId={el.id}
            ctx={props.code}
            mapped={filesUnder(props.model, props.code.codemap, el.id)}
          />
        </Block>
      ) : null}
      <RelList title="Uses" rels={view.uses} side="to" {...props} />
      <RelList title="Used by" rels={view.usedBy} side="from" {...props} />
      {view.children.length ? (
        <Block title="Inside">
          <Links
            items={view.children.map((c) => ({
              key: `element:${c.id}`,
              label: c.spec.name ?? c.key,
              hint: c.spec.kind,
            }))}
            onSelect={props.onSelect}
          />
        </Block>
      ) : null}
      <JourneyLinks journeys={view.journeys} onJourney={props.onJourney} />
    </div>
  );
}

function ActorDetails(props: DetailsProps & { id: string }) {
  const view = getActor(props.model, props.id);
  if (!view) return <Missing />;
  const { actor } = view;
  return (
    <div className="details">
      <p className="eyebrow">Actor · {actor.spec.kind}</p>
      <h1>{actor.spec.name ?? actor.id}</h1>
      <Chips
        items={[actor.spec.segment, statusLabel(actor.spec.status), ...(actor.spec.members ?? [])]}
      />
      {actor.spec.description ? <p className="lede">{actor.spec.description}</p> : null}
      <Actions>
        <FocusButton {...props} label="Show only what this actor uses and owns" />
      </Actions>
      <RelList title="Uses" rels={view.uses} side="to" {...props} />
      {view.owns.length ? (
        <Block title="Owns">
          <Links
            items={view.owns.map((e) => ({
              key: `element:${e.id}`,
              label: e.spec.name ?? e.id,
              hint: e.spec.kind,
            }))}
            onSelect={props.onSelect}
          />
        </Block>
      ) : null}
      <JourneyLinks
        journeys={view.journeys.map((j) => j.journey)}
        roles={new Map(view.journeys.map((j) => [j.journey.id, j.role]))}
        onJourney={props.onJourney}
      />
    </div>
  );
}

function DomainDetails(props: DetailsProps & { id: string }) {
  const domain = props.landscape?.domains.find((d) => d.id === props.id);
  if (!domain) return <Missing />;
  const { model } = props;
  const members = domain.members.map((id) => model.elements.get(id)).filter((e) => e !== undefined);
  // Journeys that pass through the domain, from any repo.
  const inside = (t: Target | undefined) =>
    t?.type === "element" && domain.members.some((m) => t.id === m || t.id.startsWith(`${m}.`));
  const journeys = [...model.journeys.values()].filter((j) =>
    j.steps.some((s) => inside(s.from) || inside(s.to)),
  );
  return (
    <div className="details">
      <p className="eyebrow">Domain</p>
      <h1>{domain.name ?? domain.id}</h1>
      {domain.description ? <p className="lede">{domain.description}</p> : null}
      {domain.owners.length ? (
        <Block title="Owners">
          <Links
            items={domain.owners.map((o) => ({
              key: `actor:${o}`,
              label: model.actors.get(o)?.spec.name ?? o,
              hint: model.actors.get(o)?.spec.kind,
            }))}
            onSelect={props.onSelect}
          />
        </Block>
      ) : null}
      <Block title="Members">
        <Links
          items={members.map((e) => ({
            key: `element:${e.id}`,
            label: e.spec.name ?? e.id,
            hint: e.spec.tags?.includes("repo") && !e.parentId ? "repo" : e.spec.kind,
          }))}
          onSelect={props.onSelect}
        />
      </Block>
      <JourneyLinks journeys={journeys} onJourney={props.onJourney} />
    </div>
  );
}

function ExternalDetails(props: DetailsProps & { ref_: string }) {
  const usedBy = props.model.relationships.filter(
    (r) => r.to.type === "external" && r.to.ref === props.ref_,
  );
  const ns = props.ref_.split(".")[0] ?? "";
  const other = new DataRegistry(props.model).models.get(ns);
  const there = other?.elements.get(props.ref_.slice(ns.length + 1));
  const source = props.model.imports[ns];
  return (
    <div className="details">
      <p className="eyebrow">
        {there?.spec.kind ?? "Element"} in {other?.name ?? ns}
      </p>
      <h1>{targetLabel(props.model, { type: "external", namespace: ns, ref: props.ref_ })}</h1>
      <Chips
        items={[there?.spec.technology, source ? Object.values(source).join(" @ ") : undefined]}
      />
      {there?.spec.description ? <p className="lede">{there.spec.description}</p> : null}
      {there?.spec.owners?.length ? (
        <Block title="Owners">
          <p>{there.spec.owners.join(", ")}</p>
        </Block>
      ) : null}
      <RelList title="Used by" rels={usedBy} side="from" {...props} />
    </div>
  );
}

function ChangeNote({ compare, id }: { compare?: Compare | undefined; id: string }) {
  if (!compare) return null;
  const c = compare.diff.elements.find((x) => x.id === id);
  // A box changes with what's inside it.
  const inside = compare.diff.elements.filter((x) => x.id.startsWith(`${id}.`));
  if (!c && !inside.length) return null;
  const what = !c
    ? `Changed since ${compare.ref}, inside:`
    : c.kind === "added"
      ? `Added since ${compare.ref}.`
      : c.kind === "moved"
        ? `Moved from ${c.from} since ${compare.ref}.`
        : `Changed since ${compare.ref}: ${c.fields.join(", ")}.`;
  return (
    <div className={`change-note change-${c?.kind ?? "changed"}`}>
      <p>{what}</p>
      {inside.length && c?.kind !== "added" ? (
        <ul className="change-inside">
          {inside.map((x) => (
            <li key={x.id}>
              <span className={`change-mark change-${x.kind}`}>
                {x.kind === "added" ? "+" : x.kind === "removed" ? "−" : "~"}
              </span>{" "}
              {x.id.slice(id.length + 1)} {x.kind}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RemovedDetails(props: DetailsProps & { compare: Compare; id: string }) {
  const el = props.compare.base.elements.get(props.id.slice(8));
  return (
    <div className="details">
      <p className="eyebrow">{el?.spec.kind ?? "element"}</p>
      <h1>{el?.spec.name ?? el?.key ?? props.id.slice(8)}</h1>
      <p className="change-note change-removed">Removed since {props.compare.ref}.</p>
      {el?.spec.description ? <p className="lede">{el.spec.description}</p> : null}
      {el?.code.length ? (
        <Block title="Code it mapped">
          <ul className="code-list">
            {el.code.map((c) => (
              <li key={c.path}>
                <code>{c.path}</code>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
    </div>
  );
}

function RelList(
  props: DetailsProps & { title: string; rels: Relationship[]; side: "from" | "to" },
) {
  if (props.rels.length === 0) return null;
  return (
    <Block title={props.title}>
      <ul className="rel-list">
        {props.rels.map((r) => {
          const t: Target = props.side === "to" ? r.to : r.from;
          return (
            <li
              key={`${nodeKey(r.from)}->${nodeKey(r.to)}`}
              className={r.status === "planned" ? "is-planned" : ""}
            >
              <button type="button" className="link" onClick={() => props.onSelect(nodeKey(t))}>
                {labelOf(props.model, t)}
              </button>
              {r.status !== "active" ? <span className="chip small">{r.status}</span> : null}
              {r.technology ? <span className="chip small">{r.technology}</span> : null}
              {r.description ? <p>{r.description}</p> : null}
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

function JourneyLinks(props: {
  journeys: JourneyNode[];
  roles?: Map<string, string>;
  onJourney: (id: string) => void;
}) {
  if (props.journeys.length === 0) return null;
  return (
    <Block title="Journeys">
      <ul className="link-list">
        {props.journeys.map((j) => (
          <li key={j.id}>
            <button type="button" className="link" onClick={() => props.onJourney(j.id)}>
              {j.spec.name ?? j.id}
            </button>
            <span className="muted">
              {" "}
              · {props.roles?.get(j.id) ?? j.spec.importance ?? "normal"}
            </span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function FocusButton(props: DetailsProps & { label?: string }) {
  return (
    <button
      type="button"
      className={`btn${props.focused ? " is-on" : ""}`}
      aria-pressed={props.focused}
      onClick={() => props.onFocus(!props.focused)}
      title={props.label ?? "Show only this and what it's connected to"}
    >
      {props.focused ? "Show everything" : "Focus"}
    </button>
  );
}

function Breadcrumbs(props: {
  items: { key: string; label: string }[];
  onSelect: (k: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <nav className="crumbs" aria-label="Parents">
      {props.items.map((c) => (
        <button key={c.key} type="button" className="link" onClick={() => props.onSelect(c.key)}>
          {c.label}
        </button>
      ))}
    </nav>
  );
}

function Links(props: {
  items: { key: string; label: string; hint?: string; missing?: boolean }[];
  onSelect: (k: string) => void;
}) {
  return (
    <ul className="link-list">
      {props.items.map((i) => (
        <li key={i.key}>
          {i.missing ? (
            <span className="muted" title="Not defined in this model">
              {i.label}
            </span>
          ) : (
            <button type="button" className="link" onClick={() => props.onSelect(i.key)}>
              {i.label}
            </button>
          )}
          {i.hint ? <span className="muted"> · {i.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Chips({ items }: { items: (string | undefined)[] }) {
  const shown = items.filter((i): i is string => Boolean(i));
  if (shown.length === 0) return null;
  return (
    <div className="chips">
      {shown.map((c) => (
        <span key={c} className="chip">
          {c}
        </span>
      ))}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="block">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

function Missing() {
  return (
    <div className="details">
      <p className="lede">This is no longer in the model.</p>
    </div>
  );
}

function labelOf(model: Model, t: Target): string {
  return targetLabel(model, t);
}

function statusLabel(status: string | undefined) {
  return status && status !== "active" ? status : undefined;
}

function provenanceLabel(p: { source: string; by?: string | undefined } | undefined) {
  if (!p || p.source === "declared") return undefined;
  return p.by ? `${p.source} by ${p.by}` : p.source;
}
