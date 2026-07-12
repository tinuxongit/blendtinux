/* BlendTinux hosted MCP relay (Cloudflare Worker + Durable Objects).
   Zero-install path: the BlendTinux page shows a pairing code and connects
   here over wss (/<CODE>/ws); an MCP host (Claude Code, Claude Desktop,
   claude.ai connectors) speaks Streamable HTTP to POST /<CODE>. One Durable
   Object per code relays tool calls to that one browser tab, so a code only
   ever controls its own tab. No dependencies, deploy with wrangler. */
import { DurableObject } from "cloudflare:workers";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const NOT_CONNECTED =
  "BlendTinux isn't connected: open tinux.dev/blendtinux, turn on the MCP plug in the top bar, and check the pairing code in the address you added matches the one shown next to the plug";

// ---- tool definitions (kept in sync with mcp/tools.mjs, the local server) ----

const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
const hexColor = { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "hex color like #f0924f" };
const finish = {
  type: "string",
  enum: ["matte", "plastic", "ceramic", "wood", "stone", "marble", "metal",
    "chrome", "gold", "copper", "glass", "frosted", "glow"],
  description: "material finish",
};
const refProps = {
  id: { type: "string", description: "object id from list_scene" },
  name: { type: "string", description: "exact object name, used when id is absent" },
};
const obj = (properties, required) => {
  const s = { type: "object", properties };
  if (required) s.required = required;
  return s;
};

// result: how the page's result becomes MCP content ("json" | "image" | "obj")
const TOOLS = [
  {
    name: "list_scene", timeoutMs: 20000, result: "json",
    description: "List everything in the current BlendTinux scene: project name, editor mode, selection, and every object with its id, name, transform, color, finish and vertex count. Call this first to get object ids.",
    inputSchema: obj({}),
  },
  {
    name: "add_object", timeoutMs: 20000, result: "json",
    description: "Add a primitive to the scene. Position defaults to an empty spot on the floor. Rotation is degrees XYZ. The user can undo this with Ctrl+Z.",
    inputSchema: obj({
      kind: { type: "string", enum: ["cube", "sphere", "cylinder", "cone", "torus", "plane"] },
      name: { type: "string" },
      position: vec3,
      rotation: { ...vec3, description: "degrees XYZ" },
      scale: vec3,
      color: hexColor,
      finish,
    }, ["kind"]),
  },
  {
    name: "update_object", timeoutMs: 20000, result: "json",
    description: "Change an existing object: move, rotate (degrees XYZ), scale, recolor, change the material finish, toggle smooth shading (flat=false is smooth), rename, or hide/show. Only the fields you pass change. Undoable.",
    inputSchema: obj({
      ...refProps,
      newName: { type: "string" },
      position: vec3,
      rotation: { ...vec3, description: "degrees XYZ" },
      scale: vec3,
      color: hexColor,
      finish,
      flat: { type: "boolean", description: "true = flat shading, false = smooth" },
      visible: { type: "boolean" },
    }),
  },
  {
    name: "duplicate_object", timeoutMs: 20000, result: "json",
    description: "Duplicate an object, offset so the copy is visible (default offset [0.6, 0, 0.6]). Undoable.",
    inputSchema: obj({ ...refProps, offset: vec3 }),
  },
  {
    name: "delete_object", timeoutMs: 20000, result: "json",
    description: "Delete an object from the scene. The user can undo this with Ctrl+Z.",
    inputSchema: obj({ ...refProps }),
  },
  {
    name: "select_object", timeoutMs: 20000, result: "json",
    description: "Select an object in the app, optionally framing the camera on it.",
    inputSchema: obj({ ...refProps, frame: { type: "boolean", description: "center the camera on it" } }),
  },
  {
    name: "subdivide_object", timeoutMs: 60000, result: "json",
    description: "Subdivide an object's mesh: every quad becomes 4 quads. With smooth=true it applies Catmull-Clark subdivision, which also rounds the shape. Undoable.",
    inputSchema: obj({ ...refProps, smooth: { type: "boolean", default: false } }),
  },
  {
    name: "screenshot", timeoutMs: 20000, result: "image",
    description: "Capture what the user currently sees in BlendTinux (the realtime viewport, or the ray-traced render if render mode is open) as a PNG.",
    inputSchema: obj({}),
  },
  {
    name: "render", timeoutMs: 150000, result: "image",
    description: "Run BlendTinux's path tracer on the current scene and return the image. More samples = cleaner but slower (200 is a good preview, 1000+ for quality). Takes seconds to a couple of minutes; the app returns to its previous mode afterwards.",
    inputSchema: obj({ samples: { type: "integer", minimum: 16, maximum: 2000, default: 200 } }),
  },
  {
    name: "list_projects", timeoutMs: 20000, result: "json",
    description: "List the user's saved BlendTinux projects and which one is open.",
    inputSchema: obj({}),
  },
  {
    name: "create_project", timeoutMs: 20000, result: "json",
    description: "Create a new empty project (with the starter sphere) and switch to it. The current project is saved first.",
    inputSchema: obj({ name: { type: "string" } }),
  },
  {
    name: "open_project", timeoutMs: 20000, result: "json",
    description: "Switch to another saved project by id or exact name. The current project is saved first.",
    inputSchema: obj({
      id: { type: "string", description: "project id from list_projects" },
      name: { type: "string", description: "exact project name" },
    }),
  },
  {
    name: "rename_project", timeoutMs: 20000, result: "json",
    description: "Rename a saved project.",
    inputSchema: obj({
      id: { type: "string", description: "project id from list_projects" },
      name: { type: "string", description: "exact current project name" },
      newName: { type: "string" },
    }, ["newName"]),
  },
  {
    name: "export_obj", timeoutMs: 60000, result: "obj",
    description: "Export the whole scene as Wavefront OBJ text (world-space, quads preserved, vertex colors when painted).",
    inputSchema: obj({}),
  },
  {
    name: "import_obj", timeoutMs: 60000, result: "json",
    description: "Import Wavefront OBJ text as a new object in the scene. Oddly-scaled models are normalized and set on the ground. Undoable.",
    inputSchema: obj({
      text: { type: "string", description: "the OBJ file contents" },
      name: { type: "string" },
    }, ["text"]),
  },
];

const toContent = (tool, r) => {
  if (tool.result === "image") {
    return [
      { type: "image", data: r.png, mimeType: "image/png" },
      { type: "text", text: r.note },
    ];
  }
  if (tool.result === "obj") return [{ type: "text", text: r.obj }];
  return [{ type: "text", text: JSON.stringify(r, null, 2) }];
};

// ---- the per-code room -----------------------------------------------------

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this._pending = new Map(); // id -> {resolve, reject, timer}
    this._nextId = 1;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      // newest tab wins, so a zombie tab never blocks a fresh one
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.close(4000, "replaced"); } catch (_) {}
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }
    let msg;
    try { msg = await request.json(); } catch (_) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => this._handle(m)))).filter(Boolean);
      return out.length ? Response.json(out) : new Response(null, { status: 202 });
    }
    const resp = await this._handle(msg);
    return resp ? Response.json(resp) : new Response(null, { status: 202 });
  }

  webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(message); } catch (_) { return; }
    if (!msg || msg.hello || !this._pending.has(msg.id)) return;
    const p = this._pending.get(msg.id);
    this._pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "unknown error from the page"));
  }

  webSocketClose() {
    for (const [, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new Error("BlendTinux disconnected mid-request"));
    }
    this._pending.clear();
  }

  webSocketError() { /* close follows */ }

  _page() {
    const socks = this.ctx.getWebSockets();
    return socks.length ? socks[socks.length - 1] : null;
  }

  _call(cmd, args, timeoutMs) {
    const sock = this._page();
    if (!sock) return Promise.reject(new Error(NOT_CONNECTED));
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("BlendTinux did not answer in time (" + cmd + ")"));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      sock.send(JSON.stringify({ id, cmd, args: args || {} }));
    });
  }

  // one JSON-RPC message in, one response out (null for notifications)
  async _handle(msg) {
    if (!msg || msg.jsonrpc !== "2.0" || !msg.method) return null;
    const isNotification = msg.id === undefined || msg.id === null;
    const reply = (result) => isNotification ? null : { jsonrpc: "2.0", id: msg.id, result };
    const fail = (code, message) => isNotification ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } };

    switch (msg.method) {
      case "initialize": {
        const asked = msg.params && msg.params.protocolVersion;
        return reply({
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "blendtinux", version: "1.0.0" },
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === (msg.params && msg.params.name));
        if (!tool) return fail(-32602, "unknown tool: " + (msg.params && msg.params.name));
        try {
          const result = await this._call(tool.name, (msg.params && msg.params.arguments) || {}, tool.timeoutMs);
          return reply({ content: toContent(tool, result) });
        } catch (err) {
          return reply({ content: [{ type: "text", text: String(err.message || err) }], isError: true });
        }
      }
      default:
        if (msg.method.startsWith("notifications/")) return null;
        return fail(-32601, "method not found: " + msg.method);
    }
  }
}

// ---- router ------------------------------------------------------------------

const HELP =
  "BlendTinux MCP relay.\n\n" +
  "1. Open tinux.dev/blendtinux and turn on the MCP plug in the top bar.\n" +
  "2. Click the pairing code next to the plug to copy your personal MCP address.\n" +
  "3. Add it to Claude:  claude mcp add --transport http blendtinux <that address>\n";

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return new Response(HELP, { headers: { "Content-Type": "text/plain" } });

    const code = parts[0].toUpperCase().replace(/-/g, "");
    if (!/^[A-Z0-9]{6,16}$/.test(code) || parts.length > 2 || (parts[1] && parts[1] !== "ws")) {
      return new Response("Not Found\n\n" + HELP, { status: 404, headers: { "Content-Type": "text/plain" } });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};
