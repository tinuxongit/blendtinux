/* GLSL for the render mode's path tracer (see render.js for the lifecycle).
   TRACE_FRAG traces one full light path per pixel per frame and keeps a
   running average in a float target; VIEW_FRAG tone-maps that average to the
   screen. Every render setting is a uniform, so nothing ever recompiles. */
"use strict";

BT.RenderShaders = {

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

uniform sampler2D uTris, uBVH, uLights, uPrev;
uniform int uTriTexW, uBVHTexW, uLightTexW, uLightCount, uFrame, uBounces, uSkyMode;
uniform vec2 uRes;
uniform vec3 uCamPos, uCamRight, uCamUp, uCamFwd, uSunDir, uSunColor, uSkyColor;
uniform float uTanFov, uAspect, uAperture, uFocusDist;
uniform bool uBgTransparent;

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
vec4 lightTexel(int i) {
  return texelFetch(uLights, ivec2(i % uLightTexW, i / uLightTexW), 0);
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
  vec3 s;
  if (uSkyMode == 3) {
    s = uSkyColor;
  } else {
    float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    if (uSkyMode == 1)      s = mix(vec3(0.30, 0.11, 0.055), vec3(0.16, 0.11, 0.20), pow(t, 1.2)); // sunset
    else if (uSkyMode == 2) s = mix(vec3(0.010, 0.012, 0.022), vec3(0.030, 0.040, 0.085), pow(t, 1.3)); // night
    else                    s = mix(vec3(0.045, 0.045, 0.055), vec3(0.30, 0.36, 0.50), pow(t, 1.4)); // day
  }
  if (spec) s += uSunColor * smoothstep(0.9993, 0.9999, dot(d, uSunDir)) * 340.0;
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

// ---- procedural surface patterns (wood, stone, marble) --------------------

float hash13(vec3 q) {
  q = fract(q * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec3 q) {
  vec3 i = floor(q), f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  float c000 = hash13(i),                   c100 = hash13(i + vec3(1, 0, 0));
  float c010 = hash13(i + vec3(0, 1, 0)),   c110 = hash13(i + vec3(1, 1, 0));
  float c001 = hash13(i + vec3(0, 0, 1)),   c101 = hash13(i + vec3(1, 0, 1));
  float c011 = hash13(i + vec3(0, 1, 1)),   c111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
             mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}

float patternShade(int pat, vec3 q) {
  if (pat == 1) { // wood: noise stretched along y turned into grain bands
    float g = vnoise(vec3(q.x * 9.0, q.y * 1.6, q.z * 9.0))
            + 0.5 * vnoise(vec3(q.x * 18.0, q.y * 3.2, q.z * 18.0));
    float bands = 0.5 + 0.5 * sin(g * 11.0);
    return 0.7 + 0.3 * bands * bands;
  }
  if (pat == 2) { // stone: patchy two-octave noise with dark speckles
    float n = vnoise(q * 5.0) * 0.65 + vnoise(q * 21.0) * 0.35;
    float speck = step(0.93, vnoise(q * 60.0)) * 0.25;
    return 0.7 + 0.35 * n - speck;
  }
  if (pat == 3) { // marble: thin dark veins warped by noise
    float n = vnoise(q * 2.5) + 0.5 * vnoise(q * 6.0);
    float vein = pow(0.5 + 0.5 * sin((q.x + q.y + q.z) * 3.0 + n * 7.0), 8.0);
    return 1.0 - 0.55 * vein;
  }
  return 1.0;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  seed = uint(px.x) * 1973u + uint(px.y) * 9277u + uint(uFrame) * 26699u + 1u;

  vec2 jitter = vec2(rnd(), rnd());
  vec2 ndc = ((vec2(px) + jitter) / uRes) * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uTanFov * uAspect + uCamUp * ndc.y * uTanFov);
  vec3 ro = uCamPos;

  // thin-lens depth of field: jitter the origin over the aperture disc,
  // keep aiming at the focal point
  if (uAperture > 0.0) {
    float fr = sqrt(rnd()), fa = 6.2831853 * rnd();
    vec3 fp = ro + rd * (uFocusDist / max(dot(rd, uCamFwd), 1e-3));
    ro += (uCamRight * cos(fa) + uCamUp * sin(fa)) * (uAperture * fr);
    rd = normalize(fp - ro);
  }

  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  bool specBounce = true;
  float aSample = 1.0;

  for (int bounce = 0; bounce < 12; bounce++) {
    if (bounce >= uBounces) break;
    Hit hit;
    if (!traverse(ro, rd, 1e30, false, hit)) {
      if (bounce == 0 && uBgTransparent) { aSample = 0.0; break; }
      radiance += throughput * sky(rd, specBounce);
      break;
    }

    int ti = hit.tri * 9;
    vec4 t0 = triTexel(ti), t1 = triTexel(ti + 1), t2 = triTexel(ti + 2);
    vec4 t3 = triTexel(ti + 3), t4 = triTexel(ti + 4), t5 = triTexel(ti + 5);
    vec4 c0 = triTexel(ti + 6);
    int kind = int(t0.w);
    float rough = t1.w;
    float emis = t2.w;
    float metal = t4.w;
    float dens = t5.w;
    int pat = int(c0.w);
    float w0 = 1.0 - hit.u - hit.v;
    vec3 albedo = c0.rgb * w0 + triTexel(ti + 7).rgb * hit.u + triTexel(ti + 8).rgb * hit.v;

    // the geometric normal decides inside/outside and anchors ray offsets;
    // the smooth shading normal only shades. Mixing those two up is what
    // makes low-poly smooth surfaces look faceted and blotchy.
    vec3 gn = normalize(cross(t1.xyz - t0.xyz, t2.xyz - t0.xyz));
    bool inside = dot(gn, rd) > 0.0;
    if (inside) gn = -gn;
    vec3 n = gn;
    if (t3.w < 0.5) {
      n = normalize(t3.xyz * w0 + t4.xyz * hit.u + t5.xyz * hit.v);
      if (inside) n = -n;
      if (dot(n, gn) <= 0.0) n = gn;
    }

    vec3 p = ro + rd * hit.t;
    if (pat > 0) albedo *= patternShade(pat, p);

    // diffuse paths get emitters through the light sampling below instead,
    // otherwise they would be counted twice
    if (emis > 0.0 && specBounce) radiance += throughput * albedo * emis;

    if (kind == 2) { // glass
      float ior = inside ? 1.5 : 1.0 / 1.5;
      float cosi = -dot(rd, n);
      float f0 = 0.04;
      float fres = f0 + (1.0 - f0) * pow(1.0 - cosi, 5.0);
      vec3 refr = refract(rd, n, ior);
      vec3 dir;
      if (length(refr) < 0.5 || rnd() < fres) dir = reflect(rd, n);
      else dir = refr;
      // Beer-Lambert: the glass color deepens with the distance travelled inside
      if (inside) throughput *= exp(-(vec3(1.0) - albedo) * dens * hit.t);
      dir = normalize(dir + sphereDir() * rough * 0.35);
      ro = p + dir * 1e-4;
      rd = dir;
      specBounce = true;
      continue;
    }

    bool metalRefl = kind == 1 || (metal > 0.0 && rnd() < metal);
    bool doSpec = metalRefl;
    if (!doSpec && (kind == 0 || kind == 3)) {
      float cosi = -dot(rd, n);
      float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
      doSpec = rnd() < fres * (1.0 - rough); // plastic coat
    }

    if (doSpec) {
      vec3 dir = normalize(reflect(rd, n) + sphereDir() * rough * rough);
      float dg = dot(dir, gn);
      if (dg <= 0.0) dir = normalize(dir - 2.0 * dg * gn); // keep it above the real surface
      if (metalRefl) throughput *= albedo;
      ro = p + gn * 2e-4;
      rd = dir;
      specBounce = true;
    } else {
      // direct sun with soft shadows
      vec3 sd = normalize(uSunDir + sphereDir() * 0.012);
      float ndl = dot(n, sd);
      if (ndl > 0.0 && dot(sd, gn) > 0.0) {
        Hit sh;
        if (!traverse(p + gn * 2e-4, sd, 1e30, true, sh)) {
          radiance += throughput * albedo * ndl * uSunColor;
        }
      }
      // direct light from one randomly picked glowing triangle
      if (uLightCount > 0) {
        int li = min(int(rnd() * float(uLightCount)), uLightCount - 1);
        vec4 L = lightTexel(li);
        int lt = int(L.x) * 9;
        vec3 la = triTexel(lt).xyz, lb = triTexel(lt + 1).xyz, lc = triTexel(lt + 2).xyz;
        float r1 = rnd(), r2 = rnd();
        if (r1 + r2 > 1.0) { r1 = 1.0 - r1; r2 = 1.0 - r2; }
        vec3 lp = la + (lb - la) * r1 + (lc - la) * r2;
        vec3 ld = lp - p;
        float d2 = dot(ld, ld);
        float dist = sqrt(d2);
        ld /= dist;
        float ndl2 = dot(n, ld);
        float cosl = abs(dot(normalize(cross(lb - la, lc - la)), ld));
        if (ndl2 > 0.0 && cosl > 1e-4 && dot(ld, gn) > 0.0) {
          Hit sh;
          if (!traverse(p + gn * 2e-4, ld, dist - 1e-3, true, sh)) {
            vec3 lcol = (triTexel(lt + 6).rgb + triTexel(lt + 7).rgb + triTexel(lt + 8).rgb) / 3.0;
            float lemis = triTexel(lt + 2).w;
            radiance += throughput * albedo * 0.3183099 * lcol * lemis
                        * ndl2 * cosl * L.y * float(uLightCount) / max(d2, 1e-4);
          }
        }
      }
      throughput *= albedo;
      ro = p + gn * 2e-4;
      rd = cosineDir(n);
      float dg = dot(rd, gn);
      if (dg <= 0.0) rd = normalize(rd - 2.0 * dg * gn); // flip below-horizon samples back out
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
  // running average, so half-float targets never overflow
  vec4 prev = texelFetch(uPrev, px, 0);
  float w = 1.0 / float(uFrame + 1);
  outColor = vec4(mix(prev.rgb, radiance, w), mix(prev.a, aSample, w));
}
`,

  VIEW_FRAG: `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAccum;
uniform float uExposure;
uniform bool uTransparent;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 acc = texelFetch(uAccum, ivec2(gl_FragCoord.xy), 0);
  vec3 hdr = acc.rgb;
  float a = 1.0;
  if (uTransparent) {
    a = acc.a;
    hdr = a > 0.001 ? hdr / a : vec3(0.0); // un-premultiply the sky-free average
  }
  vec3 c = aces(hdr * 1.15 * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  outColor = vec4(c, a);
}
`,
};
