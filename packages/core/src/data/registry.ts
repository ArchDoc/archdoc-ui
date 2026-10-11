import { otherModels } from "../federation/consumers.js";
import type { DataNode, LogicNode, MappingNode, Model } from "../model.js";
import { qualifyData } from "./resolve.js";

/** A qualified reference split into its namespace and local ID. */
function split(ref: string, ns: string): { ns: string; id: string } {
  const dot = ref.indexOf(".");
  return dot > 0 ? { ns: ref.slice(0, dot), id: ref.slice(dot + 1) } : { ns, id: ref };
}

/** Where an entry is stored: a datastore's table, in some repo. */
export interface StoredIn {
  namespace: string;
  element: string;
  table: string;
}

/** A mapping or logic block, with the model it's written in (references in it are relative to that). */
export interface Owned<T> {
  namespace: string;
  /** Qualified, such as payments.refund-to-ledger. */
  ref: string;
  node: T;
  model: Model;
}

/**
 * Every model this repo knows (its own, the ones it imports, and the
 * landscape's), so data, mappings, and logic can be followed across repos
 * by qualified name.
 */
export class DataRegistry {
  readonly models = new Map<string, Model>();

  constructor(readonly home: Model) {
    for (const [ns, m] of otherModels(home)) this.models.set(ns, m.model);
    this.models.set(home.namespace, home);
  }

  /** An entry by a reference written in namespace `ns`. */
  entry(ref: string, ns = this.home.namespace): { ref: string; node: DataNode } | undefined {
    const { ns: where, id } = split(ref, ns);
    const node = this.models.get(where)?.data.get(id);
    return node ? { ref: `${where}.${id}`, node } : undefined;
  }

  mapping(ref: string, ns = this.home.namespace): Owned<MappingNode> | undefined {
    const { ns: where, id } = split(ref, ns);
    const model = this.models.get(where);
    const node = model?.mappings.get(id);
    return model && node ? { namespace: where, ref: `${where}.${id}`, node, model } : undefined;
  }

  logic(ref: string, ns = this.home.namespace): Owned<LogicNode> | undefined {
    const { ns: where, id } = split(ref, ns);
    const model = this.models.get(where);
    const node = model?.logic.get(id);
    return model && node ? { namespace: where, ref: `${where}.${id}`, node, model } : undefined;
  }

  /** Every mapping in every known model. */
  allMappings(): Owned<MappingNode>[] {
    return [...this.models].flatMap(([ns, model]) =>
      [...model.mappings.values()].map((node) => ({
        namespace: ns,
        ref: `${ns}.${node.id}`,
        node,
        model,
      })),
    );
  }

  /** Where an entry (qualified) is stored, in any known model. */
  storedIn(entry: string): StoredIn[] {
    const out: StoredIn[] = [];
    for (const [ns, model] of this.models) {
      for (const e of model.elements.values()) {
        for (const [table, s] of Object.entries(e.spec.stores ?? {})) {
          if (qualifyData(s.entity, ns) === entry)
            out.push({ namespace: ns, element: e.id, table });
        }
      }
    }
    return out;
  }

  /**
   * What a mapping's `to` names, from the model it's written in: an entry
   * (LedgerEntry), or a datastore table (ledger.ledger_entries, or
   * payments.ledger.ledger_entries), whose entry it is.
   */
  target(to: string, ns: string): { entry: string; table?: StoredIn | undefined } | undefined {
    const direct = this.entry(to, ns);
    if (direct) return { entry: direct.ref };
    const dot = to.lastIndexOf(".");
    if (dot <= 0) return undefined;
    const table = to.slice(dot + 1);
    const { ns: where, id } = split(to.slice(0, dot), ns);
    // An element ID may itself be dotted (payments.ledger), so try this namespace first.
    for (const [n, elementId] of [
      [ns, to.slice(0, dot)],
      [where, id],
    ] as const) {
      const model = this.models.get(n);
      const store = model?.elements.get(elementId)?.spec.stores?.[table];
      if (store) {
        return {
          entry: qualifyData(store.entity, n),
          table: { namespace: n, element: elementId, table },
        };
      }
    }
    return undefined;
  }
}
