import type {
  ActorSpec,
  Bundle,
  DataEntrySpec,
  ElementSpec,
  ImportSpec,
  JourneySpec,
  JourneyStepSpec,
  Provenance,
  RuleSpec,
  Status,
} from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "./diagnostics.js";

/** A local actor or element, by its ID within this model. */
export interface NodeRef {
  type: "actor" | "element";
  id: string;
}

/** Something in another repo's namespace. Federation (roadmap Phase 4) resolves these. */
export interface ExternalRef {
  type: "external";
  namespace: string;
  /** Fully qualified reference, such as `payments.charges`. */
  ref: string;
}

export type Target = NodeRef | ExternalRef;

export interface ActorNode {
  type: "actor";
  id: string;
  spec: ActorSpec;
  location?: SourceLocation | undefined;
}

export interface CodeRef {
  path: string;
  description?: string | undefined;
}

export interface ElementNode {
  type: "element";
  /** Dotted path from the top of the model, such as `toolchain.core.loader`. */
  id: string;
  /** The element's own key, such as `loader`. */
  key: string;
  parentId?: string | undefined;
  childIds: string[];
  /** 0 for top-level elements. */
  depth: number;
  spec: ElementSpec;
  code: CodeRef[];
  location?: SourceLocation | undefined;
}

export interface Relationship {
  from: NodeRef;
  to: Target;
  /** The reference as written in `uses`. */
  ref: string;
  description?: string | undefined;
  technology?: string | undefined;
  /** The target's contract this goes through, such as an api path or a topic. */
  via?: string | undefined;
  status: Status;
  sends: string[];
  provenance?: Provenance | undefined;
  location?: SourceLocation | undefined;
}

export interface JourneyStep {
  index: number;
  spec: JourneyStepSpec;
  from?: Target | undefined;
  to?: Target | undefined;
  location?: SourceLocation | undefined;
}

export interface JourneyNode {
  id: string;
  spec: JourneySpec;
  actor?: Target | undefined;
  steps: JourneyStep[];
  location?: SourceLocation | undefined;
}

export interface DataNode {
  id: string;
  spec: DataEntrySpec;
  location?: SourceLocation | undefined;
}

export interface Model {
  namespace: string;
  name?: string | undefined;
  description?: string | undefined;
  imports: Record<string, ImportSpec>;
  actors: Map<string, ActorNode>;
  elements: Map<string, ElementNode>;
  journeys: Map<string, JourneyNode>;
  data: Map<string, DataNode>;
  rules: RuleSpec[];
  relationships: Relationship[];
  /** Model files that were read, in load order. */
  files: string[];
  diagnostics: Diagnostic[];
  /** Where each import is written in the root file. */
  importLocations?: Map<string, SourceLocation> | undefined;
  /** Other repos' models, from the vendored bundles in archdoc.lock. Empty until synced. */
  imported?: Map<string, ImportedModel> | undefined;
  /** The `landscape:` import, as written. */
  landscapeImport?: ImportSpec | undefined;
  /** The landscape and the models it imports, from archdoc.lock. Undefined until synced. */
  landscape?: Landscape | undefined;
}

/** The landscape repo's model, with every model it imports (except this one). */
export interface Landscape extends ImportedModel {
  /** The other repos' models, at the versions the landscape pins. */
  members: Map<string, ImportedModel>;
}

/** Another repo's model, as pinned in archdoc.lock. */
export interface ImportedModel {
  namespace: string;
  version?: string | undefined;
  commit?: string | undefined;
  source?: string | undefined;
  bundle: Bundle;
  model: Model;
}

export function nodeKey(ref: NodeRef | ExternalRef): string {
  return ref.type === "external" ? `external:${ref.ref}` : `${ref.type}:${ref.id}`;
}

export function describeTarget(t: Target): string {
  return t.type === "external" ? t.ref : t.id;
}
