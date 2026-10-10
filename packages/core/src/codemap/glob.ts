/**
 * A small, dependency-free glob matcher for `code:` paths, so code mapping
 * runs the same in Node and the browser.
 *
 * - `**` matches any number of path segments (including none)
 * - `*` matches within one segment, `?` one character
 * - `{a,b}` matches either alternative
 * - A path with no wildcards matches itself and, as a directory, everything under it
 */
export function compileGlob(pattern: string): RegExp {
  const glob = normalizePath(pattern).replace(/\/+$/, "");
  if (!/[*?{]/.test(glob)) {
    return new RegExp(`^${escapeRegex(glob)}(?:/.*)?$`);
  }
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*") {
      if (glob.charAt(i + 1) === "*") {
        const slashAfter = glob.charAt(i + 2) === "/";
        // "**/" matches zero or more whole segments; a trailing "**" matches the rest.
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        continue;
      }
      re += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map(escapeRegex)
        .join("|")})`;
      i = end;
    } else {
      re += escapeRegex(c);
    }
  }
  // "dir/**" also matches "dir" itself.
  if (glob.endsWith("/**")) re = re.replace(/\/\.\*$/, "(?:/.*)?");
  return new RegExp(`^${re}$`);
}

/** The literal part before the first wildcard. Longer means more specific. */
export function literalPrefix(pattern: string): string {
  const glob = normalizePath(pattern);
  const i = glob.search(/[*?{]/);
  return i === -1 ? glob : glob.slice(0, i);
}

/** Forward slashes, no leading "./" or "/". */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.+^$()|[\]\\]/g, "\\$&");
}
