# BlendTinux MCP

Let an AI assistant (Claude Code, Claude Desktop, claude.ai, or any MCP host) build and edit BlendTinux scenes: add and arrange objects, set materials, take screenshots, run ray-traced renders, manage projects, and import/export OBJ.

## Zero-install way (recommended)

No downloads, no Node, nothing to run:

1. Open tinux.dev/blendtinux and click the **plug icon** in the top bar. When it links through the relay, a short pairing code appears next to it.
2. Click the code to copy your personal MCP address (it looks like `https://blendtinux-mcp.....workers.dev/YOURCODE`).
3. Add it to Claude Code: `claude mcp add --transport http blendtinux <that address>`, or paste the address into claude.ai / Claude Desktop as a custom connector.

The relay (a Cloudflare Worker, source in `../mcp-worker/`) only routes each pairing code to the one browser tab holding it, so nobody can reach your scene without your code. The code is remembered by your browser, so the address stays valid across sessions.

## Local way (fully offline)

A small server your MCP host launches on your own machine: it opens a WebSocket on `127.0.0.1` and your BlendTinux tab connects to it. The plug button always tries this local server first, before the relay.

### Setup

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
