import type { Importance, TraceEvidence, TraceRole, TraceStepSpec } from "@archdoc/spec";
import { locate } from "../codemap/codemap.js";
import { normalizePath } from "../codemap/glob.js";
import { findSnippet } from "../codemap/snippet.js";
import type { Diagnostic } from "../diagnostics.js";
import { otherModels } from "../federation/consumers.js";
import type { JourneyNode, Model } from "../model.js";
import {
  classifyHop,
  endOfTarget,
  qualified,
  related,
  resolveTraceEnd,
  type TraceEnd,
  type TraceHop,
} from "./hops.js";
import {
  parseExpands,
  type Trace,
  type TraceCodeRef,
  traceCodeLabel,
  traceCodeRefs,
  traceEvidenceOf,
  traceRoleOf,
} from "./trace.js";

/** A problem `checkTrace` found, with the 1-based step it's about. */
export interface TraceFinding extends Diagnostic {
  trace: string;
  step?: number | undefined;
}

/** A code reference in a trace, checked against the repository. */
export interface TraceCodeView extends TraceCodeRef {
  /** path:42 or path:40-88 (symbol). */
  label: string;
  /** False when the file isn't in the repository. Undefined when the files weren't given. */
  exists?: boolean | undefined;
  /** Why the line or symbol doesn't match the file, such as "has 30 lines, not 42". */
  problem?: string | undefined;
  /** The element that owns the file. */
  element?: string | undefined;
}

/** The journey step a trace opens up (`expands`). */
export interface TraceAnchorView {
  /** As written: review-ai-change#4. */
  written: string;
  journey: string;
  /** 1-based. */
  step: number;
  /** The repo the journey is in, when it's not this one. */
  namespace?: string | undefined;
  /** found, or why the step couldn't be read. */
  status: "found" | "unknown-journey" | "unknown-step" | "not-synced";
  goal?: string | undefined;
  actor?: string | undefined;
  importance?: Importance | undefined;
  /** How many steps the journey has. */
  steps?: number | undefined;
  /** The modeled step, with its ends resolved like the trace's. */
  modeled?:
    | {
        from: TraceEnd;
        to: TraceEnd;
        action?: string | undefined;
        description?: string | undefined;
        code?: string | undefined;
      }
    | undefined;
}

/** One hop of the failing run, resolved for drawing. */
export interface TraceStepView {
  /** 1-based. */
  step: number;
  from: TraceEnd;
  to: TraceEnd;
  action?: string | undefined;
  description?: string | undefined;
  role: TraceRole;
  evidence: TraceEvidence;
  /** Whether the model declares this hop, and the relationship it follows. */
  hop: TraceHop;
  /**
   * Both ends lie inside the modeled step's ends (or their parts): the hop
   * happens "beneath" it. Undefined without a modeled step.
   */
  within?: boolean | undefined;
  code: TraceCodeView[];
  observed?: Record<string, unknown> | undefined;
  expected?: Record<string, unknown> | undefined;
  /** A call that should have happened in this step and didn't. */
  missing?:
    | {
        from: TraceEnd;
        to: TraceEnd;
        call?: string | undefined;
        description?: string | undefined;
        hop: TraceHop;
      }
    | undefined;
  /** The step as written, for what journeys also say (sends, creates, changes, decides…). */
  spec: TraceStepSpec;
}

/** A trace resolved against the model: what a UI draws and what `archdoc trace show` prints. */
export interface TraceView {
  id: string;
  file: string;
  title: string;
  symptom: string;
  reproduce?: string | undefined;
  diagnosis?: string | undefined;
  fix?: string | undefined;
  /** For a trace no journey covers. */
  actor?: TraceEnd | undefined;
  goal?: string | undefined;
  anchor?: TraceAnchorView | undefined;
  steps: TraceStepView[];
  worksIn?: { element: TraceEnd; code: TraceCodeView[]; note?: string | undefined } | undefined;
  /** 1-based steps with role cause. */
  causes: number[];
  /** 1-based steps the model has no relationship for. */
  undeclared: number[];
}

export interface TraceCheck {
  trace: Trace;
  findings: TraceFinding[];
  view: TraceView;
}

export interface CheckTraceOptions {
  /** Repository files, to tell stale code references. Without it, code isn't checked. */
  files?: readonly string[] | undefined;
  /** A repository file's text, to tell lines and symbols that no longer match it. */
  read?: ((path: string) => string | undefined) | undefined;
}

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * Checks a trace against the model and the code: that its elements and its
 * journey step exist, that its code references still match, and which hops
 * the model doesn't declare (drift found while debugging). Deterministic:
 * reads files only through `options`.
 */
export function checkTrace(
  model: Model,
  trace: Trace,
  options: CheckTraceOptions = {},
): TraceCheck {
  const findings: TraceFinding[] = [];
  const s = trace.spec;
  const add = (
    severity: TraceFinding["severity"],
    code: string,
    message: string,
    at: string,
    step?: number,
  ) =>
    findings.push({
      severity,
      code,
      message: step ? `Step ${step}: ${message}` : message,
      trace: trace.id,
      step,
      location: trace.locations[at] ?? trace.locations.trace,
    });

  // Ends in repos that aren't synced, by namespace: one note for each.
  const unsynced = new Map<string, number[]>();
  const end = (written: string, at: string, step?: number, as?: "element" | "actor") => {
    const e = resolveTraceEnd(model, written, as);
    const what = as ?? "actor or element";
    if (e.status === "unknown") {
      add(
        "error",
        as === "actor" ? "trace/unknown-actor" : "trace/unknown-element",
        `"${written}" is not an ${what} in the model.${e.hint ? ` ${e.hint}` : ""}`,
        at,
        step,
      );
    } else if (e.status === "ambiguous") {
      add(
        "error",
        "trace/ambiguous-element",
        `"${written}" could mean ${e.candidates?.join(" or ")}. Write more of its ID.`,
        at,
        step,
      );
    } else if (e.status === "not-synced" && e.namespace) {
      const list = unsynced.get(e.namespace) ?? [];
      if (step && !list.includes(step)) list.push(step);
      unsynced.set(e.namespace, list);
    }
    return e;
  };

  const code = (refs: TraceCodeRef[], at: string, step?: number): TraceCodeView[] =>
    refs.map((ref) => {
      const path = normalizePath(ref.path);
      const view: TraceCodeView = { ...ref, path, label: traceCodeLabel({ ...ref, path }) };
      const owner = locate(model, path).element;
      if (owner) view.element = owner.id;
      if (options.files) {
        const exists = options.files.some((f) => f === path || f.startsWith(`${path}/`));
        view.exists = exists;
        if (!exists) {
          add("warning", "trace/stale-code", `${path} is not in the repository.`, at, step);
          return view;
        }
      }
      if (options.read && (ref.lines !== undefined || ref.symbol !== undefined)) {
        const text = options.read(path);
        if (text !== undefined) {
          const found = findSnippet({ path, lines: ref.lines, symbol: ref.symbol }, text);
          if ("problem" in found) {
            view.problem = found.problem;
            add("warning", "trace/stale-code", `${path} ${found.problem}.`, at, step);
          }
        }
      }
      return view;
    });

  // The journey step it opens up.
  let anchor: TraceAnchorView | undefined;
  if (s.expands) anchor = resolveAnchor(model, s.expands);
  if (anchor && anchor.status !== "found") {
    const known = () => {
      const ids = [...model.journeys.keys()];
      return ids.length ? ` Known: ${ids.join(", ")}.` : "";
    };
    if (anchor.status === "unknown-journey") {
      add(
        "error",
        "trace/unknown-journey",
        `expands "${s.expands}", but there's no journey "${anchor.journey}".${anchor.namespace ? "" : known()}`,
        "expands",
      );
    } else if (anchor.status === "unknown-step") {
      add(
        "error",
        "trace/unknown-step",
        `expands "${s.expands}", but journey "${anchor.journey}" has ${anchor.steps} step${anchor.steps === 1 ? "" : "s"}. Steps count from 1.`,
        "expands",
      );
    } else {
      add(
        "info",
        "trace/unverified-journey",
        `expands a journey in ${anchor.namespace}, which isn't synced, so the step can't be checked (archdoc sync).`,
        "expands",
      );
    }
  }
  const actor = s.actor ? end(s.actor, "actor", undefined, "actor") : undefined;
  if (!s.expands && !s.actor) {
    add(
      "warning",
      "trace/no-anchor",
      "The trace isn't attached to anything. Add expands: <journey>#<step> for the step where the error showed up, or actor and goal when no journey covers it.",
      "trace",
    );
  }

  const modeled = anchor?.modeled;
  const modeledEnds = modeled
    ? [qualified(model, modeled.from), qualified(model, modeled.to)].filter(
        (x): x is string => x !== undefined,
      )
    : [];
  const inStep = (e: TraceEnd) => {
    const q = qualified(model, e);
    return q !== undefined && modeledEnds.some((m) => related(q, m));
  };

  const steps: TraceStepView[] = s.steps.map((spec, i) => {
    const n = i + 1;
    const from = end(spec.from, `steps.${i}.from`, n);
    const to = end(spec.to, `steps.${i}.to`, n);
    const hop = classifyHop(model, from, to);
    if (hop.kind === "undeclared") {
      add(
        "warning",
        "trace/undeclared-hop",
        `${from.id} → ${to.id} isn't a relationship the model declares. If the code really does this, add it to the model or fix the code.`,
        `steps.${i}`,
        n,
      );
    }
    const view: TraceStepView = {
      step: n,
      from,
      to,
      action: spec.action,
      description: spec.description,
      role: traceRoleOf(spec),
      evidence: traceEvidenceOf(spec),
      hop,
      within: modeledEnds.length ? inStep(from) && inStep(to) : undefined,
      code: code(traceCodeRefs(spec.code), `steps.${i}.code`, n),
      observed: spec.observed,
      expected: spec.expected,
      spec,
    };
    for (const c of view.code) {
      const owner = c.element;
      const ends = [from, to].map((e) => qualified(model, e)).filter((x) => x !== undefined);
      if (!owner || ends.length < 2 || from.status !== "resolved" || to.status !== "resolved")
        continue;
      if (!ends.some((e) => related(`${model.namespace}.${owner}`, e))) {
        add(
          "info",
          "trace/code-elsewhere",
          `${c.path} belongs to ${owner}, not to ${from.id} or ${to.id}.`,
          `steps.${i}.code`,
          n,
        );
      }
    }
    if (spec.missing) {
      const mFrom = spec.missing.from ? end(spec.missing.from, `steps.${i}.missing.to`, n) : from;
      const mTo = end(spec.missing.to, `steps.${i}.missing.to`, n);
      view.missing = {
        from: mFrom,
        to: mTo,
        call: spec.missing.call,
        description: spec.missing.description,
        hop: classifyHop(model, mFrom, mTo),
      };
    }
    return view;
  });

  let worksIn: TraceView["worksIn"];
  const w = s["works-in"];
  if (w) {
    worksIn = {
      element: end(w.element, "works-in.element", undefined, "element"),
      code: code(traceCodeRefs(w.code), "works-in.code"),
      note: w.note,
    };
  }

  for (const [namespace, list] of unsynced) {
    add(
      "info",
      "trace/unverified",
      `${namespace} isn't synced, so what the trace says about it${list.length ? ` (step${list.length === 1 ? "" : "s"} ${list.join(", ")})` : ""} can't be checked. Run archdoc sync.`,
      list.length ? `steps.${(list[0] as number) - 1}` : "trace",
    );
  }

  const causes = steps.filter((x) => x.role === "cause").map((x) => x.step);
  if (causes.length === 0) {
    add(
      "warning",
      "trace/no-cause",
      "No step has role: cause. Mark the step where it goes wrong, or say in the diagnosis why it isn't known yet.",
      "trace",
    );
  }
  const noEvidence = s.steps.flatMap((x, i) => (x.evidence ? [] : [i + 1]));
  if (noEvidence.length) {
    add(
      "info",
      "trace/no-evidence",
      `Step${noEvidence.length === 1 ? "" : "s"} ${noEvidence.join(", ")} ${noEvidence.length === 1 ? "says" : "say"} no evidence, so ${noEvidence.length === 1 ? "it counts" : "they count"} as inferred. Say reproduced or read where you saw it.`,
      `steps.${(noEvidence[0] as number) - 1}`,
    );
  }

  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (a.step ?? 0) - (b.step ?? 0));
  return {
    trace,
    findings,
    view: {
      id: trace.id,
      file: trace.file,
      title: s.title,
      symptom: s.symptom,
      reproduce: s.reproduce,
      diagnosis: s.diagnosis,
      fix: s.fix,
      actor,
      goal: s.goal,
      anchor,
      steps,
      worksIn,
      causes,
      undeclared: steps.filter((x) => x.hop.kind === "undeclared").map((x) => x.step),
    },
  };
}

/** Reads `expands` (journey#step) and finds the modeled step, here or in another repo. */
export function resolveAnchor(model: Model, expands: string): TraceAnchorView {
  const parsed = parseExpands(expands);
  const journeyRef = parsed?.journey ?? expands;
  const step = parsed?.step ?? 0;
  const base = { written: expands, journey: journeyRef, step };

  let journey: JourneyNode | undefined = model.journeys.get(journeyRef);
  let namespace: string | undefined;
  if (!journey) {
    const own = `${model.namespace}.`;
    if (journeyRef.startsWith(own)) journey = model.journeys.get(journeyRef.slice(own.length));
  }
  if (!journey) {
    const dot = journeyRef.indexOf(".");
    if (dot <= 0) return { ...base, status: "unknown-journey" };
    namespace = journeyRef.slice(0, dot);
    const dep = otherModels(model).get(namespace);
    if (!dep) {
      return {
        ...base,
        namespace,
        status: model.imports[namespace] ? "not-synced" : "unknown-journey",
      };
    }
    journey = dep.model.journeys.get(journeyRef.slice(dot + 1));
    if (!journey) return { ...base, namespace, status: "unknown-journey" };
  }

  const info = {
    ...base,
    namespace,
    goal: journey.spec.goal,
    actor: journey.spec.actor,
    importance: journey.spec.importance ?? "normal",
    steps: journey.steps.length,
  };
  const modeled = journey.steps[step - 1];
  if (!modeled) return { ...info, status: "unknown-step" };
  return {
    ...info,
    status: "found",
    modeled: {
      from: endOfTarget(model, modeled.spec.from, modeled.from, namespace),
      to: endOfTarget(model, modeled.spec.to, modeled.to, namespace),
      action: modeled.spec.action,
      description: modeled.spec.description,
      code: modeled.spec.code,
    },
  };
}
