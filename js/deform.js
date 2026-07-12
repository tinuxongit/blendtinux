/* Deform tools: bend, twist, taper, noise. A deform session snapshots the
   base positions, recomputes every vertex from that base while the slider
   moves, and only becomes a history entry on Apply. Cancel restores the base. */
"use strict";

BT.Deform = {
  session: null, // { obj, kind, base, axis, amount, freq }

  KINDS: {
    twist: { label: "Twist", min: -6.28, max: 6.28, def: 0 },
    bend:  { label: "Bend",  min: -3.14, max: 3.14, def: 0 },
    taper: { label: "Taper", min: -0.95, max: 3, def: 0 },
    noise: { label: "Noise", min: 0, max: 0.5, def: 0 },
  },

  start(obj, kind) {
    this.cancel();
    const g = obj.mesh.geometry;
    this.session = {
      obj, kind,
      base: g.getAttribute("position").array.slice(),
      baseNor: g.getAttribute("normal").array.slice(),
      axis: 1,
      amount: this.KINDS[kind].def,
      freq: 2.5,
      dirty: false,
    };
    BT.emit("deform", this.session);
  },

  setAxis(a) { if (this.session) { this.session.axis = a; this._recompute(); } },
  setAmount(v) { if (this.session) { this.session.amount = v; this._recompute(); } },
  setFreq(v) { if (this.session) { this.session.freq = v; this._recompute(); } },

  apply() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.dirty) {
      const after = s.obj.mesh.geometry.getAttribute("position").array.slice();
      BT.History.push({ type: "positions", id: s.obj.id, before: s.base, after });
      BT.Mesh.afterVertsChanged(s.obj, null);
    }
    BT.emit("deform", null);
  },

  cancel() {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.dirty) {
      s.obj.mesh.geometry.getAttribute("position").array.set(s.base);
      s.obj.mesh.geometry.getAttribute("normal").array.set(s.baseNor);
      s.obj.mesh.geometry.getAttribute("position").needsUpdate = true;
      s.obj.mesh.geometry.getAttribute("normal").needsUpdate = true;
      s.obj.mesh.geometry.computeBoundingSphere();
      s.obj.mesh.geometry.computeBoundingBox();
    }
    BT.emit("deform", null);
  },

  _recompute() {
    const s = this.session;
    const g = s.obj.mesh.geometry;
    const pos = g.getAttribute("position").array;
    const base = s.base;
    const a = s.axis, u = (a + 1) % 3, v = (a + 2) % 3;

    // bbox range along the chosen axis, from the base shape
    let h0 = Infinity, h1 = -Infinity;
    for (let i = a; i < base.length; i += 3) {
      if (base[i] < h0) h0 = base[i];
      if (base[i] > h1) h1 = base[i];
    }
    const L = Math.max(h1 - h0, 1e-6);
    const A = s.amount;

    if (s.kind === "noise") {
      const nor = s.baseNor, f = s.freq;
      for (let i = 0; i < base.length; i += 3) {
        const d = A * BT.valueNoise3(base[i] * f, base[i + 1] * f, base[i + 2] * f);
        pos[i] = base[i] + nor[i] * d;
        pos[i + 1] = base[i + 1] + nor[i + 1] * d;
        pos[i + 2] = base[i + 2] + nor[i + 2] * d;
      }
    } else {
      for (let i = 0; i < base.length; i += 3) {
        const h = base[i + a], pu = base[i + u], pv = base[i + v];
        const t = (h - h0) / L;
        let nh = h, nu = pu, nv = pv;
        if (s.kind === "twist") {
          const ang = A * t, c = Math.cos(ang), sn = Math.sin(ang);
          nu = pu * c - pv * sn;
          nv = pu * sn + pv * c;
        } else if (s.kind === "taper") {
          const f = Math.max(0.05, 1 + A * (t - 0.5) * 2);
          nu = pu * f; nv = pv * f;
        } else if (s.kind === "bend") {
          if (Math.abs(A) > 1e-4) {
            const R = L / A, theta = t * A, r = R - pu;
            nu = R - r * Math.cos(theta);
            nh = h0 + r * Math.sin(theta);
          }
        }
        pos[i + a] = nh; pos[i + u] = nu; pos[i + v] = nv;
      }
    }

    s.dirty = true;
    g.getAttribute("position").needsUpdate = true;
    g.computeVertexNormals();
    g.getAttribute("normal").needsUpdate = true;
    g.computeBoundingSphere();
  },
};
