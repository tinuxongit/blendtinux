# BlendTinux MCP

Let an AI assistant (Claude Code, Claude Desktop, or any MCP host) build and edit BlendTinux scenes: add and arrange objects, set materials, take screenshots, run ray-traced renders, manage projects, and import/export OBJ.

Everything runs on **your machine**. Your MCP host launches this small server locally, the server opens a WebSocket on `127.0.0.1`, and your open BlendTinux tab (tinux.dev/blendtinux or a local copy) connects to it when you click the plug button in the top bar. Nothing goes through the website and nobody else can reach your scene.

## Setup

Requirements: Node 18+ and pnpm.

```sh
cd mcp
pnpm install
```

(If you're using the live site, grab this folder from the repo, or download the three `.mjs` files plus `package.json` from `tinux.dev/blendtinux/mcp/`.)

### Claude Code

```sh
claude mcp add blendtinux -- node C:/path/to/blendtinux/mcp/server.mjs
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "blendtinux": {
      "command": "node",
      "args": ["C:/path/to/blendtinux/mcp/server.mjs"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blendtinux": {
      "command": "node",
      "args": ["C:/path/to/blendtinux/mcp/server.mjs"]
    }
  }
}
```

### Connect the page

Open BlendTinux in your browser and click the **plug icon** in the top bar. It glows orange when linked (dim orange means it's on but still looking for the server). The setting is remembered; the page reconnects by itself if the server restarts.

## Tools

- `list_scene`, `add_object`, `update_object`, `duplicate_object`, `delete_object`, `select_object`, `subdivide_object` (every change is one Ctrl+Z step in the app)
- `screenshot` (what you see), `render` (path-traced image at N samples)
- `list_projects`, `create_project`, `open_project`, `rename_project`
- `export_obj`, `import_obj`

## Port

Default `43117`. If it clashes, set the `BLENDTINUX_MCP_PORT` env var for the server and change the `PORT` constant at the top of `js/mcp.js` to match.

## Troubleshooting

- "BlendTinux isn't connected": the page isn't linked. Open the app and click the plug.
- Only the most recent tab stays connected; older tabs are dropped.
- The https site can reach `ws://127.0.0.1` in Chrome and Firefox (localhost is exempt from mixed-content rules). Safari may block it; use a local copy of the app there.
- Port busy at startup: the server prints a hint on stderr; pick another port (see above).
