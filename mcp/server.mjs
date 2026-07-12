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

// surfaced to the model as system-prompt context by MCP hosts;
// keep in sync with INSTRUCTIONS in ../mcp-worker/src/worker.mjs
export const INSTRUCTIONS = `BlendTinux is a browser 3D modeller with a path-traced render mode. You are driving the user's live tab: they watch every change as it happens, and each tool call is one Ctrl+Z step.

Conventions: Y is up and the ground is y=0. The grid is 1 unit per square; a typical prop stands 1-4 units tall. Rotations are degrees XYZ, colors are #rrggbb hex.

Working well:
- Call list_scene first: it returns object ids, the camera, and what already exists.
- Building: use primitives for simple parts and create_mesh for anything tapered, curved or profiled (prefer quad faces, they subdivide cleanly). subdivide_object smooth=true rounds shapes; deform_object twists/bends/tapers. Move multi-part builds with transform_objects so they stay aligned.
- Materials: pick the closest finish preset, then fine-tune with roughness/metalness. Setting emissive > 0 makes an object a real area light: use glowing shapes for lamps, screens, windows and fires.
- Rendering: frame the shot with set_camera (position + target), set the mood with set_render_settings (sun direction, sky, exposure, depth of field), then render. 200 samples previews, 800+ finals. For quick geometry checks use screenshot instead, it is instant.
- Everything autosaves into the user's current project; use create_project rather than deleting their objects when starting something new.`;

const port = Number(process.env.BLENDTINUX_MCP_PORT) || 43117;
const server = new McpServer({ name: "blendtinux", version: "1.0.0" }, { instructions: INSTRUCTIONS });
const bridge = new PageBridge(port);
registerTools(server, bridge);

await server.connect(new StdioServerTransport());
console.error("[blendtinux-mcp] up, waiting for the page on ws://127.0.0.1:" + port);
