/* Render mode: a progressive GPU path tracer (shaders in render-shaders.js).
   The scene's triangles and a BVH are packed into float textures and a
   fragment shader traces full light paths (sun with soft shadows, sky,
   diffuse bounces, metal reflection, glass refraction, glowing emitters
   sampled as real lights). Every frame adds one sample per pixel; orbiting
   restarts the accumulation, so it behaves like a live rendered viewport.
   Entering/leaving the "render" mode opens/closes it. Needs WebGL2 + float
   render targets. */
"use strict";

BT.Render = {
  _renderer: null,
  _canvas: null,
  _running: false,
  _paused: false,
  _samples: 0,
  _t0: 0,
  _rtA: null, _rtB: null, _rtOpts: null,
  _traceScene: null, _traceMat: null,
  _viewScene: null, _viewMat: null,
  _quadCam: null,
  _texes: [],
  _camSig: "",
  _onResize: null,

  SUN_COLORS: {
    day: [2.6, 2.35, 2.0],
    sunset: [3.0, 1.7, 0.95],
    night: [0.3, 0.36, 0.55],
    solid: [2.6, 2.35, 2.0],
  },

  // everything the render panel drives; persisted per project in the
  // autosave payload. `settings` is a live copy cloned from DEFAULTS below.
  DEFAULTS: {
    target: 1000,      // stop refining at this many samples, 0 = keep going
    bounces: 5,
    resScale: 1,       // 0.5 | 1 | 2 of the window size
    resW: 0, resH: 0,  // explicit render size in pixels, 0 = follow the window
    sunElev: 54, sunAzim: 56, sunStrength: 1, // ~ the old sun at (3,5,2)
    sky: "day",        // day | sunset | night | solid
    skyColor: "#0e1220",
    bgTransparent: false,
    ground: true,
    exposure: 1,
    aperture: 0, focus: 0, // focus 0 = the orbit target distance
  },
  settings: null, // assigned right after this object literal

  init() {
    BT.on("mode", (m) => {
      if (m === "render") this.open();
      else if (this._running) this.close();
    });
    // undo/redo/paste while rendering: rebuild so the image tracks the scene
    BT.on("history", () => this.refreshScene());
  },

  open() {
    if (this._running) return;
    const built = this._buildSceneData();
    if (!built) { this._bail(); return; }

    const canvas = document.getElementById("render-canvas");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: false });
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      for (const t of built.texes) t.dispose();
      BT.emit("toast", "this browser cannot run the ray tracer (WebGL2 needed)");
      this._bail();
      return;
    }
    this._canvas = canvas;
    canvas.hidden = false;
    BT.Viewport.paused = true;
    this._texes = built.texes;
    this._renderer = renderer;
    renderer.setPixelRatio(1);

    const size = this._size();
    renderer.setSize(size.w, size.h, false);

    const floatOK = !!renderer.extensions.get("EXT_color_buffer_float");
    this._rtOpts = {
      type: floatOK ? THREE.FloatType : THREE.HalfFloatType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    };
    this._rtA = new THREE.WebGLRenderTarget(size.w, size.h, this._rtOpts);
    this._rtB = new THREE.WebGLRenderTarget(size.w, size.h, this._rtOpts);
    renderer.setClearColor(0x000000, 0);

    this._traceMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uTris: { value: built.triTex },
        uBVH: { value: built.bvhTex },
        uLights: { value: built.lightTex },
        uLightCount: { value: built.lightCount },
        uTriTexW: { value: built.triTexW },
        uBVHTexW: { value: built.bvhTexW },
        uLightTexW: { value: built.lightTexW },
        uPrev: { value: null },
        uFrame: { value: 0 },
        uRes: { value: new THREE.Vector2(size.w, size.h) },
        uCamPos: { value: new THREE.Vector3() },
        uCamRight: { value: new THREE.Vector3() },
        uCamUp: { value: new THREE.Vector3() },
        uCamFwd: { value: new THREE.Vector3() },
        uTanFov: { value: Math.tan(BT.Viewport.camera.fov * 0.5 * Math.PI / 180) },
        uAspect: { value: size.w / size.h },
        uBounces: { value: this.settings.bounces },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Vector3() },
        uSkyMode: { value: 0 },
        uSkyColor: { value: new THREE.Vector3() },
        uBgTransparent: { value: false },
        uAperture: { value: 0 },
        uFocusDist: { value: BT.Viewport.cam.dist },
      },
      vertexShader: BT.RenderShaders.VERT,
      fragmentShader: BT.RenderShaders.TRACE_FRAG,
    });
    this._viewMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uAccum: { value: null }, uExposure: { value: 1 }, uTransparent: { value: false } },
      vertexShader: BT.RenderShaders.VERT,
      fragmentShader: BT.RenderShaders.VIEW_FRAG,
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    const traceMesh = new THREE.Mesh(quad, this._traceMat);
    traceMesh.frustumCulled = false;
    const viewMesh = new THREE.Mesh(quad.clone(), this._viewMat);
    viewMesh.frustumCulled = false;
    this._traceScene = new THREE.Scene();
    this._traceScene.add(traceMesh);
    this._viewScene = new THREE.Scene();
    this._viewScene.add(viewMesh);
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

    this._running = true;
    this._paused = false;
    this._updateCamera();
    this._applyUniforms();
    this._resetAccum();

    this._onResize = () => { if (this._running) this._recreateTargets(); };
    window.addEventListener("resize", this._onResize);

    const loop = () => {
      if (!this._running) return;
      requestAnimationFrame(loop);
      this._step();
    };
    loop();
  },

  close() {
    if (!this._renderer) return;
    this._running = false;
    if (this._onResize) { window.removeEventListener("resize", this._onResize); this._onResize = null; }
    document.getElementById("render-canvas").hidden = true;
    BT.Viewport.paused = false;
    if (this._rtA) { this._rtA.dispose(); this._rtB.dispose(); this._rtA = this._rtB = null; }
    for (const t of this._texes) t.dispose();
    this._texes = [];
    if (this._traceMat) { this._traceMat.dispose(); this._viewMat.dispose(); this._traceMat = this._viewMat = null; }
    this._renderer.dispose();
    this._renderer = null;
    this._traceScene = this._viewScene = null;
    this._camSig = "";
  },

  // open() failed: fall back to object mode after the mode listeners finish
  _bail() {
    setTimeout(() => { if (BT.state.mode === "render") BT.setMode("object"); }, 0);
  },

  _size() {
    const s = this.settings;
    if (s.resW && s.resH) {
      return {
        w: Math.min(4096, Math.max(64, Math.round(s.resW))),
        h: Math.min(4096, Math.max(64, Math.round(s.resH))),
      };
    }
    const cw = this._canvas && this._canvas.clientWidth || window.innerWidth;
    const ch = this._canvas && this._canvas.clientHeight || window.innerHeight;
    return {
      w: Math.min(4096, Math.max(1, Math.round(cw * s.resScale))),
      h: Math.min(4096, Math.max(1, Math.round(ch * s.resScale))),
    };
  },

  // ---- the per-frame loop ---------------------------------------------------------

  _sig() {
    const c = BT.Viewport.cam;
    return c.theta + "," + c.phi + "," + c.dist + "," + c.target.x + "," + c.target.y + "," + c.target.z + "," + BT.Viewport.camera.fov;
  },

  _step() {
    // the viewport loop is paused, so track its orbit state ourselves:
    // any camera change restarts the accumulation (the BVH stays)
    if (this._sig() !== this._camSig) {
      this._updateCamera();
      this._resetAccum();
    }
    if (this._paused) return;

    const r = this._renderer;
    this._traceMat.uniforms.uFrame.value = this._samples;
    this._traceMat.uniforms.uPrev.value = this._rtA.texture;
    r.setRenderTarget(this._rtB);
    r.render(this._traceScene, this._quadCam);
    r.setRenderTarget(null);
    this._viewMat.uniforms.uAccum.value = this._rtB.texture;
    r.render(this._viewScene, this._quadCam);
    const t = this._rtA; this._rtA = this._rtB; this._rtB = t;
    this._samples++;

    if (this.settings.target && this._samples >= this.settings.target) {
      this._paused = true;
      this._syncPauseBtn();
    }
    this._updateProgress();
  },

  _updateCamera() {
    const vp = BT.Viewport;
    vp._applyCamera();
    vp.camera.updateMatrixWorld();
    const e = vp.camera.matrixWorld.elements;
    const u = this._traceMat.uniforms;
    u.uCamPos.value.copy(vp.camera.position);
    u.uCamRight.value.set(e[0], e[1], e[2]);
    u.uCamUp.value.set(e[4], e[5], e[6]);
    u.uCamFwd.value.set(-e[8], -e[9], -e[10]);
    u.uTanFov.value = Math.tan(vp.camera.fov * 0.5 * Math.PI / 180);
    u.uFocusDist.value = this.settings.focus > 0 ? this.settings.focus : vp.cam.dist;
    this._camSig = this._sig();
  },

  _resetAccum() {
    const r = this._renderer;
    r.setRenderTarget(this._rtA); r.clear();
    r.setRenderTarget(this._rtB); r.clear();
    r.setRenderTarget(null);
    this._samples = 0;
    this._t0 = performance.now();
    if (this._paused) { this._paused = false; this._syncPauseBtn(); }
  },

  _recreateTargets() {
    const size = this._size();
    this._rtA.dispose(); this._rtB.dispose();
    this._rtA = new THREE.WebGLRenderTarget(size.w, size.h, this._rtOpts);
    this._rtB = new THREE.WebGLRenderTarget(size.w, size.h, this._rtOpts);
    this._renderer.setSize(size.w, size.h, false);
    const u = this._traceMat.uniforms;
    u.uRes.value.set(size.w, size.h);
    u.uAspect.value = size.w / size.h;
    this._resetAccum();
  },

  // ---- settings --------------------------------------------------------------------

  // the panel calls this after writing settings[key]; everything is a
  // uniform, so no setting ever recompiles a shader
  applySettings(key) {
    BT.IO.scheduleSave();
    if (!this._running) return;
    if (key === "target") { // just moves the stopping point, the samples stay
      if (this._paused && (!this.settings.target || this._samples < this.settings.target)) {
        this._paused = false;
        this._syncPauseBtn();
      }
      this._updateProgress();
      return;
    }
    if (key === "resScale") { this._recreateTargets(); return; }
    if (key === "ground") { this.refreshScene(); return; }
    this._applyUniforms();
    if (key === "exposure") { this._redrawView(); return; } // view-only, keep the samples
    this._resetAccum();
  },

  _redrawView() {
    this._viewMat.uniforms.uAccum.value = this._rtA.texture;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._viewScene, this._quadCam);
  },

  _applyUniforms() {
    const s = this.settings;
    const u = this._traceMat.uniforms;
    u.uBounces.value = s.bounces;
    const el = s.sunElev * Math.PI / 180, az = s.sunAzim * Math.PI / 180;
    u.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    const sc = this.SUN_COLORS[s.sky] || this.SUN_COLORS.day;
    u.uSunColor.value.set(sc[0], sc[1], sc[2]).multiplyScalar(s.sunStrength);
    u.uSkyMode.value = { day: 0, sunset: 1, night: 2, solid: 3 }[s.sky] || 0;
    const skyC = new THREE.Color(s.skyColor).convertSRGBToLinear();
    u.uSkyColor.value.set(skyC.r, skyC.g, skyC.b);
    u.uBgTransparent.value = s.bgTransparent;
    u.uAperture.value = s.aperture;
    u.uFocusDist.value = s.focus > 0 ? s.focus : BT.Viewport.cam.dist;
    this._viewMat.uniforms.uExposure.value = s.exposure;
    this._viewMat.uniforms.uTransparent.value = s.bgTransparent;
    this._canvas.classList.toggle("alpha", s.bgTransparent);
  },

  // repack the scene (ground toggle, undo/redo) without touching the shaders
  refreshScene() {
    if (!this._running) return;
    const old = this._texes;
    const built = this._buildSceneData();
    if (!built) { this._bail(); return; }
    this._texes = built.texes;
    for (const t of old) t.dispose();
    const u = this._traceMat.uniforms;
    u.uTris.value = built.triTex;
    u.uBVH.value = built.bvhTex;
    u.uLights.value = built.lightTex;
    u.uLightCount.value = built.lightCount;
    this._resetAccum();
  },

  togglePause() {
    this._paused = !this._paused;
    // resuming past the sample target means "keep refining"
    if (!this._paused && this.settings.target && this._samples >= this.settings.target) {
      this.settings.target = 0;
      const chips = document.getElementById("rd-target");
      if (chips) chips.querySelectorAll(".chip").forEach((c) =>
        c.setAttribute("aria-pressed", String(c.dataset.v === "0")));
      BT.IO.scheduleSave();
    }
    this._syncPauseBtn();
    this._updateProgress();
  },

  savePNG() {
    if (!this._renderer) return;
    // draw once more so the canvas is fresh in this same task, then grab it
    this._redrawView();
    const a = document.createElement("a");
    a.href = this._renderer.domElement.toDataURL("image/png");
    a.download = "blendtinux-render.png";
    a.click();
  },

  _updateProgress() {
    const el = document.getElementById("rd-progress");
    if (!el) return;
    const secs = (performance.now() - this._t0) / 1000;
    const time = secs < 90 ? Math.round(secs) + "s" : (secs / 60).toFixed(1) + "min";
    el.textContent = this._samples.toLocaleString() +
      (this.settings.target ? " / " + this.settings.target.toLocaleString() : "") +
      " samples · " + time + (this._paused ? " · paused" : "");
  },

  _syncPauseBtn() {
    const b = document.getElementById("rd-pause");
    if (b) b.textContent = this._paused ? "Resume" : "Pause";
  },

  // ---- scene packing -----------------------------------------------------------

  _buildSceneData() {
    const objs = BT.state.objects.filter((o) => o.mesh.visible);
    if (!objs.length) { BT.emit("toast", "nothing to render yet"); return null; }

    // gather world-space triangles
    const tris = []; // {p:[9], n:[9], c:[9], kind, rough, emis, metal, dens, flat}
    const v = new THREE.Vector3();
    for (const obj of objs) {
      obj.mesh.updateMatrixWorld();
      const m = obj.mesh.matrixWorld;
      const nm = new THREE.Matrix3().getNormalMatrix(m);
      const g = obj.mesh.geometry;
      const pos = g.getAttribute("position").array;
      const nor = g.getAttribute("normal").array;
      const colAttr = g.getAttribute("color");
      const idx = g.index.array;
      const em = BT.Mesh.effectiveMat(obj.finish, obj.rough, obj.metal, obj.emit);
      const base = new THREE.Color(obj.color).convertSRGBToLinear();
      const kind = em.kind, rough = em.roughness;
      const metal = em.metalness || 0, dens = em.density || 0;
      const pat = em.pattern || 0;
      const emis = em.emissive ? em.emissive * 2.4 : 0;
      for (let f = 0; f < idx.length; f += 3) {
        const t = { p: [], n: [], c: [], kind, rough, emis, metal, dens, pat, flat: obj.flat ? 1 : 0 };
        for (let k = 0; k < 3; k++) {
          const vi = idx[f + k];
          v.fromArray(pos, vi * 3).applyMatrix4(m);
          t.p.push(v.x, v.y, v.z);
          v.fromArray(nor, vi * 3).applyMatrix3(nm).normalize();
          t.n.push(v.x, v.y, v.z);
          if (colAttr) t.c.push(colAttr.array[vi * 3], colAttr.array[vi * 3 + 1], colAttr.array[vi * 3 + 2]);
          else t.c.push(base.r, base.g, base.b);
        }
        tris.push(t);
      }
    }
    if (tris.length > 400000) { BT.emit("toast", "scene too heavy to ray trace (400k triangles max)"); return null; }

    // studio ground
    if (this.settings.ground) {
      const G = 60, gc = [0.055, 0.055, 0.062];
      const ground = [
        { p: [-G, 0, -G, -G, 0, G, G, 0, G], n: [0, 1, 0, 0, 1, 0, 0, 1, 0], c: [...gc, ...gc, ...gc], kind: 0, rough: 0.85, emis: 0, metal: 0, dens: 0, pat: 0, flat: 1 },
        { p: [-G, 0, -G, G, 0, G, G, 0, -G], n: [0, 1, 0, 0, 1, 0, 0, 1, 0], c: [...gc, ...gc, ...gc], kind: 0, rough: 0.85, emis: 0, metal: 0, dens: 0, pat: 0, flat: 1 },
      ];
      for (const t of ground) tris.push(t);
    }

    // BVH over triangle centroids, leaves get contiguous runs
    const order = tris.map((_, i) => i);
    const cent = new Float32Array(tris.length * 3);
    const bMin = new Float32Array(tris.length * 3), bMax = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      const p = tris[i].p;
      for (let a = 0; a < 3; a++) {
        const x = p[a], y = p[3 + a], z = p[6 + a];
        bMin[i * 3 + a] = Math.min(x, y, z);
        bMax[i * 3 + a] = Math.max(x, y, z);
        cent[i * 3 + a] = (x + y + z) / 3;
      }
    }
    const nodes = []; // {min:[3], max:[3], a, b} a<0 -> leaf(start=-a-1,count=b) else children(a=self+1 handled via explicit, b=right)
    const build = (lo, hi) => {
      const ni = nodes.length;
      const node = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], a: 0, b: 0 };
      nodes.push(node);
      for (let i = lo; i < hi; i++) {
        const t = order[i];
        for (let a = 0; a < 3; a++) {
          node.min[a] = Math.min(node.min[a], bMin[t * 3 + a]);
          node.max[a] = Math.max(node.max[a], bMax[t * 3 + a]);
        }
      }
      if (hi - lo <= 4) {
        node.a = -(lo + 1);
        node.b = hi - lo;
        return ni;
      }
      let axis = 0, best = -1;
      for (let a = 0; a < 3; a++) {
        const s = node.max[a] - node.min[a];
        if (s > best) { best = s; axis = a; }
      }
      const sub = order.slice(lo, hi).sort((x, y) => cent[x * 3 + axis] - cent[y * 3 + axis]);
      for (let i = 0; i < sub.length; i++) order[lo + i] = sub[i];
      const mid = (lo + hi) >> 1;
      build(lo, mid); // left child is ni + 1 by construction
      node.b = build(mid, hi);
      node.a = ni + 1;
      return ni;
    };
    build(0, tris.length);

    // pack triangles (in BVH order) into a float texture, 9 texels each
    const TW = 2048;
    const triTexH = Math.ceil(tris.length * 9 / TW);
    const triData = new Float32Array(TW * triTexH * 4);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[order[i]];
      const o = i * 9 * 4;
      const put = (slot, x, y, z, w) => {
        triData[o + slot * 4] = x; triData[o + slot * 4 + 1] = y;
        triData[o + slot * 4 + 2] = z; triData[o + slot * 4 + 3] = w;
      };
      put(0, t.p[0], t.p[1], t.p[2], t.kind);
      put(1, t.p[3], t.p[4], t.p[5], t.rough);
      put(2, t.p[6], t.p[7], t.p[8], t.emis);
      put(3, t.n[0], t.n[1], t.n[2], t.flat);
      put(4, t.n[3], t.n[4], t.n[5], t.metal);
      put(5, t.n[6], t.n[7], t.n[8], t.dens);
      put(6, t.c[0], t.c[1], t.c[2], t.pat);
      put(7, t.c[3], t.c[4], t.c[5], 0);
      put(8, t.c[6], t.c[7], t.c[8], 0);
    }
    const triTex = new THREE.DataTexture(triData, TW, triTexH, THREE.RGBAFormat, THREE.FloatType);
    triTex.needsUpdate = true;

    const bvhTexH = Math.ceil(nodes.length * 2 / TW);
    const bvhData = new Float32Array(TW * bvhTexH * 4);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], o = i * 2 * 4;
      bvhData[o] = n.min[0]; bvhData[o + 1] = n.min[1]; bvhData[o + 2] = n.min[2]; bvhData[o + 3] = n.a;
      bvhData[o + 4] = n.max[0]; bvhData[o + 5] = n.max[1]; bvhData[o + 6] = n.max[2]; bvhData[o + 7] = n.b;
    }
    const bvhTex = new THREE.DataTexture(bvhData, TW, bvhTexH, THREE.RGBAFormat, THREE.FloatType);
    bvhTex.needsUpdate = true;

    // glowing triangles become explicit lights: (index in BVH order, area)
    const lights = [];
    for (let i = 0; i < tris.length; i++) {
      const t = tris[order[i]];
      if (t.emis <= 0) continue;
      const e1x = t.p[3] - t.p[0], e1y = t.p[4] - t.p[1], e1z = t.p[5] - t.p[2];
      const e2x = t.p[6] - t.p[0], e2y = t.p[7] - t.p[1], e2z = t.p[8] - t.p[2];
      const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
      const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (area > 1e-8) lights.push(i, area);
    }
    const lightCount = lights.length / 2;
    const lightTexH = Math.max(1, Math.ceil(lightCount / TW));
    const lightData = new Float32Array(TW * lightTexH * 4);
    for (let i = 0; i < lightCount; i++) {
      lightData[i * 4] = lights[i * 2];
      lightData[i * 4 + 1] = lights[i * 2 + 1];
    }
    const lightTex = new THREE.DataTexture(lightData, TW, lightTexH, THREE.RGBAFormat, THREE.FloatType);
    lightTex.needsUpdate = true;

    return {
      triTex, bvhTex, lightTex, lightCount,
      triTexW: TW, bvhTexW: TW, lightTexW: TW,
      texes: [triTex, bvhTex, lightTex],
    };
  },
};

BT.Render.settings = Object.assign({}, BT.Render.DEFAULTS);
