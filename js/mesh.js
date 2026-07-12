/* Geometry domain. Every mesh is a welded, indexed triangle mesh described by
   plain data {pos: Float32Array, idx: Uint32Array, col: Float32Array|null,
   quad: Int32Array|null}. `quad` pairs triangles into squares (quad[f] = the
   partner triangle of f, or -1): the GPU still draws triangles, but tools
   think in quads like Blender does. Loop cut walks quad rings, subdivision
   splits squares into 4 squares (Catmull-Clark when smoothing), wireframes
   hide the quad diagonals. Welding removes the duplicated seam vertices
   THREE primitives ship with. UVs are dropped on purpose. Vertex colors are
   stored linear. */
"use strict";

BT.Mesh = {

  /* Viewport look for each finish; the ray tracer maps them to real BSDFs
     (kind: 0 diffuse/coat, 1 metal, 2 glass, 3 glow). `pattern` is procedural
     grain the ray tracer shades into the surface (1 wood, 2 stone, 3 marble).
     `tint` is only a suggested color: picking the chip sets it, the color
     picker keeps working afterwards. */
  FINISHES: {
    matte:   { metalness: 0, roughness: 0.9,  kind: 0 },
    plastic: { metalness: 0, roughness: 0.3,  kind: 0 },
    ceramic: { metalness: 0, roughness: 0.12, kind: 0 },
    wood:    { metalness: 0, roughness: 0.62, kind: 0, pattern: 1, tint: "#9a6a43" },
    stone:   { metalness: 0, roughness: 0.85, kind: 0, pattern: 2, tint: "#8f8d88" },
    marble:  { metalness: 0, roughness: 0.18, kind: 0, pattern: 3, tint: "#e6e3dd" },
    metal:   { metalness: 1, roughness: 0.35, kind: 1 },
    chrome:  { metalness: 1, roughness: 0.05, kind: 1 },
    gold:    { metalness: 1, roughness: 0.2,  kind: 1, tint: "#e8b34a" },
    copper:  { metalness: 1, roughness: 0.25, kind: 1, tint: "#c97a4e" },
    glass:   { metalness: 0, roughness: 0.04, kind: 2, opacity: 0.35, density: 0.8 },
    frosted: { metalness: 0, roughness: 0.45, kind: 2, opacity: 0.55, density: 0.35 },
    glow:    { metalness: 0, roughness: 0.6,  kind: 3, emissive: 1.4 },
  },
  // finishes from older saves map onto the closest current one
  FINISH_ALIASES: { glossy: "plastic", satin: "plastic", brushed: "metal", mirror: "chrome", tinted: "glass", neon: "glow" },
  normalizeFinish(f) { return this.FINISHES[f] ? f : (this.FINISH_ALIASES[f] || "matte"); },
  DEFAULT_COLOR: "#b8b0a6",

  _applyFinish(material, finish, colorHex, hasVertexColors) {
    const fin = this.FINISHES[finish];
    material.metalness = fin.metalness;
    material.roughness = fin.roughness;
    const wasTransparent = material.transparent;
    material.transparent = !!fin.opacity;
    material.opacity = fin.opacity || 1;
    material.depthWrite = !fin.opacity;
    if (!hasVertexColors) {
      material.color = new THREE.Color(colorHex).convertSRGBToLinear();
    }
    if (fin.emissive) {
      material.emissive = new THREE.Color(colorHex).convertSRGBToLinear();
      material.emissiveIntensity = fin.emissive;
    } else {
      material.emissive = new THREE.Color(0x000000);
      material.emissiveIntensity = 1;
    }
    if (wasTransparent !== material.transparent) material.needsUpdate = true;
  },

  // the selection highlight has to coexist with glow's emissive
  setSelectionTint(obj, on) {
    const m = obj.mesh.material;
    if (this.FINISHES[obj.finish].emissive) {
      m.emissiveIntensity = on ? 2.1 : this.FINISHES[obj.finish].emissive;
    } else {
      m.emissive.setHex(on ? 0x3a1f0a : 0x000000);
    }
  },

  // ---- weld ---------------------------------------------------------------

  /* Also returns faceMap (old face index -> new face index or -1) so quad
     pairings survive the weld. */
  weldData(pos, idx, col, quad) {
    const map = new Map();
    const remap = new Uint32Array(pos.length / 3);
    const outPos = [], outCol = col ? [] : null;
    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const key = Math.round(x * 1e5) + "_" + Math.round(y * 1e5) + "_" + Math.round(z * 1e5);
      let n = map.get(key);
      if (n === undefined) {
        n = outPos.length / 3;
        map.set(key, n);
        outPos.push(x, y, z);
        if (outCol) outCol.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
      }
      remap[v] = n;
    }
    const nFIn = idx.length / 3;
    const faceMap = new Int32Array(nFIn).fill(-1);
    const outIdx = [];
    for (let f = 0; f < nFIn; f++) {
      const a = remap[idx[f * 3]], b = remap[idx[f * 3 + 1]], c = remap[idx[f * 3 + 2]];
      if (a === b || b === c || a === c) continue;
      faceMap[f] = outIdx.length / 3;
      outIdx.push(a, b, c);
    }
    let outQuad = null;
    if (quad) {
      outQuad = new Int32Array(outIdx.length / 3).fill(-1);
      for (let f = 0; f < nFIn; f++) {
        const nf = faceMap[f], p = quad[f];
        if (nf < 0 || p < 0) continue;
        const np = faceMap[p];
        if (np >= 0) outQuad[nf] = np;
      }
      // pairs must stay mutual
      for (let f = 0; f < outQuad.length; f++) {
        const p = outQuad[f];
        if (p >= 0 && outQuad[p] !== f) outQuad[f] = -1;
      }
    }
    return {
      pos: new Float32Array(outPos),
      idx: new Uint32Array(outIdx),
      col: outCol ? new Float32Array(outCol) : null,
      quad: outQuad,
    };
  },

  /* THREE grid geometries emit each grid square as two consecutive
     triangles; pair them before welding so the quad structure survives. */
  weldThreeGeometry(g) {
    const src = g.index ? g : g.toNonIndexed();
    const pos = src.getAttribute("position").array;
    let idx;
    if (src.index) idx = src.index.array;
    else { idx = new Uint32Array(pos.length / 3); for (let i = 0; i < idx.length; i++) idx[i] = i; }
    const nF = idx.length / 3;
    const quad = new Int32Array(nF).fill(-1);
    for (let f = 0; f + 1 < nF; f += 2) {
      const t1 = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
      const t2 = [idx[f * 3 + 3], idx[f * 3 + 4], idx[f * 3 + 5]];
      let shared = 0;
      for (const v of t1) if (t2.indexOf(v) >= 0) shared++;
      if (shared === 2) { quad[f] = f + 1; quad[f + 1] = f; }
    }
    const data = this.weldData(pos, idx, null, quad);
    g.dispose();
    if (src !== g) src.dispose();
    return data;
  },

  // ---- primitives ---------------------------------------------------------

  // basic shapes stay basic; "Add detail" densifies before sculpting
  createPrimitive(kind) {
    let g;
    switch (kind) {
      case "cube":     g = new THREE.BoxGeometry(1, 1, 1); break;
      case "sphere":   g = new THREE.SphereGeometry(0.6, 32, 16); break;
      case "cylinder": g = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32, 1); break;
      case "cone":     g = new THREE.ConeGeometry(0.6, 1.2, 32, 1); break;
      case "torus":    g = new THREE.TorusGeometry(0.55, 0.22, 12, 24); break;
      case "plane":    g = new THREE.PlaneGeometry(1.4, 1.4, 1, 1); g.rotateX(-Math.PI / 2); break;
      default: throw new Error("unknown primitive " + kind);
    }
    return this.weldThreeGeometry(g);
  },

  // ---- geometry build / object lifecycle ----------------------------------

  buildGeometry(data) {
    const g = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(data.pos.slice(), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", posAttr);
    if (data.col) {
      const colAttr = new THREE.BufferAttribute(data.col.slice(), 3);
      colAttr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("color", colAttr);
    }
    g.setIndex(new THREE.BufferAttribute(data.idx.slice(), 1));
    g.computeVertexNormals();
    g.getAttribute("normal").setUsage(THREE.DynamicDrawUsage);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  },

  createObject(opts) {
    const finish = this.normalizeFinish(opts.finish);
    const geometry = this.buildGeometry(opts.data);
    const material = new THREE.MeshStandardMaterial({
      flatShading: !!opts.flat,
      side: THREE.DoubleSide, // planes and inside-out sculpts stay visible
    });
    if (opts.data.col) {
      material.vertexColors = true;
      material.color.setRGB(1, 1, 1);
    }
    this._applyFinish(material, finish, opts.color || this.DEFAULT_COLOR, !!opts.data.col);
    const mesh = new THREE.Mesh(geometry, material);
    if (opts.p) mesh.position.fromArray(opts.p);
    if (opts.q) mesh.quaternion.fromArray(opts.q);
    if (opts.s) mesh.scale.fromArray(opts.s);
    const obj = {
      id: opts.id || BT.uid(),
      name: opts.name || "shape",
      mesh,
      color: opts.color || this.DEFAULT_COLOR,
      finish,
      flat: !!opts.flat,
      quadMap: opts.data.quad ? opts.data.quad.slice() : new Int32Array(opts.data.idx.length / 3).fill(-1),
      adjacency: null,
      polys: null,
    };
    mesh.userData.btObj = obj;
    return obj;
  },

  disposeObject(obj) {
    obj.mesh.geometry.dispose();
    obj.mesh.material.dispose();
    obj.adjacency = null;
    obj.polys = null;
  },

  replaceGeometry(obj, data) {
    obj.mesh.geometry.dispose();
    obj.mesh.geometry = this.buildGeometry(data);
    obj.quadMap = data.quad ? data.quad.slice() : new Int32Array(data.idx.length / 3).fill(-1);
    obj.adjacency = null;
    obj.polys = null;
    const hasCol = !!data.col;
    if (obj.mesh.material.vertexColors !== hasCol) {
      obj.mesh.material.vertexColors = hasCol;
      if (hasCol) obj.mesh.material.color = new THREE.Color(1, 1, 1);
      else this._applyFinish(obj.mesh.material, obj.finish, obj.color, false);
      obj.mesh.material.needsUpdate = true;
    }
    BT.emit("geometry", obj);
  },

  applyMaterialProps(obj, props) {
    obj.color = props.color;
    obj.finish = this.normalizeFinish(props.finish);
    obj.flat = props.flat;
    const m = obj.mesh.material;
    this._applyFinish(m, obj.finish, props.color, m.vertexColors);
    if (m.flatShading !== props.flat) { m.flatShading = props.flat; m.needsUpdate = true; }
    if (BT.state.selected === obj) this.setSelectionTint(obj, true);
    BT.emit("material", obj);
  },

  ensureColorAttribute(obj) {
    const g = obj.mesh.geometry;
    if (g.getAttribute("color")) return;
    const n = g.getAttribute("position").count;
    const c = new THREE.Color(obj.color).convertSRGBToLinear();
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("color", attr);
    obj.mesh.material.vertexColors = true;
    obj.mesh.material.color.setRGB(1, 1, 1);
    obj.mesh.material.needsUpdate = true;
  },

  geometryData(obj) {
    const g = obj.mesh.geometry;
    const col = g.getAttribute("color");
    return {
      pos: g.getAttribute("position").array.slice(),
      idx: (g.index.array instanceof Uint32Array ? g.index.array : new Uint32Array(g.index.array)).slice(),
      col: col ? col.array.slice() : null,
      quad: obj.quadMap ? obj.quadMap.slice() : null,
    };
  },

  serializeObject(obj) {
    const d = this.geometryData(obj);
    return {
      id: obj.id, name: obj.name, color: obj.color, finish: obj.finish, flat: obj.flat,
      vis: obj.mesh.visible !== false,
      p: obj.mesh.position.toArray(), q: obj.mesh.quaternion.toArray(), s: obj.mesh.scale.toArray(),
      pos: d.pos, idx: d.idx, col: d.col, quad: d.quad,
    };
  },

  deserializeObject(data) {
    const obj = this.createObject({
      id: data.id, name: data.name, color: data.color, finish: data.finish, flat: data.flat,
      p: data.p, q: data.q, s: data.s,
      data: { pos: data.pos, idx: data.idx, col: data.col, quad: data.quad || null },
    });
    if (data.vis === false) obj.mesh.visible = false;
    return obj;
  },

  vertCount(obj) { return obj.mesh.geometry.getAttribute("position").count; },

  // ---- polygon view of the mesh (quads + lone triangles) --------------------

  /* Cached per topology. polys[i] is the corner cycle (length 4 or 3) with
     the original triangle winding; polyFaces[i] lists its 1 or 2 triangles;
     faceToPoly maps triangle -> poly; edgeMap maps a canonical polygon-edge
     key to the polys that share it (quad diagonals are not polygon edges). */
  getPolys(obj) {
    if (obj.polys) return obj.polys;
    const g = obj.mesh.geometry;
    const built = this.buildPolys({
      pos: g.getAttribute("position").array,
      idx: g.index.array,
      quad: obj.quadMap,
    });
    obj.polys = built;
    return built;
  },

  buildPolys(data) {
    const idx = data.idx, quad = data.quad;
    const nF = idx.length / 3;
    const nV = data.pos.length / 3;
    const polys = [], polyFaces = [];
    const faceToPoly = new Int32Array(nF).fill(-1);
    const done = new Uint8Array(nF);
    for (let f = 0; f < nF; f++) {
      if (done[f]) continue;
      const p = quad ? quad[f] : -1;
      if (p >= 0 && quad[p] === f && !done[p]) {
        done[f] = done[p] = 1;
        const t1 = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]];
        const t2 = [idx[p * 3], idx[p * 3 + 1], idx[p * 3 + 2]];
        // shared diagonal = the two verts of t1 also in t2
        let a = -1;
        for (const v of t1) if (t2.indexOf(v) < 0) a = v;
        let c = -1;
        for (const v of t2) if (t1.indexOf(v) < 0) c = v;
        if (a < 0 || c < 0) { // not a real pair, treat as lone tris
          done[p] = 0;
          faceToPoly[f] = polys.length;
          polys.push(t1); polyFaces.push([f]);
          continue;
        }
        // rotate t1 so it reads (a, x, y): quad cycle = a, x, c, y
        let r = t1.indexOf(a);
        const x = t1[(r + 1) % 3], y = t1[(r + 2) % 3];
        faceToPoly[f] = faceToPoly[p] = polys.length;
        polys.push([a, x, c, y]);
        polyFaces.push([f, p]);
      } else {
        done[f] = 1;
        faceToPoly[f] = polys.length;
        polys.push([idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]]);
        polyFaces.push([f]);
      }
    }
    const edgeMap = new Map();
    const ekey = (u, v) => (u < v ? u * nV + v : v * nV + u);
    for (let pi = 0; pi < polys.length; pi++) {
      const cyc = polys[pi];
      for (let k = 0; k < cyc.length; k++) {
        const key = ekey(cyc[k], cyc[(k + 1) % cyc.length]);
        const rec = edgeMap.get(key);
        if (rec) rec.push(pi);
        else edgeMap.set(key, [pi]);
      }
    }
    return { polys, polyFaces, faceToPoly, edgeMap, ekey };
  },

  // triangles for a quad cycle (a,b,c,d), paired
  _emitQuad(faces, quads, a, b, c, d) {
    const f = faces.length / 3;
    faces.push(a, b, c, a, c, d);
    quads.push(f + 1, f);
  },
  _emitTri(faces, quads, a, b, c) {
    faces.push(a, b, c);
    quads.push(-1);
  },

  // ---- adjacency (CSR layout, rebuilt lazily after topology changes) -------

  getAdjacency(obj) {
    if (obj.adjacency) return obj.adjacency;
    const g = obj.mesh.geometry;
    const nV = g.getAttribute("position").count;
    const idx = g.index.array;
    const nF = idx.length / 3;

    const fCount = new Uint32Array(nV);
    for (let i = 0; i < idx.length; i++) fCount[idx[i]]++;
    const fOff = new Uint32Array(nV + 1);
    for (let v = 0; v < nV; v++) fOff[v + 1] = fOff[v] + fCount[v];
    const fList = new Uint32Array(idx.length);
    const fCursor = fOff.slice(0, nV);
    for (let f = 0; f < nF; f++) {
      fList[fCursor[idx[f * 3]]++] = f;
      fList[fCursor[idx[f * 3 + 1]]++] = f;
      fList[fCursor[idx[f * 3 + 2]]++] = f;
    }

    const edges = new Set();
    for (let f = 0; f < nF; f++) {
      const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
      edges.add(a < b ? a * nV + b : b * nV + a);
      edges.add(b < c ? b * nV + c : c * nV + b);
      edges.add(c < a ? c * nV + a : a * nV + c);
    }
    const nCount = new Uint32Array(nV);
    edges.forEach((k) => { nCount[Math.floor(k / nV)]++; nCount[k % nV]++; });
    const nOff = new Uint32Array(nV + 1);
    for (let v = 0; v < nV; v++) nOff[v + 1] = nOff[v] + nCount[v];
    const nList = new Uint32Array(nOff[nV]);
    const nCursor = nOff.slice(0, nV);
    edges.forEach((k) => {
      const a = Math.floor(k / nV), b = k % nV;
      nList[nCursor[a]++] = b;
      nList[nCursor[b]++] = a;
    });

    obj.adjacency = { fOff, fList, nOff, nList };
    return obj.adjacency;
  },

  // ---- normals ------------------------------------------------------------

  computeNormalsPartial(obj, movedIndices) {
    const g = obj.mesh.geometry;
    const adj = this.getAdjacency(obj);
    const pos = g.getAttribute("position").array;
    const nor = g.getAttribute("normal").array;
    const idx = g.index.array;

    const faceSet = new Set();
    for (let i = 0; i < movedIndices.length; i++) {
      const v = movedIndices[i];
      for (let j = adj.fOff[v]; j < adj.fOff[v + 1]; j++) faceSet.add(adj.fList[j]);
    }
    const ring = new Set();
    faceSet.forEach((f) => { ring.add(idx[f * 3]); ring.add(idx[f * 3 + 1]); ring.add(idx[f * 3 + 2]); });

    const cache = new Map();
    const faceNormal = (f) => {
      let fn = cache.get(f);
      if (fn) return fn;
      const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
      const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
      const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
      fn = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
      cache.set(f, fn);
      return fn;
    };

    ring.forEach((v) => {
      let x = 0, y = 0, z = 0;
      for (let j = adj.fOff[v]; j < adj.fOff[v + 1]; j++) {
        const fn = faceNormal(adj.fList[j]);
        x += fn[0]; y += fn[1]; z += fn[2];
      }
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      nor[v * 3] = x / len; nor[v * 3 + 1] = y / len; nor[v * 3 + 2] = z / len;
    });
    g.getAttribute("normal").needsUpdate = true;
  },

  afterVertsChanged(obj, movedIndices) {
    const g = obj.mesh.geometry;
    if (movedIndices && movedIndices.length < g.getAttribute("position").count * 0.5) {
      this.computeNormalsPartial(obj, movedIndices);
    } else {
      g.computeVertexNormals();
      g.getAttribute("normal").needsUpdate = true;
    }
    g.getAttribute("position").needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
  },


  // ---- subdivision (quad-based, Catmull-Clark when smooth) ------------------

  /* Every polygon (quad or lone triangle) becomes one sub-quad per corner:
     corner -> edge point -> face point -> other edge point. No diagonals are
     ever split, and after one round everything is quads. smooth=false keeps
     the shape (midpoints and centroids); smooth=true applies Catmull-Clark
     rules like a subsurf modifier. */
  subdivide(data, smooth) {
    if (smooth === undefined) smooth = true;
    const { polys, edgeMap, ekey } = this.buildPolys(data);
    const pos = data.pos, col = data.col;
    const nV = pos.length / 3, nP = polys.length;

    // face points
    const faceP = new Float64Array(nP * 3);
    for (let pi = 0; pi < nP; pi++) {
      const cyc = polys[pi];
      let x = 0, y = 0, z = 0;
      for (const v of cyc) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
      faceP[pi * 3] = x / cyc.length; faceP[pi * 3 + 1] = y / cyc.length; faceP[pi * 3 + 2] = z / cyc.length;
    }

    // edge indexing
    const edgeIdx = new Map();
    const edgeVerts = [];
    edgeMap.forEach((polyList, key) => {
      edgeIdx.set(key, edgeVerts.length);
      const u = Math.floor(key / nV), v = key % nV;
      edgeVerts.push([u, v, polyList]);
    });
    const nE = edgeVerts.length;

    // edge points
    const edgeP = new Float64Array(nE * 3);
    for (let e = 0; e < nE; e++) {
      const [u, v, polyList] = edgeVerts[e];
      let x = pos[u * 3] + pos[v * 3];
      let y = pos[u * 3 + 1] + pos[v * 3 + 1];
      let z = pos[u * 3 + 2] + pos[v * 3 + 2];
      if (smooth && polyList.length === 2) {
        x += faceP[polyList[0] * 3] + faceP[polyList[1] * 3];
        y += faceP[polyList[0] * 3 + 1] + faceP[polyList[1] * 3 + 1];
        z += faceP[polyList[0] * 3 + 2] + faceP[polyList[1] * 3 + 2];
        edgeP[e * 3] = x / 4; edgeP[e * 3 + 1] = y / 4; edgeP[e * 3 + 2] = z / 4;
      } else {
        edgeP[e * 3] = x / 2; edgeP[e * 3 + 1] = y / 2; edgeP[e * 3 + 2] = z / 2;
      }
    }

    // vertex points
    const vertP = new Float64Array(nV * 3);
    if (!smooth) {
      for (let i = 0; i < nV * 3; i++) vertP[i] = pos[i];
    } else {
      const fSumX = new Float64Array(nV), fSumY = new Float64Array(nV), fSumZ = new Float64Array(nV);
      const fCnt = new Uint32Array(nV);
      for (let pi = 0; pi < nP; pi++) {
        for (const v of polys[pi]) {
          fSumX[v] += faceP[pi * 3]; fSumY[v] += faceP[pi * 3 + 1]; fSumZ[v] += faceP[pi * 3 + 2];
          fCnt[v]++;
        }
      }
      const mSumX = new Float64Array(nV), mSumY = new Float64Array(nV), mSumZ = new Float64Array(nV);
      const eCnt = new Uint32Array(nV);
      const bSumX = new Float64Array(nV), bSumY = new Float64Array(nV), bSumZ = new Float64Array(nV);
      const bCnt = new Uint32Array(nV);
      for (let e = 0; e < nE; e++) {
        const [u, v, polyList] = edgeVerts[e];
        const mx = (pos[u * 3] + pos[v * 3]) / 2;
        const my = (pos[u * 3 + 1] + pos[v * 3 + 1]) / 2;
        const mz = (pos[u * 3 + 2] + pos[v * 3 + 2]) / 2;
        mSumX[u] += mx; mSumY[u] += my; mSumZ[u] += mz; eCnt[u]++;
        mSumX[v] += mx; mSumY[v] += my; mSumZ[v] += mz; eCnt[v]++;
        if (polyList.length === 1) {
          bSumX[u] += mx; bSumY[u] += my; bSumZ[u] += mz; bCnt[u]++;
          bSumX[v] += mx; bSumY[v] += my; bSumZ[v] += mz; bCnt[v]++;
        }
      }
      for (let v = 0; v < nV; v++) {
        const v3 = v * 3;
        if (bCnt[v] === 2) { // boundary: cubic B-spline rule
          vertP[v3] = (bSumX[v] + 6 * pos[v3]) / 8;
          vertP[v3 + 1] = (bSumY[v] + 6 * pos[v3 + 1]) / 8;
          vertP[v3 + 2] = (bSumZ[v] + 6 * pos[v3 + 2]) / 8;
        } else if (bCnt[v] > 0 || fCnt[v] < 3) {
          vertP[v3] = pos[v3]; vertP[v3 + 1] = pos[v3 + 1]; vertP[v3 + 2] = pos[v3 + 2];
        } else {
          const n = fCnt[v];
          vertP[v3] = (fSumX[v] / n + 2 * mSumX[v] / eCnt[v] + (n - 3) * pos[v3]) / n;
          vertP[v3 + 1] = (fSumY[v] / n + 2 * mSumY[v] / eCnt[v] + (n - 3) * pos[v3 + 1]) / n;
          vertP[v3 + 2] = (fSumZ[v] / n + 2 * mSumZ[v] / eCnt[v] + (n - 3) * pos[v3 + 2]) / n;
        }
      }
    }

    // assemble vertices: originals, edge points, face points
    const outPos = new Float32Array((nV + nE + nP) * 3);
    outPos.set(new Float32Array(vertP), 0);
    outPos.set(new Float32Array(edgeP), nV * 3);
    outPos.set(new Float32Array(faceP), (nV + nE) * 3);

    let outCol = null;
    if (col) {
      outCol = new Float32Array((nV + nE + nP) * 3);
      outCol.set(col);
      for (let e = 0; e < nE; e++) {
        const [u, v] = edgeVerts[e];
        const o = (nV + e) * 3;
        outCol[o] = (col[u * 3] + col[v * 3]) / 2;
        outCol[o + 1] = (col[u * 3 + 1] + col[v * 3 + 1]) / 2;
        outCol[o + 2] = (col[u * 3 + 2] + col[v * 3 + 2]) / 2;
      }
      for (let pi = 0; pi < nP; pi++) {
        const cyc = polys[pi], o = (nV + nE + pi) * 3;
        let r = 0, gc = 0, b = 0;
        for (const v of cyc) { r += col[v * 3]; gc += col[v * 3 + 1]; b += col[v * 3 + 2]; }
        outCol[o] = r / cyc.length; outCol[o + 1] = gc / cyc.length; outCol[o + 2] = b / cyc.length;
      }
    }

    // one sub-quad per corner of every polygon
    const faces = [], quads = [];
    for (let pi = 0; pi < nP; pi++) {
      const cyc = polys[pi];
      const k = cyc.length;
      const fv = nV + nE + pi;
      for (let i = 0; i < k; i++) {
        const vPrev = cyc[(i - 1 + k) % k], vCur = cyc[i], vNext = cyc[(i + 1) % k];
        const eNext = nV + edgeIdx.get(ekey(vCur, vNext));
        const ePrev = nV + edgeIdx.get(ekey(vPrev, vCur));
        this._emitQuad(faces, quads, vCur, eNext, fv, ePrev);
      }
    }

    return {
      pos: outPos,
      idx: new Uint32Array(faces),
      col: outCol,
      quad: Int32Array.from(quads),
    };
  },

  // ---- loop cut --------------------------------------------------------------

  /* Trace a quad ring from the hovered face. p is the hit point in local
     space. Returns null off quads; otherwise the ordered crossed edges
     (each {u, v} oriented so one t fits all), the quads to split, terminator
     triangles, whether the ring closes, and t0 = where the cursor sits along
     the entry edge. */
  traceLoop(obj, faceIndex, p) {
    const { polys, faceToPoly, edgeMap, ekey } = this.getPolys(obj);
    const pos = obj.mesh.geometry.getAttribute("position").array;
    const startPi = faceToPoly[faceIndex];
    if (startPi < 0 || polys[startPi].length !== 4) return null;

    // nearest boundary edge of the hovered quad
    const cyc = polys[startPi];
    let best = -1, bestD = Infinity, bestT = 0.5;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      a.fromArray(pos, cyc[i] * 3);
      b.fromArray(pos, cyc[(i + 1) % 4] * 3);
      const seg = tmp.copy(b).sub(a);
      const t = BT.clamp(p.clone().sub(a).dot(seg) / Math.max(seg.lengthSq(), 1e-12), 0, 1);
      const d = p.distanceToSquared(a.clone().addScaledVector(seg, t));
      if (d < bestD) { bestD = d; best = i; bestT = t; }
    }
    const entry = { u: cyc[best], v: cyc[(best + 1) % 4] };

    const adjIn = (pi, corner, exclude) => {
      const c = polys[pi];
      const i = c.indexOf(corner);
      const n1 = c[(i + 1) % c.length], n2 = c[(i - 1 + c.length) % c.length];
      return n1 === exclude ? n2 : n1;
    };
    const otherPoly = (key, pi) => {
      const list = edgeMap.get(key);
      if (!list || list.length !== 2) return -1;
      return list[0] === pi ? list[1] : list[0];
    };

    const walk = (pi, ent, recordEntry, visited, out) => {
      let cur = pi, e = ent;
      let guard = 0;
      if (recordEntry) out.crossed.push({ u: e.u, v: e.v });
      while (guard++ < 100000) {
        if (visited.has(cur)) return "closed";
        visited.add(cur);
        out.quads.push({ pi: cur, entry: { u: e.u, v: e.v } });
        const exit = { u: adjIn(cur, e.u, e.v), v: adjIn(cur, e.v, e.u) };
        out.crossed.push({ u: exit.u, v: exit.v });
        const next = otherPoly(ekey(exit.u, exit.v), cur);
        if (next < 0) return "open";
        if (polys[next].length !== 4) { out.tris.push({ pi: next, u: exit.u, v: exit.v }); return "open"; }
        cur = next;
        e = exit;
      }
      return "open";
    };

    const visited = new Set();
    const fwd = { crossed: [], quads: [], tris: [] };
    const status = walk(startPi, entry, true, visited, fwd);
    let crossed = fwd.crossed, quads = fwd.quads, tris = fwd.tris;
    let closed = status === "closed";

    if (!closed) {
      // walk the other way from the entry edge
      const backStart = otherPoly(ekey(entry.u, entry.v), startPi);
      if (backStart >= 0 && polys[backStart].length === 4) {
        const back = { crossed: [], quads: [], tris: [] };
        walk(backStart, entry, false, visited, back);
        crossed = back.crossed.slice().reverse().concat(crossed);
        quads = back.quads.concat(quads);
        tris = back.tris.concat(tris);
      } else if (backStart >= 0) {
        tris = tris.concat([{ pi: backStart, u: entry.u, v: entry.v }]);
      }
    } else {
      crossed = crossed.slice(0, -1); // last exit equals the first entry
    }

    return { crossed, quads, tris, closed, t0: bestT, entryKey: ekey(entry.u, entry.v) };
  },

  /* Apply a traced loop cut at parameter t (same t on every crossed edge,
     measured from each edge's oriented u corner). Quads split into two
     quads, terminator triangles get a plain 2-way split. */
  applyLoopCut(data, trace, t) {
    const pos = data.pos, col = data.col;
    const nV = pos.length / 3;
    const built = this.buildPolys(data);
    const { polys, polyFaces, ekey } = built;

    // one new vertex per crossed edge
    const cutVert = new Map(); // canonical edge key -> new vertex index
    const newPos = [], newCol = [];
    for (const e of trace.crossed) {
      const key = ekey(e.u, e.v);
      if (cutVert.has(key)) continue;
      cutVert.set(key, nV + cutVert.size);
      const u3 = e.u * 3, v3 = e.v * 3;
      newPos.push(
        pos[u3] + (pos[v3] - pos[u3]) * t,
        pos[u3 + 1] + (pos[v3 + 1] - pos[u3 + 1]) * t,
        pos[u3 + 2] + (pos[v3 + 2] - pos[u3 + 2]) * t
      );
      if (col) newCol.push(
        col[u3] + (col[v3] - col[u3]) * t,
        col[u3 + 1] + (col[v3 + 1] - col[u3 + 1]) * t,
        col[u3 + 2] + (col[v3 + 2] - col[u3 + 2]) * t
      );
    }

    const splitQuads = new Map(); // poly index -> entry edge
    for (const q of trace.quads) splitQuads.set(q.pi, q.entry);
    const splitTris = new Map(); // poly index -> crossed edge
    for (const tr of trace.tris) splitTris.set(tr.pi, tr);

    const faces = [], quads = [];
    for (let pi = 0; pi < polys.length; pi++) {
      const cyc = polys[pi];
      if (splitQuads.has(pi)) {
        const ent = splitQuads.get(pi);
        // orient (u, v) to follow the cycle so the sub-quads keep the winding
        let u = ent.u, v = ent.v;
        let iu = cyc.indexOf(u);
        if (cyc[(iu + 1) % 4] !== v) { const t2 = u; u = v; v = t2; iu = cyc.indexOf(u); }
        const vP = cyc[(iu + 2) % 4], uP = cyc[(iu + 3) % 4];
        const P = cutVert.get(ekey(u, v));
        const Q = cutVert.get(ekey(uP, vP));
        this._emitQuad(faces, quads, uP, u, P, Q);
        this._emitQuad(faces, quads, P, v, vP, Q);
      } else if (splitTris.has(pi) && cyc.length === 3) {
        const tr = splitTris.get(pi);
        const P = cutVert.get(ekey(tr.u, tr.v));
        // rotate so the crossed edge is (c0, c1)
        let c = cyc.slice();
        while (!((c[0] === tr.u && c[1] === tr.v) || (c[0] === tr.v && c[1] === tr.u))) c.push(c.shift());
        this._emitTri(faces, quads, c[0], P, c[2]);
        this._emitTri(faces, quads, P, c[1], c[2]);
      } else if (cyc.length === 4) {
        this._emitQuad(faces, quads, cyc[0], cyc[1], cyc[2], cyc[3]);
      } else {
        this._emitTri(faces, quads, cyc[0], cyc[1], cyc[2]);
      }
    }

    const outPos = new Float32Array(pos.length + newPos.length);
    outPos.set(pos);
    outPos.set(newPos, pos.length);
    let outCol = null;
    if (col) {
      outCol = new Float32Array(col.length + newCol.length);
      outCol.set(col);
      outCol.set(newCol, col.length);
    }
    return {
      data: { pos: outPos, idx: new Uint32Array(faces), col: outCol, quad: Int32Array.from(quads) },
      sel: Array.from(cutVert.values()),
    };
  },

  // ---- mirror across X (duplicates, flips winding, welds the seam) ---------

  mirrorX(data) {
    const n = data.pos.length / 3;
    const nF = data.idx.length / 3;
    const pos = new Float32Array(data.pos.length * 2);
    pos.set(data.pos);
    for (let v = 0; v < n; v++) {
      pos[(n + v) * 3] = -data.pos[v * 3];
      pos[(n + v) * 3 + 1] = data.pos[v * 3 + 1];
      pos[(n + v) * 3 + 2] = data.pos[v * 3 + 2];
    }
    const idx = new Uint32Array(data.idx.length * 2);
    idx.set(data.idx);
    for (let f = 0; f < data.idx.length; f += 3) {
      idx[data.idx.length + f] = data.idx[f] + n;
      idx[data.idx.length + f + 1] = data.idx[f + 2] + n;
      idx[data.idx.length + f + 2] = data.idx[f + 1] + n;
    }
    let col = null;
    if (data.col) {
      col = new Float32Array(data.col.length * 2);
      col.set(data.col);
      col.set(data.col, data.col.length);
    }
    let quad = null;
    if (data.quad) {
      quad = new Int32Array(nF * 2).fill(-1);
      for (let f = 0; f < nF; f++) {
        quad[f] = data.quad[f];
        quad[nF + f] = data.quad[f] >= 0 ? data.quad[f] + nF : -1;
      }
    }
    return this.weldData(pos, idx, col, quad);
  },

  // ---- vertex editing ops (Verts mode) -----------------------------------------

  _compact(pos, col, faces, quads, trackIdx) {
    const nV = pos.length / 3;
    const used = new Uint8Array(nV);
    for (let i = 0; i < faces.length; i++) used[faces[i]] = 1;
    const remap = new Int32Array(nV).fill(-1);
    let n = 0;
    for (let v = 0; v < nV; v++) if (used[v]) remap[v] = n++;
    const outPos = new Float32Array(n * 3);
    const outCol = col ? new Float32Array(n * 3) : null;
    for (let v = 0; v < nV; v++) {
      if (remap[v] < 0) continue;
      const s = v * 3, d = remap[v] * 3;
      outPos[d] = pos[s]; outPos[d + 1] = pos[s + 1]; outPos[d + 2] = pos[s + 2];
      if (outCol) { outCol[d] = col[s]; outCol[d + 1] = col[s + 1]; outCol[d + 2] = col[s + 2]; }
    }
    const outIdx = new Uint32Array(faces.length);
    for (let i = 0; i < faces.length; i++) outIdx[i] = remap[faces[i]];
    return {
      data: { pos: outPos, idx: outIdx, col: outCol, quad: quads ? Int32Array.from(quads) : null },
      sel: trackIdx ? trackIdx.map((v) => remap[v]).filter((v) => v >= 0) : [],
    };
  },

  deleteVerts(data, selSet) {
    const faces = [], quads = [];
    const nFIn = data.idx.length / 3;
    const faceMap = new Int32Array(nFIn).fill(-1);
    for (let f = 0; f < nFIn; f++) {
      const a = data.idx[f * 3], b = data.idx[f * 3 + 1], c = data.idx[f * 3 + 2];
      if (selSet.has(a) || selSet.has(b) || selSet.has(c)) continue;
      faceMap[f] = faces.length / 3;
      faces.push(a, b, c);
      quads.push(-1);
    }
    if (!faces.length) return null;
    this._remapQuads(data.quad, faceMap, quads);
    return this._compact(data.pos, data.col, faces, quads, null);
  },

  _remapQuads(oldQuad, faceMap, quads) {
    if (!oldQuad) return;
    for (let f = 0; f < faceMap.length; f++) {
      const nf = faceMap[f];
      if (nf < 0 || oldQuad[f] < 0) continue;
      const np = faceMap[oldQuad[f]];
      if (np >= 0) quads[nf] = np;
    }
    for (let f = 0; f < quads.length; f++) {
      const p = quads[f];
      if (p >= 0 && quads[p] !== f) quads[f] = -1;
    }
  },

  deleteFaces(data, triSet) {
    const faces = [], quads = [];
    const nFIn = data.idx.length / 3;
    const faceMap = new Int32Array(nFIn).fill(-1);
    for (let f = 0; f < nFIn; f++) {
      if (triSet.has(f)) continue;
      faceMap[f] = faces.length / 3;
      faces.push(data.idx[f * 3], data.idx[f * 3 + 1], data.idx[f * 3 + 2]);
      quads.push(-1);
    }
    if (!faces.length) return null;
    this._remapQuads(data.quad, faceMap, quads);
    return this._compact(data.pos, data.col, faces, quads, null);
  },

  mergeVerts(data, selSet) {
    if (selSet.size < 2) return null;
    let target = Infinity, cx = 0, cy = 0, cz = 0, cr = 0, cg = 0, cb = 0;
    selSet.forEach((v) => {
      if (v < target) target = v;
      cx += data.pos[v * 3]; cy += data.pos[v * 3 + 1]; cz += data.pos[v * 3 + 2];
      if (data.col) { cr += data.col[v * 3]; cg += data.col[v * 3 + 1]; cb += data.col[v * 3 + 2]; }
    });
    const k = selSet.size;
    const pos = data.pos.slice(), col = data.col ? data.col.slice() : null;
    pos[target * 3] = cx / k; pos[target * 3 + 1] = cy / k; pos[target * 3 + 2] = cz / k;
    if (col) { col[target * 3] = cr / k; col[target * 3 + 1] = cg / k; col[target * 3 + 2] = cb / k; }
    const faces = [], quads = [];
    const nFIn = data.idx.length / 3;
    const faceMap = new Int32Array(nFIn).fill(-1);
    for (let f = 0; f < nFIn; f++) {
      const a = selSet.has(data.idx[f * 3]) ? target : data.idx[f * 3];
      const b = selSet.has(data.idx[f * 3 + 1]) ? target : data.idx[f * 3 + 1];
      const c = selSet.has(data.idx[f * 3 + 2]) ? target : data.idx[f * 3 + 2];
      if (a === b || b === c || a === c) continue;
      faceMap[f] = faces.length / 3;
      faces.push(a, b, c);
      quads.push(-1);
    }
    if (!faces.length) return null;
    this._remapQuads(data.quad, faceMap, quads);
    return this._compact(pos, col, faces, quads, [target]);
  },

  fillFace(data, selArr) {
    if (selArr.length < 3 || selArr.length > 4) return null;
    const pos = data.pos;
    const p = selArr.map((v) => new THREE.Vector3().fromArray(pos, v * 3));
    const meshC = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 3) meshC.add(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
    meshC.multiplyScalar(3 / pos.length);
    const faceC = p.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / p.length);
    let order = selArr.slice();
    if (selArr.length === 4) {
      const n = new THREE.Vector3().crossVectors(p[1].clone().sub(p[0]), p[2].clone().sub(p[0]));
      if (n.lengthSq() < 1e-12) return null;
      n.normalize();
      const u = p[0].clone().sub(faceC).normalize();
      const w = new THREE.Vector3().crossVectors(n, u);
      order = selArr.map((v, i) => ({ v, ang: Math.atan2(p[i].clone().sub(faceC).dot(w), p[i].clone().sub(faceC).dot(u)) }))
        .sort((x, y) => x.ang - y.ang).map((x) => x.v);
    }
    const q = order.map((v) => new THREE.Vector3().fromArray(pos, v * 3));
    const n = new THREE.Vector3().crossVectors(q[1].clone().sub(q[0]), q[2].clone().sub(q[0]));
    if (n.lengthSq() < 1e-12) return null;
    if (n.dot(faceC.clone().sub(meshC)) < 0) order.reverse();

    const nFIn = data.idx.length / 3;
    const faces = Array.from(data.idx);
    const quads = data.quad ? Array.from(data.quad) : new Array(nFIn).fill(-1);
    if (order.length === 3) {
      faces.push(order[0], order[1], order[2]);
      quads.push(-1);
    } else {
      this._emitQuad(faces, quads, order[0], order[1], order[2], order[3]);
    }
    return {
      data: { pos: pos.slice(), idx: new Uint32Array(faces), col: data.col ? data.col.slice() : null, quad: Int32Array.from(quads) },
      sel: selArr.slice(),
    };
  },

  /* Extrude the selected face region outward; with inset=true the duplicated
     verts shrink toward the region center instead (a face cut inside the
     face), ready to be pushed in or out. regionTris (array of triangle
     indices) overrides the region detection, used by face-select mode. */
  extrude(data, selSet, inset, regionTris) {
    const idx = data.idx;
    let region = [];
    if (regionTris) {
      region = Array.from(regionTris).map((f) => f * 3);
    } else {
      for (let f = 0; f < idx.length; f += 3) {
        if (selSet.has(idx[f]) && selSet.has(idx[f + 1]) && selSet.has(idx[f + 2])) region.push(f);
      }
    }
    if (!region.length) return null;

    const pos = data.pos;
    const normal = new THREE.Vector3();
    let edgeLen = 0;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (const f of region) {
      va.fromArray(pos, idx[f] * 3); vb.fromArray(pos, idx[f + 1] * 3); vc.fromArray(pos, idx[f + 2] * 3);
      normal.add(new THREE.Vector3().crossVectors(vb.clone().sub(va), vc.clone().sub(va)));
      edgeLen += va.distanceTo(vb) + vb.distanceTo(vc) + vc.distanceTo(va);
    }
    if (normal.lengthSq() < 1e-12) normal.set(0, 1, 0); else normal.normalize();
    const offset = inset ? 0 : edgeLen / (region.length * 3) * 0.8;

    const nV = pos.length / 3;
    const useCount = new Map();
    const ekey = (a, b) => (a < b ? a * nV + b : b * nV + a);
    for (const f of region) {
      for (let k = 0; k < 3; k++) {
        const a = idx[f + k], b = idx[f + (k + 1) % 3];
        useCount.set(ekey(a, b), (useCount.get(ekey(a, b)) || 0) + 1);
      }
    }

    // region center, for the inset shrink
    const center = new THREE.Vector3();
    const regionVerts = new Set();
    for (const f of region) for (let k = 0; k < 3; k++) regionVerts.add(idx[f + k]);
    regionVerts.forEach((v) => center.add(new THREE.Vector3().fromArray(pos, v * 3)));
    center.multiplyScalar(1 / regionVerts.size);

    const dup = new Map();
    const newPos = [], newCol = [];
    const shrink = inset ? 0.3 : 0;
    for (const f of region) {
      for (let k = 0; k < 3; k++) {
        const v = idx[f + k];
        if (dup.has(v)) continue;
        dup.set(v, nV + dup.size);
        newPos.push(
          pos[v * 3] + normal.x * offset + (center.x - pos[v * 3]) * shrink,
          pos[v * 3 + 1] + normal.y * offset + (center.y - pos[v * 3 + 1]) * shrink,
          pos[v * 3 + 2] + normal.z * offset + (center.z - pos[v * 3 + 2]) * shrink
        );
        if (data.col) newCol.push(data.col[v * 3], data.col[v * 3 + 1], data.col[v * 3 + 2]);
      }
    }

    const nFIn = idx.length / 3;
    const faces = Array.from(idx);
    const quads = data.quad ? Array.from(data.quad) : new Array(nFIn).fill(-1);
    for (const f of region) {
      for (let k = 0; k < 3; k++) faces[f + k] = dup.get(idx[f + k]);
    }
    // side walls are proper quads
    for (const f of region) {
      for (let k = 0; k < 3; k++) {
        const a = idx[f + k], b = idx[f + (k + 1) % 3];
        if (useCount.get(ekey(a, b)) !== 1) continue;
        this._emitQuad(faces, quads, a, b, dup.get(b), dup.get(a));
      }
    }

    const outPos = new Float32Array(pos.length + newPos.length);
    outPos.set(pos); outPos.set(newPos, pos.length);
    let outCol = null;
    if (data.col) {
      outCol = new Float32Array(data.col.length + newCol.length);
      outCol.set(data.col); outCol.set(newCol, data.col.length);
    }
    return {
      data: { pos: outPos, idx: new Uint32Array(faces), col: outCol, quad: Int32Array.from(quads) },
      sel: Array.from(dup.values()),
    };
  },
};
