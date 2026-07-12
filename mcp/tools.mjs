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
const matOverrides = {
  roughness: z.number().min(-1).max(1).optional().describe("0 mirror-smooth .. 1 fully diffuse, overrides the finish preset; -1 clears the override"),
  metalness: z.number().min(-1).max(1).optional().describe("0 dielectric .. 1 metal, overrides the finish preset; -1 clears the override"),
  emissive: z.number().min(-1).max(5).optional().describe("glow strength; any value > 0 makes the object a real area light in renders; -1 clears the override"),
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
    description: "List everything in the current BlendTinux scene: project name, editor mode, camera (position/target/fov), selection, and every object with its id, name, transform, color, finish, material overrides and vertex count. Call this first to get object ids.",
    inputSchema: {},
  });

  forward("add_object", {
    title: "Add object",
    description: "Add a primitive to the scene. Position defaults to an empty spot on the floor. Rotation is degrees XYZ. The Y axis points up. The user can undo this with Ctrl+Z.",
    inputSchema: {
      kind: z.enum(["cube", "sphere", "cylinder", "cone", "torus", "plane"]),
      name: z.string().optional(),
      position: vec3.optional(),
      rotation: vec3.optional().describe("degrees XYZ"),
      scale: vec3.optional(),
      color: hexColor.optional(),
      finish: finish.optional(),
      ...matOverrides,
    },
  });

  forward("update_object", {
    title: "Update object",
    description: "Change an existing object: move, rotate (degrees XYZ), scale, recolor, change the material finish, fine-tune roughness/metalness/emissive, toggle smooth shading (flat=false is smooth), rename, or hide/show. Only the fields you pass change; changing the finish resets overrides unless they are set in the same call. Undoable.",
    inputSchema: {
      ...ref,
      newName: z.string().optional(),
      position: vec3.optional(),
      rotation: vec3.optional().describe("degrees XYZ"),
      scale: vec3.optional(),
      color: hexColor.optional(),
      finish: finish.optional(),
      ...matOverrides,
      flat: z.boolean().optional().describe("true = flat shading, false = smooth"),
      visible: z.boolean().optional(),
    },
  });

  forward("create_mesh", {
    title: "Create mesh",
    description: "Create an object from raw geometry: a flat vertex position list and a list of 3- or 4-index faces (counter-clockwise seen from outside; quads stay quads for subdivision). Use this for shapes primitives cannot make: tapered blades, curved sweeps, custom profiles. Y is up. Coordinates are used exactly as given (no normalization). Undoable.",
    inputSchema: {
      positions: z.array(z.number()).describe("flat [x,y,z, x,y,z, ...] vertex list"),
      faces: z.array(z.array(z.number().int()).min(3).max(4)).describe("faces as vertex-index polygons, e.g. [[0,1,2,3],[4,5,6]]"),
      name: z.string().optional(),
      position: vec3.optional(),
      rotation: vec3.optional().describe("degrees XYZ"),
      scale: vec3.optional(),
      color: hexColor.optional(),
      finish: finish.optional(),
      ...matOverrides,
      flat: z.boolean().optional().describe("true = flat shading, false = smooth (default)"),
    },
  }, 60000);

  forward("transform_objects", {
    title: "Transform objects together",
    description: "Move, rotate and/or scale several objects as one rigid group around a shared pivot (default: the center of the group's footprint on the floor). One undo step. Use this to reposition multi-part builds without breaking their alignment.",
    inputSchema: {
      ids: z.array(z.string()).min(1).describe("object ids from list_scene"),
      translate: vec3.optional(),
      rotate: vec3.optional().describe("degrees XYZ around the pivot"),
      scale: z.number().positive().optional().describe("uniform scale factor around the pivot"),
      pivot: vec3.optional().describe("world-space pivot point"),
    },
  });

  forward("deform_object", {
    title: "Deform object",
    description: "Bend, twist, taper or add noise to an object's mesh along an axis. Amount units: twist/bend are radians over the object's length, taper is a scale gradient (-0.95..3), noise is a displacement distance with `detail` controlling frequency. Dense meshes deform smoothly; subdivide first if the mesh is coarse. Undoable.",
    inputSchema: {
      ...ref,
      kind: z.enum(["twist", "bend", "taper", "noise"]),
      axis: z.enum(["x", "y", "z"]).default("y"),
      amount: z.number(),
      detail: z.number().min(0.5).max(8).optional().describe("noise frequency, default 2.5"),
    },
  }, 60000);

  // ---- camera and lighting ------------------------------------------------------

  forward("set_camera", {
    title: "Set camera",
    description: "Move the shared viewport/render camera. Pass position and target as world-space points (Y up), or just distance/fov to adjust in place. A running render restarts from the new view automatically. Returns the resulting camera.",
    inputSchema: {
      position: vec3.optional().describe("camera position in world space"),
      target: vec3.optional().describe("point the camera looks at"),
      distance: z.number().optional().describe("orbit distance from the target"),
      fov: z.number().min(10).max(120).optional().describe("vertical field of view in degrees, default 50"),
    },
  });

  forward("set_render_settings", {
    title: "Render settings",
    description: "Adjust lighting and rendering: sun direction/strength, sky preset or solid color, exposure, light bounces, ground plane, transparent background, and depth of field (aperture + focusDistance). Fields you omit keep their value; call with no fields to read the current settings. For extra lights, give any object an `emissive` value: it becomes a real area light. Settings persist with the project.",
    inputSchema: {
      sunElevation: z.number().min(0).max(90).optional().describe("degrees above the horizon"),
      sunAzimuth: z.number().optional().describe("compass direction in degrees"),
      sunStrength: z.number().min(0).max(5).optional(),
      sky: z.enum(["day", "sunset", "night", "solid"]).optional(),
      skyColor: hexColor.optional().describe("used when sky is 'solid'"),
      exposure: z.number().min(0.1).max(5).optional(),
      bounces: z.number().int().min(2).max(10).optional(),
      ground: z.boolean().optional().describe("the studio ground plane in renders"),
      transparentBackground: z.boolean().optional(),
      aperture: z.number().min(0).max(0.5).optional().describe("depth-of-field blur, 0 = everything sharp"),
      focusDistance: z.number().min(0).max(50).optional().describe("0 = focus on the orbit target"),
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
    description: "Run BlendTinux's path tracer on the current scene and return the image. Always starts from zero samples, so the count is exact. More samples = cleaner but slower (200 is a good preview, 1000+ for quality). Optional width/height set the render resolution (mainly for aspect ratio and supersampling; the returned image is capped at 1024 on the long edge). Takes seconds to a couple of minutes; the app returns to its previous state afterwards.",
    inputSchema: {
      samples: z.number().int().min(16).max(2000).default(200),
      width: z.number().int().min(64).max(4096).optional().describe("render width in pixels, needs height too"),
      height: z.number().int().min(64).max(4096).optional().describe("render height in pixels, needs width too"),
    },
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
    description: "Import Wavefront OBJ text. Each `o`/`g` group becomes its own object (so parts can get their own materials); one undo step for the whole file. With fit=true (default) oddly-scaled models are normalized and set on the ground with their relative layout intact; fit=false keeps the exact coordinates. Prefer create_mesh for geometry you are generating yourself.",
    inputSchema: {
      text: z.string().describe("the OBJ file contents"),
      name: z.string().optional(),
      fit: z.boolean().optional().describe("false = keep the file's exact coordinates (default true)"),
      split: z.boolean().optional().describe("false = merge all groups into one object (default true)"),
    },
  }, 60000);
}
