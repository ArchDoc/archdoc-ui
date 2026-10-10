import { type Document, isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";

export type YamlPath = readonly (string | number)[];

export interface ParsedFile {
  file: string;
  doc: Document;
  value: unknown;
  /** Location of the key (or item) at a path, falling back to the nearest ancestor. */
  locate(path: YamlPath): SourceLocation;
}

export function parseYaml(
  file: string,
  text: string,
): { parsed?: ParsedFile; diagnostics: Diagnostic[] } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  const pos = (offset: number): SourceLocation => {
    const { line, col } = lineCounter.linePos(offset);
    return { file, line, column: col };
  };

  const diagnostics: Diagnostic[] = [...doc.errors, ...doc.warnings].map((e) => ({
    severity: doc.errors.includes(e as never) ? "error" : "warning",
    code: "yaml/syntax",
    message: e.message.split("\n")[0] ?? e.message,
    location: pos(e.pos[0]),
  }));
  if (doc.errors.length > 0) return { diagnostics };

  const locate = (path: YamlPath): SourceLocation => {
    for (let i = path.length; i > 0; i--) {
      const parent = i === 1 ? doc.contents : doc.getIn(path.slice(0, i - 1), true);
      const seg = path[i - 1];
      if (isMap(parent)) {
        const pair = parent.items.find(
          (p) => String(isScalar(p.key) ? p.key.value : p.key) === String(seg),
        );
        const node = (pair?.key ?? pair?.value) as { range?: [number, number, number] } | undefined;
        if (node?.range) return pos(node.range[0]);
      } else if (isSeq(parent) && typeof seg === "number") {
        const item = parent.items[seg] as { range?: [number, number, number] } | undefined;
        if (item?.range) return pos(item.range[0]);
      }
    }
    return { file, line: 1, column: 1 };
  };

  return { parsed: { file, doc, value: doc.toJS(), locate }, diagnostics };
}
