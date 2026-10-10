import {
  type CodeSpec,
  type ElementSpec,
  isV1Model,
  JourneyFileSchema,
  type JourneySpec,
  type ModelFile,
  ModelFileSchema,
  type UsesSpec,
} from "@archdoc/spec";
import type { z } from "zod";
import { validateJourneys } from "../check/journeys.js";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import type { ActorNode, CodeRef, ElementNode, Model, NodeRef, Relationship } from "../model.js";
import { type Resolution, Resolver } from "./resolve.js";
import { type ParsedFile, parseYaml, type YamlPath } from "./yaml.js";

export interface ModelSource {
  /** Path shown in diagnostics. */
  path: string;
  text: string;
}

export interface BuildOptions {
  /**
   * Path of the root file (the one with `archdoc` and `namespace`). Defaults to
   * the source named `archdoc.yaml` or `archdoc.yml`, else the first source.
   */
  root?: string;
}

const ROOT_ONLY = ["namespace", "name", "description", "imports"] as const;

/**
 * Builds a model from in-memory sources. Pure: no filesystem or network, so it
 * runs the same in Node, the browser, and CI.
 */
export function buildModel(sources: readonly ModelSource[], options: BuildOptions = {}): Model {
  const diagnostics: Diagnostic[] = [];
  const model: Model = {
    namespace: "",
    imports: {},
    actors: new Map(),
    elements: new Map(),
    journeys: new Map(),
    data: new Map(),
    rules: [],
    relationships: [],
    files: sources.map((s) => s.path),
    diagnostics,
  };

  const rootPath =
    options.root ??
    sources.find((s) => /(^|[/\\])archdoc\.ya?ml$/.test(s.path))?.path ??
    sources[0]?.path;
  if (!rootPath) {
    diagnostics.push({
      severity: "error",
      code: "model/not-found",
      message: "No model files found. Create .archdoc/archdoc.yaml.",
    });
    return model;
  }

  let schemaErrors = false;
  // Where each owner and `uses` entry was written, for reference diagnostics.
  const usesSites: {
    from: NodeRef;
    uses: UsesSpec;
    scope?: string;
    file: ParsedFile;
    path: YamlPath;
  }[] = [];
  const ownerSites: { owners: string[]; file: ParsedFile; path: YamlPath }[] = [];
  const journeySites = new Map<string, { file: ParsedFile; path: YamlPath }>();

  for (const source of sources) {
    const isRoot = source.path === rootPath;
    const { parsed, diagnostics: yamlDiagnostics } = parseYaml(source.path, source.text);
    diagnostics.push(...yamlDiagnostics);
    if (!parsed) {
      schemaErrors = true;
      continue;
    }
    const value = parsed.value;
    if (value === null || value === undefined) {
      if (isRoot) {
        diagnostics.push(error("model/missing-root-field", "The root file is empty.", parsed, []));
      }
      continue;
    }
    if (isV1Model(value)) {
      schemaErrors = true;
      diagnostics.push(
        error(
          "spec/v1-model",
          'This is a v1 model (users/components). Run "archdoc migrate" to convert it to v2.',
          parsed,
          ["archdoc"],
        ),
      );
      continue;
    }

    const isJourneyFile = typeof value === "object" && "journey" in value;
    const result = isJourneyFile
      ? JourneyFileSchema.safeParse(value)
      : ModelFileSchema.safeParse(value);
    if (!result.success) {
      schemaErrors = true;
      diagnostics.push(...schemaDiagnostics(result.error, parsed));
      continue;
    }

    if (isJourneyFile) {
      const {
        journey: id,
        $schema: _s,
        archdoc: _a,
        ...spec
      } = result.data as z.infer<typeof JourneyFileSchema>;
      addJourney(id, spec, parsed, []);
      continue;
    }

    const file = result.data as ModelFile;
    if (isRoot) {
      if (!file.archdoc) {
        diagnostics.push(
          error("model/missing-root-field", 'The root file needs archdoc: "2.0".', parsed, []),
        );
      }
      if (!file.namespace) {
        diagnostics.push(
          error(
            "model/missing-root-field",
            "The root file needs a namespace, such as namespace: payments. It makes IDs unique across repos.",
            parsed,
            [],
          ),
        );
      }
      model.namespace = file.namespace ?? "";
      model.name = file.name;
      model.description = file.description;
      model.imports = file.imports ?? {};
    } else {
      for (const key of ROOT_ONLY) {
        if (file[key] !== undefined) {
          diagnostics.push(
            error(
              "model/root-only-field",
              `"${key}" can only be set in the root file (${rootPath}).`,
              parsed,
              [key],
            ),
          );
        }
      }
    }

    for (const [id, spec] of Object.entries(file.actors ?? {})) {
      const path = ["actors", id];
      if (model.actors.has(id)) {
        diagnostics.push(duplicate("actor", id, parsed, path, model.actors.get(id)?.location));
        continue;
      }
      const node: ActorNode = { type: "actor", id, spec, location: parsed.locate(path) };
      model.actors.set(id, node);
      if (spec.uses) usesSites.push({ from: node, uses: spec.uses, file: parsed, path });
    }

    addElements(file.elements ?? {}, undefined, parsed, ["elements"], 0);

    for (const [id, spec] of Object.entries(file.journeys ?? {})) {
      addJourney(id, spec, parsed, ["journeys", id]);
    }

    for (const [id, spec] of Object.entries(file.data ?? {})) {
      const path = ["data", id];
      if (model.data.has(id)) {
        diagnostics.push(duplicate("data entry", id, parsed, path, model.data.get(id)?.location));
        continue;
      }
      model.data.set(id, { id, spec, location: parsed.locate(path) });
      if (spec.owners) ownerSites.push({ owners: spec.owners, file: parsed, path });
    }

    for (const [i, rule] of (file.rules ?? []).entries()) {
      if (model.rules.some((r) => r.id === rule.id)) {
        diagnostics.push(
          error("model/duplicate", `Rule "${rule.id}" is defined twice.`, parsed, ["rules", i]),
        );
        continue;
      }
      model.rules.push(rule);
    }
  }

  if (schemaErrors) {
    diagnostics.push({
      severity: "info",
      code: "model/incomplete",
      message:
        "Reference and journey checks were skipped. Fix the errors above, then validate again.",
    });
    return model;
  }

  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );

  for (const site of usesSites) {
    for (const [ref, value] of Object.entries(site.uses)) {
      const path = [...site.path, "uses", ref];
      const location = site.file.locate(path);
      const resolution = resolver.element(ref, site.scope);
      if (resolution.status === "resolved" || resolution.status === "external") {
        const rel = typeof value === "string" ? { description: value } : (value ?? {});
        model.relationships.push({
          from: { type: site.from.type, id: site.from.id },
          to: resolution.target,
          ref,
          description: rel.description,
          technology: rel.technology,
          status: rel.status ?? "active",
          sends: rel.sends === undefined ? [] : [rel.sends].flat(),
          provenance: rel.provenance,
          location,
        } satisfies Relationship);
        continue;
      }
      if (resolution.status === "unresolved" && resolver.actor(ref).status === "resolved") {
        diagnostics.push({
          severity: "error",
          code: "ref/uses-actor",
          message: `"${ref}" is an actor. "uses" can only point to elements. To show an element serving an actor, add uses to the actor instead.`,
          location,
          path: path.join("."),
        });
        continue;
      }
      diagnostics.push(refDiagnostic(resolution, `${site.from.id} uses "${ref}"`, location, path));
    }
  }

  for (const site of ownerSites) {
    for (const [i, owner] of site.owners.entries()) {
      const resolution = resolver.actor(owner);
      if (resolution.status === "resolved" || resolution.status === "external") continue;
      diagnostics.push({
        severity: "warning",
        code: "ref/unresolved-owner",
        message: `Owner "${owner}" is not an actor in this model. Add it under actors (usually kind: team).`,
        location: site.file.locate([...site.path, "owners", i]),
        path: [...site.path, "owners", i].join("."),
      });
    }
  }

  checkDataRefs(model, resolver);
  diagnostics.push(...validateJourneys(model, resolver, journeySites));
  return model;

  function addElements(
    specs: Record<string, ElementSpec>,
    parentId: string | undefined,
    file: ParsedFile,
    basePath: YamlPath,
    depth: number,
  ): string[] {
    const ids: string[] = [];
    for (const [key, spec] of Object.entries(specs)) {
      const id = parentId ? `${parentId}.${key}` : key;
      const path = [...basePath, key];
      if (model.elements.has(id)) {
        diagnostics.push(duplicate("element", id, file, path, model.elements.get(id)?.location));
        continue;
      }
      const node: ElementNode = {
        type: "element",
        id,
        key,
        parentId,
        childIds: [],
        depth,
        spec,
        code: normalizeCode(spec.code),
        location: file.locate(path),
      };
      model.elements.set(id, node);
      ids.push(id);
      if (spec.uses) usesSites.push({ from: node, uses: spec.uses, scope: parentId, file, path });
      if (spec.owners) ownerSites.push({ owners: spec.owners, file, path });
      node.childIds = addElements(spec.elements ?? {}, id, file, [...path, "elements"], depth + 1);
    }
    return ids;
  }

  function addJourney(id: string, spec: JourneySpec, file: ParsedFile, path: YamlPath) {
    if (model.journeys.has(id)) {
      diagnostics.push(duplicate("journey", id, file, path, model.journeys.get(id)?.location));
      return;
    }
    model.journeys.set(id, {
      id,
      spec,
      steps: spec.steps.map((step, index) => ({
        index,
        spec: step,
        location: file.locate([...path, "steps", index]),
      })),
      location: file.locate(path.length ? path : ["journey"]),
    });
    journeySites.set(id, { file, path });
    if (spec.owners) ownerSites.push({ owners: spec.owners, file, path });
  }
}

function checkDataRefs(model: Model, resolver: Resolver) {
  const known = (name: string) =>
    model.data.has(name) || resolver.isImported(name) || name.startsWith(`${model.namespace}.`);
  for (const rel of model.relationships) {
    for (const name of rel.sends) {
      if (known(name)) continue;
      model.diagnostics.push({
        severity: "warning",
        code: "ref/unresolved-data",
        message: `${rel.from.id} → ${rel.ref} sends "${name}", which is not defined under data.`,
        location: rel.location,
      });
    }
  }
}

export function normalizeCode(code: CodeSpec | undefined): CodeRef[] {
  if (code === undefined) return [];
  return [code].flat().map((c) => (typeof c === "string" ? { path: c } : c));
}

function error(code: string, message: string, file: ParsedFile, path: YamlPath): Diagnostic {
  return {
    severity: "error",
    code,
    message,
    location: file.locate(path),
    path: path.join(".") || undefined,
  };
}

function duplicate(
  what: string,
  id: string,
  file: ParsedFile,
  path: YamlPath,
  first: SourceLocation | undefined,
): Diagnostic {
  const where = first ? ` (first defined at ${first.file}:${first.line})` : "";
  return error(
    "model/duplicate",
    `${capitalize(what)} "${id}" is defined twice${where}.`,
    file,
    path,
  );
}

function refDiagnostic(
  resolution: Exclude<Resolution, { status: "resolved" | "external" }>,
  subject: string,
  location: SourceLocation,
  path: YamlPath,
): Diagnostic {
  if (resolution.status === "ambiguous") {
    return {
      severity: "error",
      code: "ref/ambiguous",
      message: `${subject} could mean ${resolution.candidates.join(" or ")}. Use a longer path.`,
      location,
      path: path.join("."),
    };
  }
  return {
    severity: "error",
    code: "ref/unresolved",
    message: `${subject}, which doesn't exist.${resolution.hint ? ` ${resolution.hint}` : ""}`,
    location,
    path: path.join("."),
  };
}

function schemaDiagnostics(err: z.ZodError, file: ParsedFile): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const issue of err.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        out.push(error("schema/unknown-field", `Unknown field "${key}".`, file, [...path, key]));
      }
      continue;
    }
    let message = issue.message;
    if (issue.code === "invalid_key") {
      const inner = issue.issues.map((i) => i.message).join("; ");
      message = `Invalid ID "${String(path.at(-1))}": ${inner}`;
    } else if (issue.code === "invalid_union" && path.length > 0) {
      message = `Invalid value for "${String(path.at(-1))}".`;
    } else if (path.length > 0 && !file.doc.hasIn(path)) {
      message = `Missing required field "${String(path.at(-1))}".`;
    }
    out.push(error("schema/invalid", message, file, path));
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
