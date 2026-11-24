// Shahed-style delta-wing drone silhouette (top view), nose up, in a unit box [-1, 1].
// Shared by the Canvas map and the SVG icon so both look identical.

export const DRONE_OUTLINE: [number, number][] = [
  [0, -1], // nose
  [0.13, -0.6],
  [1, 0.5], // right wingtip
  [0.94, 0.7],
  [0.22, 0.48], // trailing edge meets fuselage
  [0.13, 0.86], // tail / propeller housing
  [-0.13, 0.86],
  [-0.22, 0.48],
  [-0.94, 0.7],
  [-1, 0.5], // left wingtip
  [-0.13, -0.6],
];

/** Small vertical stabilisers at the wingtips. */
export const DRONE_FINS: [number, number][][] = [
  [[0.97, 0.6], [0.9, 0.22]],
  [[-0.97, 0.6], [-0.9, 0.22]],
];

/** Slight tilt so the drones look like they are flying, not parked. */
export const DRONE_TILT = (-25 * Math.PI) / 180;

export const DRONE_SVG_PATH =
  DRONE_OUTLINE.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ') +
  ' Z ' +
  DRONE_FINS.map(([[x1, y1], [x2, y2]]) => `M${x1} ${y1} L${x2} ${y2}`).join(' ');

/** Traces the drone outline (not the fins) on a canvas at (cx, cy) with half-size r. */
export function traceDrone(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, tilt = DRONE_TILT): void {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const at = ([x, y]: [number, number]): [number, number] => [cx + (x * cos - y * sin) * r, cy + (x * sin + y * cos) * r];
  ctx.beginPath();
  DRONE_OUTLINE.forEach((p, i) => {
    const [x, y] = at(p);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  for (const [a, b] of DRONE_FINS) {
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
}
