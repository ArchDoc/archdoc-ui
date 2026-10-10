import type { Model } from "../model.js";

export interface SearchHit {
  type: "element" | "actor" | "journey";
  id: string;
  /** Element kind, actor kind, or journey importance. */
  kind: string;
  description?: string | undefined;
  /** Code paths (elements) or step code entry points (journeys). */
  code: string[];
  score: number;
}

const STOP = new Set(
  "a an the to of in on for and or with how where what which do does is are i we new add make change update this that it".split(
    " ",
  ),
);

/**
 * Finds elements, actors, and journeys by words, so an agent can ask "where do
 * CLI commands live?" before it knows any file paths. Plain phrasing works:
 * filler words are ignored, results that match more of the words rank first,
 * and at least half of the words must match. Matches in IDs, names, and code
 * paths count most.
 */
export function search(model: Model, query: string, limit = 10): SearchHit[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w))
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return [];
  const needed = Math.max(1, Math.ceil(words.length / 2));

  /** Words matched (in thousands) plus their weights. */
  const score = (fields: { text: string | undefined; weight: number }[]): number => {
    let matched = 0;
    let weight = 0;
    for (const w of words) {
      const best = Math.max(
        0,
        ...fields.map((f) => (f.text?.toLowerCase().includes(w) ? f.weight : 0)),
      );
      if (best > 0) {
        matched++;
        weight += best;
      }
    }
    return matched * 1000 + weight;
  };

  const hits: SearchHit[] = [];
  for (const e of model.elements.values()) {
    const s = score([
      { text: e.id, weight: 5 },
      { text: e.spec.name, weight: 5 },
      { text: e.spec.kind, weight: 2 },
      { text: e.spec.technology, weight: 2 },
      { text: e.spec.tags?.join(" "), weight: 2 },
      { text: e.spec.description, weight: 1 },
      { text: e.code.map((c) => c.path).join(" "), weight: 3 },
    ]);
    if (s > 0) {
      // Prefer the specific part over the container that holds it.
      hits.push({
        type: "element",
        id: e.id,
        kind: e.spec.kind,
        description: e.spec.description,
        code: e.code.map((c) => c.path),
        score: s + e.depth * 0.5,
      });
    }
  }
  for (const a of model.actors.values()) {
    const s = score([
      { text: a.id, weight: 5 },
      { text: a.spec.name, weight: 5 },
      { text: a.spec.kind, weight: 2 },
      { text: a.spec.description, weight: 1 },
    ]);
    if (s > 0)
      hits.push({
        type: "actor",
        id: a.id,
        kind: a.spec.kind,
        description: a.spec.description,
        code: [],
        score: s,
      });
  }
  for (const j of model.journeys.values()) {
    const s = score([
      { text: j.id, weight: 5 },
      { text: j.spec.name, weight: 5 },
      { text: j.spec.goal, weight: 2 },
      { text: j.spec.steps.map((st) => st.action).join(" "), weight: 1 },
    ]);
    if (s > 0) {
      hits.push({
        type: "journey",
        id: j.id,
        kind: j.spec.importance ?? "normal",
        description: j.spec.goal,
        code: j.spec.steps.flatMap((st) => (st.code ? [st.code] : [])),
        score: s,
      });
    }
  }
  // Keep results that match at least half the words. For a long, sentence-like
  // query where nothing does, fall back to the closest matches.
  const best = Math.max(0, ...hits.map((h) => Math.floor(h.score / 1000)));
  const threshold = Math.min(needed, best);
  return hits
    .filter((h) => Math.floor(h.score / 1000) >= threshold)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
