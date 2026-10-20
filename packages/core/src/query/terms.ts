// Words for matching a question against the model and the code. Identifiers
// split into their parts (archdoc_check → archdoc, check; loadModelAtRef →
// load, model, at, ref), so a tool name or a function name finds what a
// description of it would.

/** Filler words that say nothing about where code lives. */
export const STOP = new Set(
  "a an the to of in on for and or with how where what which do does is are i we new add make change update this that it its be as at by so from into when than then not no only also all every each one same can should would".split(
    " ",
  ),
);

/** Splits an identifier or path on `_`, `-`, `.`, `/`, and camelCase, lowercased. */
export function splitIdentifier(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A plural's singular, for words long enough that it's safe ("commands" → "command"). */
export function singular(word: string): string {
  return word.length > 3 && !word.endsWith("ss") ? word.replace(/s$/, "") : word;
}

/** The words of a question, split into identifier parts, without filler or duplicates. */
export function queryTerms(query: string): string[] {
  const out = new Set<string>();
  for (const part of splitIdentifier(query)) {
    const w = singular(part);
    if (w.length > 1 && !STOP.has(w)) out.add(w);
  }
  return [...out];
}

const ENDINGS = new Set(
  "s es r rs d er ers ed ing ion ions or ors al ally ment ments able ity ive".split(" "),
);
/** Endings after a doubled consonant: mapping, committed, running. */
const DOUBLED = /^([bdgklmnprt])\1(?:ed|ing|er|ers)$/;

/**
 * Whether a query word and a word in the code mean the same thing: equal, or
 * one is the other with a common ending (check/checker, simulate/simulation,
 * map/mapping), but not when they only share a stem (data/database, repo/report).
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3) return false;
  if (l.startsWith(s)) {
    const rest = l.slice(s.length);
    return ENDINGS.has(rest) || DOUBLED.test(`${s.slice(-1)}${rest}`);
  }
  // simulate/simulation, explore/exploring: a final "e" that the longer word drops.
  return s.endsWith("e") && l.startsWith(s.slice(0, -1)) && ENDINGS.has(l.slice(s.length - 1));
}
