import { z } from "zod";
import type { ActorSpec, ElementKind, ElementSpec, ModelFile } from "./schema.js";
import { SPEC_VERSION } from "./schema.js";

const V1EntrySchema = z.looseObject({
  description: z.string().optional(),
  documentation: z.string().optional(),
  repository: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string().nullable()).nullable().optional(),
});

/** The v0/v1 format read by `@archdoc/archdoc-ui` 0.1–0.2. */
export const V1ModelSchema = z.looseObject({
  archdoc: z.union([z.string(), z.number()]).optional(),
  users: z.record(z.string(), V1EntrySchema.nullable()).nullable().optional(),
  components: z.record(z.string(), V1EntrySchema.nullable()).nullable().optional(),
  /** Called `services` before 0.2.0. */
  services: z.record(z.string(), V1EntrySchema.nullable()).nullable().optional(),
});

export type V1Model = z.infer<typeof V1ModelSchema>;

/** True when a parsed YAML document looks like a v1 model rather than v2. */
export function isV1Model(doc: unknown): boolean {
  if (typeof doc !== "object" || doc === null) return false;
  const d = doc as Record<string, unknown>;
  if (typeof d.archdoc === "string" && d.archdoc.startsWith("2")) return false;
  return "users" in d || "components" in d || "services" in d;
}

export interface MigrateOptions {
  namespace: string;
  name?: string;
}

export interface MigrateResult {
  model: ModelFile;
  /** Human-readable notes about choices the migration made. */
  notes: string[];
}

const DATASTORE_TAGS = new Set([
  "database",
  "db",
  "datastore",
  "storage",
  "cache",
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "mongodb",
  "redis",
  "dynamodb",
  "elasticsearch",
]);
const QUEUE_TAGS = new Set(["queue", "kafka", "rabbitmq", "sqs", "pubsub", "nats"]);

function guessKind(tags: string[] | undefined): ElementKind {
  const lower = (tags ?? []).map((t) => t.toLowerCase());
  if (lower.some((t) => DATASTORE_TAGS.has(t))) return "datastore";
  if (lower.some((t) => QUEUE_TAGS.has(t))) return "queue";
  return "container";
}

function uses(deps: Record<string, string | null> | null | undefined) {
  if (!deps || Object.keys(deps).length === 0) return undefined;
  return Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, v ?? null]));
}

function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Migrate a v1 model to v2: `users` become person actors, `components` (or
 * `services`) become elements, and `dependencies` become `uses`.
 */
export function migrateV1(doc: unknown, options: MigrateOptions): MigrateResult {
  const v1 = V1ModelSchema.parse(doc);
  const notes: string[] = [];

  const actors: Record<string, ActorSpec> = {};
  for (const [id, user] of Object.entries(v1.users ?? {})) {
    actors[id] = defined({
      kind: "person" as const,
      description: user?.description,
      documentation: user?.documentation,
      tags: user?.tags,
      uses: uses(user?.dependencies),
    });
  }
  if (Object.keys(actors).length > 0) {
    notes.push(
      `${Object.keys(actors).length} user(s) became actors of kind "person". Change the kind to role, team, organization, or agent where that fits better.`,
    );
  }

  const components = { ...(v1.services ?? {}), ...(v1.components ?? {}) };
  if (v1.services) notes.push('"services" (pre-0.2.0) were migrated the same way as components.');

  const elements: Record<string, ElementSpec> = {};
  const kinds: Record<string, number> = {};
  for (const [id, c] of Object.entries(components)) {
    const kind = guessKind(c?.tags);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    elements[id] = defined({
      kind,
      description: c?.description,
      documentation: c?.documentation,
      tags: c?.tags,
      links: c?.repository ? [{ url: c.repository, title: "Repository" }] : undefined,
      uses: uses(c?.dependencies),
    });
  }
  if (Object.keys(elements).length > 0) {
    const summary = Object.entries(kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    notes.push(
      `Element kinds were guessed from tags (${summary}). Review them, and consider grouping containers under a system.`,
    );
  }

  const model: ModelFile = defined({
    archdoc: SPEC_VERSION,
    namespace: options.namespace,
    name: options.name,
    actors: Object.keys(actors).length ? actors : undefined,
    elements: Object.keys(elements).length ? elements : undefined,
  });
  return { model, notes };
}
