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

// surfaced to the model as system-prompt context by MCP hosts;
// keep in sync with INSTRUCTIONS in ../../mcp/server.mjs
const INSTRUCTIONS = `BlendTinux is a browser 3D modeller with a path-traced render mode. You are driving the user's live tab: they watch every change as it happens, and each tool call is one Ctrl+Z step.

Conventions: Y is up and the ground is y=0. The grid is 1 unit per square; a typical prop stands 1-4 units tall. Rotations are degrees XYZ, colors are #rrggbb hex.

Working well:
- Call list_scene first: it returns object ids, the camera, and what already exists.
- Building: use primitives for simple parts and create_mesh for anything tapered, curved or profiled (prefer quad faces, they subdivide cleanly). subdivide_object smooth=true rounds shapes; deform_object twists/bends/tapers. Move multi-part builds with transform_objects so they stay aligned.
- Materials: pick the closest finish preset, then fine-tune with roughness/metalness. Setting emissive > 0 makes an object a real area light: use glowing shapes for lamps, screens, windows and fires.
- Rendering: frame the shot with set_camera (position + target), set the mood with set_render_settings (sun direction, sky, exposure, depth of field), then render. 200 samples previews, 800+ finals. For quick geometry checks use screenshot instead, it is instant.
- Everything autosaves into the user's current project; use create_project rather than deleting their objects when starting something new.`;

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
const matOverrideProps = {
  roughness: { type: "number", minimum: -1, maximum: 1, description: "0 mirror-smooth .. 1 fully diffuse, overrides the finish preset; -1 clears the override" },
  metalness: { type: "number", minimum: -1, maximum: 1, description: "0 dielectric .. 1 metal, overrides the finish preset; -1 clears the override" },
  emissive: { type: "number", minimum: -1, maximum: 5, description: "glow strength; any value > 0 makes the object a real area light in renders; -1 clears the override" },
};

// result: how the page's result becomes MCP content ("json" | "image" | "obj")
const TOOLS = [
  {
    name: "list_scene", timeoutMs: 20000, result: "json",
    description: "List everything in the current BlendTinux scene: project name, editor mode, camera (position/target/fov), selection, and every object with its id, name, transform, color, finish, material overrides and vertex count. Call this first to get object ids.",
    inputSchema: obj({}),
  },
  {
    name: "add_object", timeoutMs: 20000, result: "json",
    description: "Add a primitive to the scene. Position defaults to an empty spot on the floor. Rotation is degrees XYZ. The Y axis points up. The user can undo this with Ctrl+Z.",
    inputSchema: obj({
      kind: { type: "string", enum: ["cube", "sphere", "cylinder", "cone", "torus", "plane"] },
      name: { type: "string" },
      position: vec3,
      rotation: { ...vec3, description: "degrees XYZ" },
      scale: vec3,
      color: hexColor,
      finish,
      ...matOverrideProps,
    }, ["kind"]),
  },
  {
    name: "update_object", timeoutMs: 20000, result: "json",
    description: "Change an existing object: move, rotate (degrees XYZ), scale, recolor, change the material finish, fine-tune roughness/metalness/emissive, toggle smooth shading (flat=false is smooth), rename, or hide/show. Only the fields you pass change; changing the finish resets overrides unless they are set in the same call. Undoable.",
    inputSchema: obj({
      ...refProps,
      newName: { type: "string" },
      position: vec3,
      rotation: { ...vec3, description: "degrees XYZ" },
      scale: vec3,
      color: hexColor,
      finish,
      ...matOverrideProps,
      flat: { type: "boolean", description: "true = flat shading, false = smooth" },
      visible: { type: "boolean" },
    }),
  },
  {
    name: "create_mesh", timeoutMs: 60000, result: "json",
    description: "Create an object from raw geometry: a flat vertex position list and a list of 3- or 4-index faces (counter-clockwise seen from outside; quads stay quads for subdivision). Use this for shapes primitives cannot make: tapered blades, curved sweeps, custom profiles. Y is up. Coordinates are used exactly as given (no normalization). Undoable.",
    inputSchema: obj({
      positions: { type: "array", items: { type: "number" }, description: "flat [x,y,z, x,y,z, ...] vertex list" },
      faces: { type: "array", items: { type: "array", items: { type: "integer" }, minItems: 3, maxItems: 4 }, description: "faces as vertex-index polygons, e.g. [[0,1,2,3],[4,5,6]]" },
      name: { type: "string" },
      position: vec3,
      rotation: { ...vec3, description: "degrees XYZ" },
      scale: vec3,
      color: hexColor,
      finish,
      ...matOverrideProps,
      flat: { type: "boolean", description: "true = flat shading, false = smooth (default)" },
    }, ["positions", "faces"]),
  },
  {
    name: "transform_objects", timeoutMs: 20000, result: "json",
    description: "Move, rotate and/or scale several objects as one rigid group around a shared pivot (default: the center of the group's footprint on the floor). One undo step. Use this to reposition multi-part builds without breaking their alignment.",
    inputSchema: obj({
      ids: { type: "array", items: { type: "string" }, minItems: 1, description: "object ids from list_scene" },
      translate: vec3,
      rotate: { ...vec3, description: "degrees XYZ around the pivot" },
      scale: { type: "number", exclusiveMinimum: 0, description: "uniform scale factor around the pivot" },
      pivot: { ...vec3, description: "world-space pivot point" },
    }, ["ids"]),
  },
  {
    name: "deform_object", timeoutMs: 60000, result: "json",
    description: "Bend, twist, taper or add noise to an object's mesh along an axis. Amount units: twist/bend are radians over the object's length, taper is a scale gradient (-0.95..3), noise is a displacement distance with `detail` controlling frequency. Dense meshes deform smoothly; subdivide first if the mesh is coarse. Undoable.",
    inputSchema: obj({
      ...refProps,
      kind: { type: "string", enum: ["twist", "bend", "taper", "noise"] },
      axis: { type: "string", enum: ["x", "y", "z"], default: "y" },
      amount: { type: "number" },
      detail: { type: "number", minimum: 0.5, maximum: 8, description: "noise frequency, default 2.5" },
    }, ["kind", "amount"]),
  },
  {
    name: "set_camera", timeoutMs: 20000, result: "json",
    description: "Move the shared viewport/render camera. Pass position and target as world-space points (Y up), or just distance/fov to adjust in place. A running render restarts from the new view automatically. Returns the resulting camera.",
    inputSchema: obj({
      position: { ...vec3, description: "camera position in world space" },
      target: { ...vec3, description: "point the camera looks at" },
      distance: { type: "number", description: "orbit distance from the target" },
      fov: { type: "number", minimum: 10, maximum: 120, description: "vertical field of view in degrees, default 50" },
    }),
  },
  {
    name: "set_render_settings", timeoutMs: 20000, result: "json",
    description: "Adjust lighting and rendering: sun direction/strength, sky preset or solid color, exposure, light bounces, ground plane, transparent background, and depth of field (aperture + focusDistance). Fields you omit keep their value; call with no fields to read the current settings. For extra lights, give any object an `emissive` value: it becomes a real area light. Settings persist with the project.",
    inputSchema: obj({
      sunElevation: { type: "number", minimum: 0, maximum: 90, description: "degrees above the horizon" },
      sunAzimuth: { type: "number", description: "compass direction in degrees" },
      sunStrength: { type: "number", minimum: 0, maximum: 5 },
      sky: { type: "string", enum: ["day", "sunset", "night", "solid"] },
      skyColor: { ...hexColor, description: "used when sky is 'solid'" },
      exposure: { type: "number", minimum: 0.1, maximum: 5 },
      bounces: { type: "integer", minimum: 2, maximum: 10 },
      ground: { type: "boolean", description: "the studio ground plane in renders" },
      transparentBackground: { type: "boolean" },
      aperture: { type: "number", minimum: 0, maximum: 0.5, description: "depth-of-field blur, 0 = everything sharp" },
      focusDistance: { type: "number", minimum: 0, maximum: 50, description: "0 = focus on the orbit target" },
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
    description: "Run BlendTinux's path tracer on the current scene and return the image. Always starts from zero samples, so the count is exact. More samples = cleaner but slower (200 is a good preview, 1000+ for quality). Optional width/height set the render resolution (mainly for aspect ratio and supersampling; the returned image is capped at 1024 on the long edge). Takes seconds to a couple of minutes; the app returns to its previous state afterwards.",
    inputSchema: obj({
      samples: { type: "integer", minimum: 16, maximum: 2000, default: 200 },
      width: { type: "integer", minimum: 64, maximum: 4096, description: "render width in pixels, needs height too" },
      height: { type: "integer", minimum: 64, maximum: 4096, description: "render height in pixels, needs width too" },
    }),
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
    description: "Import Wavefront OBJ text. Each `o`/`g` group becomes its own object (so parts can get their own materials); one undo step for the whole file. With fit=true (default) oddly-scaled models are normalized and set on the ground with their relative layout intact; fit=false keeps the exact coordinates. Prefer create_mesh for geometry you are generating yourself.",
    inputSchema: obj({
      text: { type: "string", description: "the OBJ file contents" },
      name: { type: "string" },
      fit: { type: "boolean", description: "false = keep the file's exact coordinates (default true)" },
      split: { type: "boolean", description: "false = merge all groups into one object (default true)" },
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
          instructions: INSTRUCTIONS,
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
