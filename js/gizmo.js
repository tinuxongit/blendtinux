/* Custom transform gizmo. Four tools: hand (grab a shape and drag it around,
   no gizmo drawn), translate (double-headed axis arrows), rotate (rings with
   grab balls), scale (axis handles). Kept screen-size-constant. Translate
   and rotate act in world axes, scale acts along the object's local axes
   (world-axis scale is not representable in a plain scale vector). Each
   visible part has an invisible fatter hit sibling; drags project the mouse
   ray onto the axis line, the rotation plane, or the ground plane. */
"use strict";

BT.Gizmo = {
  root: null,
  groups: {},          // translate | rotate | scale -> THREE.Group
  _hits: { translate: [], rotate: [], scale: [] },
  _mats: [],
  _hover: null,
  _drag: null,
  AXIS_COLORS: [0xe04545, 0x4cb74c, 0x3d6de0],
  ACCENT: 0xf0924f,

  init() {
    this.root = new THREE.Group();
    this.root.visible = false;
    BT.Viewport.scene.add(this.root);

    this.groups.translate = this._buildTranslate();
    this.groups.rotate = this._buildRotate();
    this.groups.scale = this._buildScale();
    for (const k in this.groups) { this.groups[k].visible = false; this.root.add(this.groups[k]); }

    BT.on("selection", () => this._refresh());
    BT.on("mode", () => this._refresh());
    BT.on("vertex", () => this._refresh());
    BT.Viewport.onFrame(() => this._frame());

    const canvas = BT.Viewport.canvas;
    canvas.addEventListener("pointermove", (e) => {
      if (this._drag) { this._moveDrag(e); return; }
      if (this.root.visible) this._updateHover(e);
    });
    const end = (e) => this._endDrag(e);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    this._refresh();
  },

  AXIS_TOOLS: { translate: 1, rotate: 1, scale: 1 },

  setMode(mode) {
    BT.state.gizmoMode = mode;
    // a tool that acts on a shape needs one selected
    if ((this.AXIS_TOOLS[mode] || mode === "cut") && !BT.state.selected) {
      if (BT.state.objects.length === 1) BT.select(BT.state.objects[0]);
      else if (BT.state.objects.length) BT.emit("toast", "click a shape first");
    }
    if (this.AXIS_TOOLS[mode] && BT.state.mode === "vertex" && BT.Vertex && !BT.Vertex.selected.size) {
      BT.emit("toast", "pick some vertices to put the handles on");
    }
    if (mode === "cut" && !this._cutToastShown) {
      this._cutToastShown = true;
      BT.emit("toast", "hover the shape to preview the cut ring, click to cut, it snaps to the middle");
    }
    this._refresh();
    BT.emit("gizmoMode", mode);
  },

  _refresh() {
    let active = false;
    if (this.AXIS_TOOLS[BT.state.gizmoMode] && BT.state.selected) {
      if (BT.state.mode === "object") active = true;
      else if (BT.state.mode === "vertex") active = !!(BT.Vertex && BT.Vertex.selected.size);
    }
    this.root.visible = active;
    for (const k in this.groups) this.groups[k].visible = k === BT.state.gizmoMode;
    const cutting = BT.state.gizmoMode === "cut" &&
      (BT.state.mode === "object" || BT.state.mode === "vertex");
    BT.Viewport.canvas.style.cursor = cutting ? "crosshair" : "";
  },

  _frame() {
    const obj = BT.state.selected;
    if (!this.root.visible || !obj) return;
    if (BT.state.mode === "vertex") {
      const m = BT.Vertex.medianWorld();
      if (!m) return;
      this.root.position.copy(m);
      this.groups.scale.quaternion.identity(); // vertex scale acts in world axes
    } else {
      this.root.position.copy(obj.mesh.position);
      this.groups.scale.quaternion.copy(obj.mesh.quaternion);
    }
    this.root.scale.setScalar(BT.Viewport.camera.position.distanceTo(this.root.position) * 0.16);
  },

  // ---- building -------------------------------------------------------------

  _mat(color) {
    const m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
    m.userData.baseColor = color;
    this._mats.push(m);
    return m;
  },

  _hitMat() {
    return new THREE.MeshBasicMaterial({ visible: false });
  },

  _orient(mesh, axis) {
    // built along +Y, rotate into the requested axis
    if (axis === 0) mesh.rotation.z = -Math.PI / 2;
    if (axis === 2) mesh.rotation.x = Math.PI / 2;
  },

  // double-headed arrows through the object, one per axis
  _buildTranslate() {
    const g = new THREE.Group();
    for (let axis = 0; axis < 3; axis++) {
      const mat = this._mat(this.AXIS_COLORS[axis]);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.5, 8), mat);
      const tipA = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 12), mat);
      tipA.position.y = 0.82;
      const tipB = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 12), mat);
      tipB.position.y = -0.82;
      tipB.rotation.x = Math.PI;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.85, 6), this._hitMat());
      hit.userData.part = { mode: "translate", axis, mat };
      const holder = new THREE.Group();
      holder.add(shaft, tipA, tipB, hit);
      this._orient(holder, axis);
      holder.traverse((o) => { o.renderOrder = 999; });
      g.add(holder);
      this._hits.translate.push(hit);
    }
    return g;
  },

  // thin rings, each with a grab ball
  _buildRotate() {
    const g = new THREE.Group();
    const R = 0.62, ballAt = R / Math.SQRT2;
    // ball spots chosen so the three never overlap
    const ballPos = [
      new THREE.Vector3(0, ballAt, ballAt),   // on the X ring (YZ plane)
      new THREE.Vector3(ballAt, 0, -ballAt),  // on the Y ring (XZ plane)
      new THREE.Vector3(-ballAt, ballAt, 0),  // on the Z ring (XY plane)
    ];
    for (let axis = 0; axis < 3; axis++) {
      const mat = this._mat(this.AXIS_COLORS[axis]);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.009, 8, 64), mat);
      const hit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 6, 32), this._hitMat());
      hit.userData.part = { mode: "rotate", axis, mat };
      const holder = new THREE.Group();
      holder.add(ring, hit);
      // torus lies in XY plane (axis = Z); rotate into place
      if (axis === 0) holder.rotation.y = Math.PI / 2;
      if (axis === 1) holder.rotation.x = Math.PI / 2;
      holder.traverse((o) => { o.renderOrder = 998; });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), mat);
      ball.position.copy(ballPos[axis]);
      ball.renderOrder = 999;
      const ballHit = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), this._hitMat());
      ballHit.position.copy(ballPos[axis]);
      ballHit.userData.part = { mode: "rotate", axis, mat };
      g.add(holder, ball, ballHit);
      this._hits.rotate.push(hit, ballHit);
    }
    return g;
  },

  _buildScale() {
    const g = new THREE.Group();
    for (let axis = 0; axis < 3; axis++) {
      const mat = this._mat(this.AXIS_COLORS[axis]);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.6, 8), mat);
      shaft.position.y = 0.35;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), mat);
      tip.position.y = 0.68;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 6), this._hitMat());
      hit.position.y = 0.45;
      hit.userData.part = { mode: "scale", axis, mat };
      const holder = new THREE.Group();
      holder.add(shaft, tip, hit);
      this._orient(holder, axis);
      holder.traverse((o) => { o.renderOrder = 999; });
      g.add(holder);
      this._hits.scale.push(hit);
    }
    const uniMat = this._mat(0xd8d4cf);
    const uni = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), uniMat);
    uni.renderOrder = 999;
    const uniHit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), this._hitMat());
    uniHit.userData.part = { mode: "scale", axis: -1, mat: uniMat };
    g.add(uni, uniHit);
    this._hits.scale.push(uniHit);
    return g;
  },

  // ---- hover ------------------------------------------------------------------

  _pickPart(e) {
    const ray = BT.Viewport.rayFromEvent(e);
    const hits = ray.intersectObjects(this._hits[BT.state.gizmoMode], false);
    return hits.length ? hits[0].object.userData.part : null;
  },

  _updateHover(e) {
    const part = this._pickPart(e);
    if (this._hover && this._hover !== part) this._hover.mat.color.setHex(this._hover.mat.userData.baseColor);
    if (part) part.mat.color.setHex(this.ACCENT);
    this._hover = part;
    BT.Viewport.canvas.style.cursor = part ? "grab" : "";
  },

  // ---- dragging ------------------------------------------------------------------

  tryStartDrag(e) {
    const editMode = BT.state.mode;
    if (editMode !== "object" && editMode !== "vertex") return false;
    const gm = BT.state.gizmoMode;
    if (gm === "select" || gm === "cut") return false; // select clicks and cut clicks are handled elsewhere
    if (gm === "hand") return editMode === "object" ? this._tryStartHand(e) : false;
    if (!this.root.visible) return false;
    const part = this._pickPart(e);
    if (!part) return false;
    const obj = BT.state.selected;
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    let axis = part.axis >= 0 ? axes[part.axis] : null;
    if (part.mode === "scale" && axis && editMode === "object") axis.applyQuaternion(obj.mesh.quaternion).normalize();
    this._drag = {
      part, obj,
      axis,
      origin: this.root.position.clone(),
      startPos: obj.mesh.position.clone(),
      startQuat: obj.mesh.quaternion.clone(),
      startScale: obj.mesh.scale.clone(),
      startY: e.clientY,
      before: editMode === "object" ? this._snapshot(obj) : null,
      verts: editMode === "vertex" ? this._captureVerts(obj) : null,
      pivot: this.root.position.clone(),
      moved: false,
      t0: 0, angle0: 0,
    };
    if (part.mode === "rotate") this._drag.angle0 = this._ringAngle(e);
    else if (part.axis >= 0) this._drag.t0 = this._axisParam(e);
    part.mat.color.setHex(this.ACCENT);
    BT.Viewport.canvas.setPointerCapture(e.pointerId);
    BT.Viewport.canvas.style.cursor = "grabbing";
    return true;
  },

  _captureVerts(obj) {
    const arr = obj.mesh.geometry.getAttribute("position").array;
    const indices = Array.from(BT.Vertex.selected);
    const orig = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      const v3 = indices[i] * 3, i3 = i * 3;
      orig[i3] = arr[v3]; orig[i3 + 1] = arr[v3 + 1]; orig[i3 + 2] = arr[v3 + 2];
    }
    return { indices, orig };
  },

  _snapshot(obj) {
    return { p: obj.mesh.position.toArray(), q: obj.mesh.quaternion.toArray(), s: obj.mesh.scale.toArray() };
  },

  // hand tool: grab any shape and slide it on the ground plane, Shift lifts
  _tryStartHand(e) {
    const hit = BT.Viewport.pickObject(e);
    if (!hit) return false;
    const obj = hit.object.userData.btObj;
    BT.select(obj);
    this._drag = {
      part: { mode: "hand", mat: null },
      obj,
      grab: hit.point.clone(),
      startPos: obj.mesh.position.clone(),
      before: this._snapshot(obj),
    };
    BT.Viewport.canvas.setPointerCapture(e.pointerId);
    BT.Viewport.canvas.style.cursor = "grabbing";
    return true;
  },

  _moveHand(e) {
    const d = this._drag, obj = d.obj;
    const ray = BT.Viewport.rayFromEvent(e).ray;
    if (e.shiftKey) {
      // lift: vertical component of a camera-facing plane through the grab point
      const n = BT.Viewport.camera.getWorldDirection(new THREE.Vector3());
      const dn = ray.direction.dot(n);
      if (Math.abs(dn) < 1e-6) return;
      const t = d.grab.clone().sub(ray.origin).dot(n) / dn;
      const hit = ray.origin.clone().addScaledVector(ray.direction, t);
      let y = d.startPos.y + (hit.y - d.grab.y);
      if (e.ctrlKey) y = Math.round(y / 0.25) * 0.25;
      obj.mesh.position.y = y;
    } else {
      // slide on the ground plane at the grab height
      if (Math.abs(ray.direction.y) < 1e-6) return;
      const t = (d.grab.y - ray.origin.y) / ray.direction.y;
      if (t < 0) return;
      const hit = ray.origin.clone().addScaledVector(ray.direction, t);
      let x = d.startPos.x + hit.x - d.grab.x;
      let z = d.startPos.z + hit.z - d.grab.z;
      if (e.ctrlKey) { x = Math.round(x / 0.25) * 0.25; z = Math.round(z / 0.25) * 0.25; }
      obj.mesh.position.x = x;
      obj.mesh.position.z = z;
    }
    BT.emit("transform", obj);
  },

  // closest param along the gizmo axis line to the mouse ray
  _axisParam(e) {
    const d = this._drag;
    const ray = BT.Viewport.rayFromEvent(e).ray;
    const w0 = d.origin.clone().sub(ray.origin);
    const a = d.axis, dir = ray.direction;
    const B = a.dot(dir);
    const denom = 1 - B * B;
    if (Math.abs(denom) < 1e-6) return d.t0;
    const D = a.dot(w0), E = dir.dot(w0);
    return (B * E - D) / denom;
  },

  _ringAngle(e) {
    const d = this._drag;
    const ray = BT.Viewport.rayFromEvent(e).ray;
    const n = d.axis;
    const dn = ray.direction.dot(n);
    if (Math.abs(dn) < 1e-6) return d.angle0;
    const s = d.origin.clone().sub(ray.origin).dot(n) / dn;
    const hit = ray.origin.clone().addScaledVector(ray.direction, s);
    const v = hit.sub(d.origin);
    const u1 = Math.abs(n.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    u1.sub(n.clone().multiplyScalar(u1.dot(n))).normalize();
    const u2 = new THREE.Vector3().crossVectors(n, u1);
    return Math.atan2(v.dot(u2), v.dot(u1));
  },

  _moveDrag(e) {
    const d = this._drag;
    const obj = d.obj, part = d.part;
    if (part.mode === "hand") { this._moveHand(e); return; }
    if (d.verts) { this._moveVerts(e); return; }
    if (part.mode === "translate") {
      let delta = this._axisParam(e) - d.t0;
      if (e.shiftKey) delta = Math.round(delta / 0.1) * 0.1;
      obj.mesh.position.copy(d.startPos).addScaledVector(d.axis, delta);
    } else if (part.mode === "rotate") {
      let ang = this._ringAngle(e) - d.angle0;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      const q = new THREE.Quaternion().setFromAxisAngle(d.axis, ang);
      obj.mesh.quaternion.copy(d.startQuat).premultiply(q);
    } else { // scale
      let factor;
      if (part.axis < 0) {
        factor = Math.exp((d.startY - e.clientY) * 0.006);
      } else {
        const gs = this.root.scale.x || 1;
        factor = 1 + (this._axisParam(e) - d.t0) / gs;
      }
      factor = Math.max(0.01, factor);
      if (part.axis < 0) obj.mesh.scale.copy(d.startScale).multiplyScalar(factor);
      else {
        obj.mesh.scale.copy(d.startScale);
        const comp = ["x", "y", "z"][part.axis];
        obj.mesh.scale[comp] = d.startScale[comp] * factor;
      }
    }
    BT.emit("transform", obj);
  },

  // vertex-mode gizmo drag: build a world-space transform about the pivot,
  // convert it into the object's local space, run the original positions
  // through it
  _moveVerts(e) {
    const d = this._drag, part = d.part;
    const mT = (v, s) => new THREE.Matrix4().makeTranslation(v.x * s, v.y * s, v.z * s);
    let W;
    if (part.mode === "translate") {
      let delta = this._axisParam(e) - d.t0;
      if (e.shiftKey) delta = Math.round(delta / 0.1) * 0.1;
      W = new THREE.Matrix4().makeTranslation(d.axis.x * delta, d.axis.y * delta, d.axis.z * delta);
    } else if (part.mode === "rotate") {
      let ang = this._ringAngle(e) - d.angle0;
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      W = mT(d.pivot, 1).multiply(new THREE.Matrix4().makeRotationAxis(d.axis, ang)).multiply(mT(d.pivot, -1));
    } else {
      let f;
      if (part.axis < 0) f = Math.exp((d.startY - e.clientY) * 0.006);
      else f = 1 + (this._axisParam(e) - d.t0) / (this.root.scale.x || 1);
      f = Math.max(0.01, f);
      let S;
      if (part.axis < 0) S = new THREE.Matrix4().makeScale(f, f, f);
      else {
        const a = d.axis, k = f - 1;
        S = new THREE.Matrix4().set(
          1 + k * a.x * a.x, k * a.x * a.y, k * a.x * a.z, 0,
          k * a.x * a.y, 1 + k * a.y * a.y, k * a.y * a.z, 0,
          k * a.x * a.z, k * a.y * a.z, 1 + k * a.z * a.z, 0,
          0, 0, 0, 1);
      }
      W = mT(d.pivot, 1).multiply(S).multiply(mT(d.pivot, -1));
    }

    d.obj.mesh.updateMatrixWorld();
    const mw = d.obj.mesh.matrixWorld;
    const full = new THREE.Matrix4().copy(mw).invert().multiply(W).multiply(mw);
    const attr = d.obj.mesh.geometry.getAttribute("position");
    const v = new THREE.Vector3();
    const { indices, orig } = d.verts;
    for (let i = 0; i < indices.length; i++) {
      v.fromArray(orig, i * 3).applyMatrix4(full).toArray(attr.array, indices[i] * 3);
    }
    attr.needsUpdate = true;
    d.moved = true;
    BT.Mesh.computeNormalsPartial(d.obj, indices);
    BT.Vertex._syncSelMarker();
    BT.emit("vertex");
  },

  _endDrag(e) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    try { BT.Viewport.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    BT.Viewport.canvas.style.cursor = "";
    if (d.part.mat) d.part.mat.color.setHex(d.part.mat.userData.baseColor);

    if (d.verts) {
      if (!d.moved) return;
      const attr = d.obj.mesh.geometry.getAttribute("position");
      const indices = Uint32Array.from(d.verts.indices);
      const after = new Float32Array(indices.length * 3);
      for (let i = 0; i < indices.length; i++) {
        const v3 = indices[i] * 3, i3 = i * 3;
        after[i3] = attr.array[v3]; after[i3 + 1] = attr.array[v3 + 1]; after[i3 + 2] = attr.array[v3 + 2];
      }
      BT.History.push({ type: "verts", id: d.obj.id, attr: "position", indices, before: d.verts.orig, after });
      BT.Mesh.afterVertsChanged(d.obj, d.verts.indices);
      return;
    }

    const after = this._snapshot(d.obj);
    const b = d.before;
    const same = b.p.join() === after.p.join() && b.q.join() === after.q.join() && b.s.join() === after.s.join();
    if (!same) BT.History.push({ type: "transform", id: d.obj.id, before: b, after });
  },
};
