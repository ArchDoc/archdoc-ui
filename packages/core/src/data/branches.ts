import type { Model } from "../model.js";
import { DataRegistry } from "./registry.js";

/** One outcome of a decision, and the steps that run for it. */
export interface BranchOutcome {
  /** The outcome, as the decision's rules name it, such as auto-approve. */
  name: string;
  /**
   * The rule's CEL condition, or "otherwise" for its `else`. Undefined when
   * no rule of the decision names the outcome.
   */
  condition?: string | undefined;
  /** The step indexes (0-based) that run for this outcome: the steps with `when: <name>`. */
  steps: number[];
  /** Another journey the outcome continues as, from the deciding step's `branches:`. */
  next?: string | undefined;
  /** What the deciding step's `branches:` says about the outcome. */
  description?: string | undefined;
}

/** A journey in reading order: plain steps, and blocks of steps that run for one outcome each. */
export type JourneyItem =
  | { kind: "step"; index: number }
  | {
      kind: "branches";
      /** The logic that decides, from the last `decides:` step before the block. */
      decision?: string | undefined;
      /** The step (0-based) that decides. */
      decidedAt?: number | undefined;
      /**
       * Every outcome, in the order the decision's rules list them, then any
       * other outcome a step names. Outcomes no step runs for have no steps.
       */
      outcomes: BranchOutcome[];
      /** No steps follow the block: each outcome ends the journey (or continues as `next`). */
      last: boolean;
    };

/**
 * A journey's steps as they read: plain steps, and for each run of steps with
 * `when:`, one block per outcome of the decision before them, in the order
 * the decision's rules list them, so branches don't read as steps that all
 * happen. Logic is looked up in `model`, then in `alsoIn` (another repo's
 * model, for a journey found there). Empty for an unknown journey.
 */
export function journeyBranches(model: Model, journeyId: string, alsoIn?: Model): JourneyItem[] {
  const steps = model.journeys.get(journeyId)?.steps ?? [];
  const registries = [model, alsoIn]
    .filter((m): m is Model => m !== undefined)
    .map((m) => new DataRegistry(m));
  const logic = (ref: string) => {
    for (const r of registries) {
      const found = r.logic(ref);
      if (found) return found;
    }
    return undefined;
  };
  const items: JourneyItem[] = [];
  let decision: string | undefined;
  let decidedAt: number | undefined;
  for (let i = 0; i < steps.length; i++) {
    const spec = steps[i]?.spec;
    if (!spec?.when) {
      items.push({ kind: "step", index: i });
      if (spec?.decides) {
        decision = spec.decides;
        decidedAt = i;
      }
      continue;
    }
    const run: number[] = [];
    while (i < steps.length && steps[i]?.spec.when) run.push(i++);
    i--;
    const rules = decision ? (logic(decision)?.node.spec.rules ?? []) : [];
    const outcomeOf = (r: (typeof rules)[number]) => ("then" in r ? r.then : r.else);
    const order = rules.map(outcomeOf);
    const branches = decidedAt !== undefined ? steps[decidedAt]?.spec.branches : undefined;
    const names = [...new Set([...order, ...run.map((k) => steps[k]?.spec.when ?? "")])].sort(
      (a, b) => rank(order, a) - rank(order, b),
    );
    items.push({
      kind: "branches",
      decision,
      decidedAt,
      outcomes: names.map((name) => {
        const rule = rules.find((r) => outcomeOf(r) === name);
        return {
          name,
          condition: rule ? ("when" in rule ? rule.when : "otherwise") : undefined,
          steps: run.filter((k) => steps[k]?.spec.when === name),
          next: branches?.[name]?.next,
          description: branches?.[name]?.description,
        };
      }),
      last: i === steps.length - 1,
    });
  }
  return items;
}

function rank(order: string[], name: string): number {
  const i = order.indexOf(name);
  return i < 0 ? order.length : i;
}
