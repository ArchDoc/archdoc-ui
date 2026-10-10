import { existsSync, type FSWatcher, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listRepoFiles,
  readModelSources,
  readModelSourcesAtRef,
  repoInfo,
  type SourcesAtRef,
} from "@archdoc/core";
import { landscapePayload, loadLandscape } from "./landscape.js";

export interface ViewServerOptions {
  /** Repository, .archdoc directory, or model file. */
  target: string;
  cwd: string;
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Watch the model files and tell the explorer to reload when they change. */
  watch?: boolean;
  /** Directory with the built explorer. Found automatically when omitted. */
  webDir?: string;
  /** Also send the model as it was at this ref, for the explorer's before/after view. */
  base?: string;
  /** Send the landscape: this model composed with every model it imports. */
  landscape?: boolean;
}

export interface ViewServer {
  url: string;
  /** Absolute directory (or file) being served and watched. */
  source?: string | undefined;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serves the explorer and the model to it. The browser builds the model from
 * the raw files with @archdoc/core, so the CLI and the explorer always agree.
 * Listens on localhost only.
 */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServer> {
  const webDir = options.webDir ?? findWebDir();
  const watching = options.watch === true;
  const clients = new Set<ServerResponse>();
  const initial = await readModelSources(options.target, { cwd: options.cwd });
  // The base doesn't change while the server runs, so read it once.
  const base: SourcesAtRef | undefined = options.base
    ? await readModelSourcesAtRef(options.target, options.base, { cwd: options.cwd })
    : undefined;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/model" && options.landscape) {
        const { model, composed } = await loadLandscape(options.target, options.cwd);
        return json(res, 200, await landscapePayload(model, composed, watching));
      }
      if (url.pathname === "/api/model") {
        const read = await readModelSources(options.target, { cwd: options.cwd });
        if (!read) {
          return json(res, 404, {
            error: `No ArchDoc model found at ${options.target}. Expected .archdoc/archdoc.yaml.`,
          });
        }
        const [files, repo] = await Promise.all([
          listRepoFiles(read.baseDir),
          repoInfo(read.baseDir),
        ]);
        return json(res, 200, {
          root: read.root,
          sources: read.sources,
          watch: watching,
          files,
          repo: { ...repo, root: read.baseDir },
          base: base && {
            ref: base.ref,
            commit: base.commit,
            root: base.root,
            sources: base.sources,
          },
        });
      }
      if (url.pathname === "/api/events") {
        if (!watching) return json(res, 404, { error: "Start with --watch for live reload." });
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (!webDir) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        return res.end(
          "The explorer isn't built. In the ArchDoc repo, run `pnpm build`, or set ARCHDOC_WEB_DIR.",
        );
      }
      return await serveStatic(webDir, url.pathname, res);
    } catch (err) {
      if (!res.headersSent)
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  });

  let watcher: FSWatcher | undefined;
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 25_000);
  heartbeat.unref();

  if (watching && initial) {
    let timer: NodeJS.Timeout | undefined;
    const notify = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const c of clients) c.write("event: change\ndata: {}\n\n");
      }, 80);
    };
    const isFile = (await stat(initial.source)).isFile();
    const dir = isFile ? dirname(initial.source) : initial.source;
    watcher = watch(dir, { recursive: !isFile }, (_event, name) => {
      if (isFile && name !== basename(initial.source)) return;
      if (name && !/\.ya?ml$/.test(String(name))) return;
      notify();
    });
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolveListen());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    source: initial?.source,
    close: async () => {
      clearInterval(heartbeat);
      watcher?.close();
      for (const c of clients) c.end();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

async function serveStatic(root: string, pathname: string, res: ServerResponse) {
  const base = resolve(root);
  let file = resolve(base, `.${decodeURIComponent(pathname)}`);
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403);
    return res.end();
  }
  const info = await stat(file).catch(() => undefined);
  // Unknown paths fall back to the app shell.
  if (!info?.isFile()) file = join(base, "index.html");
  const body = await readFile(file);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": file.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * The built explorer: ARCHDOC_WEB_DIR, the workspace build (when running from a
 * clone), or the copy that `prepack` puts next to the published CLI.
 */
export function findWebDir(): string | undefined {
  const candidates = [
    process.env.ARCHDOC_WEB_DIR,
    fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url)),
    fileURLToPath(new URL("../web/", import.meta.url)),
  ];
  return candidates.find((d): d is string => !!d && existsSync(join(d, "index.html")));
}
