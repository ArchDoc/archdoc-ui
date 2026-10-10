import type {
  ActorSpec,
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
}

export function nodeKey(ref: NodeRef | ExternalRef): string {
  return ref.type === "external" ? `external:${ref.ref}` : `${ref.type}:${ref.id}`;
}

export function describeTarget(t: Target): string {
  return t.type === "external" ? t.ref : t.id;
}
