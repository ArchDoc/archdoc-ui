import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startViewServer, type ViewServer } from "../src/index.js";

let tmp: string;
let repo: string;
let web: string;
let server: ViewServer | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "archdoc-view-"));
  repo = join(tmp, "repo");
  web = join(tmp, "web");
  await mkdir(join(repo, ".archdoc"), { recursive: true });
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(repo, ".archdoc", "archdoc.yaml"), 'archdoc: "2.0"\nnamespace: demo\n');
  await writeFile(join(web, "index.html"), "<!doctype html><title>explorer</title>");
  await writeFile(join(web, "assets", "app.js"), "console.log(1)");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

describe("view server", () => {
  it("serves the model sources and the explorer", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const model = await (await fetch(`${server.url}/api/model`)).json();
    expect(model).toMatchObject({
      root: ".archdoc/archdoc.yaml",
      watch: false,
      sources: [{ path: ".archdoc/archdoc.yaml" }],
    });

    const js = await fetch(`${server.url}/assets/app.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    // Unknown routes get the app shell.
    expect(await (await fetch(`${server.url}/journeys/x`)).text()).toContain("explorer");
  });

  it("refuses paths outside the explorer directory", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    const res = await fetch(`${server.url}/%2e%2e%2f%2e%2e%2frepo%2f.archdoc%2farchdoc.yaml`);
    expect(res.status).toBe(403);
  });

  it("answers 404 when there is no model", async () => {
    server = await startViewServer({ target: "web", cwd: tmp, webDir: web });
    expect(server.source).toBeUndefined();
    expect((await fetch(`${server.url}/api/model`)).status).toBe(404);
  });

  it("sends a change event when a model file changes, with --watch", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web, watch: true });
    const res = await fetch(`${server.url}/api/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain(": connected");

    await writeFile(join(repo, ".archdoc", "actors.yaml"), "actors: { dev: { kind: person } }\n");
    while (!text.includes("event: change")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain("event: change");
    await reader.cancel();

    const model = (await (await fetch(`${server.url}/api/model`)).json()) as {
      sources: { path: string }[];
    };
    expect(model.sources.map((s) => s.path)).toContain(".archdoc/actors.yaml");
  });
});
