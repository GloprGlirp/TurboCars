// Baut falke.glb: Falke S4 (Limousine) + Falke C2 (Coupé) mit Mods, ohne Logos. Start: node build_cars.mjs
// Einheiten: Meter, +Y oben, Front zeigt nach +Z (glTF-Standard), Boden bei y = 0.
import fs from 'node:fs';
import assert from 'node:assert';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { toCreasedNormals, mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// GLTFExporter nutzt FileReader, den es in Node nicht gibt
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend(); }); }
};

const { lerp, clamp } = THREE.MathUtils;
const std = (name, color, roughness, metalness = 0, extra = {}) =>
  Object.assign(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }), { name });
const M = {
  carbon: std('Carbon', 0x1c1c1f, 0.3, 0.35),
  black: std('Black', 0x070707, 0.6),
  trim: std('Trim', 0x050505, 0.12, 0.3), // Hochglanz-Schwarz (Shadowline)
  seam: std('Seam', 0x030303, 0.8, 0, { side: THREE.DoubleSide }),
  glass: std('Glass', 0x0d1318, 0.05, 0.6),
  chrome: std('Chrome', 0xd8d8d8, 0.12, 1),
  darkChrome: std('DarkChrome', 0x3a3a3c, 0.25, 0.9),
  tire: std('Tire', 0x141414, 0.85, 0, { side: THREE.DoubleSide }),
  disc: std('BrakeDisc', 0x77777a, 0.45, 0.85),
  lens: std('Light_Housing', 0x15181c, 0.08, 0.9),
  head: std('Light_Front', 0xffffff, 0.2, 0, { emissive: 0xdde8ff }),
  tailGlass: std('Light_RearGlass', 0x2a0306, 0.08, 0.3),
  tail: std('Light_Rear', 0x400000, 0.3, 0, { emissive: 0xff1010 }),
};

const L2 = 4.794 / 2, xf = 1.547, xr = xf - 2.857, R = 0.39, AY = 0.34; // Länge 4794, Radstand 2857
const REAR = [[-L2, 0.86], [-L2 + 0.03, 0.95], [-2.3, 1.005], [-2.15, 1.02]];
const HOOD = [[0.95, 0.905], [1.3, 0.875], [1.6, 0.85], [1.9, 0.81], [2.1, 0.77], [L2 - 0.15, 0.735], [L2 - 0.06, 0.685], [L2 - 0.02, 0.635], [L2, 0.6]];
const BOT = [[-L2, 0.4], [-L2 + 0.06, 0.25], [-L2 + 0.25, 0.17], [-2.0, 0.14], [2.0, 0.14], [L2 - 0.3, 0.15], [L2 - 0.07, 0.17], [L2, 0.24]];
const arc = (cx, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [cx + r * Math.cos(a), AY + r * Math.sin(a)]; });

const SPECS = {
  Falke4: {
    W: 1.903, H: 1.433, roof: 0.6, paint: 0x22573f,
    rim: std('Rim_Falke4', 0x8a6d3b, 0.35, 0.8), caliper: std('Caliper_Falke4', 0x1d4fa0, 0.35, 0.2),
    // Mittellinie oben (z aufsteigend): Heck, Heckscheibe, Dach, Frontscheibe, Haube
    top: [...REAR, [-1.58, 1.0], [-1.18, 1.25], [-0.78, 1.425], [-0.35, 1.433], [0.05, 1.425], [0.5, 1.19], ...HOOD],
    glassZ: [0.95, 0.05, -0.78, -1.58], // Frontscheibe unten/oben, Heckscheibe oben/unten
    dlo: [[0.84, 0.85], [0.06, 1.47], [-0.7, 1.47], [-1.12, 1.15], [-1.22, 1.06], [-1.26, 0.85]], // Seitenfenster mit Hofmeister-Knick
    bars: [-0.1], // B-Säule
    seams: [[[0.95, 0.27], [0.9, 0.88]], [[-0.1, 0.27], [-0.1, 0.96]],
      [[0.95, 0.27], [-0.886, 0.27], ...arc(xr, 0.43, -0.163, 0.709), [-1.06, 0.99]]],
    handles: [0.3, -0.66],
  },
  Falke2: {
    W: 1.887, H: 1.393, roof: 0.6, paint: 0xf3c200,
    rim: std('Rim_Falke2', 0x2b2b2b, 0.35, 0.6), caliper: std('Caliper_Falke2', 0xc9a13b, 0.35, 0.4),
    top: [...REAR, [-1.85, 1.0], [-1.3, 1.24], [-0.62, 1.385], [-0.3, 1.393], [-0.02, 1.385], [0.47, 1.17], ...HOOD],
    glassZ: [0.95, -0.02, -0.62, -1.85],
    dlo: [[0.84, 0.85], [0.0, 1.45], [-0.62, 1.45], [-1.3, 1.05], [-1.34, 0.85]],
    bars: [-0.62], // Steg zwischen rahmenloser Tür und Seitenscheibe
    seams: [[[0.95, 0.27], [0.9, 0.88]], [[0.95, 0.27], [-0.55, 0.27], [-0.6, 0.985]]],
    handles: [-0.3],
  },
};
const MODS = ['FrontIntakes', 'FrontLip', 'Canards', 'HoodVents', 'SideSkirts', 'Diffuser', 'Wing'];
const WHEELS = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];

const interp = (tab, z) => {
  if (z <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (z <= tab[i][0]) {
    const [z0, y0] = tab[i - 1], [z1, y1] = tab[i];
    return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
  }
  return tab[tab.length - 1][1];
};
const inPoly = (z, y, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [zi, yi] = P[i], [zj, yj] = P[j];
    if (yi > y !== yj > y && z < ((zj - zi) * (y - yi)) / (yj - yi) + zi) c = !c;
  }
  return c;
};
const edgeDist = (z, y, P) => Math.min(...P.map((p, i) => {
  const q = P[(i + 1) % P.length], dz = q[0] - p[0], dy = q[1] - p[1];
  const t = clamp(((z - p[0]) * dz + (y - p[1]) * dy) / (dz * dz + dy * dy), 0, 1);
  return Math.hypot(z - p[0] - t * dz, y - p[1] - t * dy);
}));

const group = (parent, name = '', x = 0, y = 0, z = 0, rx = 0, ry = 0) => {
  const g = new THREE.Group();
  g.name = name; g.position.set(x, y, z); g.rotation.set(rx, ry, 0);
  parent.add(g); return g;
};
const mesh = (geo, mat, parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  parent.add(m); return m;
};
const box = (p, mat, w, h, d, x, y, z, rx, ry, rz) => mesh(new THREE.BoxGeometry(w, h, d), mat, p, x, y, z, rx, ry, rz);
const cylX = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylZ = (r, len) => new THREE.CylinderGeometry(r, r, len, 12).rotateX(Math.PI / 2);
const pair = (fn) => [1, -1].forEach(fn); // k = +1 links (+x), -1 rechts
const shape = (pts, k = 1) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(k * x, y)));
// Form in x/y nach +z extrudieren
const extrude = (s, depth, mat, parent, x = 0, y = 0, z = 0, bevel = 0) => mesh(new THREE.ExtrudeGeometry(s, bevel
  ? { depth, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 }
  : { depth, bevelEnabled: false, curveSegments: 4 }), mat, parent, x, y, z);
// Form in Draufsicht (x, -z) nach oben (+y) extrudieren
const extrudeUp = (s, depth, mat, parent, x, y, z) =>
  mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).rotateX(-Math.PI / 2), mat, parent, x, y, z);
// Form in Seitenansicht (z, y) quer (x) extrudieren
const extrudeSide = (s, depth, mat, parent, x, y, z) =>
  mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2).rotateY(-Math.PI / 2), mat, parent, x, y, z);

function rrect(w, h, r, p = new THREE.Shape()) {
  const x = -w / 2, y = -h / 2;
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y);
  return p;
}
function frame(w, h, r, t) {
  const s = rrect(w, h, r);
  s.holes.push(rrect(w - 2 * t, h - 2 * t, Math.max(r - t, 0.005), new THREE.Path()));
  return s;
}

// ---- Räder: Origin = Radmitte, Achse = X, Außenseite +X (rechte Räder per scale.x = -1 gespiegelt) ----
const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, x]) => new THREE.Vector2(r, x)), 24).rotateZ(-Math.PI / 2);
const YSPOKE = [[-0.02, 0.065], [0.02, 0.065], [0.018, 0.15], [0.0602, 0.2095], [0.0304, 0.2159], [0, 0.178], [-0.0304, 0.2159], [-0.0602, 0.2095], [-0.018, 0.15]];
const WHEEL = {
  tire: lathe([[0.245, -0.125], [0.29, -0.138], [0.325, -0.134], [0.339, -0.118], [0.343, -0.08], [0.343, 0.08], [0.339, 0.118], [0.325, 0.134], [0.29, 0.138], [0.245, 0.125]]),
  barrel: lathe([[0.213, -0.12], [0.213, 0.118], [0.232, 0.128], [0.247, 0.13], [0.248, 0.122]]),
  spokes: mergeGeometries([0, 1, 2, 3, 4].map((i) => new THREE.ExtrudeGeometry(shape(YSPOKE), { depth: 0.022, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 })
    .rotateY(Math.PI / 2).translate(0.088, 0, 0).rotateX((i * 2 * Math.PI) / 5))),
  hub: cylX(0.07, 0.05).translate(0.1, 0, 0),
  cap: cylX(0.032, 0.012).translate(0.128, 0, 0),
  nuts: mergeGeometries([0, 1, 2, 3, 4].map((i) => cylX(0.009, 0.02, 6).translate(0.125, 0.048 * Math.cos((i * 2 * Math.PI) / 5 + 0.6), 0.048 * Math.sin((i * 2 * Math.PI) / 5 + 0.6)))),
  disc: cylX(0.19, 0.026, 18),
  hat: cylX(0.085, 0.07).translate(0.03, 0, 0),
};
const caliperGeo = (() => {
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.205, Math.PI / 2 - 0.45, Math.PI / 2 + 0.45, false);
  s.absarc(0, 0, 0.13, Math.PI / 2 + 0.45, Math.PI / 2 - 0.45, true);
  return new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 6 })
    .translate(0, 0, -0.035).rotateY(Math.PI / 2);
})();

function wheel(car, name, k, z, spec) {
  const w = group(car, name, k * (spec.W / 2 - 0.145), AY, z);
  w.scale.x = k;
  mesh(WHEEL.tire, M.tire, w); mesh(WHEEL.barrel, spec.rim, w); mesh(WHEEL.spokes, spec.rim, w);
  mesh(WHEEL.hub, spec.rim, w); mesh(WHEEL.cap, M.black, w); mesh(WHEEL.nuts, M.chrome, w);
  mesh(WHEEL.disc, M.disc, w); mesh(WHEEL.hat, M.darkChrome, w);
  mesh(caliperGeo, spec.caliper, car, w.position.x, AY, z, -0.9); // Sattel dreht nicht mit
}

// ---- Karosserie als Loft aus Querschnitten ----
const SUB = [3, 1, 2, 3, 3, 3, 2, 1, 18, 2, 5]; // Unterteilung je Segment zwischen den 12 Querschnitt-Punkten
const SEG = SUB.flatMap((n, s) => Array.from({ length: n }, (_, r) => [s, r]));
const NH = SEG.length + 1; // Punkte pro Halbring
const segOf = (j) => SEG[j < NH - 1 ? j : 2 * NH - 3 - j];
const [PAINT, GLASS, TRIM, BLACK, CARBON] = [0, 1, 2, 3, 4];

function buildCar(name, spec) {
  const { W, roof } = spec;
  const [zA, zB, zC, zD] = spec.glassZ;
  const car = group(new THREE.Group(), name);
  const body = group(car, 'Body');
  const paintMat = std(`Paint_${name}`, spec.paint, 0.3, 0.35);

  const archY = (z) => { for (const cx of [xr, xf]) { const d = Math.abs(z - cx); if (d <= R) return AY + Math.sqrt(R * R - d * d); } return 0; };
  const plan = (z, half) => { const rc = z > 0 ? 0.22 : 0.2, d = Math.abs(z) - (L2 - rc); return d > 0 ? half - rc + Math.sqrt(Math.max(rc * rc - d * d, 0)) : half; };
  const flare = (z) => 0.035 * Math.max(Math.exp(-(((z - xf) / 0.5) ** 2)), Math.exp(-(((z - xr) / 0.55) ** 2)));

  // 12 Querschnitt-Punkte (rechte Hälfte, x >= 0) von Unterboden-Mitte bis Dach-Mitte
  function section(z) {
    const top = interp(spec.top, z), bb = interp(BOT, z), arch = archY(z);
    const hw = plan(z, W / 2 - 0.035) + flare(z), sh = plan(z, W / 2 - 0.075) + flare(z) * 0.3;
    const belt = Math.min(0.955 - 0.03 * z, top - 0.035);
    const h = clamp((top - belt - 0.06) / 0.3, 0, 1); // 0 = Haube/Kofferraum, 1 = volle Kabine
    const k = [
      [0, bb], [hw - 0.12, bb], [hw - 0.045, bb + 0.035], [hw - 0.012, Math.max(bb + 0.12, 0.3)],
      [hw, 0.52], [hw - 0.012, 0.7], [sh, belt - 0.05], [sh - 0.025, belt], // Seitenwand bis Schulter
      [sh - 0.06 - 0.03 * h, belt + 0.015], // Fensterunterkante
      [lerp(sh - 0.16, roof, h), top - 0.05 * h - 0.012], // Fensteroberkante / Dachrahmen
      [lerp(sh - 0.3, roof - 0.1, h), top - 0.008 - 0.006 * h],
      [0, top],
    ];
    for (let i = 0; i <= 5; i++) k[i][1] = Math.max(k[i][1], arch); // Radlauf ausschneiden
    for (let i = 6; i >= 0; i--) k[i][1] = Math.min(k[i][1], k[i + 1][1]);
    for (let i = 1; i <= 7; i++) k[i][1] = Math.max(k[i][1], k[i - 1][1]);
    return k;
  }
  const ring = (k) => {
    const half = [k[0]];
    SUB.forEach((n, s) => { for (let j = 1; j <= n; j++) half.push([lerp(k[s][0], k[s + 1][0], j / n), lerp(k[s][1], k[s + 1][1], j / n)]); });
    return [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
  };
  // Oberfläche abfragen, um Anbauteile exakt aufzusetzen
  const sideX = (z, y) => {
    const k = section(z);
    for (let i = 2; i < 8; i++) if (y <= k[i + 1][1] || i === 7) return lerp(k[i][0], k[i + 1][0], clamp((y - k[i][1]) / Math.max(k[i + 1][1] - k[i][1], 1e-6), 0, 1));
  };
  const topY = (z, x) => {
    const k = section(z);
    return x >= k[10][0] ? lerp(k[9][1], k[10][1], clamp((k[9][0] - x) / (k[9][0] - k[10][0]), 0, 1)) : lerp(k[10][1], k[11][1], (k[10][0] - x) / k[10][0]);
  };

  function classify(j, zc, yc) {
    const [s, r] = segOf(j);
    const arch = archY(zc);
    if (s === 0 || (s <= 4 && arch > 0 && yc <= arch + 0.005)) return BLACK; // Unterboden, Radhaus
    if (s <= 5 && ((zc > L2 - 0.12 && yc < 0.24) || (zc < -L2 + 0.3 && yc < 0.4))) return BLACK; // Schürzen unten
    if (s === 8) {
      if (!inPoly(zc, yc, spec.dlo)) return PAINT;
      const edge = r === 0 || r === SUB[8] - 1 || edgeDist(zc, yc, spec.dlo) < 0.03 || spec.bars.some((b) => Math.abs(zc - b) < 0.035);
      return edge ? TRIM : GLASS;
    }
    if (s === 10 || (s === 9 && r === 1)) {
      if (zc > zB + 0.03 && zc < zA - 0.02) return GLASS;
      if (zc >= zA - 0.02 && zc < zA + 0.05) return TRIM; // Windlauf
      if (zc > zD + 0.03 && zc < zC - 0.03) return GLASS;
      if (s === 10 && zc >= zC - 0.03 && zc <= zB + 0.03) return CARBON; // Carbondach
    }
    return PAINT;
  }

  const N = 120;
  const zs = [...Array.from({ length: N }, (_, i) => { const s = -1 + (2 * i) / (N - 1); return L2 * (0.6 * s + 0.4 * Math.sin((Math.PI * s) / 2)); }),
    ...[xr, xf].flatMap((cx) => [cx - R - 0.002, cx - R + 0.002, cx + R - 0.002, cx + R + 0.002])].sort((a, b) => a - b);
  const rings = zs.map((z) => ring(section(z)));
  const m = rings[0].length, pos = [], idx = [[], [], [], [], []];
  rings.forEach((r, i) => r.forEach(([x, y]) => pos.push(x, y, zs[i])));
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = b + m, d = a + m;
    const yc = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
    idx[classify(j, (zs[i] + zs[i + 1]) / 2, yc)].push(a, b, d, b, c, d);
  }
  for (const [i, front] of [[0, false], [zs.length - 1, true]]) { // Front- und Heckfläche
    const c = pos.length / 3;
    pos.push(0, rings[i].reduce((s, p) => s + p[1], 0) / m, zs[i]);
    for (let j = 0; j < m; j++) { const a = i * m + j, b = i * m + ((j + 1) % m); idx[PAINT].push(...(front ? [c, a, b] : [c, b, a])); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx.flat());
  let start = 0;
  idx.forEach((l, mi) => { if (l.length) geo.addGroup(start, l.length, mi); start += l.length; });
  assert(pos.every(Number.isFinite), `${name}: NaN in Karosserie`);
  // je Material ein eigenes, kompaktes Mesh (sonst exportiert der GLTFExporter alle Punkte pro Material)
  const shellGeo = mergeVertices(toCreasedNormals(geo, 0.6)), shell = group(body, 'Shell');
  const sp = shellGeo.attributes.position, sn = shellGeo.attributes.normal, six = shellGeo.index.array;
  [paintMat, M.glass, M.trim, M.black, M.carbon].forEach((mat, mi) => {
    const map = new Map(), P = [], Nn = [], I = [];
    for (const g of shellGeo.groups) if (g.materialIndex === mi) for (let q = g.start; q < g.start + g.count; q++) {
      const v = six[q];
      if (!map.has(v)) { map.set(v, P.length / 3); P.push(sp.getX(v), sp.getY(v), sp.getZ(v)); Nn.push(sn.getX(v), sn.getY(v), sn.getZ(v)); }
      I.push(map.get(v));
    }
    if (!I.length) return;
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g2.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g2.setIndex(I);
    mesh(g2, mat, shell);
  });
  box(body, M.black, 1.28, 0.55, xf - xr + 0.9, 0, 0.425, (xf + xr) / 2); // Unterboden zwischen den Rädern

  // Fugen, Türgriffe, Kiemen, Spiegel
  function seam(pts, k) {
    const P = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(z1 - z0, y1 - y0) / 0.03));
      for (let t = 0; t < n; t++) P.push([lerp(z0, z1, t / n), lerp(y0, y1, t / n)]);
    }
    P.push(pts[pts.length - 1]);
    const p = [], ix = [];
    P.forEach(([z, y], i) => {
      const [za, ya] = P[Math.max(i - 1, 0)], [zb, yb] = P[Math.min(i + 1, P.length - 1)], l = Math.hypot(zb - za, yb - ya);
      for (const s of [1, -1]) { const zz = z - (s * 0.003 * (yb - ya)) / l, yy = y + (s * 0.003 * (zb - za)) / l; p.push(k * (sideX(zz, yy) + 0.002), yy, zz); }
      if (i) ix.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(ix); g.computeVertexNormals();
    mesh(g, M.seam, body);
  }
  pair((k) => {
    spec.seams.forEach((s) => seam(s, k));
    for (const z of spec.handles) { const y = section(z)[7][1] - 0.075; box(body, M.darkChrome, 0.014, 0.022, 0.16, k * (sideX(z, y) + 0.004), y, z); }
    // M-Kieme am Kotflügel
    const gz = 1.08, gy = 0.76, gx = sideX(gz, gy) + 0.004;
    box(body, M.trim, 0.012, 0.05, 0.13, k * gx, gy, gz);
    for (let i = 0; i < 3; i++) box(body, M.black, 0.004, 0.008, 0.1, k * (gx + 0.007), gy - 0.014 + i * 0.014, gz);
    // Spiegel
    const sh = section(0.66)[6][0];
    const head = extrude(rrect(0.2, 0.11, 0.045), 0.07, paintMat, body, k * (sh + 0.09), 1.02, 0.615, 0.015);
    head.rotation.y = k * 0.08;
    box(body, M.chrome, 0.18, 0.09, 0.004, k * (sh + 0.09), 1.02, 0.598, 0, k * 0.08);
    box(body, M.carbon, 0.13, 0.022, 0.045, k * (sh + 0.02), 0.99, 0.67);
  });

  // Front: Nieren, Scheinwerfer, Einlässe, Logo
  const HEAD = [[-0.22, -0.035], [0.2, -0.045], [0.245, 0], [0.21, 0.045], [-0.2, 0.04], [-0.245, 0.005]];
  extrude(frame(0.66, 0.15, 0.04, 0.02), 0.03, M.trim, body, 0, 0.5, L2 - 0.02);
  extrude(rrect(0.62, 0.11, 0.02), 0.02, M.black, body, 0, 0.5, L2 - 0.02);
  for (let i = 0; i < 3; i++) box(body, M.trim, 0.6, 0.01, 0.012, 0, 0.47 + i * 0.03, L2 + 0.004);
  pair((k) => {
    const g = group(body, '', k * 0.53, 0.635, L2 - 0.075, -0.55);
    extrude(shape(HEAD, k), 0.08, M.lens, g);
    for (const e of [-0.09, 0.09]) {
      mesh(new THREE.CircleGeometry(0.02, 10), M.head, g, k * e, -0.014, 0.081);
    }
    box(g, M.head, 0.4, 0.01, 0.006, 0, 0.03, 0.082); // Lichtleiste
    extrude(frame(0.34, 0.24, 0.05, 0.02), 0.025, M.trim, body, k * 0.53, 0.38, L2 - 0.005);
    extrude(rrect(0.3, 0.2, 0.03), 0.01, M.black, body, k * 0.53, 0.38, L2 - 0.005);
    box(body, paintMat, 0.03, 0.2, 0.02, k * 0.53, 0.38, L2 + 0.008);
  });
  
  // Heck: Rückleuchten, Kennzeichen, Logo, Reflektoren, Endrohre
  const TAIL = [[-0.18, -0.04], [0.16, -0.05], [0.21, -0.005], [0.19, 0.045], [-0.17, 0.04]];
  pair((k) => {
    const g = group(body, '', k * 0.57, 0.845, -L2 - 0.03, 0.35);
    extrude(shape(TAIL, k), 0.06, M.tailGlass, g);
    box(g, M.tail, 0.3, 0.012, 0.006, 0, 0.022, -0.004);
    box(g, M.tail, 0.22, 0.008, 0.006, k * 0.03, -0.022, -0.004);
    box(body, M.tail, 0.1, 0.02, 0.01, k * 0.62, 0.45, -L2 - 0.005);
    for (const x of [0.42, 0.55]) {
      mesh(cylZ(0.048, 0.16), M.chrome, body, k * x, 0.255, -L2 + 0.01);
      mesh(cylZ(0.04, 0.162), M.black, body, k * x, 0.255, -L2 + 0.01);
    }
  });
  box(body, M.black, 0.56, 0.15, 0.02, 0, 0.6, -L2 - 0.005); // Kennzeichen-Mulde
  for (const x of [-0.25, 0, 0.25]) box(body, M.black, 0.012, 0.08, 0.22, x, 0.21, -L2 + 0.15);

  wheel(car, 'Wheel_FL', 1, xf, spec); wheel(car, 'Wheel_FR', -1, xf, spec);
  wheel(car, 'Wheel_RL', 1, xr, spec); wheel(car, 'Wheel_RR', -1, xr, spec);

  // ---- Mods: je eine Gruppe "Mod_<Name>", im Spiel per .visible an/aus ----
  const mod = (n) => group(car, 'Mod_' + n);

  const fi = mod('FrontIntakes'); // Carbon-Einlässe mit Lamellen über den Serien-Einlässen
  pair((k) => {
    extrude(frame(0.4, 0.29, 0.06, 0.035), 0.05, M.carbon, fi, k * 0.53, 0.38, L2 - 0.01, 0.004);
    for (const x of [-0.11, -0.04, 0.04, 0.11]) box(fi, M.carbon, 0.008, 0.21, 0.035, k * 0.53 + x, 0.38, L2 + 0.02);
    for (const y of [-0.05, 0.05]) box(fi, M.carbon, 0.32, 0.008, 0.03, k * 0.53, 0.38 + y, L2 + 0.02);
    box(fi, M.carbon, 0.012, 0.07, 0.08, k * 0.12, 0.2, L2 - 0.04); // Fangzähne im Kinn
  });

  const lip = mod('FrontLip'); // Splitter folgt der Stoßstange in der Draufsicht
  const lipHW = (z) => { const d = z - (L2 + 0.06 - 0.28); return d > 0 ? W / 2 - 0.015 - 0.28 + Math.sqrt(Math.max(0.0784 - d * d, 0)) : W / 2 - 0.015; };
  const lz = Array.from({ length: 17 }, (_, i) => L2 - 0.45 + (0.51 * i) / 16);
  extrudeUp(shape([...lz.map((z) => [lipHW(z), -z]), ...lz.reverse().map((z) => [-lipHW(z), -z])]), 0.018, M.carbon, lip, 0, 0.13, 0);
  pair((k) => box(lip, M.carbon, 0.012, 0.06, 0.2, k * (W / 2 - 0.03), 0.15, L2 - 0.3));

  const cn = mod('Canards');
  pair((k) => [0.3, 0.42].forEach((y) => {
    const c = extrudeUp(shape([[0, 0], [0.1, 0.02], [0, 0.15]], k), 0.008, M.carbon, cn, k * 0.85, y, L2 - 0.06);
    c.rotation.z = k * 0.25;
  }));

  const hv = mod('HoodVents'); // Lamellen-Entlüftung, folgt Haubenneigung
  const vz = 1.45, slope = Math.atan((interp(spec.top, vz - 0.1) - interp(spec.top, vz + 0.1)) / 0.2);
  pair((k) => {
    const v = group(hv, '', k * 0.34, topY(vz, 0.34) + 0.004, vz, slope);
    box(v, M.black, 0.26, 0.012, 0.34, 0, 0, 0);
    for (const x of [-0.135, 0.135]) box(v, M.carbon, 0.012, 0.022, 0.36, x, 0.005, 0);
    for (const z of [-0.17, 0.17]) box(v, M.carbon, 0.28, 0.022, 0.012, 0, 0.005, z);
    for (let i = 0; i < 7; i++) box(v, M.carbon, 0.25, 0.006, 0.04, 0, 0.012, -0.135 + i * 0.045, 0.5);
  });

  const sk = mod('SideSkirts'); // L-Profil zwischen den Radläufen
  const z0 = xr + R + 0.04, z1 = xf - R - 0.04;
  pair((k) => {
    const x = sideX((z0 + z1) / 2, 0.16) - 0.015;
    extrude(shape([[0, 0], [0.075, 0], [0.075, 0.012], [0.012, 0.012], [0.012, 0.06], [0, 0.06]], k), z1 - z0, M.carbon, sk, k * x, 0.12, z0);
    box(sk, M.carbon, 0.012, 0.07, 0.1, k * (x + 0.07), 0.155, z0 + 0.05); // Winglet
  });

  const df = mod('Diffuser');
  const dp = group(df, '', 0, 0.15, -L2 + 0.16, 0.2);
  box(dp, M.carbon, 1.2, 0.02, 0.4, 0, 0, 0);
  for (const x of [-0.3, -0.15, 0, 0.15, 0.3]) box(dp, M.carbon, 0.012, 0.1, 0.38, x, 0.05, 0);
  box(df, M.tail, 0.12, 0.035, 0.02, 0, 0.23, -L2 - 0.035); // Regenlicht
  box(df, M.carbon, 0.14, 0.05, 0.03, 0, 0.23, -L2 - 0.012);

  const wg = mod('Wing'); // Profilflügel mit Schwanenhals-Haltern
  const foil = [];
  for (let i = 16; i >= 0; i--) foil.push(i);
  const af = (i, up) => {
    const x = (1 - Math.cos((Math.PI * i) / 16)) / 2, yt = 0.6 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    return [0.28 * x, 0.28 * (-0.2 * x * (1 - x) + (up ? yt : -yt))];
  };
  const wingGeo = new THREE.ExtrudeGeometry(shape([...foil.map((i) => af(i, true)), ...foil.reverse().slice(1).map((i) => af(i, false))]), { depth: 1.55, bevelEnabled: false })
    .translate(0, 0, -0.775).rotateY(Math.PI / 2);
  mesh(wingGeo, M.carbon, wg, 0, 1.22, -1.98, 0.12);
  pair((k) => {
    extrudeSide(shape([[0, 0], [-0.13, 0], [-0.1, 0.14], [-0.06, 0.23], [0.02, 0.26], [0.05, 0.24], [-0.02, 0.2], [-0.04, 0.12]]), 0.015, M.carbon, wg, k * 0.45, 1.0, -2.05);
    extrudeSide(shape([[0.04, -0.08], [-0.32, -0.06], [-0.34, 0.1], [0.02, 0.08]]), 0.01, M.carbon, wg, k * 0.78, 1.22, -1.98);
  });

  return car;
}

const scene = new THREE.Scene();
const cars = Object.entries(SPECS).map(([name, spec], i) => {
  const car = buildCar(name, spec);
  car.position.x = 0;
  scene.add(car);
  return [car, spec];
});

// Selbstcheck: Maße, Namen, Scheiben vorhanden
scene.updateMatrixWorld(true);
for (const [car, spec] of cars) {
  const shell = car.getObjectByName('Shell');
  const size = new THREE.Box3().setFromObject(shell).getSize(new THREE.Vector3());
  assert(Math.abs(size.z - 4.794) < 0.01, `${car.name} Länge ${size.z}`);
  assert(Math.abs(size.y + 0.14 - spec.H) < 0.01, `${car.name} Höhe ${size.y + 0.14}`);
  assert(Math.abs(size.x - spec.W) < 0.01, `${car.name} Breite ${size.x}`);
  assert(shell.children.some((m) => m.material === M.glass), `${car.name}: keine Scheiben`);
  for (const n of [...WHEELS, ...MODS.map((m) => 'Mod_' + m)]) assert(car.getObjectByName(n), `${car.name}: ${n} fehlt`);
}

scene.traverse((o) => { if (o.geometry) o.geometry.deleteAttribute('uv'); }); // Spiel nutzt keine Texturen
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.writeFileSync(new URL('../../public/cars/falke.glb', import.meta.url), Buffer.from(glb));
console.log(`falke.glb geschrieben (${(glb.byteLength / 1024).toFixed(0)} KB)`);
