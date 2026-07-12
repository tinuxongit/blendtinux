/* All DOM: top bar, contextual panel, menus, toasts, hints, status,
   keyboard shortcuts. Panels re-render from state on events; tooltips
   (data-tip) double as the documentation. */
"use strict";

BT.UI = {

  ICONS: {
    cube: '<path d="M8 1.8 14 5v6L8 14.2 2 11V5Z"/><path d="M8 1.8v12.4M2 5l6 3 6-3" opacity=".55"/>',
    sphere: '<circle cx="8" cy="8" r="6.2"/><ellipse cx="8" cy="8" rx="6.2" ry="2.4" opacity=".55"/>',
    cylinder: '<ellipse cx="8" cy="3.6" rx="5" ry="1.9"/><path d="M3 3.6v8.8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V3.6"/>',
    cone: '<path d="M8 1.8 13 12.2M8 1.8 3 12.2"/><ellipse cx="8" cy="12.2" rx="5" ry="1.9"/>',
    torus: '<ellipse cx="8" cy="8" rx="6.2" ry="4.4"/><ellipse cx="8" cy="8" rx="2.6" ry="1.5" opacity=".7"/>',
    plane: '<path d="M4.5 4h9l-2 8h-9Z"/>',
    object: '<path d="M3 2.5 12.8 8 8.6 9.2 6.5 13.8Z"/>',
    vertex: '<path d="M8 3.4 13 12H3Z" opacity=".45"/><circle cx="8" cy="3.4" r="1.6" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="13" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    sculpt: '<path d="M2 12.5c2-.3 2.6-4.6 6-4.6s4 4.3 6 4.6"/><path d="M2 12.5h12" opacity=".55"/>',
    paint: '<path d="M8 2.2c2.6 3.2 4.2 5.5 4.2 7.6a4.2 4.2 0 1 1-8.4 0C3.8 7.7 5.4 5.4 8 2.2Z"/>',
    move: '<path d="M8 1.5v13M1.5 8h13"/><path d="m5.8 3.4 2.2-2 2.2 2M5.8 12.6l2.2 2 2.2-2M3.4 5.8l-2 2.2 2 2.2M12.6 5.8l2 2.2-2 2.2"/>',
    rotate: '<path d="M13.6 8A5.6 5.6 0 1 1 8 2.4c2.5 0 4.2 1.4 5.2 3"/><path d="M13.6 2.2v3.4h-3.4"/>',
    scale: '<path d="M2.5 13.5v-4m0 4h4m-4 0L8 8"/><rect x="8.5" y="2.5" width="5" height="5" rx="1"/>',
    draw: '<path d="M1.8 11.5c2.5 0 2.8-5.5 6.2-5.5s3.7 5.5 6.2 5.5"/>',
    inflate: '<circle cx="8" cy="8" r="3.4"/><path d="M8 2.8V.9M8 13.2v1.9M2.8 8H.9m12.3 0h1.9M4.3 4.3 3 3m9 1.3L13 3M4.3 11.7 3 13m9-1.3L13 13" opacity=".8"/>',
    grab: '<path d="M5 8.5V3.7a1 1 0 0 1 2 0v3.6m0-4.6a1 1 0 0 1 2 0v4.6m0-3.6a1 1 0 0 1 2 0v4.1a4.5 4.5 0 0 1-9 .7L1.6 7a1 1 0 0 1 1.7-1l1.7 2.4"/>',
    smooth: '<path d="M1.8 8c2 0 2.2-2.5 4.2-2.5S8.2 10.5 10 10.5 12.2 8 14.2 8"/>',
    flatten: '<path d="M2 12.5h12"/><path d="M8 2.5v6.5m0 0 2.4-2.4M8 9 5.6 6.6"/>',
    pinch: '<path d="M1.5 3.5 6 8l-4.5 4.5M14.5 3.5 10 8l4.5 4.5"/>',
    blur: '<path d="M8 2.2c2.6 3.2 4.2 5.5 4.2 7.6a4.2 4.2 0 1 1-8.4 0C3.8 7.7 5.4 5.4 8 2.2Z"/><path d="M5.5 9.8c0 1.4 1.1 2.5 2.5 2.5" opacity=".7"/>',
    undo: '<path d="M3 6.5h7a3.5 3.5 0 0 1 0 7H6"/><path d="M6 3.5 3 6.5l3 3"/>',
    redo: '<path d="M13 6.5H6a3.5 3.5 0 0 0 0 7h4"/><path d="M10 3.5l3 3-3 3"/>',
    duplicate: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 2.5h-7a1 1 0 0 0-1 1v7"/>',
    mirror: '<path d="M8 1.5v13" opacity=".55" stroke-dasharray="2 2"/><path d="M5.5 4.5 2 8l3.5 3.5zM10.5 4.5 14 8l-3.5 3.5z"/>',
    subdiv: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M8 2.5v11M2.5 8h11" opacity=".7"/>',
    trash: '<path d="M2.5 4.5h11M6.5 4.5v-2h3v2M4 4.5l.8 9h6.4l.8-9"/><path d="M6.7 7v4M9.3 7v4" opacity=".7"/>',
    deform: '<path d="M3 13.5c0-6 2-10 5-10s5 4 5 10"/><path d="M3 13.5h10" opacity=".55"/>',
    frame: '<path d="M2 5V3a1 1 0 0 1 1-1h2m6 0h2a1 1 0 0 1 1 1v2m0 6v2a1 1 0 0 1-1 1h-2m-6 0H3a1 1 0 0 1-1-1v-2"/><circle cx="8" cy="8" r="2.2"/>',
    eye: '<path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.9"/>',
    eyeoff: '<path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8Z" opacity=".4"/><path d="M2.8 13.2 13.2 2.8"/>',
    cut: '<circle cx="4" cy="12.2" r="1.7"/><circle cx="12" cy="12.2" r="1.7"/><path d="M5.4 10.9 12.4 2.2M10.6 10.9 3.6 2.2"/>',
    inset: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><rect x="6" y="6" width="4" height="4" rx=".5"/>',
    center: '<circle cx="8" cy="8" r="2"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 2.5h-7a1 1 0 0 0-1 1v7"/>',
    paste: '<rect x="3" y="3.5" width="10" height="11" rx="1.5"/><path d="M6 3.5V2h4v1.5"/><path d="M6 8h4M6 10.7h4" opacity=".7"/>',
  },

  PRIMS: [
    ["cube", "Cube"], ["sphere", "Sphere"], ["cylinder", "Cylinder"],
    ["cone", "Cone"], ["torus", "Torus"], ["plane", "Plane"],
  ],
  BRUSHES: [
    ["draw", "Draw"], ["inflate", "Inflate"], ["grab", "Grab"],
    ["smooth", "Smooth"], ["flatten", "Flatten"], ["pinch", "Pinch"],
  ],
  BRUSH_TIPS: {
    draw: "raise the surface, hold Ctrl to carve",
    inflate: "puff vertices out along their normals, Ctrl deflates",
    grab: "pull a chunk of the surface around",
    smooth: "relax bumps and noise",
    flatten: "press the surface toward a plane",
    pinch: "gather vertices together, Ctrl spreads",
  },
  FINISH_LABELS: [
    ["matte", "Matte"], ["plastic", "Plastic"], ["glossy", "Glossy"], ["satin", "Satin"],
    ["metal", "Metal"], ["chrome", "Chrome"], ["gold", "Gold"],
    ["glass", "Glass"], ["frosted", "Frosted"], ["glow", "Glow"],
  ],
  SWATCHES: ["#f0924f", "#e0685f", "#e8c15a", "#8fc866", "#5fb8ae", "#5f96d9", "#9b7fd4", "#e8e6e3"],

  _els: {},
  _paintSwatches: [],

  ic(name, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + this.ICONS[name] + "</svg>";
  },

  init() {
    const $ = (id) => document.getElementById(id);
    this._els = {
      panel: $("panel"), hint: $("hint"), status: $("status"), toasts: $("toasts"),
      addMenu: $("add-menu"), exportMenu: $("export-menu"),
      modeSwitch: $("mode-switch"), gizmoSwitch: $("gizmo-switch"),
      undo: $("undo-btn"), redo: $("redo-btn"), importFile: $("import-file"),
      outliner: $("outliner"), outlinerList: $("outliner-list"),
    };

    this._buildTopbar();
    this._buildModeSwitch();
    this._buildGizmoSwitch();
    this._buildOutliner();
    this._bindKeyboard();

    BT.on("selection", () => { this.renderPanel(); this._syncGizmoSwitch(); this._syncModeSwitch(); this.updateStatus(); this.refreshOutliner(); });
    BT.on("mode", () => { this.renderPanel(); this._syncGizmoSwitch(); this._syncModeSwitch(); this._onModeHints(); });
    BT.on("objects", () => { this.renderPanel(); this.updateStatus(); this.refreshOutliner(); });
    BT.on("geometry", () => { this.renderPanel(); this.updateStatus(); });
    BT.on("material", () => { this.renderPanel(); this.refreshOutliner(); });
    BT.on("deform", () => this.renderPanel());
    BT.on("gizmoMode", () => this._syncGizmoSwitch());
    BT.on("brush", () => this._syncBrushReadout());
    BT.on("history", () => {
      this._els.undo.disabled = !BT.History.canUndo();
      this._els.redo.disabled = !BT.History.canRedo();
      this.updateStatus();
      if (BT.state.mode === "sculpt") this._dismissHint("sculpt");
    });
    BT.on("transform", (obj) => this._syncTransformInputs(obj));
    BT.on("vertex", () => this._syncVertexPanel());
    BT.on("toast", (msg, action) => this.toast(msg, action));
    BT.on("saved", () => this._flashSaveDot());
    BT.on("orbited", () => this._dismissHint("orbit"));

    this.renderPanel();
    this.updateStatus();
  },

  // ---- top bar ---------------------------------------------------------------

  _buildTopbar() {
    const e = this._els;
    e.undo.innerHTML = this.ic("undo");
    e.redo.innerHTML = this.ic("redo");
    e.undo.addEventListener("click", () => BT.History.undo());
    e.redo.addEventListener("click", () => BT.History.redo());

    e.addMenu.innerHTML = this.PRIMS.map(([k, label]) =>
      '<button data-kind="' + k + '">' + this.ic(k) + label + "</button>").join("");
    this._wireMenu("add-btn", e.addMenu, (btn) => this.addPrimitive(btn.dataset.kind));

    const fmts = [
      ["glb", "GLB", "keeps colors and materials", true],
      ["obj", "OBJ", "meshes and vertex colors", false],
      ["stl", "STL", "for 3D printing", false],
      ["ply", "PLY", "points, faces and colors", false],
    ];
    e.exportMenu.innerHTML = fmts.map(([k, label, sub, rec]) =>
      '<button data-fmt="' + k + '"><span>.' + label.toLowerCase() + "</span><span class=\"msub\">" + sub + "</span>" +
      (rec ? '<span class="mtag">best</span>' : "") + "</button>").join("");
    this._wireMenu("export-btn", e.exportMenu, (btn) => {
      const fmt = btn.dataset.fmt;
      if (fmt === "glb") BT.IO.exportGLB();
      else if (fmt === "obj") BT.IO.exportOBJ();
      else if (fmt === "stl") BT.IO.exportSTL();
      else BT.IO.exportPLY();
    });

    document.getElementById("render-btn").addEventListener("click", () => BT.Render.open());
    document.getElementById("render-save").addEventListener("click", () => BT.Render.savePNG());
    document.getElementById("render-close").addEventListener("click", () => BT.Render.close());

    document.getElementById("import-btn").addEventListener("click", () => e.importFile.click());
    e.importFile.addEventListener("change", () => {
      const file = e.importFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => BT.IO.importOBJText(reader.result, file.name);
      reader.readAsText(file);
      e.importFile.value = "";
    });
  },

  _wireMenu(btnId, menu, onPick) {
    const btn = document.getElementById(btnId);
    const close = () => { menu.hidden = true; document.removeEventListener("pointerdown", onDoc, true); };
    const onDoc = (ev) => { if (!menu.contains(ev.target) && ev.target !== btn) close(); };
    btn.addEventListener("click", () => {
      if (!menu.hidden) { close(); return; }
      menu.hidden = false;
      document.addEventListener("pointerdown", onDoc, true);
    });
    menu.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      close();
      onPick(b);
    });
  },

  _buildModeSwitch() {
    const modes = [
      ["object", "Object", "select and arrange shapes (1)"],
      ["sculpt", "Sculpt", "push and pull the surface (2)"],
      ["paint", "Paint", "brush colors onto the surface (3)"],
      ["vertex", "Verts", "see and move single vertices (4)"],
    ];
    this._els.modeSwitch.innerHTML = modes.map(([k, label, tip]) =>
      '<button role="radio" data-mode="' + k + '" data-tip="' + tip + '" aria-label="' + label + '">' + this.ic(k) + '<span class="seg-label">' + label + "</span></button>").join("");
    this._els.modeSwitch.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (b && !b.disabled) BT.setMode(b.dataset.mode);
    });
    this._syncModeSwitch();
  },

  _syncModeSwitch() {
    const hasSel = !!BT.state.selected || BT.state.objects.length === 1;
    this._els.modeSwitch.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.mode === BT.state.mode));
      if (b.dataset.mode !== "object") b.disabled = !hasSel;
    });
  },

  _buildGizmoSwitch() {
    const tools = [
      ["select", "object", "select: click shapes without moving anything (Q)"],
      ["hand", "grab", "hand: drag a shape to move it, Shift lifts, Ctrl snaps (H)"],
      ["translate", "move", "move along the X/Y/Z arrows (G)"],
      ["rotate", "rotate", "rotate: drag a ring or its ball (R)"],
      ["scale", "scale", "scale (S)"],
      ["cut", "cut", "loop cut: hover the shape for the ring preview, click to slice (C)"],
    ];
    this._els.gizmoSwitch.innerHTML = tools.map(([k, icon, tip]) =>
      '<button role="radio" data-g="' + k + '" data-tip="' + tip + '" aria-label="' + tip + '">' + this.ic(icon) + "</button>").join("");
    this._els.gizmoSwitch.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (b) BT.Gizmo.setMode(b.dataset.g);
    });
    this._syncGizmoSwitch();
  },

  _syncGizmoSwitch() {
    this._els.gizmoSwitch.hidden = BT.state.mode !== "object" && BT.state.mode !== "vertex";
    this._els.gizmoSwitch.querySelectorAll("button").forEach((b) =>
      b.setAttribute("aria-checked", String(b.dataset.g === BT.state.gizmoMode)));
  },

  // ---- outliner ----------------------------------------------------------------

  _buildOutliner() {
    this._els.outlinerList.addEventListener("click", (ev) => {
      const eye = ev.target.closest(".oeye");
      if (eye) {
        this.toggleVisible(BT.findObject(eye.dataset.id));
        return;
      }
      const row = ev.target.closest(".oname");
      if (row) {
        const obj = BT.findObject(row.dataset.id);
        if (obj) BT.select(obj);
      }
    });
    this.refreshOutliner();
  },

  refreshOutliner() {
    const list = this._els.outlinerList;
    const objs = BT.state.objects;
    this._els.outliner.hidden = !objs.length;
    if (!objs.length) { list.innerHTML = ""; return; }
    list.innerHTML = objs.map((o) => {
      const sel = o === BT.state.selected;
      const vis = o.mesh.visible !== false;
      return '<div class="orow' + (sel ? " sel" : "") + (vis ? "" : " hiddenobj") + '">' +
        '<button class="oname" data-id="' + o.id + '" title="' + BT.Mesh.vertCount(o).toLocaleString() + ' verts">' +
        '<span class="odot" style="background:' + o.color + '"></span>' + this._esc(o.name) + "</button>" +
        '<button class="oeye" data-id="' + o.id + '" aria-label="' + (vis ? "hide" : "show") + " " + this._esc(o.name) + '">' +
        this.ic(vis ? "eye" : "eyeoff") + "</button></div>";
    }).join("");
  },

  // ---- context menu ----------------------------------------------------------------

  showContextMenu(x, y, obj) {
    const m = document.getElementById("ctxmenu");
    const items = [];
    if (obj) {
      items.push(["dup-here", "duplicate", "Duplicate here"]);
      items.push(["copy", "copy", "Copy"]);
      if (this._clipboard) items.push(["paste", "paste", "Paste"]);
      items.push(["hide", "eyeoff", "Hide"]);
      items.push(["delete", "trash", "Delete"]);
    } else if (this._clipboard) {
      items.push(["paste", "paste", "Paste"]);
    } else return;

    m.innerHTML = items.map(([act, icon, label]) =>
      '<button data-act="' + act + '"' + (act === "delete" ? ' style="color:var(--danger)"' : "") + ">" +
      this.ic(icon) + label + "</button>").join("");
    m.hidden = false;
    m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + "px";
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + "px";

    const close = () => { m.hidden = true; document.removeEventListener("pointerdown", onDoc, true); };
    const onDoc = (ev) => { if (!m.contains(ev.target)) close(); };
    setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
    m.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      close();
      switch (b.dataset.act) {
        case "dup-here": this.duplicateHere(obj); break;
        case "copy": this.copySelected(); break;
        case "paste": this.paste(); break;
        case "hide": this.toggleVisible(obj); break;
        case "delete": this.deleteSelected(); break;
      }
    };
  },

  // exact clone in the exact same place
  duplicateHere(obj) {
    if (!obj) return;
    const d = BT.Mesh.serializeObject(obj);
    d.id = BT.uid();
    d.name = obj.name + " copy";
    const clone = BT.Mesh.deserializeObject(d);
    BT.addObject(clone, true);
    BT.History.push({ type: "add", data: d });
    this.toast("duplicated " + obj.name + " in place, drag it away");
  },

  toggleVisible(obj) {
    if (!obj) return;
    const before = obj.mesh.visible;
    obj.mesh.visible = !before;
    BT.History.push({ type: "visible", id: obj.id, before, after: !before });
    if (!obj.mesh.visible && BT.state.selected === obj) {
      BT.select(null);
      if (BT.state.mode !== "object") BT.setMode("object");
    }
    this.refreshOutliner();
  },

  // ---- clipboard -----------------------------------------------------------------

  _clipboard: null,
  _pasteCount: 0,

  copySelected() {
    const obj = BT.state.selected;
    if (!obj) { this.toast("select a shape to copy first"); return; }
    this._clipboard = BT.Mesh.serializeObject(obj);
    this._pasteCount = 0;
    this.toast("copied " + obj.name);
  },

  cutSelected() {
    const obj = BT.state.selected;
    if (!obj) { this.toast("select a shape to cut first"); return; }
    this._clipboard = BT.Mesh.serializeObject(obj);
    this._pasteCount = 0;
    this.deleteSelected();
    this.toast("cut " + this._clipboard.name + ", paste it with Ctrl+V");
  },

  paste() {
    if (!this._clipboard) { this.toast("nothing copied yet (Ctrl+C copies the selected shape)"); return; }
    const c = this._clipboard;
    this._pasteCount++;
    const d = {
      id: BT.uid(), name: c.name + " copy", color: c.color, finish: c.finish, flat: c.flat, vis: c.vis,
      p: [c.p[0] + 0.6 * this._pasteCount, c.p[1], c.p[2] + 0.6 * this._pasteCount],
      q: c.q.slice(), s: c.s.slice(),
      pos: c.pos.slice(), idx: c.idx.slice(), col: c.col ? c.col.slice() : null,
    };
    const obj = BT.Mesh.deserializeObject(d);
    BT.addObject(obj, true);
    BT.History.push({ type: "add", data: d });
  },

  // ---- scene actions ------------------------------------------------------------

  addPrimitive(kind) {
    const data = BT.Mesh.createPrimitive(kind);
    let n = 1;
    for (const o of BT.state.objects) if (o.name.indexOf(kind) === 0) n++;
    const flat = kind === "cube" || kind === "plane";
    const obj = BT.Mesh.createObject({ data, name: n > 1 ? kind + " " + n : kind, flat });

    // sit on the grid, and step aside if the spot is taken
    obj.mesh.geometry.computeBoundingBox();
    const bb = obj.mesh.geometry.boundingBox;
    let x = 0;
    const taken = (tx) => BT.state.objects.some((o) => Math.abs(o.mesh.position.x - tx) < 0.9 && Math.abs(o.mesh.position.z) < 0.9);
    while (taken(x)) x += 1.5;
    obj.mesh.position.set(x, -bb.min.y, 0);

    BT.addObject(obj, true);
    BT.History.push({ type: "add", data: BT.Mesh.serializeObject(obj) });
  },

  centerSelected() {
    const obj = BT.state.selected;
    if (!obj) return;
    const before = this._snapshotTransform(obj);
    const box = new THREE.Box3().setFromObject(obj.mesh);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    obj.mesh.position.x -= c.x;
    obj.mesh.position.z -= c.z;
    obj.mesh.position.y -= box.min.y;
    BT.History.push({ type: "transform", id: obj.id, before, after: this._snapshotTransform(obj) });
    BT.emit("transform", obj);
  },

  duplicateSelected() {
    const src = BT.state.selected;
    if (!src) return;
    const d = BT.Mesh.serializeObject(src);
    d.id = BT.uid();
    d.name = src.name + " copy";
    d.p = [d.p[0] + 0.6, d.p[1], d.p[2] + 0.6];
    const obj = BT.Mesh.deserializeObject(d);
    BT.addObject(obj, true);
    BT.History.push({ type: "add", data: d });
  },

  deleteSelected() {
    const obj = BT.state.selected;
    if (!obj) return;
    BT.History.push({ type: "delete", data: BT.Mesh.serializeObject(obj) });
    BT.removeObject(obj);
    BT.Mesh.disposeObject(obj);
  },

  subdivideSelected(smooth) {
    const obj = BT.state.selected;
    if (!obj) return;
    if (BT.Mesh.vertCount(obj) > 100000) {
      this.toast("this mesh is already very dense");
      return;
    }
    const before = BT.Mesh.geometryData(obj);
    const after = BT.Mesh.subdivide(before, smooth);
    BT.Mesh.replaceGeometry(obj, after);
    BT.History.push({ type: "geometry", id: obj.id, before, after });
  },

  // repeat shape-keeping subdivision until the mesh is dense enough to sculpt
  densifySelected() {
    const obj = BT.state.selected;
    if (!obj) return;
    const before = BT.Mesh.geometryData(obj);
    let after = before;
    let guard = 0;
    while (after.pos.length / 3 < 6000 && guard++ < 7) after = BT.Mesh.subdivide(after, false);
    if (after === before) return;
    BT.Mesh.replaceGeometry(obj, after);
    BT.History.push({ type: "geometry", id: obj.id, before, after });
    this.toast("added detail: " + (after.pos.length / 3).toLocaleString() + " verts, same shape");
  },

  mirrorSelected() {
    const obj = BT.state.selected;
    if (!obj) return;
    const before = BT.Mesh.geometryData(obj);
    const after = BT.Mesh.mirrorX(before);
    BT.Mesh.replaceGeometry(obj, after);
    BT.History.push({ type: "geometry", id: obj.id, before, after });
  },

  // ---- panel ---------------------------------------------------------------------

  renderPanel() {
    const p = this._els.panel;
    const mode = BT.state.mode, sel = BT.state.selected;
    p.hidden = false;
    if (mode === "object") {
      if (!sel) {
        if (!BT.state.objects.length) {
          p.innerHTML = '<div class="pempty">it is quiet in here.<br><br>press <span class="kbd">+ Add</span> up top to drop in a shape, then sculpt, paint and export it.</div>';
        } else {
          p.innerHTML = '<div class="pempty">click a shape (or its row in the Shapes list) to select it. with the hand tool, dragging a shape moves it.<br><br><span class="kbd">drag</span> empty space orbits &nbsp;<span class="kbd">shift+drag</span> pans &nbsp;<span class="kbd">scroll</span> zooms<br><br><span class="kbd">Ctrl+C</span> <span class="kbd">Ctrl+X</span> <span class="kbd">Ctrl+V</span> copy, cut and paste shapes</div>';
        }
        return;
      }
      if (BT.Deform.session) { this._renderDeformSession(p); return; }
      this._renderObjectPanel(p, sel);
    } else if (mode === "sculpt") {
      this._renderSculptPanel(p);
    } else if (mode === "paint") {
      this._renderPaintPanel(p);
    } else {
      this._renderVertexPanel(p);
    }
  },

  _renderVertexPanel(p) {
    const sel = BT.state.selected;
    const faceMode = BT.Vertex.selMode === "face";
    const n = faceMode ? BT.Vertex.selectedFaces.size : BT.Vertex.selected.size;
    const vi = BT.Vertex.active;
    const key = BT.Vertex.selMode + ":" + vi + ":" + n;

    let html =
      '<div class="psec"><div class="prow"><label>pick</label><div class="chips" id="selmode-chips">' +
      [["vertex", "Verts"], ["face", "Faces"]].map(([k, label]) =>
        '<button class="chip" data-sm="' + k + '" aria-pressed="' + (BT.Vertex.selMode === k) + '">' + label + "</button>").join("") +
      "</div></div></div>";

    if (faceMode) {
      if (!n) {
        html += '<div class="psec"><div class="pempty">click a face to pick it · <span class="kbd">shift</span>+click adds more · drag on empty space to box-select · drag a picked face to move it.</div></div>';
      } else {
        html += '<div class="psec"><div class="plabel">' + n.toLocaleString() + " face" + (n === 1 ? "" : "s") + " selected</div></div>";
      }
      html +=
        '<div class="psec"><div class="plabel">Tools</div><div class="agrid">' +
        '<button class="abtn" id="vx-extrude" data-tip="pull the picked faces out (E)">' + this.ic("inflate") + "Extrude</button>" +
        '<button class="abtn" id="vx-inset" data-tip="cut a smaller face inside the picked faces (I)">' + this.ic("inset") + "Inset</button>" +
        '<button class="abtn danger" id="vx-del" style="grid-column:1/-1" data-tip="delete the picked faces (X)">' + this.ic("trash") + "Delete</button>" +
        "</div></div>";
    } else {
      if (!n) {
        html +=
          '<div class="psec"><div class="pempty">every dot is a vertex, the little corners your mesh is built from.<br><br>' +
          'click a dot to pick it · <span class="kbd">shift</span>+click adds more · drag on empty space to box-select · drag a picked dot to move the whole selection.</div></div>';
      } else {
        const f = (v) => (Math.round(v * 1000) / 1000).toString();
        html += '<div class="psec"><div class="plabel">' + n.toLocaleString() + " of " + BT.Mesh.vertCount(sel).toLocaleString() + " vertices selected</div>";
        if (vi >= 0) {
          const pos = sel.mesh.geometry.getAttribute("position").array;
          html +=
            '<div class="prow"><label>position</label><div class="vec3">' +
            [0, 1, 2].map((i) =>
              '<input data-vc="' + i + '" value="' + f(pos[vi * 3 + i]) + '" aria-label="vertex ' + "xyz"[i] + '">').join("") +
            "</div></div>";
        }
        html += "</div>";
      }
      html +=
        '<div class="psec"><div class="plabel">Tools</div><div class="agrid">' +
        '<button class="abtn" id="vx-extrude" data-tip="pull new geometry out of the selected faces (E)">' + this.ic("inflate") + "Extrude</button>" +
        '<button class="abtn" id="vx-inset" data-tip="cut a smaller face inside the selected faces, then push it (I)">' + this.ic("inset") + "Inset</button>" +
        '<button class="abtn" id="vx-fill" data-tip="make a face from 3 or 4 picked vertices (F)">' + this.ic("plane") + "Fill</button>" +
        '<button class="abtn" id="vx-merge" data-tip="collapse the picked vertices into one (M)">' + this.ic("pinch") + "Merge</button>" +
        '<button class="abtn danger" id="vx-del" style="grid-column:1/-1" data-tip="delete picked vertices and their faces (X)">' + this.ic("trash") + "Delete</button>" +
        "</div>" +
        '<div class="pempty" style="margin-top:10px"><span class="kbd">arrow keys</span> walk to a neighbouring vertex · the Move/Rotate/Scale tools on the left work on the picked vertices too</div></div>';
    }

    p.innerHTML = html;
    p.dataset.vkey = key;
    p.querySelector("#selmode-chips").addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (b) BT.Vertex.setSelMode(b.dataset.sm);
    });
    p.querySelectorAll("[data-vc]").forEach((inp) => {
      inp.addEventListener("focus", () => inp.select());
      inp.addEventListener("change", () => BT.Vertex.setCoord(+inp.dataset.vc, parseFloat(inp.value)));
    });
    p.querySelector("#vx-extrude").addEventListener("click", () => BT.Vertex.extrudeSelected());
    p.querySelector("#vx-inset").addEventListener("click", () => BT.Vertex.insetSelected());
    const fill = p.querySelector("#vx-fill");
    if (fill) fill.addEventListener("click", () => BT.Vertex.fillSelected());
    const merge = p.querySelector("#vx-merge");
    if (merge) merge.addEventListener("click", () => BT.Vertex.mergeSelected());
    p.querySelector("#vx-del").addEventListener("click", () => BT.Vertex.deleteSelectedVerts());
  },

  _syncVertexPanel() {
    const p = this._els.panel;
    if (BT.state.mode !== "vertex") return;
    const key = BT.Vertex.selMode + ":" + BT.Vertex.active + ":" +
      (BT.Vertex.selMode === "face" ? BT.Vertex.selectedFaces.size : BT.Vertex.selected.size);
    if (p.dataset.vkey !== key) { this.renderPanel(); return; }
    const sel = BT.state.selected;
    if (!sel || BT.Vertex.active < 0) return;
    const pos = sel.mesh.geometry.getAttribute("position").array;
    const f = (v) => (Math.round(v * 1000) / 1000).toString();
    p.querySelectorAll("[data-vc]").forEach((inp) => {
      if (inp === document.activeElement) return;
      inp.value = f(pos[BT.Vertex.active * 3 + +inp.dataset.vc]);
    });
  },

  _renderObjectPanel(p, sel) {
    const pos = sel.mesh.position, rot = sel.mesh.rotation, scl = sel.mesh.scale;
    const deg = (r) => (r * 180 / Math.PI);
    const f = (v) => (Math.round(v * 100) / 100).toString();
    const vec3 = (id, a, b, c) =>
      '<div class="vec3">' +
      '<input data-t="' + id + '" data-i="0" value="' + f(a) + '" aria-label="' + id + ' x">' +
      '<input data-t="' + id + '" data-i="1" value="' + f(b) + '" aria-label="' + id + ' y">' +
      '<input data-t="' + id + '" data-i="2" value="' + f(c) + '" aria-label="' + id + ' z">' +
      "</div>";

    p.innerHTML =
      '<div class="psec"><input type="text" id="obj-name" value="' + this._esc(sel.name) + '" aria-label="Object name"></div>' +
      '<div class="psec"><div class="plabel">Transform</div>' +
      '<div class="prow"><label>position</label>' + vec3("p", pos.x, pos.y, pos.z) + "</div>" +
      '<div class="prow"><label>rotation</label>' + vec3("r", deg(rot.x), deg(rot.y), deg(rot.z)) + "</div>" +
      '<div class="prow"><label>scale</label>' + vec3("s", scl.x, scl.y, scl.z) + "</div>" +
      '<button class="abtn" id="act-center" style="width:100%;margin-top:2px" data-tip="move to the middle of the grid, resting on the floor">' + this.ic("center") + "Center on floor</button></div>" +
      '<div class="psec"><div class="plabel">Material</div>' +
      '<div class="prow"><label>color</label><input type="color" id="obj-color" value="' + sel.color + '" data-tip="base color"></div>' +
      '<div class="prow"><label>finish</label><div class="chips" id="finish-chips">' +
      this.FINISH_LABELS.map(([k, label]) => '<button class="chip" data-f="' + k + '" aria-pressed="' + (sel.finish === k) + '">' + label + "</button>").join("") +
      "</div></div>" +
      '<div class="trow"><span>smooth shading</span><button class="toggle" id="flat-toggle" aria-pressed="' + (!sel.flat) + '" aria-label="smooth shading"></button></div></div>' +
      '<div class="psec"><div class="plabel">Mesh</div><div class="agrid">' +
      '<button class="abtn" id="act-dup" data-tip="Shift+D">' + this.ic("duplicate") + "Duplicate</button>" +
      '<button class="abtn" id="act-mirror" data-tip="copy across X and weld">' + this.ic("mirror") + "Mirror</button>" +
      '<button class="abtn" id="act-subdiv" data-tip="splits every square into 4 squares, shape stays the same">' + this.ic("subdiv") + "Subdivide</button>" +
      '<button class="abtn" id="act-subdiv-smooth" data-tip="Catmull-Clark subdivision, rounds the shape like a subsurf modifier">' + this.ic("smooth") + "Smooth +</button>" +
      '<button class="abtn danger" id="act-del" data-tip="X or Delete" style="grid-column:1/-1">' + this.ic("trash") + "Delete</button>" +
      "</div></div>" +
      '<div class="psec"><div class="plabel">Deform</div><div class="agrid">' +
      Object.keys(BT.Deform.KINDS).map((k) =>
        '<button class="abtn" data-deform="' + k + '">' + this.ic("deform") + BT.Deform.KINDS[k].label + "</button>").join("") +
      "</div></div>";

    // name
    const nameEl = p.querySelector("#obj-name");
    nameEl.addEventListener("change", () => {
      const nv = nameEl.value.trim().slice(0, 40) || sel.name;
      if (nv !== sel.name) {
        BT.History.push({ type: "rename", id: sel.id, before: sel.name, after: nv });
        sel.name = nv;
        this.updateStatus();
      }
      nameEl.value = sel.name;
    });

    // transform inputs
    p.querySelectorAll(".vec3 input").forEach((inp) => {
      let before = null;
      inp.addEventListener("focus", () => { before = this._snapshotTransform(sel); inp.select(); });
      inp.addEventListener("change", () => {
        const v = parseFloat(inp.value);
        if (!isFinite(v)) { this._syncTransformInputs(sel); return; }
        const i = +inp.dataset.i, t = inp.dataset.t;
        if (t === "p") sel.mesh.position.setComponent(i, v);
        else if (t === "s") sel.mesh.scale.setComponent(i, v === 0 ? 0.01 : v);
        else {
          const e = sel.mesh.rotation;
          const arr = [e.x, e.y, e.z];
          arr[i] = v * Math.PI / 180;
          sel.mesh.rotation.set(arr[0], arr[1], arr[2]);
        }
        const after = this._snapshotTransform(sel);
        BT.History.push({ type: "transform", id: sel.id, before: before || after, after });
        before = after;
        this._syncTransformInputs(sel);
      });
    });

    // material
    p.querySelector("#obj-color").addEventListener("input", (ev) => {
      const beforeProps = { color: sel.color, finish: sel.finish, flat: sel.flat };
      const afterProps = { color: ev.target.value, finish: sel.finish, flat: sel.flat };
      BT.Mesh.applyMaterialProps(sel, afterProps);
      this._coalesceMaterialCmd(sel, beforeProps, afterProps);
    });
    p.querySelector("#finish-chips").addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      const beforeProps = { color: sel.color, finish: sel.finish, flat: sel.flat };
      const afterProps = { color: sel.color, finish: b.dataset.f, flat: sel.flat };
      BT.Mesh.applyMaterialProps(sel, afterProps);
      BT.History.push({ type: "material", id: sel.id, before: beforeProps, after: afterProps });
    });
    p.querySelector("#flat-toggle").addEventListener("click", () => {
      const beforeProps = { color: sel.color, finish: sel.finish, flat: sel.flat };
      const afterProps = { color: sel.color, finish: sel.finish, flat: !sel.flat };
      BT.Mesh.applyMaterialProps(sel, afterProps);
      BT.History.push({ type: "material", id: sel.id, before: beforeProps, after: afterProps });
    });

    // actions
    p.querySelector("#act-center").addEventListener("click", () => this.centerSelected());
    p.querySelector("#act-dup").addEventListener("click", () => this.duplicateSelected());
    p.querySelector("#act-mirror").addEventListener("click", () => this.mirrorSelected());
    p.querySelector("#act-subdiv").addEventListener("click", () => this.subdivideSelected(false));
    p.querySelector("#act-subdiv-smooth").addEventListener("click", () => this.subdivideSelected(true));
    p.querySelector("#act-del").addEventListener("click", () => this.deleteSelected());
    p.querySelectorAll("[data-deform]").forEach((b) =>
      b.addEventListener("click", () => BT.Deform.start(sel, b.dataset.deform)));
  },

  _coalesceMaterialCmd(sel, beforeProps, afterProps) {
    // color drags fire many input events; keep one undo step per gesture
    const h = BT.History;
    const last = h.stack[h.ptr - 1];
    if (last && last.type === "material" && last.id === sel.id && h.ptr === h.stack.length &&
        last._live && Date.now() - last._t < 800) {
      last.after = afterProps;
      last._t = Date.now();
    } else {
      h.push({ type: "material", id: sel.id, before: beforeProps, after: afterProps, _live: true, _t: Date.now() });
    }
  },

  _renderDeformSession(p) {
    const s = BT.Deform.session;
    const kind = BT.Deform.KINDS[s.kind];
    p.innerHTML =
      '<div class="psec"><div class="plabel">Deform: ' + kind.label + "</div>" +
      '<div class="slider-row"><label>amount</label><input type="range" id="df-amount" min="' + kind.min + '" max="' + kind.max + '" step="0.01" value="' + s.amount + '"><span class="sval" id="df-val">' + s.amount.toFixed(2) + "</span></div>" +
      (s.kind === "noise" ? '<div class="slider-row"><label>detail</label><input type="range" id="df-freq" min="0.5" max="8" step="0.1" value="' + s.freq + '"><span class="sval" id="df-fval">' + s.freq.toFixed(1) + "</span></div>" : "") +
      (s.kind !== "noise" ? '<div class="prow"><label>axis</label><div class="chips" id="df-axis">' +
        ["X", "Y", "Z"].map((a, i) => '<button class="chip" data-a="' + i + '" aria-pressed="' + (s.axis === i) + '">' + a + "</button>").join("") + "</div></div>" : "") +
      '<div class="agrid" style="margin-top:10px">' +
      '<button class="abtn primary" id="df-apply">Apply</button>' +
      '<button class="abtn" id="df-cancel" data-tip="Esc">Cancel</button>' +
      "</div></div>";

    const amount = p.querySelector("#df-amount");
    amount.addEventListener("input", () => {
      BT.Deform.setAmount(parseFloat(amount.value));
      p.querySelector("#df-val").textContent = parseFloat(amount.value).toFixed(2);
    });
    const freq = p.querySelector("#df-freq");
    if (freq) freq.addEventListener("input", () => {
      BT.Deform.setFreq(parseFloat(freq.value));
      p.querySelector("#df-fval").textContent = parseFloat(freq.value).toFixed(1);
    });
    const axis = p.querySelector("#df-axis");
    if (axis) axis.addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      BT.Deform.setAxis(+b.dataset.a);
      axis.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    });
    p.querySelector("#df-apply").addEventListener("click", () => BT.Deform.apply());
    p.querySelector("#df-cancel").addEventListener("click", () => BT.Deform.cancel());
  },

  _renderSculptPanel(p) {
    const st = BT.Sculpt.settings;
    p.innerHTML =
      '<div class="psec"><div class="plabel">Brush</div><div class="bgrid">' +
      this.BRUSHES.map(([k, label]) =>
        '<button class="bbtn" data-b="' + k + '" aria-pressed="' + (st.brush === k) + '" data-tip="' + this.BRUSH_TIPS[k] + '">' + this.ic(k) + label + "</button>").join("") +
      "</div></div>" +
      this._brushSliders(st) +
      '<div class="psec"><div class="prow"><label>falloff</label><div class="chips" id="falloff-chips">' +
      [["smooth", "Soft"], ["linear", "Even"], ["sharp", "Crisp"]].map(([k, label]) =>
        '<button class="chip" data-fo="' + k + '" aria-pressed="' + (st.falloff === k) + '">' + label + "</button>").join("") +
      "</div></div>" +
      '<div class="trow"><span>mirror across X</span><button class="toggle" id="sym-toggle" aria-pressed="' + st.symmetry + '" aria-label="mirror across X"></button></div></div>' +
      this._densifyOffer();
    this._bindBrushCommon(p, "brush");
  },

  _renderPaintPanel(p) {
    const st = BT.Sculpt.settings;
    p.innerHTML =
      '<div class="psec"><div class="plabel">Paint</div><div class="bgrid" style="grid-template-columns:1fr 1fr">' +
      [["paint", "Paint"], ["blur", "Blend"]].map(([k, label]) =>
        '<button class="bbtn" data-b="' + k + '" aria-pressed="' + (st.paintBrush === k) + '">' + this.ic(k === "paint" ? "paint" : "blur") + label + "</button>").join("") +
      "</div></div>" +
      '<div class="psec"><div class="prow"><label>color</label><input type="color" id="paint-color" value="' + st.paintColor + '"></div>' +
      '<div class="prow"><label></label><div class="swatches">' +
      this.SWATCHES.map((c) => '<button class="swatch" style="background:' + c + '" data-c="' + c + '" aria-label="use ' + c + '"></button>').join("") +
      "</div></div></div>" +
      this._brushSliders(st) +
      '<div class="psec"><div class="trow"><span>mirror across X</span><button class="toggle" id="sym-toggle" aria-pressed="' + st.symmetry + '" aria-label="mirror across X"></button></div></div>' +
      this._densifyOffer();
    this._bindBrushCommon(p, "paintBrush");

    const colorEl = p.querySelector("#paint-color");
    colorEl.addEventListener("input", () => { BT.Sculpt.settings.paintColor = colorEl.value; });
    p.querySelectorAll(".swatch").forEach((s) => s.addEventListener("click", () => {
      BT.Sculpt.settings.paintColor = s.dataset.c;
      colorEl.value = s.dataset.c;
    }));
  },

  _brushSliders(st) {
    return '<div class="psec">' +
      '<div class="slider-row"><label>size</label><input type="range" id="br-radius" min="0.02" max="1.5" step="0.01" value="' + st.radius + '" data-tip="[ and ] or Ctrl+scroll"><span class="sval" id="br-radius-val">' + st.radius.toFixed(2) + "</span></div>" +
      '<div class="slider-row"><label>strength</label><input type="range" id="br-strength" min="0.05" max="1" step="0.01" value="' + st.strength + '"><span class="sval" id="br-strength-val">' + st.strength.toFixed(2) + "</span></div></div>";
  },

  _bindBrushCommon(p, brushKey) {
    p.querySelectorAll(".bbtn").forEach((b) => b.addEventListener("click", () => {
      BT.Sculpt.settings[brushKey] = b.dataset.b;
      p.querySelectorAll(".bbtn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    const radius = p.querySelector("#br-radius");
    radius.addEventListener("input", () => {
      BT.Sculpt.settings.radius = parseFloat(radius.value);
      p.querySelector("#br-radius-val").textContent = parseFloat(radius.value).toFixed(2);
    });
    const strength = p.querySelector("#br-strength");
    strength.addEventListener("input", () => {
      BT.Sculpt.settings.strength = parseFloat(strength.value);
      p.querySelector("#br-strength-val").textContent = parseFloat(strength.value).toFixed(2);
    });
    const fo = p.querySelector("#falloff-chips");
    if (fo) fo.addEventListener("click", (ev) => {
      const b = ev.target.closest(".chip");
      if (!b) return;
      BT.Sculpt.settings.falloff = b.dataset.fo;
      fo.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    });
    const sym = p.querySelector("#sym-toggle");
    sym.addEventListener("click", () => {
      BT.Sculpt.settings.symmetry = !BT.Sculpt.settings.symmetry;
      sym.setAttribute("aria-pressed", String(BT.Sculpt.settings.symmetry));
    });
    const densify = p.querySelector("#densify-btn");
    if (densify) densify.addEventListener("click", () => { this.densifySelected(); this.renderPanel(); });
  },

  _densifyOffer() {
    const sel = BT.state.selected;
    if (!sel || BT.Mesh.vertCount(sel) >= 8000) return "";
    return '<div class="psec"><button class="abtn" id="densify-btn" style="width:100%" data-tip="subdivides without changing the shape, so brushes have vertices to push">' +
      this.ic("subdiv") + "Add detail (" + BT.Mesh.vertCount(sel).toLocaleString() + " verts is too coarse to sculpt)</button></div>";
  },

  _syncBrushReadout() {
    const r = document.getElementById("br-radius");
    const v = document.getElementById("br-radius-val");
    if (r) r.value = BT.Sculpt.settings.radius;
    if (v) v.textContent = BT.Sculpt.settings.radius.toFixed(2);
  },

  _snapshotTransform(obj) {
    return { p: obj.mesh.position.toArray(), q: obj.mesh.quaternion.toArray(), s: obj.mesh.scale.toArray() };
  },

  _syncTransformInputs(obj) {
    if (BT.state.mode !== "object" || BT.state.selected !== obj) return;
    const p = this._els.panel;
    const f = (v) => (Math.round(v * 100) / 100).toString();
    const vals = {
      p: obj.mesh.position.toArray(),
      r: [obj.mesh.rotation.x, obj.mesh.rotation.y, obj.mesh.rotation.z].map((r) => r * 180 / Math.PI),
      s: obj.mesh.scale.toArray(),
    };
    p.querySelectorAll(".vec3 input").forEach((inp) => {
      if (inp === document.activeElement) return;
      inp.value = f(vals[inp.dataset.t][+inp.dataset.i]);
    });
  },

  // ---- status, toasts, hints -------------------------------------------------------

  updateStatus() {
    const el = this._els.status;
    const sel = BT.state.selected;
    let total = 0;
    for (const o of BT.state.objects) total += BT.Mesh.vertCount(o);
    if (!BT.state.objects.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML =
      (sel ? this._esc(sel.name) + " · " + BT.Mesh.vertCount(sel).toLocaleString() + " verts"
           : BT.state.objects.length + " shapes · " + total.toLocaleString() + " verts") +
      '<span class="dot" id="save-dot" title="autosaved in this browser"></span>';
  },

  _flashSaveDot() {
    const dot = document.getElementById("save-dot");
    if (!dot) return;
    dot.classList.add("on");
    setTimeout(() => dot.classList.remove("on"), 1200);
  },

  toast(msg, action) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.addEventListener("click", () => { action.fn(); t.remove(); });
      t.appendChild(b);
    }
    this._els.toasts.appendChild(t);
    setTimeout(() => t.remove(), action ? 8000 : 3500);
  },

  _hintShown: {},
  showHint(key, text) {
    if (this._hintShown[key]) return;
    this._hintShown[key] = "showing";
    const h = this._els.hint;
    h.innerHTML = text;
    h.hidden = false;
    h.classList.remove("fading");
  },
  _dismissHint(key) {
    if (this._hintShown[key] !== "showing") return;
    this._hintShown[key] = "done";
    const h = this._els.hint;
    h.classList.add("fading");
    setTimeout(() => { h.hidden = true; }, 700);
  },
  _onModeHints() {
    if (BT.state.mode === "sculpt") {
      this._dismissHint("orbit");
      this.showHint("sculpt", 'drag on the model to sculpt · <span class="kbd">[</span> <span class="kbd">]</span> resize the brush · <span class="kbd">Ctrl</span> inverts');
    }
  },

  _esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  // ---- keyboard ---------------------------------------------------------------------

  _bindKeyboard() {
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") t.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? BT.History.redo() : BT.History.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); BT.History.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "c") { e.preventDefault(); this.copySelected(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "x") { e.preventDefault(); this.cutSelected(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); this.paste(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (k) {
        case "1": BT.setMode("object"); break;
        case "2": BT.setMode("sculpt"); break;
        case "3": BT.setMode("paint"); break;
        case "4": BT.setMode("vertex"); break;
        case "arrowup": if (BT.state.mode === "vertex") { e.preventDefault(); BT.Vertex.step(0, 1); } break;
        case "arrowdown": if (BT.state.mode === "vertex") { e.preventDefault(); BT.Vertex.step(0, -1); } break;
        case "arrowleft": if (BT.state.mode === "vertex") { e.preventDefault(); BT.Vertex.step(-1, 0); } break;
        case "arrowright": if (BT.state.mode === "vertex") { e.preventDefault(); BT.Vertex.step(1, 0); } break;
        case "q": if (BT.state.mode === "object" || BT.state.mode === "vertex") BT.Gizmo.setMode("select"); break;
        case "h": if (BT.state.mode === "object" || BT.state.mode === "vertex") BT.Gizmo.setMode("hand"); break;
        case "g": if (BT.state.mode === "object" || BT.state.mode === "vertex") BT.Gizmo.setMode("translate"); break;
        case "r": if (BT.state.mode === "object" || BT.state.mode === "vertex") BT.Gizmo.setMode("rotate"); break;
        case "s": if (BT.state.mode === "object" || BT.state.mode === "vertex") BT.Gizmo.setMode("scale"); break;
        case "c": if (BT.state.mode === "object" || BT.state.mode === "vertex") BT.Gizmo.setMode("cut"); break;
        case "f":
          if (BT.state.mode === "vertex") BT.Vertex.fillSelected();
          else if (BT.state.selected) BT.Viewport.frameObject(BT.state.selected);
          break;
        case "e": if (BT.state.mode === "vertex") BT.Vertex.extrudeSelected(); break;
        case "i": if (BT.state.mode === "vertex") BT.Vertex.insetSelected(); break;
        case "m": if (BT.state.mode === "vertex") BT.Vertex.mergeSelected(); break;
        case "x": case "delete":
          if (BT.state.mode === "object") this.deleteSelected();
          else if (BT.state.mode === "vertex") BT.Vertex.deleteSelectedVerts();
          break;
        case "d": if (e.shiftKey && BT.state.mode === "object") { e.preventDefault(); this.duplicateSelected(); } break;
        case "[": BT.Sculpt.nudgeRadius(1 / 1.15); break;
        case "]": BT.Sculpt.nudgeRadius(1.15); break;
        case "escape":
          if (BT.Render._running) BT.Render.close();
          else if (BT.state.gizmoMode === "cut") BT.Gizmo.setMode("select");
          else if (BT.Deform.session) BT.Deform.cancel();
          else if (BT.state.mode !== "object") BT.setMode("object");
          else BT.select(null);
          break;
      }
    });
  },
};
