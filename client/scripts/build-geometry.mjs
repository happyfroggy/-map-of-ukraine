// Converts a GeoJSON of Ukrainian ADM1 regions into compact, pre-projected
// polygon data for the Canvas map (src/map/geometry.ts).
//
// Source used: geoBoundaries gbOpen UKR ADM1 (simplified), data © OpenStreetMap
// contributors, ODbL 1.0 — https://www.geoboundaries.org
//
// Usage: node scripts/build-geometry.mjs <path/to/geoBoundaries-UKR-ADM1_simplified.geojson>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISO_TO_ID = {
  'UA-43': 'crimea', 'UA-05': 'vinnytsia', 'UA-07': 'volyn', 'UA-12': 'dnipropetrovsk',
  'UA-14': 'donetsk', 'UA-18': 'zhytomyr', 'UA-21': 'zakarpattia', 'UA-23': 'zaporizhzhia',
  'UA-26': 'ivano-frankivsk', 'UA-32': 'kyiv', 'UA-35': 'kirovohrad', 'UA-09': 'luhansk',
  'UA-46': 'lviv', 'UA-48': 'mykolaiv', 'UA-51': 'odesa', 'UA-53': 'poltava', 'UA-56': 'rivne',
  'UA-59': 'sumy', 'UA-61': 'ternopil', 'UA-63': 'kharkiv', 'UA-65': 'kherson',
  'UA-68': 'khmelnytskyi', 'UA-71': 'cherkasy', 'UA-77': 'chernivtsi', 'UA-74': 'chernihiv',
};
// Cities with special status: drawn, but not playable.
const DECOR = { 'UA-30': 'kyiv-city', 'UA-40': 'sevastopol' };

const WIDTH = 1000;
const PADDING = 8;
const TOLERANCE = 0.6; // map units (≈ CSS px at full width)
const MIN_RING_AREA = 4; // drop tiny islands

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-geometry.mjs <geojson>');
  process.exit(1);
}
const geo = JSON.parse(readFileSync(src, 'utf8'));

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

// Equirectangular projection corrected for Ukraine's mid latitude.
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const f of geo.features) {
  for (const poly of polygonsOf(f.geometry)) {
    for (const [lon, lat] of poly[0]) {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
  }
}
const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
const scale = (WIDTH - 2 * PADDING) / ((maxLon - minLon) * k);
const HEIGHT = Math.ceil((maxLat - minLat) * scale + 2 * PADDING);
const project = ([lon, lat]) => [PADDING + (lon - minLon) * k * scale, PADDING + (maxLat - lat) * scale];

function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Closed rings start and end at the same point, so split at the farthest vertex first. */
function simplifyRing(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 0, farD = -1;
  ring.forEach(([x, y], i) => {
    const d = Math.hypot(x - x0, y - y0);
    if (d > farD) { farD = d; far = i; }
  });
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify(ring.slice(far), tol);
  return [...a, ...b.slice(1)];
}

const area = (ring) => {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
};
const inside = (x, y, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const distToRing = (x, y, ring) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
};
/** Point well inside the largest ring — good spot for a label. */
function labelPoint(ring) {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = -1;
  const step = Math.max(1.5, Math.min(x1 - x0, y1 - y0) / 40);
  for (let x = x0; x <= x1; x += step) {
    for (let y = y0; y <= y1; y += step) {
      if (!inside(x, y, ring)) continue;
      const d = distToRing(x, y, ring);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
  }
  return best.map((v) => Math.round(v));
}

const DRONES_PER_REGION = 3;

/**
 * Where to draw a region's drones: a tidy row just above/below the label when
 * it fits, otherwise the roomiest spots inside the region, spaced apart.
 */
function dronePoints(ring, label) {
  const fits = ([x, y], margin) => inside(x, y, ring) && distToRing(x, y, ring) >= margin;
  for (const dy of [-17, 17, -24, 24]) {
    for (const gap of [19, 16, 13]) {
      const row = [-gap, 0, gap].map((dx) => [label[0] + dx, label[1] + dy]);
      if (row.every((p) => fits(p, 5))) return row.map((p) => p.map(Math.round));
    }
  }
  // Fallback: greedy farthest-from-edge points, away from the label and each other.
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cands = [];
  for (let x = x0; x <= x1; x += 2) for (let y = y0; y <= y1; y += 2) {
    if (inside(x, y, ring)) cands.push({ p: [x, y], d: distToRing(x, y, ring) });
  }
  cands.sort((a, b) => b.d - a.d);
  for (const [spacing, labelGap] of [[16, 11], [12, 9], [9, 0]]) {
    const chosen = [];
    for (const c of cands) {
      if (Math.abs(c.p[0] - label[0]) < 26 && Math.abs(c.p[1] - label[1]) < labelGap) continue;
      if (chosen.some((q) => Math.hypot(q[0] - c.p[0], q[1] - c.p[1]) < spacing)) continue;
      chosen.push(c.p);
      if (chosen.length === DRONES_PER_REGION) return chosen.map((p) => p.map(Math.round));
    }
  }
  throw new Error('no room for drones');
}

const round = (v) => Math.round(v * 10) / 10;
const regions = [];
const decor = [];
let totalPoints = 0;

for (const f of geo.features) {
  const iso = f.properties.shapeISO;
  const id = ISO_TO_ID[iso] ?? DECOR[iso];
  if (!id) throw new Error(`Unknown region ${iso} (${f.properties.shapeName})`);

  const rings = [];
  let largest = null;
  for (const poly of polygonsOf(f.geometry)) {
    poly.forEach((ring, ri) => {
      const projected = simplifyRing(ring.map(project), TOLERANCE);
      if (projected.length < 4 || area(projected) < MIN_RING_AREA) return;
      if (ri === 0 && (!largest || area(projected) > area(largest))) largest = projected;
      rings.push(projected);
    });
  }
  totalPoints += rings.reduce((s, r) => s + r.length, 0);
  const label = labelPoint(largest);
  const shape = { id, rings: rings.map((r) => r.flatMap(([x, y]) => [round(x), round(y)])), label };
  if (ISO_TO_ID[iso]) shape.drones = dronePoints(largest, label);
  (ISO_TO_ID[iso] ? regions : decor).push(shape);
}

if (regions.length !== 25) throw new Error(`Expected 25 regions, got ${regions.length}`);
regions.sort((a, b) => a.id.localeCompare(b.id));

const out = `// GENERATED by scripts/build-geometry.mjs — do not edit by hand.
// Boundaries: geoBoundaries (gbOpen UKR ADM1), © OpenStreetMap contributors, ODbL 1.0.

export interface RegionShape {
  id: string;
  /** Flat [x0, y0, x1, y1, …] rings in map units. Holes are drawn with the even-odd rule. */
  rings: number[][];
  /** Label anchor inside the region. */
  label: [number, number];
  /** Drone (question) positions, ${DRONES_PER_REGION} per playable region. */
  drones?: [number, number][];
}

export const MAP_WIDTH = ${WIDTH};
export const MAP_HEIGHT = ${HEIGHT};

export const REGION_SHAPES: RegionShape[] = ${JSON.stringify(regions)};

/** Cities with special status — drawn for context, not playable. */
export const DECOR_SHAPES: RegionShape[] = ${JSON.stringify(decor)};
`;
const target = join(dirname(fileURLToPath(import.meta.url)), '../src/map/geometry.ts');
writeFileSync(target, out);
console.log(`Wrote ${target}: ${regions.length} regions + ${decor.length} decor, ${totalPoints} points, ${WIDTH}×${HEIGHT}, ${(out.length / 1024).toFixed(1)} KB`);
