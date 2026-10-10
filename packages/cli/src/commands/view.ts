import { spawn } from "node:child_process";
import { relative } from "node:path";
import type { Io } from "../io.js";
import { startViewServer, type ViewServer } from "../server.js";

export interface ViewOptions {
  watch?: boolean;
  /** Show changes since this ref. */
  base?: string;
  port?: string;
  open?: boolean;
}

/** Starts the explorer. Resolves once the server is listening; it runs until the process ends. */
export async function view(
  target: string,
  options: ViewOptions,
  io: Io,
): Promise<{ code: number; server?: ViewServer }> {
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.err(`--port must be a number from 0 to 65535 (0 picks a free port).`);
    return { code: 1 };
  }
  let server: ViewServer;
  try {
    server = await startViewServer({
      target,
      cwd: io.cwd,
      port,
      watch: options.watch,
      base: options.base,
    });
  } catch (err) {
    io.err(`Couldn't start the explorer: ${err instanceof Error ? err.message : String(err)}`);
    return { code: 1 };
  }
  if (!server.source) {
    io.err(`No ArchDoc model at ${target}. Expected .archdoc/archdoc.yaml.`);
    await server.close();
    return { code: 1 };
  }

  const what = relative(io.cwd, server.source) || ".";
  io.out(
    `ArchDoc explorer: ${server.url}${options.base ? ` (showing changes since ${options.base})` : ""}`,
  );
  io.out(
    options.watch
      ? `Watching ${what} for changes. Press Ctrl+C to stop.`
      : `Serving ${what}. Press Ctrl+C to stop.`,
  );
  if (options.open) openBrowser(server.url);
  return { code: 0, server };
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}
