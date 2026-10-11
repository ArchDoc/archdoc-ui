import { Environment } from "@marcbachmann/cel-js";

/** A field an expression reads from one of its named inputs, such as refund.amount_cents. */
export interface FieldRef {
  input: string;
  field: string;
}

/** The fixed time `now()` returns, so the same model and sample always give the same result. */
export const SIMULATED_NOW = "2026-01-01T00:00:00.000Z";

const env = new Environment({ unlistedVariablesAreDyn: true }).registerFunction(
  "now(): google.protobuf.Timestamp",
  () => new Date(SIMULATED_NOW),
);

type Node = { op: string; args: unknown };

/**
 * Parses a CEL expression and lists the fields it reads from the given
 * inputs. Pure and deterministic: it runs the same in Node and the browser.
 */
export function compile(
  expression: string,
  inputs: ReadonlySet<string>,
): { ok: true; refs: FieldRef[]; unknownInputs: string[] } | { ok: false; error: string } {
  let ast: Node;
  try {
    ast = env.parse(expression).ast as unknown as Node;
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
  const refs: FieldRef[] = [];
  const unknownInputs = new Set<string>();
  const bound = new Set<string>();
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    const node = n as Node;
    if (node.op === "." && Array.isArray(node.args)) {
      const [target, field] = node.args as [Node, string];
      if (target?.op === "id" && typeof target.args === "string") {
        if (inputs.has(target.args)) refs.push({ input: target.args, field });
        else if (!bound.has(target.args)) unknownInputs.add(target.args);
        return;
      }
    }
    if (node.op === "id" && typeof node.args === "string") {
      if (!inputs.has(node.args) && !bound.has(node.args)) unknownInputs.add(node.args);
      return;
    }
    // Macros like items.exists(i, ...) bind a variable of their own.
    if (node.op === "rcall" && Array.isArray(node.args)) {
      const [, target, params] = node.args as [string, unknown, Node[]];
      visit(target);
      const v = params?.[0];
      const local =
        v?.op === "id" && typeof v.args === "string" && params.length > 1 ? v.args : undefined;
      if (local) bound.add(local);
      for (const p of local ? params.slice(1) : (params ?? [])) visit(p);
      if (local) bound.delete(local);
      return;
    }
    visit(node.args);
  };
  visit(ast);
  const seen = new Set<string>();
  return {
    ok: true,
    refs: refs.filter((r) => {
      const k = `${r.input}.${r.field}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    unknownInputs: [...unknownInputs],
  };
}

/**
 * Evaluates a CEL expression over plain JSON values. Whole numbers are CEL
 * ints, so `fare_cents / 2` divides the way CEL says; results come back as
 * plain JSON (ints as numbers, timestamps as ISO strings).
 */
export function evaluate(
  expression: string,
  context: Record<string, unknown>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      value: toPlain(env.evaluate(expression, toCel(context) as Record<string, unknown>)),
    };
  } catch (err) {
    return { ok: false, error: firstLine(err) };
  }
}

function toCel(v: unknown): unknown {
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (Array.isArray(v)) return v.map(toCel);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toCel(x)]));
  }
  return v;
}

function toPlain(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), toPlain(x)]));
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  }
  return v;
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}
