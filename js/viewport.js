/* Renderer, camera, lights, grid, orbit controls, frame loop, picking.
   Orbit: left-drag or right-drag rotates, middle-drag or Shift+drag pans,
   wheel zooms. A short left click (under the drag threshold) selects. */
"use strict";

BT.Viewport = {
  scene: null, camera: null, renderer: null, canvas: null,
  cam: { target: new THREE.Vector3(0, 0.4, 0), theta: 0.6, phi: 1.15, dist: 4.2 },
  _frameFns: [],
  _raycaster: new THREE.Raycaster(),
  _pointer: new THREE.Vector2(),
  _drag: null,
  _moved: false,
  _reduced: false,

  init(canvas) {
    this.canvas = canvas;
    this._reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.setClearColor(0x101014);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);

    const key = new THREE.DirectionalLight(0xfff1e0, 0.85);
    key.position.set(3, 5, 2);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.3);
    fill.position.set(-4, 2, -1);
    const rim = new THREE.DirectionalLight(0xffe6c8, 0.25);
    rim.position.set(0, 3, -5);
    const hemi = new THREE.HemisphereLight(0x2e2e38, 0x191914, 0.9);
    this.scene.add(key, fill, rim, hemi);

    const grid = new THREE.GridHelper(24, 24, 0x2c2c36, 0x1e1e26);
    grid.position.y = -0.001;
    this.scene.add(grid);

    // colored center axes on the floor, matching the gizmo: red = X, blue = Z
    const axisLine = (x0, z0, x1, z1, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([x0, 0.001, z0, x1, 0.001, z1]), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      this.scene.add(line);
    };
    axisLine(-12, 0, 12, 0, 0xe04545);
    axisLine(0, -12, 0, 12, 0x3d6de0);

    this._bindInput();
    this._resize();
    window.addEventListener("resize", () => this._resize());

    const loop = () => {
      requestAnimationFrame(loop);
      if (this.paused) return; // the ray tracer wants the whole GPU
      this._applyCamera();
      for (let i = 0; i < this._frameFns.length; i++) this._frameFns[i]();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  },

  onFrame(fn) { this._frameFns.push(fn); },

  _resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },

  _applyCamera() {
    const c = this.cam;
    this.camera.position.set(
      c.target.x + c.dist * Math.sin(c.phi) * Math.sin(c.theta),
      c.target.y + c.dist * Math.cos(c.phi),
      c.target.z + c.dist * Math.sin(c.phi) * Math.cos(c.theta)
    );
    this.camera.lookAt(c.target);
  },

  frameObject(obj) {
    obj.mesh.geometry.computeBoundingSphere();
    const bs = obj.mesh.geometry.boundingSphere;
    const center = bs.center.clone().applyMatrix4(obj.mesh.matrixWorld);
    const s = obj.mesh.scale;
    const r = bs.radius * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    this.cam.target.copy(center);
    this.cam.dist = BT.clamp(r * 2.6, 0.5, 200);
  },

  // ---- picking -------------------------------------------------------------

  rayFromClient(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.set(
      ((cx - rect.left) / rect.width) * 2 - 1,
      -((cy - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    return this._raycaster;
  },

  rayFromEvent(e) { return this.rayFromClient(e.clientX, e.clientY); },

  pickObject(e) {
    const ray = this.rayFromEvent(e);
    const meshes = BT.state.objects.filter((o) => o.mesh.visible).map((o) => o.mesh);
    const hits = ray.intersectObjects(meshes, false);
    return hits.length ? hits[0] : null;
  },

  pickMesh(e, mesh) {
    const ray = this.rayFromEvent(e);
    const hits = ray.intersectObject(mesh, false);
    return hits.length ? hits[0] : null;
  },

  // ---- input ----------------------------------------------------------------

  _bindInput() {
    const canvas = this.canvas;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("pointerdown", (e) => {
      if (this._drag) return;
      // give the gizmo and the brush first refusal on left-drags
      if (e.button === 0) {
        if (BT.Gizmo && BT.Gizmo.tryStartDrag(e)) return;
        if (BT.Vertex && BT.Vertex.tryCutClick(e)) return;
        if (BT.Sculpt && BT.Sculpt.tryStartStroke(e)) return;
        if (BT.Vertex && BT.Vertex.tryStart(e)) return;
      }
      const pan = e.button === 1 || (e.button === 2 && e.shiftKey) || (e.button === 0 && e.shiftKey);
      this._drag = { x: e.clientX, y: e.clientY, pan, button: e.button };
      this._moved = false;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      if (!this._moved && dx * dx + dy * dy < 16) return;
      this._moved = true;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      const c = this.cam;
      if (this._drag.pan) {
        const k = 2 * c.dist * Math.tan(this.camera.fov * 0.5 * Math.PI / 180) / this.canvas.clientHeight;
        const m = this.camera.matrix.elements;
        c.target.x += m[0] * -dx * k + m[4] * dy * k;
        c.target.y += m[1] * -dx * k + m[5] * dy * k;
        c.target.z += m[2] * -dx * k + m[6] * dy * k;
      } else {
        c.theta -= dx * 0.005;
        c.phi = BT.clamp(c.phi - dy * 0.005, 0.05, Math.PI - 0.05);
        BT.emit("orbited");
      }
    });

    const endDrag = (e) => {
      if (!this._drag) return;
      const wasClick = !this._moved && this._drag.button === 0 && !this._drag.pan;
      const wasRightClick = !this._moved && this._drag.button === 2 && !this._drag.pan;
      this._drag = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (wasClick && BT.state.mode === "object") {
        const hit = this.pickObject(e);
        BT.select(hit ? hit.object.userData.btObj : null);
      } else if (wasRightClick && BT.state.mode === "object") {
        const hit = this.pickObject(e);
        const obj = hit ? hit.object.userData.btObj : null;
        if (obj) BT.select(obj);
        BT.UI.showContextMenu(e.clientX, e.clientY, obj);
      }
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey && BT.state.mode !== "object") return; // brush resize, sculpt.js handles it
      this.cam.dist = BT.clamp(this.cam.dist * Math.pow(0.95, -e.deltaY / 53), 0.2, 200);
    }, { passive: false });
  },
};
