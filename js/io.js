/* Import/export and autosave. All exporters are hand-written (the vendored
   three.min.js is core-only, no example addons). GLB keeps one node per
   object with its transform; OBJ/STL/PLY bake world transforms into the
   vertices. Vertex colors are stored linear internally; OBJ and PLY convert
   back to sRGB on the way out, glTF wants linear as-is. */
"use strict";

BT.IO = {

  download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  _lin2srgb(c) { return Math.pow(BT.clamp(c, 0, 1), 1 / 2.2); },

  _worldBaked(obj) {
    obj.mesh.updateMatrixWorld();
    const g = obj.mesh.geometry;
    const pos = g.getAttribute("position").array;
    const nor = g.getAttribute("normal").array;
    const colAttr = g.getAttribute("color");
    const n = pos.length / 3;
    const outP = new Float32Array(n * 3), outN = new Float32Array(n * 3);
    const m = obj.mesh.matrixWorld;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromArray(pos, i * 3).applyMatrix4(m).toArray(outP, i * 3);
      v.fromArray(nor, i * 3).applyMatrix3(nm).normalize().toArray(outN, i * 3);
    }
    return { pos: outP, nor: outN, col: colAttr ? colAttr.array : null, idx: g.index.array, count: n };
  },

  // ---- GLB -------------------------------------------------------------------

  exportGLB() {
    const objects = BT.state.objects;
    if (!objects.length) { BT.emit("toast", "nothing to export yet"); return; }
    const json = {
      asset: { version: "2.0", generator: "BlendTinux" },
      scene: 0, scenes: [{ nodes: [] }],
      nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [],
    };
    const parts = [];
    let binLen = 0;

    const addView = (bytes, target) => {
      const pad = (4 - (binLen % 4)) % 4;
      if (pad) { parts.push(new Uint8Array(pad)); binLen += pad; }
      json.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.byteLength, target });
      parts.push(bytes);
      binLen += bytes.byteLength;
      return json.bufferViews.length - 1;
    };
    const addAccessor = (arr, componentType, type, target, withMinMax) => {
      const comps = type === "SCALAR" ? 1 : 3;
      const acc = {
        bufferView: addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), target),
        componentType, count: arr.length / comps, type,
      };
      if (withMinMax) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) {
          if (arr[i + k] < min[k]) min[k] = arr[i + k];
          if (arr[i + k] > max[k]) max[k] = arr[i + k];
        }
        acc.min = min; acc.max = max;
      }
      json.accessors.push(acc);
      return json.accessors.length - 1;
    };

    objects.forEach((obj) => {
      const g = obj.mesh.geometry;
      const pos = g.getAttribute("position").array;
      const nor = g.getAttribute("normal").array;
      const colAttr = g.getAttribute("color");
      const idxSrc = g.index.array;
      const idx = pos.length / 3 <= 65535 ? Uint16Array.from(idxSrc) : (idxSrc instanceof Uint32Array ? idxSrc : Uint32Array.from(idxSrc));

      const attributes = {
        POSITION: addAccessor(pos, 5126, "VEC3", 34962, true),
        NORMAL: addAccessor(nor, 5126, "VEC3", 34962, false),
      };
      if (colAttr) attributes.COLOR_0 = addAccessor(colAttr.array, 5126, "VEC3", 34962, false);
      const indices = addAccessor(idx, idx instanceof Uint16Array ? 5123 : 5125, "SCALAR", 34963, false);

      const em = BT.Mesh.effectiveMat(obj.finish, obj.rough, obj.metal, obj.emit);
      const c = colAttr ? new THREE.Color(1, 1, 1) : new THREE.Color(obj.color).convertSRGBToLinear();
      const mat = {
        name: obj.name + " material",
        pbrMetallicRoughness: {
          baseColorFactor: [c.r, c.g, c.b, em.opacity || 1],
          metallicFactor: em.metalness,
          roughnessFactor: em.roughness,
        },
      };
      if (em.opacity) mat.alphaMode = "BLEND";
      if (em.emissive) {
        const e = new THREE.Color(obj.color).convertSRGBToLinear();
        mat.emissiveFactor = [Math.min(e.r, 1), Math.min(e.g, 1), Math.min(e.b, 1)];
      }
      json.materials.push(mat);
      json.meshes.push({ name: obj.name, primitives: [{ attributes, indices, material: json.materials.length - 1 }] });
      json.nodes.push({
        name: obj.name,
        mesh: json.meshes.length - 1,
        translation: obj.mesh.position.toArray(),
        rotation: obj.mesh.quaternion.toArray(),
        scale: obj.mesh.scale.toArray(),
      });
      json.scenes[0].nodes.push(json.nodes.length - 1);
    });

    json.buffers.push({ byteLength: binLen });

    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const binPad = (4 - (binLen % 4)) % 4;
    const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + binLen + binPad;

    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let o = 0;
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); o = 12;
    dv.setUint32(o, jsonBytes.length + jsonPad, true); dv.setUint32(o + 4, 0x4e4f534a, true); o += 8;
    u8.set(jsonBytes, o); o += jsonBytes.length;
    for (let i = 0; i < jsonPad; i++) u8[o++] = 0x20;
    dv.setUint32(o, binLen + binPad, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
    for (const p of parts) { u8.set(p, o); o += p.byteLength; }

    this.download(new Blob([buf], { type: "model/gltf-binary" }), "blendtinux.glb");
  },

  // ---- OBJ -------------------------------------------------------------------

  buildOBJText() {
    const objects = BT.state.objects;
    if (!objects.length) return null;
    const out = ["# made with BlendTinux, tinux.dev/blendtinux"];
    let offset = 1;
    for (const obj of objects) {
      const b = this._worldBaked(obj);
      out.push("o " + obj.name.replace(/\s+/g, "_"));
      for (let i = 0; i < b.count; i++) {
        let line = "v " + b.pos[i * 3].toFixed(6) + " " + b.pos[i * 3 + 1].toFixed(6) + " " + b.pos[i * 3 + 2].toFixed(6);
        if (b.col) {
          line += " " + this._lin2srgb(b.col[i * 3]).toFixed(4) +
                  " " + this._lin2srgb(b.col[i * 3 + 1]).toFixed(4) +
                  " " + this._lin2srgb(b.col[i * 3 + 2]).toFixed(4);
        }
        out.push(line);
      }
      for (let i = 0; i < b.count; i++) {
        out.push("vn " + b.nor[i * 3].toFixed(4) + " " + b.nor[i * 3 + 1].toFixed(4) + " " + b.nor[i * 3 + 2].toFixed(4));
      }
      // write quads as quads, lone triangles as triangles
      const { polys } = BT.Mesh.buildPolys({ pos: b.pos, idx: b.idx, quad: obj.quadMap });
      for (const cyc of polys) {
        out.push("f " + cyc.map((v) => (v + offset) + "//" + (v + offset)).join(" "));
      }
      offset += b.count;
    }
    return out.join("\n");
  },

  exportOBJ() {
    const text = this.buildOBJText();
    if (text === null) { BT.emit("toast", "nothing to export yet"); return; }
    this.download(new Blob([text], { type: "text/plain" }), "blendtinux.obj");
  },

  // ---- STL (binary) ------------------------------------------------------------

  exportSTL() {
    const objects = BT.state.objects;
    if (!objects.length) { BT.emit("toast", "nothing to export yet"); return; }
    const baked = objects.map((o) => this._worldBaked(o));
    let nTris = 0;
    for (const b of baked) nTris += b.idx.length / 3;
    const buf = new ArrayBuffer(84 + nTris * 50);
    const dv = new DataView(buf);
    new Uint8Array(buf).set(new TextEncoder().encode("BlendTinux binary STL"), 0);
    dv.setUint32(80, nTris, true);
    let o = 84;
    for (const b of baked) {
      for (let f = 0; f < b.idx.length; f += 3) {
        const a3 = b.idx[f] * 3, b3 = b.idx[f + 1] * 3, c3 = b.idx[f + 2] * 3;
        const ux = b.pos[b3] - b.pos[a3], uy = b.pos[b3 + 1] - b.pos[a3 + 1], uz = b.pos[b3 + 2] - b.pos[a3 + 2];
        const vx = b.pos[c3] - b.pos[a3], vy = b.pos[c3 + 1] - b.pos[a3 + 1], vz = b.pos[c3 + 2] - b.pos[a3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        dv.setFloat32(o, nx / len, true); dv.setFloat32(o + 4, ny / len, true); dv.setFloat32(o + 8, nz / len, true); o += 12;
        for (const i3 of [a3, b3, c3]) {
          dv.setFloat32(o, b.pos[i3], true);
          dv.setFloat32(o + 4, b.pos[i3 + 1], true);
          dv.setFloat32(o + 8, b.pos[i3 + 2], true);
          o += 12;
        }
        dv.setUint16(o, 0, true); o += 2;
      }
    }
    this.download(new Blob([buf], { type: "application/octet-stream" }), "blendtinux.stl");
  },

  // ---- PLY (binary little endian) ------------------------------------------------

  exportPLY() {
    const objects = BT.state.objects;
    if (!objects.length) { BT.emit("toast", "nothing to export yet"); return; }
    const baked = objects.map((o) => this._worldBaked(o));
    let nV = 0, nF = 0;
    for (const b of baked) { nV += b.count; nF += b.idx.length / 3; }
    const header =
      "ply\nformat binary_little_endian 1.0\ncomment made with BlendTinux\n" +
      "element vertex " + nV + "\n" +
      "property float x\nproperty float y\nproperty float z\n" +
      "property float nx\nproperty float ny\nproperty float nz\n" +
      "property uchar red\nproperty uchar green\nproperty uchar blue\n" +
      "element face " + nF + "\nproperty list uchar int vertex_indices\nend_header\n";
    const headerBytes = new TextEncoder().encode(header);
    const buf = new ArrayBuffer(headerBytes.length + nV * 27 + nF * 13);
    new Uint8Array(buf).set(headerBytes, 0);
    const dv = new DataView(buf);
    let o = headerBytes.length;
    for (let bi = 0; bi < baked.length; bi++) {
      const b = baked[bi];
      const base = new THREE.Color(objects[bi].color).convertSRGBToLinear();
      for (let i = 0; i < b.count; i++) {
        dv.setFloat32(o, b.pos[i * 3], true); dv.setFloat32(o + 4, b.pos[i * 3 + 1], true); dv.setFloat32(o + 8, b.pos[i * 3 + 2], true);
        dv.setFloat32(o + 12, b.nor[i * 3], true); dv.setFloat32(o + 16, b.nor[i * 3 + 1], true); dv.setFloat32(o + 20, b.nor[i * 3 + 2], true);
        const cr = b.col ? b.col[i * 3] : base.r, cg = b.col ? b.col[i * 3 + 1] : base.g, cb = b.col ? b.col[i * 3 + 2] : base.b;
        dv.setUint8(o + 24, Math.round(this._lin2srgb(cr) * 255));
        dv.setUint8(o + 25, Math.round(this._lin2srgb(cg) * 255));
        dv.setUint8(o + 26, Math.round(this._lin2srgb(cb) * 255));
        o += 27;
      }
    }
    let vOffset = 0;
    for (const b of baked) {
      for (let f = 0; f < b.idx.length; f += 3) {
        dv.setUint8(o, 3);
        dv.setInt32(o + 1, b.idx[f] + vOffset, true);
        dv.setInt32(o + 5, b.idx[f + 1] + vOffset, true);
        dv.setInt32(o + 9, b.idx[f + 2] + vOffset, true);
        o += 13;
      }
      vOffset += b.count;
    }
    this.download(new Blob([buf], { type: "application/octet-stream" }), "blendtinux.ply");
  },

  // ---- OBJ import -----------------------------------------------------------------

  /* Returns the list of created objects. Each `o`/`g` group becomes its own
     object (opts.split = false merges everything into one). opts.fit = false
     keeps the file's exact coordinates; otherwise oddly-scaled models are
     normalized and set on the ground, with one shared transform so multi-part
     files keep their relative layout. */
  importOBJText(text, filename, opts) {
    opts = opts || {};
    const fit = opts.fit !== false;
    const split = opts.split !== false;
    const rawPos = [], rawCol = [];
    let hasColor = false;
    const groups = [];
    let cur = null;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.length < 2) continue;
      const t = line.split(/\s+/).filter(Boolean);
      if (t[0] === "v") {
        rawPos.push(parseFloat(t[1]), parseFloat(t[2]), parseFloat(t[3]));
        if (t.length >= 7) {
          hasColor = true;
          rawCol.push(parseFloat(t[4]), parseFloat(t[5]), parseFloat(t[6]));
        } else rawCol.push(1, 1, 1);
      } else if (t[0] === "o" || t[0] === "g") {
        const gname = t.slice(1).join(" ");
        if (!cur || cur.faces.length) groups.push(cur = { name: gname, faces: [], quadPairs: [] });
        else if (gname) cur.name = gname;
      } else if (t[0] === "f") {
        if (!cur) groups.push(cur = { name: "", faces: [], quadPairs: [] });
        const vs = [];
        for (let i = 1; i < t.length; i++) {
          let vi = parseInt(t[i].split("/")[0], 10);
          if (vi < 0) vi = rawPos.length / 3 + vi + 1;
          vs.push(vi - 1);
        }
        const base = cur.faces.length / 3;
        for (let i = 2; i < vs.length; i++) cur.faces.push(vs[0], vs[i - 1], vs[i]);
        if (vs.length === 4) cur.quadPairs.push(base); // the two fan triangles form a quad
      }
    }
    let parts = groups.filter((g) => g.faces.length);
    if (!rawPos.length || !parts.length) { BT.emit("toast", "could not read that .obj file"); return null; }
    if (!split && parts.length > 1) {
      const merged = { name: "", faces: [], quadPairs: [] };
      for (const p of parts) {
        const base = merged.faces.length / 3;
        for (const f of p.faces) merged.faces.push(f);
        for (const q of p.quadPairs) merged.quadPairs.push(q + base);
      }
      parts = [merged];
    }

    let colLin = null;
    if (hasColor) {
      colLin = new Float32Array(rawCol.length);
      for (let i = 0; i < rawCol.length; i++) colLin[i] = Math.pow(BT.clamp(rawCol[i], 0, 1), 2.2);
    }

    // each part keeps only the vertices its faces use
    const compact = (faces) => {
      const remap = new Map();
      const pos = [], col = colLin ? [] : null;
      const idx = new Uint32Array(faces.length);
      for (let i = 0; i < faces.length; i++) {
        const v = faces[i];
        let n = remap.get(v);
        if (n === undefined) {
          n = remap.size;
          remap.set(v, n);
          pos.push(rawPos[v * 3], rawPos[v * 3 + 1], rawPos[v * 3 + 2]);
          if (col) col.push(colLin[v * 3], colLin[v * 3 + 1], colLin[v * 3 + 2]);
        }
        idx[i] = n;
      }
      return { pos: new Float32Array(pos), idx, col: col ? new Float32Array(col) : null };
    };

    const baseName = (filename || "import").replace(/\.obj$/i, "").slice(0, 40) || "import";
    const made = [];
    const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const part of parts) {
      const c = compact(part.faces);
      const quad = new Int32Array(c.idx.length / 3).fill(-1);
      for (const base of part.quadPairs) { quad[base] = base + 1; quad[base + 1] = base; }
      const data = BT.Mesh.weldData(c.pos, c.idx, c.col, quad);
      if (!data.idx.length) continue;
      for (let i = 0; i < data.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (data.pos[i + k] < bb.min[k]) bb.min[k] = data.pos[i + k];
          if (data.pos[i + k] > bb.max[k]) bb.max[k] = data.pos[i + k];
        }
      }
      const name = (part.name || (parts.length > 1 ? baseName + " " + (made.length + 1) : baseName)).slice(0, 40);
      made.push(BT.Mesh.createObject({ data, name }));
    }
    if (!made.length) { BT.emit("toast", "could not read that .obj file"); return null; }

    // one shared transform keeps multi-part files aligned
    if (fit) {
      const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      const maxDim = Math.max(size[0], size[1], size[2]) || 1;
      const s = maxDim > 6 || maxDim < 0.2 ? 2 / maxDim : 1;
      for (const obj of made) {
        obj.mesh.scale.setScalar(s);
        obj.mesh.position.set(
          -(bb.min[0] + bb.max[0]) * 0.5 * s,
          -bb.min[1] * s,
          -(bb.min[2] + bb.max[2]) * 0.5 * s
        );
      }
    }

    for (const obj of made) BT.addObject(obj, obj === made[0]);
    const adds = made.map((obj) => ({ type: "add", data: BT.Mesh.serializeObject(obj) }));
    BT.History.push(adds.length === 1 ? adds[0] : { type: "batch", cmds: adds });
    BT.Viewport.frameObject(made[0]);
    let total = 0;
    for (const obj of made) total += BT.Mesh.vertCount(obj);
    BT.emit("toast", "imported " + (made.length > 1 ? made.length + " objects" : made[0].name) + " (" + total.toLocaleString() + " verts)");
    return made;
  },

  // ---- autosave -------------------------------------------------------------------

  /* Projects: every project is one localStorage key with the full scene
     payload; a small index key remembers the list and which one is open.
     The pre-project single-scene autosave migrates into the first project. */

  KEY_INDEX: "blendtinux.projects.v1",
  KEY_PREFIX: "blendtinux.proj.",
  KEY_LEGACY: "blendtinux.scene.v1",
  _projects: [],   // [{id, name}]
  _currentId: null,
  _saveTimer: 0,
  _warned: false,

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 800);
  },

  save() {
    if (!this._currentId) return;
    const s = BT.state;
    const cam = BT.Viewport.cam;
    const payload = {
      v: 1,
      cam: { t: cam.target.toArray(), theta: cam.theta, phi: cam.phi, dist: cam.dist, fov: BT.Viewport.camera.fov },
      mode: s.mode === "render" ? "object" : s.mode, // never boot into a live tracer
      render: BT.Render.settings,
      sel: s.selected ? s.selected.id : null,
      objects: s.objects.map((obj) => {
        const d = BT.Mesh.serializeObject(obj);
        return {
          id: d.id, name: d.name, color: d.color, finish: d.finish, flat: d.flat, vis: d.vis,
          rough: d.rough, metal: d.metal, emit: d.emit,
          p: d.p, q: d.q, s: d.s,
          pos: BT.b64FromF32(d.pos),
          idx: BT.b64FromU32(d.idx),
          col: d.col ? BT.b64FromF32(d.col) : null,
          quad: d.quad ? BT.b64FromI32(d.quad) : null,
        };
      }),
    };
    try {
      const str = JSON.stringify(payload);
      if (str.length > 4.6e6) throw new Error("too large");
      localStorage.setItem(this.KEY_PREFIX + this._currentId, str);
      BT.emit("saved");
    } catch (err) {
      if (!this._warned) {
        this._warned = true;
        BT.emit("toast", "scene is too large to autosave, use Export to keep it safe");
      }
    }
  },

  // boot: pick up the project list and open the last project
  restore() {
    this._loadIndex();
    if (!this._projects.length) {
      const legacy = localStorage.getItem(this.KEY_LEGACY);
      const id = BT.uid();
      this._projects = [{ id, name: "untitled" }];
      this._currentId = id;
      if (legacy) {
        try {
          localStorage.setItem(this.KEY_PREFIX + id, legacy);
          localStorage.removeItem(this.KEY_LEGACY);
        } catch (_) {}
      }
      this._saveIndex();
    }
    if (!this._projects.some((p) => p.id === this._currentId)) this._currentId = this._projects[0].id;
    return this._loadPayload(this._currentId);
  },

  _loadIndex() {
    try {
      const idx = JSON.parse(localStorage.getItem(this.KEY_INDEX));
      if (idx && Array.isArray(idx.list) && idx.list.length) {
        this._projects = idx.list;
        this._currentId = idx.current;
      }
    } catch (_) {}
  },

  _saveIndex() {
    try {
      localStorage.setItem(this.KEY_INDEX, JSON.stringify({ current: this._currentId, list: this._projects }));
    } catch (_) {}
  },

  _loadPayload(id) {
    try {
      const str = localStorage.getItem(this.KEY_PREFIX + id);
      if (!str) return false;
      const payload = JSON.parse(str);
      if (!payload || payload.v !== 1 || !payload.objects.length) return false;
      for (const d of payload.objects) {
        const obj = BT.Mesh.deserializeObject({
          id: d.id, name: d.name, color: d.color, finish: d.finish, flat: d.flat, vis: d.vis,
          rough: d.rough, metal: d.metal, emit: d.emit,
          p: d.p, q: d.q, s: d.s,
          pos: BT.f32FromB64(d.pos),
          idx: BT.u32FromB64(d.idx),
          col: d.col ? BT.f32FromB64(d.col) : null,
          quad: d.quad ? BT.i32FromB64(d.quad) : null,
        });
        BT.addObject(obj, false);
      }
      const cam = BT.Viewport.cam;
      cam.target.fromArray(payload.cam.t);
      cam.theta = payload.cam.theta; cam.phi = payload.cam.phi; cam.dist = payload.cam.dist;
      if (payload.cam.fov) {
        BT.Viewport.camera.fov = payload.cam.fov;
        BT.Viewport.camera.updateProjectionMatrix();
      }
      Object.assign(BT.Render.settings, BT.Render.DEFAULTS, payload.render || {});
      if (payload.sel) BT.select(BT.findObject(payload.sel));
      if (payload.mode && payload.mode !== "object") BT.setMode(payload.mode);
      return true;
    } catch (err) {
      try { localStorage.removeItem(this.KEY_PREFIX + id); } catch (_) {}
      return false;
    }
  },

  // ---- project ops (the topbar project menu drives these) ---------------------

  currentProject() {
    return this._projects.find((p) => p.id === this._currentId) || null;
  },

  listProjects() { return this._projects; },

  starterScene() {
    const cam = BT.Viewport.cam;
    cam.target.set(0, 0.4, 0); cam.theta = 0.6; cam.phi = 1.15; cam.dist = 4.2;
    const data = BT.Mesh.createPrimitive("sphere");
    const obj = BT.Mesh.createObject({ data, name: "sphere" });
    obj.mesh.position.y = 0.6;
    BT.addObject(obj, true);
  },

  _clearScene() {
    if (BT.state.mode !== "object") BT.setMode("object");
    BT.select(null);
    for (const obj of BT.state.objects.slice()) {
      BT.removeObject(obj);
      BT.Mesh.disposeObject(obj);
    }
    BT.History.clear();
  },

  switchProject(id) {
    if (id === this._currentId || !this._projects.some((p) => p.id === id)) return;
    this.save(); // keep the scene we are leaving
    this._currentId = id;
    this._saveIndex();
    this._clearScene();
    if (!this._loadPayload(id)) this.starterScene();
    BT.emit("project");
  },

  newProject() {
    this.save();
    const id = BT.uid();
    let n = 0, name;
    do { n++; name = n === 1 ? "untitled" : "untitled " + n; } while (this._projects.some((p) => p.name === name));
    this._projects.push({ id, name });
    this._currentId = id;
    this._saveIndex();
    this._clearScene();
    Object.assign(BT.Render.settings, BT.Render.DEFAULTS);
    this.starterScene();
    this.save();
    BT.emit("project");
  },

  renameProject(id, name) {
    const p = this._projects.find((x) => x.id === id);
    name = (name || "").trim().slice(0, 40);
    if (!p || !name || p.name === name) return;
    p.name = name;
    this._saveIndex();
    BT.emit("project");
  },

  deleteProject(id) {
    const i = this._projects.findIndex((x) => x.id === id);
    if (i < 0) return;
    try { localStorage.removeItem(this.KEY_PREFIX + id); } catch (_) {}
    this._projects.splice(i, 1);
    if (id !== this._currentId) { this._saveIndex(); BT.emit("project"); return; }
    if (!this._projects.length) { this._currentId = null; this.newProject(); return; }
    this._currentId = this._projects[Math.min(i, this._projects.length - 1)].id;
    this._saveIndex();
    this._clearScene();
    if (!this._loadPayload(this._currentId)) this.starterScene();
    BT.emit("project");
  },
};
