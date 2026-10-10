import type { ExternalRef, NodeRef } from "../model.js";

export type Resolution =
  | { status: "resolved"; target: NodeRef }
  | { status: "external"; target: ExternalRef }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unresolved"; hint?: string };

/**
 * Resolves references written in the model.
 *
 * Element references are looked up the way names are in code: first next to
 * the referring element (siblings), then in each enclosing scope, then as a
 * unique suffix anywhere in the model (`web` finds `toolchain.web` when only
 * one element ends that way). A reference whose first segment is an imported
 * namespace (`payments.charges`) points to another repo. A reference prefixed
 * with this model's own namespace is absolute.
 */
export class Resolver {
  constructor(
    private readonly namespace: string,
    private readonly importedNamespaces: ReadonlySet<string>,
    private readonly elementIds: ReadonlySet<string>,
    private readonly actorIds: ReadonlySet<string>,
  ) {}

  element(ref: string, scope?: string): Resolution {
    const own = this.stripNamespace(ref);
    if (own !== undefined) {
      return this.elementIds.has(own)
        ? { status: "resolved", target: { type: "element", id: own } }
        : { status: "unresolved", hint: `No element "${own}" in namespace "${this.namespace}".` };
    }

    for (let s = scope; ; s = parentOf(s)) {
      const candidate = s ? `${s}.${ref}` : ref;
      if (this.elementIds.has(candidate)) {
        return { status: "resolved", target: { type: "element", id: candidate } };
      }
      if (!s) break;
    }

    const external = this.external(ref);
    if (external) return external;

    const matches = [...this.elementIds].filter((id) => id.endsWith(`.${ref}`));
    if (matches.length === 1) {
      return { status: "resolved", target: { type: "element", id: matches[0] as string } };
    }
    if (matches.length > 1) return { status: "ambiguous", candidates: matches.sort() };
    return { status: "unresolved", hint: this.unknownNamespaceHint(ref) };
  }

  actor(ref: string): Resolution {
    const id = this.stripNamespace(ref) ?? ref;
    if (this.actorIds.has(id)) return { status: "resolved", target: { type: "actor", id } };
    return this.external(ref) ?? { status: "unresolved", hint: this.unknownNamespaceHint(ref) };
  }

  /** An actor or an element, as in journey steps. */
  endpoint(ref: string): Resolution {
    const actor = this.actor(ref);
    const element = this.element(ref);
    if (actor.status === "resolved" && element.status === "resolved") {
      return {
        status: "ambiguous",
        candidates: [`actor ${actor.target.id}`, `element ${element.target.id}`],
      };
    }
    if (actor.status === "resolved") return actor;
    if (element.status !== "unresolved") return element;
    return actor;
  }

  /** True when `ref` starts with an imported namespace, such as `payments.Refund`. */
  isImported(ref: string): boolean {
    return this.external(ref) !== undefined;
  }

  private stripNamespace(ref: string): string | undefined {
    const prefix = `${this.namespace}.`;
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
  }

  private external(ref: string): Resolution | undefined {
    const dot = ref.indexOf(".");
    if (dot <= 0) return undefined;
    const namespace = ref.slice(0, dot);
    if (!this.importedNamespaces.has(namespace)) return undefined;
    return { status: "external", target: { type: "external", namespace, ref } };
  }

  private unknownNamespaceHint(ref: string): string | undefined {
    const dot = ref.indexOf(".");
    if (dot <= 0) return undefined;
    const first = ref.slice(0, dot);
    return `"${first}" is not an element here or an imported namespace. If it lives in another repo, add it to imports in archdoc.yaml.`;
  }
}

export function parentOf(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const dot = id.lastIndexOf(".");
  return dot === -1 ? undefined : id.slice(0, dot);
}
