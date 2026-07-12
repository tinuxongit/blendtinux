/* MCP bridge: lets AI assistants drive the app over MCP. Two ways in, same
   command protocol for both:
   1. A local MCP server (mcp/server.mjs) listening on 127.0.0.1, tried first.
   2. The hosted relay (a Cloudflare Worker): the page connects out over wss
      with a personal pairing code, and any MCP host can reach this exact tab
      at RELAY/<code> with zero installs. The code only routes to this tab.
   The page receives {id, cmd, args} frames, runs them against the BT API and
   answers {id, ok, result|error}. Nothing connects unless the user turns on
   the plug button in the top bar; the choice and the pairing code are
   remembered in localStorage. Every mutation pushes the same History
   commands the UI would, so Ctrl+Z works and autosave rides along. */
"use strict";

BT.MCP = {
  PORT: 43117, // keep in sync with BLENDTINUX_MCP_PORT in mcp/server.mjs
  RELAY: "https://blendtinux-mcp.unofficialfriendsmod.workers.dev", // hosted relay (mcp-worker/)
  KEY: "blendtinux.mcp.on",
  CODE_KEY: "blendtinux.mcp.code",
  enabled: false,
  connected: false,
  via: null,        // "local" | "relay" while connected
  code: "",         // pairing code for the relay
  _ws: null,
  _ti: 0,           // which target we try next: 0 local, 1 relay
  _retry: 0,
  _timer: 0,

  init() {
    try {
      this.enabled = localStorage.getItem(this.KEY) === "1";
      this.code = localStorage.getItem(this.CODE_KEY) || "";
    } catch (_) {}
    if (!/^[A-Z2-9]{8}$/.test(this.code)) {
      // unambiguous alphabet (no 0/O/1/I/L), ~40 bits, stable across sessions
      const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
      const rnd = new Uint32Array(8);
      crypto.getRandomValues(rnd);
      this.code = Array.from(rnd, (v) => abc[v % abc.length]).join("");
      try { localStorage.setItem(this.CODE_KEY, this.code); } catch (_) {}
    }
    if (this.enabled) this._connect();
    BT.emit("mcp");
  },

  url() { return this.RELAY + "/" + this.code; },

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(this.KEY, this.enabled ? "1" : "0"); } catch (_) {}
    if (this.enabled) { this._ti = 0; this._retry = 0; this._announce = true; this._connect(); }
    else this._disconnect();
    BT.emit("mcp");
  },

  // ---- connection lifecycle ---------------------------------------------------

  _targets() {
    return [
      { via: "local", url: "ws://127.0.0.1:" + this.PORT },
      { via: "relay", url: this.RELAY.replace(/^http/, "ws") + "/" + this.code + "/ws" },
    ];
  },

  _connect() {
    if (this._ws) return;
    const target = this._targets()[this._ti];
    let ws;
    try { ws = new WebSocket(target.url); } catch (_) { this._scheduleRetry(); return; }
    this._ws = ws;
    ws.onopen = () => {
      this._retry = 0;
      this.connected = true;
      this.via = target.via;
      ws.send(JSON.stringify({ hello: { app: "blendtinux", v: 1 } }));
      BT.emit("mcp");
      // explain what just happened and what to do next; quiet toast on
      // silent reconnects so page loads and drops don't nag
      if (this._announce) {
        BT.emit("mcp-pop");
      } else {
        BT.emit("toast", target.via === "relay"
          ? "MCP linked, your code is " + this.code + " (click it up top for help)"
          : "MCP connected to the local server (click 'local' up top for help)");
      }
      this._announce = false;
    };
    ws.onmessage = (ev) => this._handle(ev);
    ws.onclose = () => {
      this._ws = null;
      const wasConnected = this.connected;
      if (wasConnected) {
        this.connected = false;
        this.via = null;
        BT.emit("mcp");
      }
      if (!this.enabled) return;
      if (wasConnected) { this._ti = 0; this._retry = 0; } // start over at local
      else this._ti = (this._ti + 1) % 2;                  // try the other door
      this._scheduleRetry();
    };
  },

  _scheduleRetry() {
    clearTimeout(this._timer);
    // hop to the next target quickly; back off only after a full local+relay cycle
    const delay = this._ti !== 0 ? 250 : Math.min(1000 * Math.pow(2, this._retry++), 15000);
    this._timer = setTimeout(() => this._connect(), delay);
  },

  _disconnect() {
    clearTimeout(this._timer);
    if (this._ws) { const ws = this._ws; this._ws = null; ws.onclose = null; ws.close(); }
    this.connected = false;
    this.via = null;
  },

  async _handle(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (!msg || !msg.id || !this.commands[msg.cmd]) return;
    let frame;
    try {
      const result = await this.commands[msg.cmd].call(this, msg.args || {});
      frame = { id: msg.id, ok: true, result: result === undefined ? null : result };
    } catch (err) {
      frame = { id: msg.id, ok: false, error: String((err && err.message) || err) };
    }
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(frame));
  },

  // ---- helpers ------------------------------------------------------------------

  _resolve(args) {
    if (args.id) {
      const o = BT.findObject(args.id);
      if (!o) throw new Error("no object with id " + args.id + ", call list_scene for current ids");
      return o;
    }
    if (args.name) {
      const hits = BT.state.objects.filter((o) => o.name === args.name);
      if (hits.length === 1) return hits[0];
      if (!hits.length) throw new Error('no object named "' + args.name + '", call list_scene for current names');
      throw new Error(hits.length + ' objects are named "' + args.name + '", use the id instead');
    }
    throw new Error("pass an object id or name");
  },

  _resolveProject(args) {
    const list = BT.IO.listProjects();
    if (args.id) {
      const p = list.find((x) => x.id === args.id);
      if (!p) throw new Error("no project with id " + args.id + ", call list_projects");
      return p;
    }
    if (args.name) {
      const hits = list.filter((x) => x.name === args.name);
      if (hits.length === 1) return hits[0];
      if (!hits.length) throw new Error('no project named "' + args.name + '", call list_projects');
      throw new Error(hits.length + ' projects are named "' + args.name + '", use the id instead');
    }
    throw new Error("pass a project id or name");
  },

  _summary(o) {
    const e = new THREE.Euler().setFromQuaternion(o.mesh.quaternion, "XYZ");
    const deg = (r) => Math.round(r * 180 / Math.PI * 100) / 100;
    const out = {
      id: o.id, name: o.name, verts: BT.Mesh.vertCount(o),
      position: o.mesh.position.toArray(),
      rotation: [deg(e.x), deg(e.y), deg(e.z)],
      scale: o.mesh.scale.toArray(),
      color: o.color, finish: o.finish, flat: o.flat,
      visible: o.mesh.visible !== false,
    };
    if (o.rough != null) out.roughness = o.rough;
    if (o.metal != null) out.metalness = o.metal;
    if (o.emit != null) out.emissive = o.emit;
    return out;
  },

  // material override from a tool arg: undefined keeps, negative clears
  _matArg(v, max) {
    if (v === undefined) return undefined;
    return v < 0 ? null : BT.clamp(v, 0, max);
  },

  _snapshot(o) {
    return { p: o.mesh.position.toArray(), q: o.mesh.quaternion.toArray(), s: o.mesh.scale.toArray() };
  },

  _applyTransformArgs(o, args) {
    if (args.position) o.mesh.position.fromArray(args.position);
    if (args.rotation) {
      const r = args.rotation.map((d) => d * Math.PI / 180);
      o.mesh.quaternion.setFromEuler(new THREE.Euler(r[0], r[1], r[2], "XYZ"));
    }
    if (args.scale) o.mesh.scale.fromArray(args.scale);
  },

  // scale so the long edge is at most 1024, return bare base64 (no data: prefix)
  _grab(src) {
    const k = Math.min(1, 1024 / Math.max(src.width, src.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return { png: c.toDataURL("image/png").split(",")[1], w: c.width, h: c.height };
  },

  _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); },

  // ---- commands -------------------------------------------------------------------

  commands: {
    list_scene() {
      const cur = BT.IO.currentProject();
      return {
        project: cur ? cur.name : null,
        mode: BT.state.mode,
        camera: BT.Viewport.cameraInfo(),
        selected: BT.state.selected ? BT.state.selected.id : null,
        objects: BT.state.objects.map((o) => this._summary(o)),
      };
    },

    add_object(args) {
      const data = BT.Mesh.createPrimitive(args.kind);
      const flat = args.kind === "cube" || args.kind === "plane";
      let n = 1;
      for (const o of BT.state.objects) if (o.name.indexOf(args.kind) === 0) n++;
      const obj = BT.Mesh.createObject({
        data, flat,
        name: args.name || (n > 1 ? args.kind + " " + n : args.kind),
        color: args.color, finish: args.finish,
        rough: this._matArg(args.roughness, 1),
        metal: this._matArg(args.metalness, 1),
        emit: this._matArg(args.emissive, 5),
      });
      // default placement: sit on the grid, step aside if the spot is taken
      obj.mesh.geometry.computeBoundingBox();
      const bb = obj.mesh.geometry.boundingBox;
      let x = 0;
      const taken = (tx) => BT.state.objects.some((o) => Math.abs(o.mesh.position.x - tx) < 0.9 && Math.abs(o.mesh.position.z) < 0.9);
      while (taken(x)) x += 1.5;
      obj.mesh.position.set(x, -bb.min.y, 0);
      this._applyTransformArgs(obj, args);
      BT.addObject(obj, true);
      BT.History.push({ type: "add", data: BT.Mesh.serializeObject(obj) });
      return this._summary(obj);
    },

    update_object(args) {
      const obj = this._resolve(args);
      if (args.position || args.rotation || args.scale) {
        const before = this._snapshot(obj);
        this._applyTransformArgs(obj, args);
        BT.History.push({ type: "transform", id: obj.id, before, after: this._snapshot(obj) });
        BT.emit("transform", obj);
      }
      if (args.color !== undefined || args.finish !== undefined || args.flat !== undefined ||
          args.roughness !== undefined || args.metalness !== undefined || args.emissive !== undefined) {
        const before = { color: obj.color, finish: obj.finish, flat: obj.flat, rough: obj.rough, metal: obj.metal, emit: obj.emit };
        // switching finish resets overrides to the new preset unless the same
        // call sets them again; a negative value clears one explicitly
        const finishChanged = args.finish !== undefined && BT.Mesh.normalizeFinish(args.finish) !== obj.finish;
        const ov = (argV, curV, max) => {
          const v = this._matArg(argV, max);
          return v !== undefined ? v : (finishChanged ? null : curV);
        };
        const after = {
          color: args.color !== undefined ? args.color : obj.color,
          finish: args.finish !== undefined ? args.finish : obj.finish,
          flat: args.flat !== undefined ? args.flat : obj.flat,
          rough: ov(args.roughness, obj.rough, 1),
          metal: ov(args.metalness, obj.metal, 1),
          emit: ov(args.emissive, obj.emit, 5),
        };
        BT.Mesh.applyMaterialProps(obj, after);
        BT.History.push({ type: "material", id: obj.id, before, after });
      }
      if (args.newName) {
        const nv = args.newName.trim().slice(0, 40);
        if (nv && nv !== obj.name) {
          BT.History.push({ type: "rename", id: obj.id, before: obj.name, after: nv });
          obj.name = nv;
          BT.emit("objects");
        }
      }
      if (args.visible !== undefined && args.visible !== (obj.mesh.visible !== false)) {
        BT.UI.toggleVisible(obj);
      }
      return this._summary(obj);
    },

    duplicate_object(args) {
      const obj = this._resolve(args);
      const off = args.offset || [0.6, 0, 0.6];
      const d = BT.Mesh.serializeObject(obj);
      d.id = BT.uid();
      d.name = obj.name + " copy";
      d.p = [d.p[0] + off[0], d.p[1] + off[1], d.p[2] + off[2]];
      const clone = BT.Mesh.deserializeObject(d);
      BT.addObject(clone, true);
      BT.History.push({ type: "add", data: d });
      return this._summary(clone);
    },

    delete_object(args) {
      const obj = this._resolve(args);
      const name = obj.name;
      BT.History.push({ type: "delete", data: BT.Mesh.serializeObject(obj) });
      BT.removeObject(obj);
      BT.Mesh.disposeObject(obj);
      return { deleted: name };
    },

    select_object(args) {
      const obj = this._resolve(args);
      BT.select(obj);
      if (args.frame) BT.Viewport.frameObject(obj);
      return this._summary(obj);
    },

    subdivide_object(args) {
      const obj = this._resolve(args);
      if (BT.Mesh.vertCount(obj) > 100000) throw new Error("this mesh is already very dense");
      const before = BT.Mesh.geometryData(obj);
      const after = BT.Mesh.subdivide(before, !!args.smooth);
      BT.Mesh.replaceGeometry(obj, after);
      BT.History.push({ type: "geometry", id: obj.id, before, after });
      return this._summary(obj);
    },

    screenshot() {
      let src;
      if (BT.state.mode === "render" && BT.Render._running && BT.Render._renderer) {
        BT.Render._redrawView();
        src = BT.Render._renderer.domElement;
      } else {
        const vp = BT.Viewport;
        vp._applyCamera();
        vp.renderer.render(vp.scene, vp.camera);
        src = vp.canvas;
      }
      const g = this._grab(src);
      return { png: g.png, note: "screenshot " + g.w + "x" + g.h + " (" + BT.state.mode + " mode)" };
    },

    async render(args) {
      const samples = BT.clamp(Math.round(args.samples || 200), 16, 2000);
      const prevMode = BT.state.mode;
      const s = BT.Render.settings;
      const prev = { target: s.target, resW: s.resW, resH: s.resH };
      const resChanged = !!(args.width && args.height);
      s.target = samples;
      if (resChanged) {
        s.resW = BT.clamp(Math.round(args.width), 64, 4096);
        s.resH = BT.clamp(Math.round(args.height), 64, 4096);
      }
      try {
        if (prevMode !== "render") BT.setMode("render");
        else if (!BT.Render._running) BT.Render.open();
        else {
          // start from zero so the count means what it says
          BT.Render.applySettings("target");
          if (resChanged) BT.Render._recreateTargets();
          else BT.Render._resetAccum();
        }
        await this._sleep(100); // let open() or its deferred bail settle
        if (!BT.Render._running) throw new Error("the ray tracer could not start (empty scene or no WebGL2)");
        const size = BT.Render._size();
        const deadline = performance.now() + 110000;
        while (BT.Render._running && BT.Render._samples < samples && performance.now() < deadline) {
          await this._sleep(200);
        }
        BT.Render._redrawView();
        const g = this._grab(BT.Render._renderer.domElement);
        const got = BT.Render._samples;
        return {
          png: g.png,
          note: (got >= samples ? got + " samples" : "timed out at " + got + " of " + samples + " samples") +
            ", rendered " + size.w + "x" + size.h + (g.w !== size.w ? ", returned " + g.w + "x" + g.h : ""),
        };
      } finally {
        s.target = prev.target;
        s.resW = prev.resW;
        s.resH = prev.resH;
        if (BT.state.mode === "render" && prevMode !== "render") BT.setMode(prevMode);
        else if (BT.Render._running && resChanged) BT.Render._recreateTargets();
      }
    },

    set_camera(args) {
      BT.Viewport.setCamera(args);
      BT.IO.scheduleSave();
      return BT.Viewport.cameraInfo();
    },

    set_render_settings(args) {
      const s = BT.Render.settings;
      const ops = [
        ["sunElevation", "sunElev", (v) => BT.clamp(v, 0, 90)],
        ["sunAzimuth", "sunAzim", (v) => ((v % 360) + 360) % 360],
        ["sunStrength", "sunStrength", (v) => BT.clamp(v, 0, 5)],
        ["sky", "sky", (v) => v],
        ["skyColor", "skyColor", (v) => v],
        ["exposure", "exposure", (v) => BT.clamp(v, 0.1, 5)],
        ["bounces", "bounces", (v) => BT.clamp(Math.round(v), 2, 10)],
        ["ground", "ground", (v) => !!v],
        ["transparentBackground", "bgTransparent", (v) => !!v],
        ["aperture", "aperture", (v) => BT.clamp(v, 0, 0.5)],
        ["focusDistance", "focus", (v) => BT.clamp(v, 0, 50)],
      ];
      for (const [argKey, key, cook] of ops) {
        if (args[argKey] === undefined) continue;
        s[key] = cook(args[argKey]);
        BT.Render.applySettings(key);
      }
      BT.IO.scheduleSave();
      return {
        sunElevation: s.sunElev, sunAzimuth: s.sunAzim, sunStrength: s.sunStrength,
        sky: s.sky, skyColor: s.skyColor, exposure: s.exposure, bounces: s.bounces,
        ground: s.ground, transparentBackground: s.bgTransparent,
        aperture: s.aperture, focusDistance: s.focus,
      };
    },

    create_mesh(args) {
      const pos = args.positions, faces = args.faces;
      if (!Array.isArray(pos) || pos.length < 9 || pos.length % 3) throw new Error("positions must be a flat [x,y,z, x,y,z, ...] list");
      const nV = pos.length / 3;
      if (nV > 100000) throw new Error("too many vertices (100k max)");
      if (!Array.isArray(faces) || !faces.length) throw new Error("faces must be a list of 3- or 4-index polygons");
      for (const f of faces) {
        if (!Array.isArray(f) || f.length < 3 || f.length > 4) throw new Error("each face needs 3 or 4 vertex indices");
        for (const v of f) if (!Number.isInteger(v) || v < 0 || v >= nV) throw new Error("face index " + v + " is out of range (" + nV + " vertices)");
      }
      const data = BT.Mesh.createMeshData(pos, faces);
      const obj = BT.Mesh.createObject({
        data,
        name: (args.name || "mesh").slice(0, 40),
        color: args.color, finish: args.finish, flat: !!args.flat,
        rough: this._matArg(args.roughness, 1),
        metal: this._matArg(args.metalness, 1),
        emit: this._matArg(args.emissive, 5),
      });
      this._applyTransformArgs(obj, args);
      BT.addObject(obj, true);
      BT.History.push({ type: "add", data: BT.Mesh.serializeObject(obj) });
      return this._summary(obj);
    },

    transform_objects(args) {
      const ids = args.ids || [];
      if (!ids.length) throw new Error("pass ids: an array of object ids from list_scene");
      const objs = ids.map((id) => {
        const o = BT.findObject(id);
        if (!o) throw new Error("no object with id " + id + ", call list_scene for current ids");
        return o;
      });
      const box = new THREE.Box3();
      for (const o of objs) { o.mesh.updateMatrixWorld(); box.expandByObject(o.mesh); }
      const pivot = args.pivot
        ? new THREE.Vector3().fromArray(args.pivot)
        : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
      const t = new THREE.Vector3().fromArray(args.translate || [0, 0, 0]);
      let q = null;
      if (args.rotate) {
        const r = args.rotate.map((d) => d * Math.PI / 180);
        q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], "XYZ"));
      }
      const k = args.scale != null ? args.scale : 1;
      if (!(k > 0)) throw new Error("scale must be > 0");
      const cmds = [];
      for (const o of objs) {
        const before = this._snapshot(o);
        const p = o.mesh.position.clone().sub(pivot);
        if (q) p.applyQuaternion(q);
        p.multiplyScalar(k).add(pivot).add(t);
        o.mesh.position.copy(p);
        if (q) o.mesh.quaternion.premultiply(q);
        o.mesh.scale.multiplyScalar(k);
        cmds.push({ type: "transform", id: o.id, before, after: this._snapshot(o) });
        BT.emit("transform", o);
      }
      BT.History.push(cmds.length === 1 ? cmds[0] : { type: "batch", cmds });
      return objs.map((o) => this._summary(o));
    },

    deform_object(args) {
      const obj = this._resolve(args);
      const kinds = BT.Deform.KINDS;
      if (!kinds[args.kind]) throw new Error("kind must be twist, bend, taper or noise");
      const axis = { x: 0, y: 1, z: 2 }[args.axis || "y"];
      if (axis === undefined) throw new Error("axis must be x, y or z");
      const amount = BT.clamp(args.amount, kinds[args.kind].min, kinds[args.kind].max);
      const freq = BT.clamp(args.detail || 2.5, 0.5, 8);
      BT.Deform.applyTo(obj, args.kind, axis, amount, freq);
      return this._summary(obj);
    },

    list_projects() {
      const cur = BT.IO.currentProject();
      return { current: cur ? cur.id : null, projects: BT.IO.listProjects() };
    },

    create_project(args) {
      BT.IO.newProject();
      const cur = BT.IO.currentProject();
      if (args.name) BT.IO.renameProject(cur.id, args.name);
      return BT.IO.currentProject();
    },

    open_project(args) {
      const p = this._resolveProject(args);
      BT.IO.switchProject(p.id);
      return { opened: p, objects: BT.state.objects.length };
    },

    rename_project(args) {
      const p = this._resolveProject(args);
      BT.IO.renameProject(p.id, args.newName);
      return BT.IO.listProjects().find((x) => x.id === p.id);
    },

    export_obj() {
      const text = BT.IO.buildOBJText();
      if (text === null) throw new Error("the scene is empty, nothing to export");
      return { obj: text };
    },

    import_obj(args) {
      const list = BT.IO.importOBJText(args.text, args.name || "import.obj", { fit: args.fit, split: args.split });
      if (!list || !list.length) throw new Error("could not read that OBJ text");
      if (list.length === 1) return this._summary(list[0]);
      return { imported: list.map((o) => this._summary(o)) };
    },
  },
};
