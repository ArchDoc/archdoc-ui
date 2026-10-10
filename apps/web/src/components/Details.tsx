import {
  describeTarget,
  getActor,
  getElement,
  type JourneyNode,
  type Model,
  nodeKey,
  overview,
  type Relationship,
  type Target,
} from "@archdoc/core/browser";
import type { ReactNode } from "react";

export interface DetailsProps {
  model: Model;
  selected?: string | undefined;
  journey?: JourneyNode | undefined;
  step: number;
  focused: boolean;
  expanded: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onJourney: (id: string) => void;
  onStep: (step: number) => void;
  onFocus: (on: boolean) => void;
  onToggle: (elementId: string) => void;
}

export function Details(props: DetailsProps) {
  const { model, selected, journey } = props;
  if (journey) return <JourneyDetails {...props} journey={journey} />;
  if (selected?.startsWith("element:")) return <ElementDetails {...props} id={selected.slice(8)} />;
  if (selected?.startsWith("actor:")) return <ActorDetails {...props} id={selected.slice(6)} />;
  if (selected?.startsWith("external:"))
    return <ExternalDetails {...props} ref_={selected.slice(9)} />;

  const o = overview(model);
  return (
    <div className="details">
      <p className="eyebrow">Model · {model.namespace}</p>
      <h1>{model.name ?? model.namespace}</h1>
      {model.description ? <p className="lede">{model.description}</p> : null}
      <dl className="stats">
        <Stat n={o.counts.actors} label="actors" />
        <Stat n={o.counts.elements} label="elements" />
        <Stat n={o.counts.relationships} label="relationships" />
        <Stat n={o.counts.journeys} label="journeys" />
      </dl>
      <div className="hint">
        <p>
          Click a box to see what it is, what it uses, and who uses it. Double-click (or use the{" "}
          <kbd>+</kbd> badge) to open a box and see what's inside.
        </p>
        <p>Pick a journey on the left to follow how an actor reaches a goal, step by step.</p>
      </div>
    </div>
  );
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
      {el.code.length ? (
        <Block title="Code">
          <ul className="code-list">
            {el.code.map((c) => (
              <li key={c.path}>
                <code>{c.path}</code>
                {c.description ? <span> · {c.description}</span> : null}
              </li>
            ))}
          </ul>
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

function ExternalDetails(props: DetailsProps & { ref_: string }) {
  const usedBy = props.model.relationships.filter(
    (r) => r.to.type === "external" && r.to.ref === props.ref_,
  );
  const ns = props.ref_.split(".")[0] ?? "";
  const source = props.model.imports[ns];
  return (
    <div className="details">
      <p className="eyebrow">In another repo · {ns}</p>
      <h1>{props.ref_}</h1>
      {source ? <Chips items={[Object.values(source).join(" @ ")]} /> : null}
      <p className="lede">
        This lives in the <code>{ns}</code> namespace, which this model imports. Its details will
        appear here once models can be federated across repos.
      </p>
      <RelList title="Used by" rels={usedBy} side="from" {...props} />
    </div>
  );
}

function JourneyDetails(props: DetailsProps & { journey: JourneyNode }) {
  const { journey, step } = props;
  return (
    <div className="details">
      <p className="eyebrow">Journey · {journey.spec.importance ?? "normal"}</p>
      <h1>{journey.spec.name ?? journey.id}</h1>
      <Chips items={[statusLabel(journey.spec.status)]} />
      <p className="lede">{journey.spec.goal}</p>
      {journey.spec.description ? <p>{journey.spec.description}</p> : null}
      <Block title="Actor">
        <Links
          items={[{ key: `actor:${journey.spec.actor}`, label: journey.spec.actor }]}
          onSelect={props.onSelect}
        />
      </Block>
      <Block title="Steps">
        <ol className="steps">
          {journey.steps.map((s) => (
            <li key={s.index} className={s.index === step ? "is-current" : ""}>
              <button type="button" onClick={() => props.onStep(s.index)}>
                <span className="step-path">
                  {s.from ? describeTarget(s.from) : s.spec.from} →{" "}
                  {s.to ? describeTarget(s.to) : s.spec.to}
                </span>
                {s.spec.action ? <span className="step-action">{s.spec.action}</span> : null}
                {s.spec.code ? <code className="step-code">{s.spec.code}</code> : null}
              </button>
            </li>
          ))}
        </ol>
      </Block>
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

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{n}</dd>
    </div>
  );
}

function Missing() {
  return (
    <div className="details">
      <p className="lede">This is no longer in the model.</p>
    </div>
  );
}

function labelOf(model: Model, t: Target): string {
  if (t.type === "external") return t.ref;
  if (t.type === "actor") return model.actors.get(t.id)?.spec.name ?? t.id;
  return model.elements.get(t.id)?.spec.name ?? t.id;
}

function statusLabel(status: string | undefined) {
  return status && status !== "active" ? status : undefined;
}

function provenanceLabel(p: { source: string; by?: string | undefined } | undefined) {
  if (!p || p.source === "declared") return undefined;
  return p.by ? `${p.source} by ${p.by}` : p.source;
}
