/* Undo/redo. Commands are plain data payloads keyed by object id, never live
   THREE objects, so deleted geometry can be disposed safely. */
"use strict";

BT.History = {
  stack: [],
  ptr: 0,          // index of the next redo slot
  bytes: 0,
  MAX_BYTES: 64 * 1024 * 1024,
  MAX_COUNT: 50,

  push(cmd) {
    // drop the redo tail
    while (this.stack.length > this.ptr) this.bytes -= this._size(this.stack.pop());
    this.stack.push(cmd);
    this.bytes += this._size(cmd);
    this.ptr = this.stack.length;
    while ((this.bytes > this.MAX_BYTES || this.stack.length > this.MAX_COUNT) && this.ptr > 1) {
      this.bytes -= this._size(this.stack.shift());
      this.ptr--;
    }
    BT.emit("history");
  },

  canUndo() { return this.ptr > 0; },
  canRedo() { return this.ptr < this.stack.length; },
  undo() { if (this.canUndo()) { this._apply(this.stack[--this.ptr], true); BT.emit("history"); } },
  redo() { if (this.canRedo()) { this._apply(this.stack[this.ptr++], false); BT.emit("history"); } },

  clear() { this.stack = []; this.ptr = 0; this.bytes = 0; BT.emit("history"); },

  _size(cmd) {
    let n = 256;
    const acc = (v) => { if (v && v.byteLength) n += v.byteLength; };
    acc(cmd.indices); acc(cmd.before); acc(cmd.after);
    if (cmd.data) { acc(cmd.data.pos); acc(cmd.data.idx); acc(cmd.data.col); }
    if (cmd.before && cmd.before.pos) { acc(cmd.before.pos); acc(cmd.before.idx); acc(cmd.before.col); }
    if (cmd.after && cmd.after.pos) { acc(cmd.after.pos); acc(cmd.after.idx); acc(cmd.after.col); }
    return n;
  },

  _apply(cmd, undo) {
    const obj = cmd.id ? BT.findObject(cmd.id) : null;
    switch (cmd.type) {
      case "transform": {
        if (!obj) return;
        const t = undo ? cmd.before : cmd.after;
        obj.mesh.position.fromArray(t.p);
        obj.mesh.quaternion.fromArray(t.q);
        obj.mesh.scale.fromArray(t.s);
        BT.emit("transform", obj);
        break;
      }
      case "add": case "delete": {
        const remove = (cmd.type === "add") === undo;
        if (remove) {
          const o = BT.findObject(cmd.data.id);
          if (o) { BT.removeObject(o); BT.Mesh.disposeObject(o); }
        } else {
          BT.addObject(BT.Mesh.deserializeObject(cmd.data), true);
        }
        break;
      }
      case "verts": { // sparse sculpt/paint stroke
        if (!obj) return;
        const attr = obj.mesh.geometry.getAttribute(cmd.attr);
        if (!attr) return;
        const src = undo ? cmd.before : cmd.after;
        const idx = cmd.indices, a = attr.array;
        for (let i = 0; i < idx.length; i++) {
          const o3 = idx[i] * 3, s3 = i * 3;
          a[o3] = src[s3]; a[o3 + 1] = src[s3 + 1]; a[o3 + 2] = src[s3 + 2];
        }
        attr.needsUpdate = true;
        if (cmd.attr === "position") BT.Mesh.afterVertsChanged(obj, cmd.indices);
        break;
      }
      case "positions": { // deform: full position swap
        if (!obj) return;
        obj.mesh.geometry.getAttribute("position").array.set(undo ? cmd.before : cmd.after);
        obj.mesh.geometry.getAttribute("position").needsUpdate = true;
        BT.Mesh.afterVertsChanged(obj, null);
        break;
      }
      case "geometry": { // subdivide/mirror: topology swap
        if (!obj) return;
        BT.Mesh.replaceGeometry(obj, undo ? cmd.before : cmd.after);
        break;
      }
      case "material": {
        if (!obj) return;
        BT.Mesh.applyMaterialProps(obj, undo ? cmd.before : cmd.after);
        break;
      }
      case "rename": {
        if (!obj) return;
        obj.name = undo ? cmd.before : cmd.after;
        BT.emit("objects");
        break;
      }
      case "visible": {
        if (!obj) return;
        obj.mesh.visible = undo ? cmd.before : cmd.after;
        BT.emit("objects");
        break;
      }
    }
  },
};
