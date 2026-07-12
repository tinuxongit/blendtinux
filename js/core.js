/* BlendTinux core: shared state, event bus, small utilities.
   Everything hangs off the single global BT. Classic scripts, no modules. */
"use strict";

const BT = {
  state: {
    objects: [],       // SceneObject records, see mesh.js createObject
    selected: null,
    mode: "object",      // object | sculpt | paint | vertex | render
    gizmoMode: "select", // select | hand | translate | rotate | scale | cut
  },

  _listeners: Object.create(null),
  on(ev, fn) {
    (this._listeners[ev] || (this._listeners[ev] = [])).push(fn);
  },
  emit(ev) {
    const fns = this._listeners[ev];
    if (!fns) return;
    const args = Array.prototype.slice.call(arguments, 1);
    for (let i = 0; i < fns.length; i++) fns[i].apply(null, args);
  },

  _uid: 0,
  uid() { return "o" + Date.now().toString(36) + (++this._uid).toString(36); },

  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },

  // scene ops -------------------------------------------------------------
  addObject(obj, select) {
    this.state.objects.push(obj);
    BT.Viewport.scene.add(obj.mesh);
    this.emit("objects");
    if (select) this.select(obj);
  },
  removeObject(obj) {
    const i = this.state.objects.indexOf(obj);
    if (i >= 0) this.state.objects.splice(i, 1);
    BT.Viewport.scene.remove(obj.mesh);
    if (this.state.selected === obj) {
      this.select(null);
      if (this.state.mode !== "object") this.setMode("object");
    }
    this.emit("objects");
  },
  findObject(id) {
    const list = this.state.objects;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  },
  select(obj) {
    if (this.state.selected === obj) return;
    const prev = this.state.selected;
    this.state.selected = obj;
    if (prev) BT.Mesh.setSelectionTint(prev, false);
    if (obj) BT.Mesh.setSelectionTint(obj, true);
    this.emit("selection", obj);
  },
  setMode(mode) {
    if (this.state.mode === mode) return;
    if (mode !== "object" && mode !== "render" && !this.state.selected) {
      if (this.state.objects.length === 1) this.select(this.state.objects[0]);
      else { this.emit("toast", "select an object first"); return; }
    }
    this.state.mode = mode;
    this.emit("mode", mode);
  },

  // typed array <-> base64 (for localStorage) ------------------------------
  b64FromBytes(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  },
  bytesFromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
  b64FromF32(arr) { return this.b64FromBytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); },
  f32FromB64(b64) { const b = this.bytesFromB64(b64); return new Float32Array(b.buffer); },
  b64FromU32(arr) { return this.b64FromBytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); },
  u32FromB64(b64) { const b = this.bytesFromB64(b64); return new Uint32Array(b.buffer); },
  b64FromI32(arr) { return this.b64FromBytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)); },
  i32FromB64(b64) { const b = this.bytesFromB64(b64); return new Int32Array(b.buffer); },

  // value noise, used by the noise deform ----------------------------------
  _hash3(x, y, z) {
    const d = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return d - Math.floor(d);
  },
  valueNoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
    const h = this._hash3.bind(this);
    const c000 = h(xi, yi, zi),     c100 = h(xi + 1, yi, zi);
    const c010 = h(xi, yi + 1, zi), c110 = h(xi + 1, yi + 1, zi);
    const c001 = h(xi, yi, zi + 1), c101 = h(xi + 1, yi, zi + 1);
    const c011 = h(xi, yi + 1, zi + 1), c111 = h(xi + 1, yi + 1, zi + 1);
    const x00 = c000 + (c100 - c000) * xf, x10 = c010 + (c110 - c010) * xf;
    const x01 = c001 + (c101 - c001) * xf, x11 = c011 + (c111 - c011) * xf;
    const y0 = x00 + (x10 - x00) * yf, y1 = x01 + (x11 - x01) * yf;
    return (y0 + (y1 - y0) * zf) * 2 - 1; // -1..1
  },
};
