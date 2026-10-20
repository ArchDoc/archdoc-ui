/**
 * One word for each kind of thing in the model, as every surface says it: the
 * CLI, the PR comment, MCP, and the explorer. A connection between elements is
 * a "use", after the `uses:` key that declares it; a logic block is a
 * "decision".
 */
export const TERMS = {
  elements: { one: "element", many: "elements", title: "Elements" },
  relationships: { one: "use", many: "uses", title: "Uses" },
  actors: { one: "actor", many: "actors", title: "Actors" },
  journeys: { one: "journey", many: "journeys", title: "Journeys" },
  data: { one: "data entry", many: "data entries", title: "Data" },
  mappings: { one: "mapping", many: "mappings", title: "Mappings" },
  logic: { one: "decision", many: "decisions", title: "Decisions" },
  rules: { one: "rule", many: "rules", title: "Rules" },
} as const;

export type Term = keyof typeof TERMS;

/** "1 element", "3 uses". */
export function counted(term: Term, n: number): string {
  return `${n} ${n === 1 ? TERMS[term].one : TERMS[term].many}`;
}
