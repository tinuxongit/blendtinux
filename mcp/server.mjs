/* BlendTinux MCP server. Launched by an MCP host (Claude Code, Claude
   Desktop) over stdio; opens a WebSocket on 127.0.0.1 that the BlendTinux
   page connects to when the user turns on the MCP plug in the top bar.
   Logging: console.error only, stdout is the stdio transport. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PageBridge } from "./bridge.mjs";
import { registerTools } from "./tools.mjs";

process.on("uncaughtException", (err) => {
  console.error("[blendtinux-mcp] uncaught: " + (err && err.stack || err));
});

const port = Number(process.env.BLENDTINUX_MCP_PORT) || 43117;
const server = new McpServer({ name: "blendtinux", version: "1.0.0" });
const bridge = new PageBridge(port);
registerTools(server, bridge);

await server.connect(new StdioServerTransport());
console.error("[blendtinux-mcp] up, waiting for the page on ws://127.0.0.1:" + port);
