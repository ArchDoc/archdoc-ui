import { type CodeMap, type JourneyStep, literalPrefix, type Model } from "@archdoc/core/browser";
import { useState } from "react";
import type { RepoLinks } from "../model/useModel.js";

export interface CodeContext {
  codemap: CodeMap;
  repo: RepoLinks;
  files: ReadonlySet<string>;
}

/** A link to a file or directory on the repository's web host. */
export function webLink(repo: RepoLinks, path: string, isFile: boolean): string | undefined {
  const ref = repo.branch ?? repo.commit;
  if (!repo.webUrl || !ref) return undefined;
  return `${repo.webUrl}/${isFile ? "blob" : "tree"}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** A link that opens the path in VS Code on this machine. */
export function editorLink(repo: RepoLinks, path: string): string | undefined {
  if (!repo.root) return undefined;
  return `vscode://file${repo.root.startsWith("/") ? "" : "/"}${repo.root}/${path}`;
}

/** The part of a code path that's a real file or directory, for linking a glob. */
export function linkTarget(
  pattern: string,
  files: ReadonlySet<string>,
): { path: string; isFile: boolean } {
  const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!/[*?{]/.test(clean)) return { path: clean, isFile: files.has(clean) };
  const prefix = literalPrefix(clean);
  const dir = prefix.endsWith("/")
    ? prefix.slice(0, -1)
    : prefix.slice(0, Math.max(0, prefix.lastIndexOf("/")));
  return { path: dir, isFile: false };
}

export function PathLinks({
  repo,
  path,
  isFile,
}: {
  repo: RepoLinks;
  path: string;
  isFile: boolean;
}) {
  const web = webLink(repo, path, isFile);
  const editor = editorLink(repo, path);
  return (
    <span className="path-links">
      {web ? (
        <a href={web} target="_blank" rel="noreferrer" title="Open on the repository's web host">
          {hostName(repo.webUrl)}
        </a>
      ) : null}
      {editor ? (
        <a href={editor} title="Open in VS Code">
          VS Code
        </a>
      ) : null}
    </span>
  );
}

/** Code paths for an element, with links, and the files mapped to it. */
export function CodeSection({
  model,
  elementId,
  ctx,
  mapped,
}: {
  model: Model;
  elementId: string;
  ctx: CodeContext;
  mapped: string[];
}) {
  const [showAll, setShowAll] = useState(false);
  const element = model.elements.get(elementId);
  if (!element) return null;
  const stale = new Set(
    ctx.codemap.stale.filter((s) => s.element === elementId).map((s) => s.pattern),
  );
  const shown = showAll ? mapped : mapped.slice(0, 12);

  return (
    <>
      <ul className="code-list">
        {element.code.map((c) => {
          const t = linkTarget(c.path, ctx.files);
          return (
            <li key={c.path}>
              <code>{c.path}</code>
              {stale.has(c.path) ? (
                <span
                  className="chip small warn"
                  title="No file in the repository matches this path"
                >
                  matches nothing
                </span>
              ) : (
                <PathLinks repo={ctx.repo} path={t.path} isFile={t.isFile} />
              )}
              {c.description ? <p>{c.description}</p> : null}
            </li>
          );
        })}
      </ul>
      {ctx.files.size > 0 ? (
        <details className="files" open={mapped.length > 0 && mapped.length <= 12}>
          <summary>
            {mapped.length} file{mapped.length === 1 ? "" : "s"}
            {element.childIds.length ? " here and inside" : ""}
          </summary>
          <ul className="file-list">
            {shown.map((f) => (
              <li key={f}>
                <span className="file-name" title={f}>
                  {f}
                </span>
                <PathLinks repo={ctx.repo} path={f} isFile />
              </li>
            ))}
          </ul>
          {mapped.length > shown.length ? (
            <button type="button" className="link" onClick={() => setShowAll(true)}>
              Show all {mapped.length}
            </button>
          ) : null}
        </details>
      ) : null}
    </>
  );
}

/** The code entry point of a journey step, with links. */
export function StepCode({ step, ctx }: { step: JourneyStep; ctx: CodeContext }) {
  const code = step.spec.code;
  if (!code) return null;
  const [file] = code.split("#");
  const t = linkTarget(file ?? code, ctx.files);
  return (
    <span className="step-code">
      <code>{code}</code> <PathLinks repo={ctx.repo} path={t.path} isFile={t.isFile} />
    </span>
  );
}

function hostName(url: string | undefined): string {
  if (!url) return "Web";
  const host = new URL(url).hostname;
  if (host.includes("github")) return "GitHub";
  if (host.includes("gitlab")) return "GitLab";
  if (host.includes("bitbucket")) return "Bitbucket";
  return host;
}
