import type { ImportedField, SchemaImporter } from "./api.js";
import { stripComments } from "./api.js";

/**
 * SQL migrations: `sql: migrations#charges` replays every .sql file under
 * migrations (or one file), in file-name order, and reads the table as the
 * last migration leaves it: CREATE TABLE, ALTER TABLE (add, drop, rename,
 * and retype columns; add foreign keys), RENAME TO, DROP TABLE, and CREATE
 * TYPE ... AS ENUM. Foreign keys (REFERENCES) say where a column points.
 */
export const sql: SchemaImporter = {
  kind: "sql",
  async read(ctx, ref) {
    if (!ref.name) throw new Error("name the table, such as migrations#charges");
    const dir = ref.path.replace(/\/$/, "");
    const files = ctx.files
      .filter((f) => f.endsWith(".sql") && (f === dir || f.startsWith(`${dir}/`)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!files.length) throw new Error(`${ref.path} has no .sql files`);
    const db = new Database();
    for (const f of files) db.run(await ctx.read(f));
    const table = db.tables.get(ref.name.toLowerCase());
    if (!table) throw new Error(`no migration under ${ref.path} leaves a table ${ref.name}`);
    return { fields: Object.fromEntries(table), files };
  },
};

/** Just enough of a database to replay schema migrations. */
class Database {
  tables = new Map<string, Map<string, ImportedField>>();
  enums = new Map<string, string[]>();

  run(text: string) {
    for (const raw of splitStatements(stripComments(text, true))) {
      const st = raw.trim().replace(/\s+/g, " ");
      dispatch(st, [
        [
          /^create type (\S+) as enum \((.*)\)$/i,
          ([name, values]) =>
            this.enums.set(
              ident(name),
              [...values.matchAll(/'([^']*)'/g)].map((v) => v[1] as string),
            ),
        ],
        [
          /^create table (?:if not exists )?(\S+) \((.*)\)/i,
          ([name, defs]) => {
            const cols = new Map<string, ImportedField>();
            for (const def of splitTop(defs)) this.define(cols, def);
            this.tables.set(ident(name), cols);
          },
        ],
        [
          /^alter table (?:if exists )?(?:only )?(\S+) (.*)$/i,
          ([name, actions]) => this.alter(ident(name), actions),
        ],
        [
          /^drop table (?:if exists )?(.*)$/i,
          ([names]) => {
            for (const t of names.split(","))
              this.tables.delete(ident(t.trim().split(" ")[0] ?? ""));
          },
        ],
      ]);
    }
  }

  private define(cols: Map<string, ImportedField>, def: string) {
    const d = def.trim();
    const pk = /^(?:constraint \S+ )?primary key \(([^)]*)\)/i.exec(d);
    if (pk) {
      for (const c of (pk[1] as string).split(",")) {
        const col = cols.get(ident(c.trim()));
        if (col) col.required = true;
      }
      return;
    }
    const fk = foreignKey(d);
    if (fk) {
      for (const [i, c] of fk.columns.entries()) {
        const col = cols.get(ident(c));
        if (col) col.references = { name: fk.table, field: fk.fields[i] };
      }
      return;
    }
    if (/^(constraint|unique|foreign key|check|index|key)\b/i.test(d)) return;
    const m = /^(\S+) (.*)$/.exec(d);
    if (!m) return;
    cols.set(ident(m[1] as string), this.column(m[2] as string));
  }

  private column(rest: string): ImportedField {
    const lower = rest.toLowerCase();
    // The type is everything up to the first constraint keyword.
    const type =
      lower.split(
        / (?:not null|null|primary key|default|references|unique|check|constraint|generated|collate)\b/,
      )[0] ?? lower;
    const field = this.type(type.trim());
    if (/\bnot null\b|\bprimary key\b/.test(lower)) field.required = true;
    const ref = /\breferences\s+(\S+?)\s*(?:\(([^)]*)\))?(?:\s|$)/i.exec(rest);
    if (ref) field.references = { name: ident(ref[1] as string), field: ref[2] && ident(ref[2]) };
    return field;
  }

  private type(raw: string): ImportedField {
    const t = raw.replace(/\(.*\)/, "").trim();
    const array = t.endsWith("[]");
    const base = t.replace(/\[\]$/, "");
    const values = this.enums.get(ident(base));
    const name = values ? "enum" : sqlType(base);
    return { type: array ? `${name}[]` : name, ...(values ? { values } : {}) };
  }

  private alter(name: string, actions: string) {
    const renamed = /^rename to (\S+)$/i.exec(actions);
    if (renamed) {
      const t = this.tables.get(name);
      this.tables.delete(name);
      if (t) this.tables.set(ident(renamed[1] as string), t);
      return;
    }
    const cols = this.tables.get(name);
    if (!cols) return;
    for (const action of splitTop(actions)) {
      dispatch(action.trim(), [
        [
          /^add (?:column )?(?:if not exists )?(.*)$/i,
          ([def]) => {
            if (
              foreignKey(def) ||
              !/^(constraint|primary key|unique|foreign key|check)\b/i.test(def)
            )
              this.define(cols, def);
          },
        ],
        [
          /^drop (?:column )?(?:if exists )?(\S+)/i,
          ([col]) => {
            if (!/^constraint$/i.test(col)) cols.delete(ident(col));
          },
        ],
        [
          /^rename (?:column )?(\S+) to (\S+)$/i,
          ([from, to]) => {
            const col = cols.get(ident(from));
            cols.delete(ident(from));
            if (col) cols.set(ident(to), col);
          },
        ],
        [
          /^alter (?:column )?(\S+) (?:set data )?type (.*?)(?: using .*)?$/i,
          ([name, type]) => {
            const col = cols.get(ident(name));
            if (col)
              cols.set(ident(name), { ...this.type(type.toLowerCase()), required: col.required });
          },
        ],
        [
          /^alter (?:column )?(\S+) (set|drop) not null$/i,
          ([name, how]) => {
            const col = cols.get(ident(name));
            if (col) col.required = how.toLowerCase() === "set";
          },
        ],
      ]);
    }
  }
}

/** A table constraint naming a foreign key: [CONSTRAINT x] FOREIGN KEY (a, b) REFERENCES t (c, d). */
function foreignKey(
  def: string,
): { columns: string[]; table: string; fields: string[] } | undefined {
  const m =
    /^(?:constraint \S+ )?foreign key\s*\(([^)]*)\)\s*references\s+(\S+?)\s*(?:\(([^)]*)\))?(?:\s|$)/i.exec(
      def.trim(),
    );
  if (!m) return undefined;
  const names = (s: string | undefined) =>
    (s ?? "")
      .split(",")
      .map((c) => ident(c.trim()))
      .filter(Boolean);
  return { columns: names(m[1]), table: ident(m[2] as string), fields: names(m[3]) };
}

/** Runs the handler of the first pattern that matches, with its groups. */
function dispatch(text: string, rules: [RegExp, (groups: Groups) => void][]): void {
  for (const [re, handle] of rules) {
    const m = re.exec(text);
    if (m) {
      handle([m[1] ?? "", m[2] ?? ""]);
      return;
    }
  }
}

type Groups = [string, string];

const SQL_TYPES: [RegExp, string][] = [
  [/^(small|big)?serial$|^(tiny|small|medium|big)?int(eger)?\d?$/, "int"],
  [/^(real|float\d?|double( precision)?|numeric|decimal|money)$/, "number"],
  [/^(text|varchar|character varying|char|character|citext|nvarchar|string)$/, "string"],
  [/^uuid$/, "uuid"],
  [/^bool(ean)?$/, "bool"],
  [/^(timestamp|timestamptz|timestamp with(out)? time zone|datetime)$/, "timestamp"],
  [/^date$/, "date"],
  [/^jsonb?$/, "json"],
  [/^(bytea|blob|binary|varbinary)$/, "bytes"],
];

function sqlType(t: string): string {
  return SQL_TYPES.find(([re]) => re.test(t))?.[1] ?? t;
}

/** An identifier without quotes or a schema: "public"."charges" is charges. */
function ident(s: string): string {
  const parts = s.replace(/["`[\]]/g, "").split(".");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/** Splits on semicolons outside quotes. */
function splitStatements(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    if (ch === ";" && !quote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Splits on commas outside parentheses and quotes. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let quote = false;
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (ch === "," && depth === 0 && !quote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
