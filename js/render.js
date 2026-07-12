/* Ray-traced render mode: a progressive GPU path tracer. The scene's
   triangles and a BVH are packed into float textures and a fragment shader
   traces full light paths (sun with soft shadows, sky, diffuse bounces,
   metal reflection, glass refraction, glowing emitters). Every frame adds
   one sample per pixel and accumulates, so quality keeps climbing the
   longer it runs. Needs WebGL2 + float render targets. */
"use strict";

BT.Render = {
  _renderer: null,
  _running: false,
  _samples: 0,
  _t0: 0,
  _rtA: null, _rtB: null,
  _traceScene: null, _traceMat: null,
  _viewScene: null, _viewMat: null,
  _quadCam: null,
  _texes: [],

  SUN_DIR: new THREE.Vector3(3, 5, 2).normalize(),

  open() {
    const built = this._buildSceneData();
    if (!built) return;

    const overlay = document.getElementById("render-overlay");
    const canvas = document.getElementById("render-canvas");
    overlay.hidden = false;
    BT.Viewport.paused = true;

    const W = Math.min(window.innerWidth, 1920);
    const H = Math.min(window.innerHeight, 1080);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      this.close();
      BT.emit("toast", "this browser cannot run the ray tracer (WebGL2 needed)");
      return;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    this._renderer = renderer;

    const floatOK = !!renderer.extensions.get("EXT_color_buffer_float");
    const rtOpts = {
      type: floatOK ? THREE.FloatType : THREE.HalfFloatType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    };
    this._rtA = new THREE.WebGLRenderTarget(W, H, rtOpts);
    this._rtB = new THREE.WebGLRenderTarget(W, H, rtOpts);

    const cam = BT.Viewport.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;

    // start the accumulators at zero
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this._rtA);
    renderer.clear();
    renderer.setRenderTarget(this._rtB);
    renderer.clear();
    renderer.setRenderTarget(null);

    this._traceMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uTris: { value: built.triTex },
        uBVH: { value: built.bvhTex },
        uTriTexW: { value: built.triTexW },
        uBVHTexW: { value: built.bvhTexW },
        uPrev: { value: null },
        uFrame: { value: 0 },
        uRes: { value: new THREE.Vector2(W, H) },
        uCamPos: { value: cam.position.clone() },
        uCamRight: { value: new THREE.Vector3(e[0], e[1], e[2]) },
        uCamUp: { value: new THREE.Vector3(e[4], e[5], e[6]) },
        uCamFwd: { value: new THREE.Vector3(-e[8], -e[9], -e[10]) },
        uTanFov: { value: Math.tan(cam.fov * 0.5 * Math.PI / 180) },
        uAspect: { value: W / H },
        uSunDir: { value: this.SUN_DIR.clone() },
      },
      vertexShader: this.VERT,
      fragmentShader: this.TRACE_FRAG,
    });
    this._viewMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uAccum: { value: null } },
      vertexShader: this.VERT,
      fragmentShader: this.VIEW_FRAG,
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

    this._samples = 0;
    this._t0 = performance.now();
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      requestAnimationFrame(loop);
      this._step();
    };
    loop();
  },

  _step() {
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

    const secs = (performance.now() - this._t0) / 1000;
    document.getElementById("render-stats").textContent =
      this._samples.toLocaleString() + " samples · " +
      (secs < 90 ? Math.round(secs) + "s" : (secs / 60).toFixed(1) + "min");
  },

  savePNG() {
    if (!this._renderer) return;
    // draw once more so the canvas is fresh in this same task, then grab it
    this._viewMat.uniforms.uAccum.value = this._rtA.texture;
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._viewScene, this._quadCam);
    const a = document.createElement("a");
    a.href = this._renderer.domElement.toDataURL("image/png");
    a.download = "blendtinux-render.png";
    a.click();
  },

  close() {
    this._running = false;
    document.getElementById("render-overlay").hidden = true;
    BT.Viewport.paused = false;
    if (this._rtA) { this._rtA.dispose(); this._rtB.dispose(); this._rtA = this._rtB = null; }
    for (const t of this._texes) t.dispose();
    this._texes = [];
    if (this._traceMat) { this._traceMat.dispose(); this._viewMat.dispose(); this._traceMat = this._viewMat = null; }
    if (this._renderer) { this._renderer.dispose(); this._renderer = null; }
    this._traceScene = this._viewScene = null;
  },

  // ---- scene packing -----------------------------------------------------------

  _buildSceneData() {
    const objs = BT.state.objects.filter((o) => o.mesh.visible);
    if (!objs.length) { BT.emit("toast", "nothing to render yet"); return null; }

    // gather world-space triangles
    const tris = []; // {p:[9], n:[9], c:[9], kind, rough, emis, flat}
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
      const fin = BT.Mesh.FINISHES[obj.finish];
      const base = new THREE.Color(fin.tint || obj.color).convertSRGBToLinear();
      const kind = fin.kind, rough = fin.roughness;
      const emis = fin.emissive ? fin.emissive * 2.4 : 0;
      for (let f = 0; f < idx.length; f += 3) {
        const t = { p: [], n: [], c: [], kind, rough, emis, flat: obj.flat ? 1 : 0 };
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
    const G = 60, gc = [0.055, 0.055, 0.062];
    const ground = [
      { p: [-G, 0, -G, -G, 0, G, G, 0, G], n: [0, 1, 0, 0, 1, 0, 0, 1, 0], c: [...gc, ...gc, ...gc], kind: 0, rough: 0.85, emis: 0, flat: 1 },
      { p: [-G, 0, -G, G, 0, G, G, 0, -G], n: [0, 1, 0, 0, 1, 0, 0, 1, 0], c: [...gc, ...gc, ...gc], kind: 0, rough: 0.85, emis: 0, flat: 1 },
    ];
    for (const t of ground) tris.push(t);

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
      put(4, t.n[3], t.n[4], t.n[5], 0);
      put(5, t.n[6], t.n[7], t.n[8], 0);
      put(6, t.c[0], t.c[1], t.c[2], 0);
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

    this._texes = [triTex, bvhTex];
    return { triTex, bvhTex, triTexW: TW, bvhTexW: TW };
  },

  // ---- shaders -------------------------------------------------------------------

  VERT: [
    "precision highp float;",
    "in vec3 position;",
    "in vec2 uv;",
    "out vec2 vUv;",
    "void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  ].join("\n"),

  TRACE_FRAG: `
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTris, uBVH, uPrev;
uniform int uTriTexW, uBVHTexW, uFrame;
uniform vec2 uRes;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd, uSunDir;
uniform float uTanFov, uAspect;

uint seed;
float rnd() {
  seed = seed * 747796405u + 2891336453u;
  uint t = ((seed >> ((seed >> 28u) + 4u)) ^ seed) * 277803737u;
  t = (t >> 22u) ^ t;
  return float(t) / 4294967295.0;
}

vec4 triTexel(int i) {
  return texelFetch(uTris, ivec2(i % uTriTexW, i / uTriTexW), 0);
}
vec4 bvhTexel(int i) {
  return texelFetch(uBVH, ivec2(i % uBVHTexW, i / uBVHTexW), 0);
}

float rayBox(vec3 ro, vec3 inv, vec3 bmin, vec3 bmax, float tMax) {
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 lo = min(t0, t1), hi = max(t0, t1);
  float tn = max(max(lo.x, lo.y), lo.z);
  float tf = min(min(hi.x, hi.y), hi.z);
  return (tf >= max(tn, 0.0) && tn < tMax) ? tn : 1e30;
}

// Moller-Trumbore, both sides
float rayTri(vec3 ro, vec3 rd, vec3 a, vec3 b, vec3 c, out float u, out float v) {
  vec3 e1 = b - a, e2 = c - a;
  vec3 p = cross(rd, e2);
  float det = dot(e1, p);
  if (abs(det) < 1e-9) return 1e30;
  float inv = 1.0 / det;
  vec3 s = ro - a;
  u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) return 1e30;
  vec3 q = cross(s, e1);
  v = dot(rd, q) * inv;
  if (v < 0.0 || u + v > 1.0) return 1e30;
  float t = dot(e2, q) * inv;
  return t > 1e-4 ? t : 1e30;
}

struct Hit { float t; int tri; float u; float v; };

bool traverse(vec3 ro, vec3 rd, float tMax, bool any, out Hit hit) {
  hit.t = tMax; hit.tri = -1;
  vec3 inv = 1.0 / rd;
  int stack[28];
  int sp = 0;
  stack[0] = 0;
  while (sp >= 0) {
    int ni = stack[sp--];
    vec4 A = bvhTexel(ni * 2);
    vec4 B = bvhTexel(ni * 2 + 1);
    if (rayBox(ro, inv, A.xyz, B.xyz, hit.t) >= hit.t) continue;
    if (A.w < 0.0) {
      int start = int(-A.w) - 1;
      int count = int(B.w);
      for (int k = 0; k < count; k++) {
        int ti = (start + k) * 9;
        vec3 pa = triTexel(ti).xyz, pb = triTexel(ti + 1).xyz, pc = triTexel(ti + 2).xyz;
        float u, v;
        float t = rayTri(ro, rd, pa, pb, pc, u, v);
        if (t < hit.t) {
          hit.t = t; hit.tri = start + k; hit.u = u; hit.v = v;
          if (any) return true;
        }
      }
    } else {
      if (sp < 26) {
        stack[++sp] = int(A.w);
        stack[++sp] = int(B.w);
      }
    }
  }
  return hit.tri >= 0;
}

vec3 sky(vec3 d, bool spec) {
  float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 s = mix(vec3(0.045, 0.045, 0.055), vec3(0.30, 0.36, 0.50), pow(t, 1.4));
  if (spec) s += vec3(10.0, 9.0, 7.4) * smoothstep(0.9993, 0.9999, dot(d, uSunDir)) * 90.0;
  return s;
}

vec3 cosineDir(vec3 n) {
  float r1 = rnd(), r2 = rnd();
  float phi = 6.2831853 * r1;
  float sr = sqrt(r2);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0, 1, 0)) : cross(n, vec3(1, 0, 0)));
  vec3 b = cross(n, t);
  return normalize(t * (cos(phi) * sr) + b * (sin(phi) * sr) + n * sqrt(1.0 - r2));
}

vec3 sphereDir() {
  float z = rnd() * 2.0 - 1.0;
  float phi = 6.2831853 * rnd();
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(phi), r * sin(phi), z);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  seed = uint(px.x) * 1973u + uint(px.y) * 9277u + uint(uFrame) * 26699u + 1u;

  vec2 jitter = vec2(rnd(), rnd());
  vec2 ndc = ((vec2(px) + jitter) / uRes) * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uTanFov * uAspect + uCamUp * ndc.y * uTanFov);
  vec3 ro = uCamPos;

  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  bool specBounce = true;

  for (int bounce = 0; bounce < 6; bounce++) {
    Hit hit;
    if (!traverse(ro, rd, 1e30, false, hit)) {
      radiance += throughput * sky(rd, specBounce);
      break;
    }

    int ti = hit.tri * 9;
    vec4 t0 = triTexel(ti), t1 = triTexel(ti + 1), t2 = triTexel(ti + 2);
    vec4 t3 = triTexel(ti + 3), t4 = triTexel(ti + 4), t5 = triTexel(ti + 5);
    int kind = int(t0.w);
    float rough = t1.w;
    float emis = t2.w;
    float w0 = 1.0 - hit.u - hit.v;
    vec3 albedo = triTexel(ti + 6).rgb * w0 + triTexel(ti + 7).rgb * hit.u + triTexel(ti + 8).rgb * hit.v;
    vec3 n;
    if (t3.w > 0.5) n = normalize(cross(t1.xyz - t0.xyz, t2.xyz - t0.xyz));
    else n = normalize(t3.xyz * w0 + t4.xyz * hit.u + t5.xyz * hit.v);
    bool inside = dot(n, rd) > 0.0;
    if (inside) n = -n;

    vec3 p = ro + rd * hit.t;

    if (emis > 0.0) radiance += throughput * albedo * emis;

    if (kind == 2) { // glass
      float ior = inside ? 1.5 : 1.0 / 1.5;
      float cosi = -dot(rd, n);
      float f0 = 0.04;
      float fres = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
      vec3 refr = refract(rd, n, ior);
      vec3 dir;
      if (length(refr) < 0.5 || rnd() < fres) dir = reflect(rd, n);
      else { dir = refr; throughput *= mix(albedo, vec3(1.0), 0.5); }
      dir = normalize(dir + sphereDir() * rough * 0.35);
      ro = p + dir * 1e-4;
      rd = dir;
      specBounce = true;
      continue;
    }

    bool doSpec = false;
    if (kind == 1) doSpec = true; // metal
    else if (kind == 0 || kind == 3) {
      float cosi = -dot(rd, n);
      float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
      doSpec = rnd() < fres * (1.0 - rough); // plastic coat
    }

    if (doSpec) {
      vec3 dir = normalize(reflect(rd, n) + sphereDir() * rough * rough);
      if (dot(dir, n) <= 0.0) dir = reflect(rd, n);
      if (kind == 1) throughput *= albedo;
      ro = p + n * 1e-4;
      rd = dir;
      specBounce = true;
    } else {
      // direct sun with soft shadows
      vec3 sd = normalize(uSunDir + sphereDir() * 0.012);
      float ndl = dot(n, sd);
      if (ndl > 0.0) {
        Hit sh;
        if (!traverse(p + n * 1e-4, sd, 1e30, true, sh)) {
          radiance += throughput * albedo * ndl * vec3(2.6, 2.35, 2.0);
        }
      }
      throughput *= albedo;
      ro = p + n * 1e-4;
      rd = cosineDir(n);
      specBounce = false;
    }

    // russian roulette
    if (bounce > 2) {
      float q = max(throughput.r, max(throughput.g, throughput.b));
      if (rnd() > q) break;
      throughput /= max(q, 1e-4);
    }
  }

  radiance = clamp(radiance, 0.0, 60.0);
  vec4 prev = texelFetch(uPrev, px, 0);
  outColor = vec4(prev.rgb + radiance, prev.a + 1.0);
}
`,

  VIEW_FRAG: `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAccum;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 acc = texelFetch(uAccum, ivec2(gl_FragCoord.xy), 0);
  vec3 c = acc.rgb / max(acc.a, 1.0);
  c = aces(c * 1.15);
  c = pow(c, vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}
`,
};
