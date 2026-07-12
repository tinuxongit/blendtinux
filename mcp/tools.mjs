/* Tool definitions. Each tool forwards to the page over the bridge and turns
   errors into isError results so the model can react. Logging: console.error
   only (stdout is the MCP stdio transport). */
import { z } from "zod";

const vec3 = z.array(z.number()).length(3);
const FINISHES = ["matte", "plastic", "ceramic", "wood", "stone", "marble", "metal",
  "chrome", "gold", "copper", "glass", "frosted", "glow"];
const finish = z.enum(FINISHES).describe("material finish");
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("hex color like #f0924f");
const ref = {
  id: z.string().optional().describe("object id from list_scene"),
  name: z.string().optional().describe("exact object name, used when id is absent"),
};

const asJSON = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const asImage = (r) => ({
  content: [
    { type: "image", data: r.png, mimeType: "image/png" },
    { type: "text", text: r.note },
  ],
});
const asText = (key) => (r) => ({ content: [{ type: "text", text: r[key] }] });

export function registerTools(server, bridge) {
  const forward = (name, def, timeoutMs, format) => {
    server.registerTool(name, def, async (args) => {
      try {
        const result = await bridge.call(name, args || {}, timeoutMs);
        return (format || asJSON)(result);
      } catch (err) {
        return { content: [{ type: "text", text: String(err.message || err) }], isError: true };
      }
    });
  };

  // ---- scene -----------------------------------------------------------------

  forward("list_scene", {
    title: "List scene",
    description: "List everything in the current BlendTinux scene: project name, editor mode, selection, and every object with its id, name, transform, color, finish and vertex count. Call this first to get object ids.",
    inputSchema: {},
  });

  forward("add_object", {
    title: "Add object",
    description: "Add a primitive to the scene. Position defaults to an empty spot on the floor. Rotation is degrees XYZ. The user can undo this with Ctrl+Z.",
    inputSchema: {
      kind: z.enum(["cube", "sphere", "cylinder", "cone", "torus", "plane"]),
      name: z.string().optional(),
      position: vec3.optional(),
      rotation: vec3.optional().describe("degrees XYZ"),
      scale: vec3.optional(),
      color: hexColor.optional(),
      finish: finish.optional(),
    },
  });

  forward("update_object", {
    title: "Update object",
    description: "Change an existing object: move, rotate (degrees XYZ), scale, recolor, change the material finish, toggle smooth shading (flat=false is smooth), rename, or hide/show. Only the fields you pass change. Undoable.",
    inputSchema: {
      ...ref,
      newName: z.string().optional(),
      position: vec3.optional(),
      rotation: vec3.optional().describe("degrees XYZ"),
      scale: vec3.optional(),
      color: hexColor.optional(),
      finish: finish.optional(),
      flat: z.boolean().optional().describe("true = flat shading, false = smooth"),
      visible: z.boolean().optional(),
    },
  });

  forward("duplicate_object", {
    title: "Duplicate object",
    description: "Duplicate an object, offset so the copy is visible (default offset [0.6, 0, 0.6]). Undoable.",
    inputSchema: { ...ref, offset: vec3.optional() },
  });

  forward("delete_object", {
    title: "Delete object",
    description: "Delete an object from the scene. The user can undo this with Ctrl+Z.",
    inputSchema: { ...ref },
  });

  forward("select_object", {
    title: "Select object",
    description: "Select an object in the app, optionally framing the camera on it.",
    inputSchema: { ...ref, frame: z.boolean().optional().describe("center the camera on it") },
  });

  forward("subdivide_object", {
    title: "Subdivide object",
    description: "Subdivide an object's mesh: every quad becomes 4 quads. With smooth=true it applies Catmull-Clark subdivision, which also rounds the shape. Undoable.",
    inputSchema: { ...ref, smooth: z.boolean().default(false) },
  }, 60000);

  // ---- visual ----------------------------------------------------------------

  forward("screenshot", {
    title: "Screenshot",
    description: "Capture what the user currently sees in BlendTinux (the realtime viewport, or the ray-traced render if render mode is open) as a PNG.",
    inputSchema: {},
  }, 20000, asImage);

  forward("render", {
    title: "Ray-traced render",
    description: "Run BlendTinux's path tracer on the current scene and return the image. More samples = cleaner but slower (200 is a good preview, 1000+ for quality). Takes seconds to a couple of minutes; the app returns to its previous mode afterwards.",
    inputSchema: { samples: z.number().int().min(16).max(2000).default(200) },
  }, 150000, asImage);

  // ---- projects --------------------------------------------------------------

  forward("list_projects", {
    title: "List projects",
    description: "List the user's saved BlendTinux projects and which one is open.",
    inputSchema: {},
  });

  forward("create_project", {
    title: "Create project",
    description: "Create a new empty project (with the starter sphere) and switch to it. The current project is saved first.",
    inputSchema: { name: z.string().optional() },
  });

  forward("open_project", {
    title: "Open project",
    description: "Switch to another saved project by id or exact name. The current project is saved first.",
    inputSchema: {
      id: z.string().optional().describe("project id from list_projects"),
      name: z.string().optional().describe("exact project name"),
    },
  });

  forward("rename_project", {
    title: "Rename project",
    description: "Rename a saved project.",
    inputSchema: {
      id: z.string().optional().describe("project id from list_projects"),
      name: z.string().optional().describe("exact current project name"),
      newName: z.string(),
    },
  });

  // ---- import/export -----------------------------------------------------------

  forward("export_obj", {
    title: "Export OBJ",
    description: "Export the whole scene as Wavefront OBJ text (world-space, quads preserved, vertex colors when painted).",
    inputSchema: {},
  }, 60000, asText("obj"));

  forward("import_obj", {
    title: "Import OBJ",
    description: "Import Wavefront OBJ text as a new object in the scene. Oddly-scaled models are normalized and set on the ground. Undoable.",
    inputSchema: {
      text: z.string().describe("the OBJ file contents"),
      name: z.string().optional(),
    },
  }, 60000);
}
