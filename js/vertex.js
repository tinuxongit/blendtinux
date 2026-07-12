/* Vertex mode: dots + quad wireframe over the selected mesh, Blender-style
   vertex editing. Click picks, shift-click toggles, dragging on empty space
   box selects, dragging a selected dot moves the whole selection on a
   camera-facing plane. The Cut tool is a loop cut: hover previews a ring of
   new edges around the shape (snapping to the middle), click cuts it. */
"use strict";

BT.Vertex = {
  selected: new Set(),      // vertex indices (in face mode: derived corners)
  active: -1,
  selMode: "vertex",        // vertex | face
  selectedFaces: new Set(), // poly indices (face mode)
  _points: null,      // all-verts dots, shares the mesh geometry
  _wire: null,        // quad wireframe (diagonals hidden), shares positions
  _selPoints: null,   // accent dots on selected verts (own small buffer)
  _faceMarker: null,  // accent tint on selected faces (face mode)
  _drag: null,
  _host: null,
  _box: null,         // box-select DOM rectangle
  _hoverCut: null,    // { trace, t } for the loop cut preview

  init() {
    this._box = document.getElementById("boxsel");

    BT.on("mode", () => this._refresh());
    BT.on("selection", () => { this._refresh(); this._clearCutPreview(); });
    BT.on("gizmoMode", () => this._clearCutPreview());
    BT.on("geometry", (obj) => { if (obj === this._host) { this._teardown(); this._refresh(); } });
    BT.on("history", () => { this._syncSelMarker(); this._syncFaceMarker(); }); // undo/redo can move picked verts

    const canvas = BT.Viewport.canvas;
    canvas.addEventListener("pointermove", (e) => {
      if (this._drag) this._moveDrag(e);
      else if (this.cutActive()) this._cutPreview(e);
    });
    const end = (e) => this._endDrag(e);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  },

  active_() { return BT.state.mode === "vertex" && !!BT.state.selected; },

  _refresh() {
    if (!this.active_() || this._host !== BT.state.selected) this._teardown();
    if (!this.active_()) return;
    if (!this._points) this._build(BT.state.selected);
  },

  _build(obj) {
    this._host = obj;
    const g = obj.mesh.geometry;
    this._points = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x9a97a0, size: 5, sizeAttenuation: false,
    }));
    this._points.renderOrder = 1;

    // quad wireframe: every polygon edge, never the diagonals
    const { edgeMap } = BT.Mesh.getPolys(obj);
    const nV = g.getAttribute("position").count;
    const lineIdx = new Uint32Array(edgeMap.size * 2);
    let w = 0;
    edgeMap.forEach((_polys, key) => {
      lineIdx[w++] = Math.floor(key / nV);
      lineIdx[w++] = key % nV;
    });
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute("position", g.getAttribute("position")); // shared, live
    wireGeo.setIndex(new THREE.BufferAttribute(lineIdx, 1));
    this._wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
      color: 0xb8b4c2, transparent: true, opacity: 0.85,
    }));
    this._wire.renderOrder = 1;

    const selGeo = new THREE.BufferGeometry();
    selGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    this._selPoints = new THREE.Points(selGeo, new THREE.PointsMaterial({
      color: 0xf0924f, size: 9, sizeAttenuation: false, depthTest: false,
    }));
    this._selPoints.renderOrder = 996;

    const fmGeo = new THREE.BufferGeometry();
    fmGeo.setAttribute("position", g.getAttribute("position")); // shared, live
    fmGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1));
    this._faceMarker = new THREE.Mesh(fmGeo, new THREE.MeshBasicMaterial({
      color: 0xf0924f, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this._faceMarker.renderOrder = 2;
    obj.mesh.add(this._points, this._wire, this._selPoints, this._faceMarker);
  },

  _teardown() {
    if (this._points) {
      this._host.mesh.remove(this._points, this._wire, this._selPoints, this._faceMarker);
      this._points.material.dispose();
      this._wire.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      this._wire.geometry.dispose();
      this._wire.material.dispose();
      this._selPoints.geometry.dispose();
      this._selPoints.material.dispose();
      this._faceMarker.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      this._faceMarker.geometry.dispose();
      this._faceMarker.material.dispose();
      this._points = this._wire = this._selPoints = this._faceMarker = null;
    }
    this._host = null;
    this.selected = new Set();
    this.selectedFaces = new Set();
    this.active = -1;
    this._clearCutPreview();
  },

  _syncSelMarker() {
    if (!this._selPoints || !this._host) return;
    const pos = this._host.mesh.geometry.getAttribute("position").array;
    const arr = new Float32Array(this.selected.size * 3);
    let i = 0;
    this.selected.forEach((v) => {
      arr[i++] = pos[v * 3]; arr[i++] = pos[v * 3 + 1]; arr[i++] = pos[v * 3 + 2];
    });
    this._selPoints.geometry.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    this._selPoints.geometry.computeBoundingSphere();
  },

  // world-space center of the current vertex selection (gizmo pivot)
  medianWorld() {
    if (!this._host || !this.selected.size) return null;
    const pos = this._host.mesh.geometry.getAttribute("position").array;
    const m = new THREE.Vector3();
    this.selected.forEach((v) => { m.x += pos[v * 3]; m.y += pos[v * 3 + 1]; m.z += pos[v * 3 + 2]; });
    m.multiplyScalar(1 / this.selected.size);
    return this._host.mesh.localToWorld(m);
  },

  setSelection(indices, activeIndex) {
    this.selected = new Set(indices);
    this.active = activeIndex !== undefined ? activeIndex :
      (this.selected.size ? this.selected.values().next().value : -1);
    if (this.active >= 0 && !this.selected.has(this.active)) this.active = -1;
    this._syncSelMarker();
    BT.emit("vertex");
  },

  // ---- face selection ---------------------------------------------------------

  setSelMode(m) {
    if (this.selMode === m) return;
    this.selMode = m;
    if (m === "face") this._facesFromVerts();
    else { this.selectedFaces = new Set(); this._syncFaceMarker(); }
    BT.emit("vertex");
  },

  setFaceSelection(faceSet) {
    this.selectedFaces = new Set(faceSet);
    // derive the corner vertices so drags, gizmo and median keep working
    const { polys } = BT.Mesh.getPolys(this._host);
    const verts = new Set();
    this.selectedFaces.forEach((pi) => { for (const v of polys[pi]) verts.add(v); });
    this.selected = verts;
    this.active = -1;
    this._syncSelMarker();
    this._syncFaceMarker();
    BT.emit("vertex");
  },

  _facesFromVerts() {
    if (!this._host) return;
    const { polys } = BT.Mesh.getPolys(this._host);
    const faces = new Set();
    for (let pi = 0; pi < polys.length; pi++) {
      if (polys[pi].every((v) => this.selected.has(v))) faces.add(pi);
    }
    this.setFaceSelection(faces);
  },

  _syncFaceMarker() {
    if (!this._faceMarker || !this._host) return;
    if (this.selMode !== "face" || !this.selectedFaces.size) {
      this._faceMarker.visible = false;
      return;
    }
    const { polyFaces } = BT.Mesh.getPolys(this._host);
    const idx = this._host.mesh.geometry.index.array;
    const out = [];
    this.selectedFaces.forEach((pi) => {
      for (const f of polyFaces[pi]) out.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]);
    });
    this._faceMarker.geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(out), 1));
    this._faceMarker.geometry.computeBoundingSphere();
    this._faceMarker.visible = true;
  },

  _selectedTris() {
    const { polyFaces } = BT.Mesh.getPolys(this._host);
    const tris = new Set();
    this.selectedFaces.forEach((pi) => { for (const f of polyFaces[pi]) tris.add(f); });
    return tris;
  },

  // ---- loop cut (works in Object and Verts mode via the rail tool) ------------

  cutActive() {
    return BT.state.gizmoMode === "cut" && !!BT.state.selected &&
      (BT.state.mode === "object" || BT.state.mode === "vertex");
  },

  _clearCutPreview() {
    this._hoverCut = null;
    const svg = document.getElementById("knife");
    svg.hidden = true;
    svg.innerHTML = "";
  },

  _cutPreview(e) {
    const obj = BT.state.selected;
    const hit = BT.Viewport.pickMesh(e, obj.mesh);
    if (!hit) { this._clearCutPreview(); return; }
    const local = obj.mesh.worldToLocal(hit.point.clone());
    const trace = BT.Mesh.traceLoop(obj, hit.faceIndex, local);
    if (!trace) { this._clearCutPreview(); return; }

    let t = BT.clamp(trace.t0, 0.05, 0.95);
    if (Math.abs(t - 0.5) < 0.08) t = 0.5; // snap: cut it in half
    this._hoverCut = { trace, t };

    // project the ring
    const mesh = obj.mesh, cam = BT.Viewport.camera;
    const rect = BT.Viewport.canvas.getBoundingClientRect();
    const pos = mesh.geometry.getAttribute("position").array;
    const v = new THREE.Vector3(), b = new THREE.Vector3();
    const pts = trace.crossed.map((edge) => {
      v.fromArray(pos, edge.u * 3);
      b.fromArray(pos, edge.v * 3);
      v.lerp(b, t);
      mesh.localToWorld(v).project(cam);
      return {
        x: (v.x + 1) / 2 * rect.width + rect.left,
        y: (-v.y + 1) / 2 * rect.height + rect.top,
      };
    });
    if (trace.closed && pts.length) pts.push(pts[0]);

    const svg = document.getElementById("knife");
    svg.hidden = false;
    let html = '<polyline points="' + pts.map((p) => p.x + "," + p.y).join(" ") + '"/>';
    for (const p of pts) html += '<circle class="mark" cx="' + p.x + '" cy="' + p.y + '" r="2.4"/>';
    svg.innerHTML = html;
  },

  // called from the viewport pointerdown chain, in Object or Verts mode
  tryCutClick(e) {
    if (!this.cutActive()) return false;
    const obj = BT.state.selected;
    const hit = BT.Viewport.pickMesh(e, obj.mesh);
    if (!hit) return false; // let orbit behave normally off the mesh
    const local = obj.mesh.worldToLocal(hit.point.clone());
    const trace = BT.Mesh.traceLoop(obj, hit.faceIndex, local);
    if (!trace) {
      BT.emit("toast", "no quad ring here to cut (this part of the mesh is triangles)");
      return true;
    }
    let t = BT.clamp(trace.t0, 0.05, 0.95);
    if (Math.abs(t - 0.5) < 0.08) t = 0.5;
    const res = BT.Mesh.applyLoopCut(BT.Mesh.geometryData(obj), trace, t);
    this._clearCutPreview();
    const before = BT.Mesh.geometryData(obj);
    BT.Mesh.replaceGeometry(obj, res.data);
    BT.History.push({ type: "geometry", id: obj.id, before, after: res.data });
    if (this._host === obj) this.setSelection(res.sel);
    BT.emit("toast", "loop cut: " + res.sel.length + " new vertices" + (t === 0.5 ? " right through the middle" : ""));
    return true;
  },

  // ---- picking and dragging -----------------------------------------------------

  tryStart(e) {
    if (!this.active_()) return false;
    if (BT.state.gizmoMode === "cut") return false; // handled by tryCutClick earlier in the chain
    const obj = BT.state.selected;

    const hit = BT.Viewport.pickMesh(e, obj.mesh);

    if (!hit) {
      this._drag = { mode: "box", obj, x0: e.clientX, y0: e.clientY, shift: e.shiftKey, moved: false };
      BT.Viewport.canvas.setPointerCapture(e.pointerId);
      return true;
    }

    if (this.selMode === "face") {
      const { faceToPoly } = BT.Mesh.getPolys(obj);
      const pi = faceToPoly[hit.faceIndex];
      if (pi < 0) return true;
      if (e.shiftKey) {
        const faces = new Set(this.selectedFaces);
        if (faces.has(pi)) faces.delete(pi); else faces.add(pi);
        this.setFaceSelection(faces);
        return true;
      }
      if (!this.selectedFaces.has(pi)) this.setFaceSelection([pi]);
      this._startMoveDrag(e, obj, hit.point);
      return true;
    }

    /* Nearest corner of the whole QUAD under the cursor, measured on screen,
       so clicks never grab a corner of the hidden diagonal you did not aim
       at. */
    const pos = obj.mesh.geometry.getAttribute("position").array;
    const { polys, faceToPoly } = BT.Mesh.getPolys(obj);
    const pi = faceToPoly[hit.faceIndex];
    const corners = pi >= 0 ? polys[pi] : [hit.face.a, hit.face.b, hit.face.c];
    const rect = BT.Viewport.canvas.getBoundingClientRect();
    const cam = BT.Viewport.camera;
    const v = new THREE.Vector3();
    let vi = -1, bestD = Infinity;
    for (const c of corners) {
      v.fromArray(pos, c * 3);
      obj.mesh.localToWorld(v).project(cam);
      const sx = (v.x + 1) / 2 * rect.width + rect.left;
      const sy = (-v.y + 1) / 2 * rect.height + rect.top;
      const d = (sx - e.clientX) * (sx - e.clientX) + (sy - e.clientY) * (sy - e.clientY);
      if (d < bestD) { bestD = d; vi = c; }
    }

    if (e.shiftKey) {
      const sel = new Set(this.selected);
      if (sel.has(vi)) { sel.delete(vi); this.setSelection(sel); }
      else { sel.add(vi); this.setSelection(sel, vi); }
      return true;
    }

    if (!this.selected.has(vi)) this.setSelection([vi], vi);
    else { this.active = vi; BT.emit("vertex"); }

    const world = new THREE.Vector3().fromArray(pos, vi * 3);
    obj.mesh.localToWorld(world);
    this._startMoveDrag(e, obj, world);
    return true;
  },

  _startMoveDrag(e, obj, anchorWorld) {
    const pos = obj.mesh.geometry.getAttribute("position").array;
    const indices = Array.from(this.selected);
    const orig = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      orig[i * 3] = pos[indices[i] * 3];
      orig[i * 3 + 1] = pos[indices[i] * 3 + 1];
      orig[i * 3 + 2] = pos[indices[i] * 3 + 2];
    }
    this._drag = {
      mode: "move", obj, indices, orig,
      start: anchorWorld.clone(),
      planeNormal: BT.Viewport.camera.getWorldDirection(new THREE.Vector3()),
      moved: false,
      sx: e.clientX, sy: e.clientY, engaged: false,
    };
    BT.Viewport.canvas.setPointerCapture(e.pointerId);
  },

  _moveDrag(e) {
    const d = this._drag;
    // a click should not nudge the vertex: engage after a few pixels
    if (d.mode === "move" && !d.engaged) {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (dx * dx + dy * dy < 16) return;
      d.engaged = true;
    }
    if (d.mode === "box") {
      d.moved = true;
      const x = Math.min(d.x0, e.clientX), y = Math.min(d.y0, e.clientY);
      const w = Math.abs(e.clientX - d.x0), h = Math.abs(e.clientY - d.y0);
      const b = this._box;
      b.hidden = false;
      b.style.left = x + "px"; b.style.top = y + "px";
      b.style.width = w + "px"; b.style.height = h + "px";
      d.rect = { x0: x, y0: y, x1: x + w, y1: y + h };
      return;
    }

    const ray = BT.Viewport.rayFromEvent(e).ray;
    const dn = ray.direction.dot(d.planeNormal);
    if (Math.abs(dn) < 1e-6) return;
    const t = d.start.clone().sub(ray.origin).dot(d.planeNormal) / dn;
    const world = ray.origin.clone().addScaledVector(ray.direction, t);
    const l1 = d.obj.mesh.worldToLocal(world.clone());
    const l0 = d.obj.mesh.worldToLocal(d.start.clone());
    const dx = l1.x - l0.x, dy = l1.y - l0.y, dz = l1.z - l0.z;

    const attr = d.obj.mesh.geometry.getAttribute("position");
    for (let i = 0; i < d.indices.length; i++) {
      attr.array[d.indices[i] * 3] = d.orig[i * 3] + dx;
      attr.array[d.indices[i] * 3 + 1] = d.orig[i * 3 + 1] + dy;
      attr.array[d.indices[i] * 3 + 2] = d.orig[i * 3 + 2] + dz;
    }
    attr.needsUpdate = true;
    d.moved = true;
    BT.Mesh.computeNormalsPartial(d.obj, d.indices);
    this._syncSelMarker();
    BT.emit("vertex");
  },

  _endDrag(e) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    try { BT.Viewport.canvas.releasePointerCapture(e.pointerId); } catch (_) {}

    if (d.mode === "box") {
      this._box.hidden = true;
      if (!d.moved) {
        if (!d.shift) {
          if (this.selMode === "face") this.setFaceSelection([]);
          else this.setSelection([]);
        }
        return;
      }
      this._boxPick(d);
      return;
    }

    if (!d.moved) return;
    const attr = d.obj.mesh.geometry.getAttribute("position");
    const indices = Uint32Array.from(d.indices);
    const after = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      after[i * 3] = attr.array[indices[i] * 3];
      after[i * 3 + 1] = attr.array[indices[i] * 3 + 1];
      after[i * 3 + 2] = attr.array[indices[i] * 3 + 2];
    }
    BT.History.push({
      type: "verts", id: d.obj.id, attr: "position",
      indices, before: d.orig, after,
    });
    BT.Mesh.afterVertsChanged(d.obj, d.indices);
  },

  _boxPick(d) {
    const obj = d.obj;
    const rect = BT.Viewport.canvas.getBoundingClientRect();
    const cam = BT.Viewport.camera;
    const pos = obj.mesh.geometry.getAttribute("position").array;
    const v = new THREE.Vector3();
    const nVerts = pos.length / 3;
    const inside = new Uint8Array(nVerts);
    for (let i = 0; i < nVerts; i++) {
      v.fromArray(pos, i * 3);
      obj.mesh.localToWorld(v).project(cam);
      if (v.z > 1) continue;
      const sx = (v.x + 1) / 2 * rect.width + rect.left;
      const sy = (-v.y + 1) / 2 * rect.height + rect.top;
      if (sx >= d.rect.x0 && sx <= d.rect.x1 && sy >= d.rect.y0 && sy <= d.rect.y1) inside[i] = 1;
    }
    if (this.selMode === "face") {
      const { polys } = BT.Mesh.getPolys(obj);
      const picked = d.shift ? new Set(this.selectedFaces) : new Set();
      for (let pi = 0; pi < polys.length; pi++) {
        if (polys[pi].every((c) => inside[c])) picked.add(pi);
      }
      this.setFaceSelection(picked);
      return;
    }
    const picked = d.shift ? new Set(this.selected) : new Set();
    let last = -1;
    for (let i = 0; i < nVerts; i++) if (inside[i]) { picked.add(i); last = i; }
    this.setSelection(picked, last >= 0 ? last : undefined);
  },

  // ---- panel input -----------------------------------------------------------------

  setCoord(i, value) {
    const obj = this._host;
    if (!obj || this.active < 0 || !isFinite(value)) return;
    const attr = obj.mesh.geometry.getAttribute("position");
    const before = [attr.array[this.active * 3], attr.array[this.active * 3 + 1], attr.array[this.active * 3 + 2]];
    const after = before.slice();
    after[i] = value;
    attr.array[this.active * 3 + i] = value;
    attr.needsUpdate = true;
    BT.History.push({
      type: "verts", id: obj.id, attr: "position",
      indices: Uint32Array.from([this.active]),
      before: Float32Array.from(before),
      after: Float32Array.from(after),
    });
    BT.Mesh.afterVertsChanged(obj, [this.active]);
    this._syncSelMarker();
  },

  /* Arrow keys walk the active vertex to the neighbour whose screen
     direction best matches the pressed arrow. */
  step(dirX, dirY) {
    const obj = this._host;
    if (!obj || this.active < 0) return;
    const adj = BT.Mesh.getAdjacency(obj);
    const pos = obj.mesh.geometry.getAttribute("position").array;
    const cam = BT.Viewport.camera;
    const project = (vi) => {
      const v = new THREE.Vector3().fromArray(pos, vi * 3);
      obj.mesh.localToWorld(v).project(cam);
      return v;
    };
    const cur = project(this.active);
    let best = -1, bestScore = 0.15;
    for (let j = adj.nOff[this.active]; j < adj.nOff[this.active + 1]; j++) {
      const nb = adj.nList[j];
      const p = project(nb);
      const dx = p.x - cur.x, dy = p.y - cur.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const score = (dx / len) * dirX + (dy / len) * dirY;
      if (score > bestScore) { bestScore = score; best = nb; }
    }
    if (best >= 0) this.setSelection([best], best);
  },

  // ---- topology ops ------------------------------------------------------------------

  _applyTopo(res) {
    const obj = this._host;
    const before = BT.Mesh.geometryData(obj);
    BT.Mesh.replaceGeometry(obj, res.data); // fires "geometry", which resets the overlays
    BT.History.push({ type: "geometry", id: obj.id, before, after: res.data });
    this.setSelection(res.sel);
    if (this.selMode === "face") this._facesFromVerts(); // keep the new cap faces selected
  },

  _extrudeOrInset(inset) {
    if (this.selMode === "face") {
      if (!this._host) return;
      if (!this.selectedFaces.size) { BT.emit("toast", "click a face first"); return; }
      const res = BT.Mesh.extrude(BT.Mesh.geometryData(this._host), null, inset, this._selectedTris());
      if (res) this._applyTopo(res);
      return;
    }
    if (!this._precheck(1)) return;
    const res = BT.Mesh.extrude(BT.Mesh.geometryData(this._host), this.selected, inset);
    if (!res) { BT.emit("toast", "select every corner of at least one face, then " + (inset ? "inset" : "extrude")); return; }
    this._applyTopo(res);
  },

  extrudeSelected() { this._extrudeOrInset(false); },

  // a smaller face cut inside the selected faces, ready to push in or out
  insetSelected() { this._extrudeOrInset(true); },

  fillSelected() {
    if (!this._precheck(3)) return;
    if (this.selected.size > 4) { BT.emit("toast", "pick exactly 3 or 4 vertices to fill"); return; }
    const res = BT.Mesh.fillFace(BT.Mesh.geometryData(this._host), Array.from(this.selected));
    if (!res) { BT.emit("toast", "those vertices do not make a face"); return; }
    this._applyTopo(res);
  },

  mergeSelected() {
    if (!this._precheck(2)) return;
    const res = BT.Mesh.mergeVerts(BT.Mesh.geometryData(this._host), this.selected);
    if (!res) { BT.emit("toast", "merging those would leave no mesh"); return; }
    this._applyTopo(res);
  },

  deleteSelectedVerts() {
    if (this.selMode === "face") {
      if (!this._host) return;
      if (!this.selectedFaces.size) { BT.emit("toast", "click a face first"); return; }
      const res = BT.Mesh.deleteFaces(BT.Mesh.geometryData(this._host), this._selectedTris());
      if (!res) { BT.emit("toast", "that would delete the whole mesh, delete the object instead"); return; }
      this._applyTopo(res);
      return;
    }
    if (!this._precheck(1)) return;
    const res = BT.Mesh.deleteVerts(BT.Mesh.geometryData(this._host), this.selected);
    if (!res) { BT.emit("toast", "that would delete the whole mesh, delete the object instead"); return; }
    this._applyTopo(res);
  },

  _precheck(minSel) {
    if (!this._host) return false;
    if (this.selected.size < minSel) {
      BT.emit("toast", minSel === 1 ? "pick some vertices first" : "pick at least " + minSel + " vertices first");
      return false;
    }
    return true;
  },
};
