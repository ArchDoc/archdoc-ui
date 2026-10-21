import type { Model } from "@archdoc/core/browser";
import { useMemo } from "react";
import { journeyCards, journeyFacts, ownership } from "../model/stories.js";
import type { LandscapeInfo, SealsInfo } from "../model/useModel.js";

export interface OverviewProps {
  model: Model;
  landscape?: LandscapeInfo | undefined;
  /** Journeys a comparison affects, marked on their cards. */
  affected?: ReadonlySet<string> | undefined;
  /** With an archdoc.sum: facts whose code changed since they were sealed. */
  seals?: SealsInfo | undefined;
  onJourney: (id: string) => void;
  /** Light a journey up on the map, or stop. */
  onPreview: (id: string | undefined) => void;
  onSelect: (key: string) => void;
}

/**
 * The landing screen's left column: what the system is, what people do with
 * it (its journeys, most important first), and who owns what.
 */
export function Overview(props: OverviewProps) {
  const { model, landscape } = props;
  const cards = useMemo(() => journeyCards(model, landscape), [model, landscape]);
  const owners = useMemo(() => ownership(model), [model]);
  return (
    <div className="overview">
      <header className="overview-intro">
        <h1>{landscape?.name ?? model.name ?? model.namespace}</h1>
        {model.description ? <p className="lede">{model.description}</p> : null}
        {landscape ? (
          <ul className="repo-list" aria-label="Repos">
            {landscape.repos.map((r) => (
              <li key={r.namespace}>
                <button
                  type="button"
                  className="link"
                  onClick={() => props.onSelect(`element:${r.namespace}`)}
                >
                  {r.name ?? r.namespace}
                </button>
                {r.version ? <span className="muted"> {r.version}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <section className="overview-section" aria-labelledby="ov-journeys">
        <h2 id="ov-journeys">Start with what people do</h2>
        {cards.length ? (
          <ul className="journey-cards">
            {cards.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="journey-card"
                  onClick={() => props.onJourney(c.id)}
                  onMouseEnter={() => props.onPreview(c.id)}
                  onMouseLeave={() => props.onPreview(undefined)}
                  onFocus={() => props.onPreview(c.id)}
                  onBlur={() => props.onPreview(undefined)}
                >
                  <span className="journey-card-top">
                    <span className="journey-card-title">{c.title}</span>
                    <span className={`importance importance-${c.importance}`}>{c.importance}</span>
                  </span>
                  <span className="journey-card-path">
                    {c.path.map((name, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: the path is fixed for the card; "…" may repeat a name.
                      <span key={`${name}${i}`} className={name === "…" ? "muted" : undefined}>
                        {i ? <span className="arrow"> → </span> : null}
                        {name}
                      </span>
                    ))}
                  </span>
                  <span className="journey-card-facts">
                    {journeyFacts(c)}
                    {props.affected?.has(c.id) ? (
                      <span className="badge-changed"> · affected by the change</span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No journeys yet. A journey says how an actor reaches a goal, step by step.
          </p>
        )}
      </section>

      {props.seals ? <Recheck seals={props.seals} onSelect={props.onSelect} /> : null}

      {owners.length ? (
        <section className="overview-section" aria-labelledby="ov-owners">
          <h2 id="ov-owners">Who owns what</h2>
          <ul className="owner-list">
            {owners.map((o) => (
              <li key={o.id}>
                {model.actors.has(o.id) ? (
                  <button
                    type="button"
                    className="link"
                    onClick={() => props.onSelect(`actor:${o.id}`)}
                  >
                    {o.name}
                  </button>
                ) : (
                  <span>{o.name}</span>
                )}
                <span className="muted">
                  {o.elements} element{o.elements === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="hint">Click a box on the map to see what it uses; double-click to open it.</p>
    </div>
  );
}

/**
 * The facts whose code changed since someone checked the model against it,
 * as archdoc verify lists them, or a line saying the model still matches.
 */
function Recheck(props: { seals: SealsInfo; onSelect: (key: string) => void }) {
  const { seals } = props;
  if (seals.error) {
    return (
      <section className="overview-section recheck" aria-labelledby="ov-recheck">
        <h2 id="ov-recheck">Model and code</h2>
        <p className="muted">
          {seals.file} can't be read ({seals.error}).
        </p>
      </section>
    );
  }
  const changed = seals.facts.filter((f) => f.state === "changed");
  const unsealed = seals.facts.filter((f) => f.state === "unsealed");
  if (!seals.facts.length) {
    return (
      <p className="recheck-ok">
        The model matches its code: all {seals.total} facts that point at code are sealed.
      </p>
    );
  }
  return (
    <section className="overview-section recheck" aria-labelledby="ov-recheck">
      <h2 id="ov-recheck">To re-check against the code</h2>
      <p className="muted">
        {changed.length
          ? `The code under ${changed.length} fact${changed.length === 1 ? "" : "s"} changed since someone checked the model against it.`
          : ""}
        {unsealed.length
          ? ` ${unsealed.length} new fact${unsealed.length === 1 ? " hasn't" : "s haven't"} been checked yet.`
          : ""}
      </p>
      <ul className="recheck-list">
        {seals.facts.map((f) => (
          <li key={f.key} className={`recheck-${f.state}`}>
            {f.element ? (
              <button
                type="button"
                className="link"
                onClick={() => props.onSelect(`element:${f.element}`)}
              >
                {f.label}
              </button>
            ) : (
              <span>{f.label}</span>
            )}
            <span className="recheck-what">
              {f.state === "changed" ? f.changes.slice(0, 2).join("; ") : "not sealed yet"}
              {f.changes.length > 2 ? `; and ${f.changes.length - 2} more` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">
        Check each against the model, then run <code>archdoc seal &lt;fact&gt;</code>.
      </p>
    </section>
  );
}
