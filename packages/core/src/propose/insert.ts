import { isMap, isScalar, parseDocument, stringify, type YAMLMap } from "yaml";

type Path = readonly (string | number)[];

/**
 * Adds `key: value` to the map at `mapPath` in YAML text, creating the map
 * (under its parent) when it doesn't exist. Only the new text is inserted;
 * everything else, comments and formatting included, stays byte for byte.
 * Block maps get indented block text, flow maps ({ … }) get a flow entry.
 */
export function insertIntoMap(text: string, mapPath: Path, key: string, value: unknown): string {
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (doc.errors.length)
    throw new Error(`Can't edit a file with YAML errors: ${doc.errors[0]?.message}`);

  const target = mapPath.length ? doc.getIn(mapPath, true) : doc.contents;
  if (target === undefined || (isScalar(target) && target.value === null && mapPath.length > 0)) {
    // The map doesn't exist (or is empty): add it to its parent as { key: value }.
    if (isScalar(target))
      throw new Error(`"${mapPath.join(".")}" is empty; fill it in by hand first.`);
    if (mapPath.length === 0) return `${text.replace(/\s*$/, "\n")}${render(key, value, 0)}\n`;
    return insertIntoMap(text, mapPath.slice(0, -1), String(mapPath.at(-1)), { [key]: value });
  }
  if (!isMap(target)) throw new Error(`"${mapPath.join(".")}" is not a map.`);
  if (target.has(key)) throw new Error(`"${[...mapPath, key].join(".")}" already exists.`);

  return target.flow ? insertFlow(text, target, key, value) : insertBlock(text, target, key, value);
}

function insertBlock(text: string, map: YAMLMap, key: string, value: unknown): string {
  const first = map.items[0]?.key as { range?: [number, number, number] } | undefined;
  const start = first?.range?.[0] ?? map.range?.[0] ?? 0;
  const indent = start - (text.lastIndexOf("\n", start - 1) + 1);
  const end = map.range?.[1] ?? text.length;
  const lines = render(key, value, indent);
  // Insert on a new line right after the map's last value.
  const at = text.indexOf("\n", end - 1);
  if (at === -1) return `${text}\n${lines}\n`;
  return `${text.slice(0, at)}\n${lines}${text.slice(at)}`;
}

function insertFlow(text: string, map: YAMLMap, key: string, value: unknown): string {
  const end = map.range?.[1] ?? text.length;
  const close = text.lastIndexOf("}", end);
  if (close === -1) throw new Error("Couldn't find the end of a flow map.");
  const before = text.slice(0, close).replace(/\s*$/, "");
  const sep = map.items.length ? ", " : " ";
  const entry = `${key}: ${stringify(value, { collectionStyle: "flow", lineWidth: 0 }).trim()}`;
  return `${before}${sep}${entry} ${text.slice(close)}`;
}

function render(key: string, value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  return stringify({ [key]: value }, { lineWidth: 0, flowCollectionPadding: false })
    .trimEnd()
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
