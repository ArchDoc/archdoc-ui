import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type ArchdocServerOptions, createArchdocServer } from "./server.js";

export { type ArchdocServerOptions, createArchdocServer, INSTRUCTIONS } from "./server.js";

/** Serves ArchDoc over stdio until the client disconnects. */
export async function runStdio(options: ArchdocServerOptions = {}): Promise<void> {
  const server = createArchdocServer(options);
  await server.connect(new StdioServerTransport());
}
