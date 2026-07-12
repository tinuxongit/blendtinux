/* Brush engine shared by Sculpt and Paint modes. One brush step runs per
   animation frame while a stroke is active. Vertex gathering is a plain
   O(n) scan in object-local space, cheap enough up to a few hundred
   thousand vertices and never stale, unlike a spatial index. */
"use strict";

BT.Sculpt = {
  settings: {
    brush: "draw",        // draw | inflate | grab | smooth | flatten | pinch
    paintBrush: "paint",  // paint | blur
    radius: 0.3,          // world units
    strength: 0.5,
    falloff: "smooth",    // smooth | linear | sharp
    symmetry: false,
    paintColor: "#f0924f",
  },

  _stroke: null,
  _cursor: null,
  _cursorMirror: null,
  _pendingEvent: null,

  init() {
    const ringGeo = new THREE.BufferGeometry();
    const pts = new Float32Array(33 * 3);
    for (let i = 0; i <= 32; i++) {
      pts[i * 3] = Math.cos(i / 32 * Math.PI * 2);
      pts[i * 3 + 1] = Math.sin(i / 32 * Math.PI * 2);
    }
    ringGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    const mkRing = (opacity) => {
      const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({
        color: 0xf0924f, transparent: true, opacity, depthTest: false,
      }));
      ring.renderOrder = 997;
      ring.visible = false;
      BT.Viewport.scene.add(ring);
      return ring;
    };
    this._cursor = mkRing(0.9);
    this._cursorMirror = mkRing(0.35);

    const canvas = BT.Viewport.canvas;
    canvas.addEventListener("pointermove", (e) => {
      this._pendingEvent = e; // consumed once per frame, raycasts are not free
    });
    canvas.addEventListener("wheel", (e) => {
      if (!e.ctrlKey || BT.state.mode === "object") return;
      this.nudgeRadius(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: true });
    const end = (e) => this._endStroke(e);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    BT.on("mode", () => this._hideCursor());
    BT.on("selection", () => this._hideCursor());
    BT.Viewport.onFrame(() => this._frame());
  },

  nudgeRadius(f) {
    this.settings.radius = BT.clamp(this.settings.radius * f, 0.02, 5);
    BT.emit("brush");
  },

  _active() { return BT.state.mode === "sculpt" || BT.state.mode === "paint"; },

  _hideCursor() {
    this._cursor.visible = false;
    this._cursorMirror.visible = false;
  },

  _updateCursor(e) {
    if (!this._active() || !BT.state.selected) { this._hideCursor(); return; }
    const mesh = BT.state.selected.mesh;
    const hit = BT.Viewport.pickMesh(e, mesh);
    if (!hit) { this._hideCursor(); return; }
    this._placeRing(this._cursor, hit.point, hit.face.normal, mesh);
    if (this.settings.symmetry) {
      const local = mesh.worldToLocal(hit.point.clone());
      local.x = -local.x;
      const n = hit.face.normal.clone(); n.x = -n.x;
      this._placeRing(this._cursorMirror, mesh.localToWorld(local), n, mesh);
    } else this._cursorMirror.visible = false;
  },

  _placeRing(ring, worldPoint, localNormal, mesh) {
    const n = localNormal.clone().transformDirection(mesh.matrixWorld);
    ring.position.copy(worldPoint).addScaledVector(n, 0.004);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    ring.scale.setScalar(this.settings.radius);
    ring.visible = true;
  },

  // ---- stroke lifecycle -------------------------------------------------------

  tryStartStroke(e) {
    if (!this._active() || !BT.state.selected) return false;
    const obj = BT.state.selected;
    const hit = BT.Viewport.pickMesh(e, obj.mesh);
    if (!hit) return false;

    const painting = BT.state.mode === "paint";
    if (painting) BT.Mesh.ensureColorAttribute(obj);
    const attrName = painting ? "color" : "position";
    const attr = obj.mesh.geometry.getAttribute(attrName);
    obj.mesh.geometry.computeBoundingSphere();

    this._stroke = {
      obj,
      brush: painting ? this.settings.paintBrush : this.settings.brush,
      attrName,
      before: attr.array.slice(),
      touched: new Set(),
      stepMarks: [],
      mark(v) { this.touched.add(v); this.stepMarks.push(v); },
      grab: null,
      startRadius: obj.mesh.geometry.boundingSphere.radius,
      inflate: 0,
    };
    if (this._stroke.brush === "grab") this._beginGrab(e, hit);
    this._pendingEvent = e;
    BT.Viewport.canvas.setPointerCapture(e.pointerId);
    return true;
  },

  _beginGrab(e, hit) {
    const s = this._stroke, mesh = s.obj.mesh;
    const local = mesh.worldToLocal(hit.point.clone());
    const r = this._localRadius(mesh);
    const sets = [this._gather(mesh, local, r)];
    if (this.settings.symmetry) {
      const m = local.clone(); m.x = -m.x;
      sets.push(this._gather(mesh, m, r));
    }
    const pos = mesh.geometry.getAttribute("position").array;
    s.grab = {
      startHit: hit.point.clone(),
      planeNormal: BT.Viewport.camera.getWorldDirection(new THREE.Vector3()),
      sets: sets.map((set, k) => ({
        idx: set.idx, w: set.w, mirror: k === 1,
        orig: (() => {
          const o = new Float32Array(set.idx.length * 3);
          for (let i = 0; i < set.idx.length; i++) {
            o[i * 3] = pos[set.idx[i] * 3]; o[i * 3 + 1] = pos[set.idx[i] * 3 + 1]; o[i * 3 + 2] = pos[set.idx[i] * 3 + 2];
          }
          return o;
        })(),
      })),
    };
  },

  _frame() {
    if (!this._pendingEvent) return;
    const e = this._pendingEvent;
    this._pendingEvent = null;
    if (this._stroke) this._step(e);
    else this._updateCursor(e);
  },

  _endStroke(e) {
    const s = this._stroke;
    if (!s) return;
    this._stroke = null;
    try { BT.Viewport.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    const g = s.obj.mesh.geometry;
    const attr = g.getAttribute(s.attrName);
    if (s.touched.size) {
      const indices = Uint32Array.from(s.touched);
      const before = new Float32Array(indices.length * 3);
      const after = new Float32Array(indices.length * 3);
      for (let i = 0; i < indices.length; i++) {
        const v3 = indices[i] * 3, i3 = i * 3;
        before[i3] = s.before[v3]; before[i3 + 1] = s.before[v3 + 1]; before[i3 + 2] = s.before[v3 + 2];
        after[i3] = attr.array[v3]; after[i3 + 1] = attr.array[v3 + 1]; after[i3 + 2] = attr.array[v3 + 2];
      }
      BT.History.push({ type: "verts", id: s.obj.id, attr: s.attrName, indices, before, after });
      if (s.attrName === "position") BT.Mesh.afterVertsChanged(s.obj, indices);
    }
    s.before = null;
  },

  // ---- one brush step ------------------------------------------------------------

  _localRadius(mesh) {
    const sc = mesh.scale;
    const mean = (Math.abs(sc.x) + Math.abs(sc.y) + Math.abs(sc.z)) / 3 || 1;
    return this.settings.radius / mean;
  },

  _falloff(t) {
    if (t >= 1) return 0;
    switch (this.settings.falloff) {
      case "linear": return 1 - t;
      case "sharp": { const u = 1 - t; return u * u; }
      default: return 0.5 * (1 + Math.cos(Math.PI * t));
    }
  },

  _gather(mesh, localCenter, r) {
    const pos = mesh.geometry.getAttribute("position").array;
    const n = pos.length / 3;
    const r2 = r * r, cx = localCenter.x, cy = localCenter.y, cz = localCenter.z;
    const idx = [], w = [];
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - cx, dy = pos[i * 3 + 1] - cy, dz = pos[i * 3 + 2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      idx.push(i);
      w.push(this._falloff(Math.sqrt(d2) / r));
    }
    return { idx, w };
  },

  _step(e) {
    const s = this._stroke;
    const mesh = s.obj.mesh;
    if (s.brush === "grab") { this._stepGrab(e); return; }

    const hit = BT.Viewport.pickMesh(e, mesh);
    if (!hit) return;
    const local = mesh.worldToLocal(hit.point.clone());
    const r = this._localRadius(mesh);
    const sign = e.ctrlKey ? -1 : 1;

    s.stepMarks = [];
    this._applyBrush(s, local, r, sign);
    if (this.settings.symmetry) {
      const m = local.clone(); m.x = -m.x;
      this._applyBrush(s, m, r, sign);
    }
    this._afterStep(r, s.stepMarks);
    this._updateCursor(e);
  },

  _applyBrush(s, center, r, sign) {
    const g = s.obj.mesh.geometry;
    const { idx, w } = this._gather(s.obj.mesh, center, r);
    if (!idx.length) return;
    const pos = g.getAttribute("position").array;
    const str = this.settings.strength;

    if (s.attrName === "color") {
      const col = g.getAttribute("color").array;
      if (s.brush === "blur") {
        const adj = BT.Mesh.getAdjacency(s.obj);
        const src = col.slice();
        for (let k = 0; k < idx.length; k++) {
          const v = idx[k];
          let cr = 0, cg = 0, cb = 0, cnt = 0;
          for (let j = adj.nOff[v]; j < adj.nOff[v + 1]; j++) {
            const nb = adj.nList[j] * 3;
            cr += src[nb]; cg += src[nb + 1]; cb += src[nb + 2]; cnt++;
          }
          if (!cnt) continue;
          const t = BT.clamp(0.6 * str * w[k], 0, 1), v3 = v * 3;
          col[v3] += (cr / cnt - col[v3]) * t;
          col[v3 + 1] += (cg / cnt - col[v3 + 1]) * t;
          col[v3 + 2] += (cb / cnt - col[v3 + 2]) * t;
          s.mark(v);
        }
      } else {
        const c = new THREE.Color(this.settings.paintColor).convertSRGBToLinear();
        for (let k = 0; k < idx.length; k++) {
          const t = BT.clamp(str * w[k] * 0.5, 0, 1), v3 = idx[k] * 3;
          col[v3] += (c.r - col[v3]) * t;
          col[v3 + 1] += (c.g - col[v3 + 1]) * t;
          col[v3 + 2] += (c.b - col[v3 + 2]) * t;
          s.mark(idx[k]);
        }
      }
      g.getAttribute("color").needsUpdate = true;
      return;
    }

    const nor = g.getAttribute("normal").array;
    const amt = 0.3 * r * str * sign; // per-step magnitude, scales with brush size

    switch (s.brush) {
      case "draw": {
        let nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < idx.length; k++) {
          const v3 = idx[k] * 3;
          nx += nor[v3] * w[k]; ny += nor[v3 + 1] * w[k]; nz += nor[v3 + 2] * w[k];
        }
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (let k = 0; k < idx.length; k++) {
          const v3 = idx[k] * 3, d = amt * w[k];
          pos[v3] += nx * d; pos[v3 + 1] += ny * d; pos[v3 + 2] += nz * d;
          s.mark(idx[k]);
        }
        break;
      }
      case "inflate": {
        for (let k = 0; k < idx.length; k++) {
          const v3 = idx[k] * 3, d = amt * w[k];
          pos[v3] += nor[v3] * d; pos[v3 + 1] += nor[v3 + 1] * d; pos[v3 + 2] += nor[v3 + 2] * d;
          s.mark(idx[k]);
        }
        break;
      }
      case "smooth": {
        const adj = BT.Mesh.getAdjacency(s.obj);
        const src = pos.slice();
        for (let k = 0; k < idx.length; k++) {
          const v = idx[k];
          let ax = 0, ay = 0, az = 0, cnt = 0;
          for (let j = adj.nOff[v]; j < adj.nOff[v + 1]; j++) {
            const nb = adj.nList[j] * 3;
            ax += src[nb]; ay += src[nb + 1]; az += src[nb + 2]; cnt++;
          }
          if (!cnt) continue;
          const t = BT.clamp(0.5 * str * w[k], 0, 1), v3 = v * 3;
          pos[v3] += (ax / cnt - pos[v3]) * t;
          pos[v3 + 1] += (ay / cnt - pos[v3 + 1]) * t;
          pos[v3 + 2] += (az / cnt - pos[v3 + 2]) * t;
          s.mark(v);
        }
        break;
      }
      case "flatten": {
        let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < idx.length; k++) {
          const v3 = idx[k] * 3;
          cx += pos[v3]; cy += pos[v3 + 1]; cz += pos[v3 + 2];
          nx += nor[v3]; ny += nor[v3 + 1]; nz += nor[v3 + 2];
        }
        cx /= idx.length; cy /= idx.length; cz /= idx.length;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (let k = 0; k < idx.length; k++) {
          const v3 = idx[k] * 3;
          const dist = (pos[v3] - cx) * nx + (pos[v3 + 1] - cy) * ny + (pos[v3 + 2] - cz) * nz;
          const t = BT.clamp(0.6 * str * w[k], 0, 1);
          pos[v3] -= nx * dist * t; pos[v3 + 1] -= ny * dist * t; pos[v3 + 2] -= nz * dist * t;
          s.mark(idx[k]);
        }
        break;
      }
      case "pinch": {
        for (let k = 0; k < idx.length; k++) {
          const v3 = idx[k] * 3;
          let vx = center.x - pos[v3], vy = center.y - pos[v3 + 1], vz = center.z - pos[v3 + 2];
          const dn = vx * nor[v3] + vy * nor[v3 + 1] + vz * nor[v3 + 2];
          vx -= nor[v3] * dn; vy -= nor[v3 + 1] * dn; vz -= nor[v3 + 2] * dn; // tangential only
          const t = 0.35 * str * w[k] * sign;
          pos[v3] += vx * t; pos[v3 + 1] += vy * t; pos[v3 + 2] += vz * t;
          s.mark(idx[k]);
        }
        break;
      }
    }
  },

  _stepGrab(e) {
    const s = this._stroke, mesh = s.obj.mesh, gr = s.grab;
    const ray = BT.Viewport.rayFromEvent(e).ray;
    const n = gr.planeNormal;
    const dn = ray.direction.dot(n);
    if (Math.abs(dn) < 1e-6) return;
    const t = gr.startHit.clone().sub(ray.origin).dot(n) / dn;
    const cur = ray.origin.clone().addScaledVector(ray.direction, t);
    const worldDelta = cur.sub(gr.startHit);

    const l1 = mesh.worldToLocal(gr.startHit.clone().add(worldDelta));
    const l0 = mesh.worldToLocal(gr.startHit.clone());
    const ldx = l1.x - l0.x, ldy = l1.y - l0.y, ldz = l1.z - l0.z;

    const pos = mesh.geometry.getAttribute("position").array;
    s.stepMarks = [];
    for (const set of gr.sets) {
      const mx = set.mirror ? -1 : 1;
      for (let i = 0; i < set.idx.length; i++) {
        const v3 = set.idx[i] * 3, o3 = i * 3, w = set.w[i];
        pos[v3] = set.orig[o3] + ldx * w * mx;
        pos[v3 + 1] = set.orig[o3 + 1] + ldy * w;
        pos[v3 + 2] = set.orig[o3 + 2] + ldz * w;
        s.mark(set.idx[i]);
      }
    }
    this._afterStep(Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz), s.stepMarks);
  },

  _afterStep(maxMove, marks) {
    const s = this._stroke;
    const g = s.obj.mesh.geometry;
    if (s.attrName !== "position") return;
    g.getAttribute("position").needsUpdate = true;
    if (marks && marks.length) BT.Mesh.computeNormalsPartial(s.obj, marks);
    // keep raycasting alive without a full bounds recompute mid-stroke
    s.inflate += Math.abs(maxMove);
    if (g.boundingSphere) g.boundingSphere.radius = s.startRadius + s.inflate;
  },
};
