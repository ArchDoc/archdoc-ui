import { z } from "zod";

/** The ArchDoc spec version this package implements. */
export const SPEC_VERSION = "2.0";

/**
 * Identifier for an actor, element, journey, or data entry. Dots are reserved
 * as path separators (`toolchain.core`, `payments.charges`).
 */
export const IdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "IDs use letters, digits, '-' and '_', and can't contain dots",
  );

/** A repo's globally unique namespace, used as the prefix in cross-repo references. */
export const NamespaceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "Namespaces are lowercase letters, digits, and '-'");

/** A reference to another actor or element: `api`, `toolchain.core`, or `payments.charges`. */
export const RefSchema = z.string().min(1);

export const StatusSchema = z
  .enum(["active", "planned", "deprecated"])
  .describe("Lifecycle status, used for roadmap overlays. Defaults to active.");

export const ProvenanceSchema = z
  .strictObject({
    source: z
      .enum(["declared", "inferred", "suggested"])
      .describe(
        "declared: written by a person (the default). inferred: produced by an analyzer. suggested: proposed by an AI agent and not yet accepted.",
      ),
    by: z
      .string()
      .optional()
      .describe("Who produced it: analyzer:ts-imports, agent:claude-code, human:@handle"),
    evidence: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .describe("Where a fact came from. Absent means declared by a person.");

const StringList = z.array(z.string());
const OneOrMany = z.union([z.string(), StringList]);

export const RelationshipSchema = z.strictObject({
  description: z.string().optional(),
  technology: z.string().optional(),
  via: z
    .string()
    .optional()
    .describe(
      "The contract this relationship goes through: an api, topic, or event the target provides",
    ),
  status: StatusSchema.optional(),
  sends: OneOrMany.optional().describe("Data entries sent along this relationship"),
  tags: StringList.optional(),
  provenance: ProvenanceSchema.optional(),
});

/** `uses` maps a target reference to a description, a full relationship, or nothing. */
export const UsesSchema = z
  .record(RefSchema, z.union([z.string(), RelationshipSchema, z.null()]))
  .describe("Outgoing relationships, keyed by the target's reference");

export const CodeRefSchema = z.union([
  z.string(),
  z.strictObject({
    path: z.string().min(1).describe("A file, directory, or glob relative to the repo root"),
    description: z.string().optional(),
  }),
]);

export const CodeSchema = z
  .union([CodeRefSchema, z.array(CodeRefSchema)])
  .describe("Where this lives in the code");

export const LinkSchema = z.strictObject({
  url: z.string().min(1),
  title: z.string().optional(),
});

export const ActorKindSchema = z.enum(["person", "role", "team", "organization", "agent"]);

export const ActorSchema = z.strictObject({
  kind: ActorKindSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  documentation: z.string().optional(),
  segment: z.string().optional(),
  members: StringList.optional().describe("Real team handles, such as @org/team"),
  tags: StringList.optional(),
  status: StatusSchema.optional(),
  uses: UsesSchema.optional(),
  provenance: ProvenanceSchema.optional(),
});

const contract = {
  description: z.string().optional(),
  status: StatusSchema.optional(),
  accepts: OneOrMany.optional().describe("Data entries it accepts"),
  returns: OneOrMany.optional().describe("Data entries it returns"),
  carries: OneOrMany.optional().describe("Data entries a topic or event carries"),
};

/** A contract an element exposes, which relationships from other repos can target with `via`. */
export const ProvideSchema = z
  .union([
    z.strictObject({ api: z.string().min(1).describe("API spec path or name"), ...contract }),
    z.strictObject({ topic: z.string().min(1).describe("Message topic"), ...contract }),
    z.strictObject({ event: z.string().min(1).describe("Event name"), ...contract }),
  ])
  .describe("An api, topic, or event this element exposes");

export const ElementKindSchema = z.enum([
  "system",
  "container",
  "component",
  "datastore",
  "queue",
  "external",
]);

export const StoreSchema = z.strictObject({
  entity: z.string(),
  key: z.string().optional(),
  retention: z.string().optional(),
  description: z.string().optional(),
});

export type ElementSpec = {
  kind: z.infer<typeof ElementKindSchema>;
  name?: string | undefined;
  description?: string | undefined;
  documentation?: string | undefined;
  technology?: string | undefined;
  tags?: string[] | undefined;
  owners?: string[] | undefined;
  status?: z.infer<typeof StatusSchema> | undefined;
  code?: z.infer<typeof CodeSchema> | undefined;
  links?: z.infer<typeof LinkSchema>[] | undefined;
  uses?: z.infer<typeof UsesSchema> | undefined;
  provides?: z.infer<typeof ProvideSchema>[] | undefined;
  stores?: Record<string, z.infer<typeof StoreSchema>> | undefined;
  provenance?: z.infer<typeof ProvenanceSchema> | undefined;
  elements?: Record<string, ElementSpec> | undefined;
};

export const ElementSchema: z.ZodType<ElementSpec> = z.strictObject({
  kind: ElementKindSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  documentation: z.string().optional(),
  technology: z.string().optional(),
  tags: StringList.optional(),
  owners: StringList.optional().describe("Actors (usually teams) that own this element"),
  status: StatusSchema.optional(),
  code: CodeSchema.optional(),
  links: z.array(LinkSchema).optional(),
  uses: UsesSchema.optional(),
  provides: z
    .array(ProvideSchema)
    .optional()
    .describe(
      "Contracts this element exposes, such as { api: openapi/trips.yaml } or { topic: trip.completed }",
    ),
  stores: z
    .record(z.string(), StoreSchema)
    .optional()
    .describe("Tables or collections in a datastore, mapped to data entities"),
  provenance: ProvenanceSchema.optional(),
  get elements() {
    return z.record(IdSchema, ElementSchema).optional().describe("Child elements");
  },
});

export const ImportanceSchema = z.enum(["critical", "high", "normal"]);

export const JourneyStepSchema = z.strictObject({
  from: RefSchema,
  to: RefSchema,
  action: z.string().optional(),
  description: z.string().optional(),
  code: z.string().optional().describe("Code entry point for this step"),
  sends: OneOrMany.optional(),
  provenance: ProvenanceSchema.optional(),
  // Data annotations. Their semantics arrive with the data layer (roadmap Phase 5).
  decides: z.string().optional(),
  via: z.string().optional(),
  when: z.string().optional(),
  branches: z.record(z.string(), z.unknown()).optional(),
  creates: z.unknown().optional(),
  changes: z.unknown().optional(),
});

const journeyShape = {
  name: z.string().optional(),
  actor: RefSchema.describe("The actor whose goal this journey serves"),
  goal: z.string(),
  description: z.string().optional(),
  importance: ImportanceSchema.optional().describe("Used to rank impact. Defaults to normal."),
  owners: StringList.optional(),
  tags: StringList.optional(),
  status: StatusSchema.optional(),
  steps: z.array(JourneyStepSchema).min(1),
};

export const JourneySchema = z.strictObject(journeyShape);

export const DataFieldSchema = z.strictObject({
  type: z.string(),
  description: z.string().optional(),
  classification: z
    .string()
    .optional()
    .describe("pii, pci, phi, internal, public, or a custom label"),
  values: z.array(z.union([z.string(), z.number()])).optional(),
  required: z.boolean().optional(),
});

export const DataEntrySchema = z.strictObject({
  kind: z.enum(["entity", "message", "event"]),
  description: z.string().optional(),
  owners: StringList.optional(),
  source: z
    .record(z.string(), z.string())
    .optional()
    .describe("The real schema this is imported from"),
  fields: z.record(z.string(), DataFieldSchema).optional(),
  states: StringList.optional(),
  tags: StringList.optional(),
});

export const RuleSchema = z.looseObject({
  id: IdSchema,
  description: z.string().optional(),
  scope: z
    .enum(["repo", "org"])
    .optional()
    .describe(
      "org: a landscape rule that also runs in every repo that imports the landscape. Defaults to repo.",
    ),
});

/** A business domain in a landscape: the repos and elements that belong to it. */
export const DomainSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  owners: StringList.optional(),
  namespaces: z
    .array(NamespaceSchema)
    .optional()
    .describe("Repos (by namespace) that belong to this domain"),
  elements: StringList.optional().describe("Elements that belong to it, such as payments.ledger"),
});

const importPath = z
  .string()
  .optional()
  .describe("Where the model lives in that repo. Defaults to .archdoc/");

export const ImportSchema = z
  .union([
    z.strictObject({
      github: z.string().describe("owner/repo on GitHub"),
      version: z.string().describe("Semver range matched against the repo's tags, such as ^5"),
      path: importPath,
    }),
    z.strictObject({
      git: z.string().describe("Any git URL, or a path relative to the repository root"),
      version: z.string().describe("Semver range matched against the repo's tags, such as ^5"),
      path: importPath,
    }),
    z.strictObject({
      url: z.string().describe("URL of a bundle written by archdoc publish"),
      version: z.string().optional(),
    }),
    z.strictObject({
      file: z
        .string()
        .describe(
          "A model file, model directory, or bundle, relative to the repository root, such as stubs for external systems",
        ),
    }),
  ])
  .describe("Another repo's model. archdoc sync pins it in archdoc.lock.");

const sections = {
  $schema: z.string().optional(),
  archdoc: z
    .string()
    .regex(/^2(\.\d+)?$/, 'This file is not spec v2. Run "archdoc migrate" to upgrade v1 models.')
    .optional(),
  actors: z.record(IdSchema, ActorSchema).optional(),
  elements: z.record(IdSchema, ElementSchema).optional(),
  journeys: z.record(IdSchema, JourneySchema).optional(),
  data: z.record(IdSchema, DataEntrySchema).optional(),
  // Reserved for the data layer and learning phases. Accepted now, validated later.
  mappings: z.record(IdSchema, z.looseObject({})).optional(),
  logic: z.record(IdSchema, z.looseObject({})).optional(),
  tours: z.record(IdSchema, z.looseObject({})).optional(),
  rules: z.array(RuleSchema).optional(),
  domains: z
    .record(IdSchema, DomainSchema)
    .optional()
    .describe("Business domains, for grouping a landscape by more than repo"),
};

/**
 * A model file. The root file (`archdoc.yaml`) sets `archdoc`, `namespace`, and
 * `imports`. Other files in `.archdoc/` add actors, elements, journeys, and so on.
 */
export const ModelFileSchema = z.strictObject({
  ...sections,
  namespace: NamespaceSchema.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  imports: z.record(NamespaceSchema, ImportSchema).optional(),
  landscape: ImportSchema.optional().describe(
    "The landscape repo, which imports every team's model. archdoc sync vendors it with those models, so this repo knows who uses it in other repos.",
  ),
});

/** A file that holds exactly one journey, such as `journeys/book-a-ride.yaml`. */
export const JourneyFileSchema = z.strictObject({
  $schema: z.string().optional(),
  archdoc: sections.archdoc,
  journey: IdSchema,
  ...journeyShape,
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type RelationshipSpec = z.infer<typeof RelationshipSchema>;
export type UsesSpec = z.infer<typeof UsesSchema>;
export type CodeRefSpec = z.infer<typeof CodeRefSchema>;
export type CodeSpec = z.infer<typeof CodeSchema>;
export type ActorKind = z.infer<typeof ActorKindSchema>;
export type ActorSpec = z.infer<typeof ActorSchema>;
export type ElementKind = z.infer<typeof ElementKindSchema>;
export type Importance = z.infer<typeof ImportanceSchema>;
export type JourneyStepSpec = z.infer<typeof JourneyStepSchema>;
export type JourneySpec = z.infer<typeof JourneySchema>;
export type DataEntrySpec = z.infer<typeof DataEntrySchema>;
export type RuleSpec = z.infer<typeof RuleSchema>;
export type DomainSpec = z.infer<typeof DomainSchema>;
export type ImportSpec = z.infer<typeof ImportSchema>;
export type ProvideSpec = z.infer<typeof ProvideSchema>;
export type ModelFile = z.infer<typeof ModelFileSchema>;
export type JourneyFile = z.infer<typeof JourneyFileSchema>;
