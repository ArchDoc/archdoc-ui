import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

/** Hex colors in a file, outside the tokens block of styles.css. */
function stray(path: string): string[] {
  let text = readFileSync(path, "utf8");
  if (path.endsWith("styles.css")) {
    const start = text.indexOf("/* tokens:start */");
    const end = text.indexOf("/* tokens:end */");
    expect(start, "styles.css marks its tokens block").toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    text = text.slice(0, start) + text.slice(end);
  }
  // Hash links and selectors such as "#root" aren't colors.
  return (text.match(HEX) ?? []).filter((h) =>
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h),
  );
}

describe("colors", () => {
  it("come from the tokens in styles.css, not hex values anywhere else", () => {
    const found = files(src).flatMap((f) => stray(f).map((h) => `${relative(src, f)}: ${h}`));
    expect(found).toEqual([]);
  });

  it("use one type scale in styles.css", () => {
    const css = readFileSync(join(src, "styles.css"), "utf8");
    const outside = css.slice(css.indexOf("/* tokens:end */"));
    // Sizes are tokens: no rem, em, or px font sizes outside the scale.
    const sizes = [...outside.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(sizes.filter((s) => !s?.startsWith("var(--fs-"))).toEqual([]);
  });
});
