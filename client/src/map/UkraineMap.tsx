import { useCallback, useEffect, useRef, useState } from 'react';
import { DroneIcon } from '../components/DroneIcon.tsx';
import { traceDrone } from './drone.ts';
import { DECOR_SHAPES, MAP_HEIGHT, MAP_WIDTH, REGION_SHAPES, type RegionShape } from './geometry.ts';

export interface UkraineMapProps {
  /** Drones left per region; regions missing here still have all `dronesPerRegion` drones. */
  drones: Record<string, number>;
  dronesPerRegion: number;
  names: Record<string, string>;
  /** Called with a region id when a region that still has drones is clicked. */
  onSelect?: (regionId: string) => void;
  disabled?: boolean;
}

const COLORS = {
  region: '#fcd34d', // є безпілотники
  regionHover: '#fbbf24',
  cleared: '#22c55e', // очищено
  decor: '#cbd5e1',
  border: '#b45309',
  clearedBorder: '#15803d',
  hoverBorder: '#0f172a',
  drone: '#1f2937',
  droneEdge: '#ffffff',
};

/** Legend / tooltip wording. */
export const MAP_LABELS = {
  hasDrones: 'Є безпілотники',
  cleared: 'Очищено',
} as const;

const FLASH_MS = 700; // region turning green
const BLAST_MS = 650; // drone shot down
const LABEL_MIN_WIDTH = 560; // CSS px; below this labels would overlap
const ROW_SPACING = 19; // map units between drones in a region's row (see build-geometry)

interface PreparedShape extends RegionShape {
  path: Path2D;
}

let prepared: { regions: PreparedShape[]; decor: PreparedShape[] } | null = null;
/** Path2D objects are built once per page load, in map coordinates. */
function getShapes() {
  if (prepared) return prepared;
  const build = (s: RegionShape): PreparedShape => {
    const path = new Path2D();
    for (const ring of s.rings) {
      path.moveTo(ring[0]!, ring[1]!);
      for (let i = 2; i < ring.length; i += 2) path.lineTo(ring[i]!, ring[i + 1]!);
      path.closePath();
    }
    return { ...s, path };
  };
  prepared = { regions: REGION_SHAPES.map(build), decor: DECOR_SHAPES.map(build) };
  return prepared;
}

let hitCtx: CanvasRenderingContext2D | null = null;
function hitTest(x: number, y: number): string | null {
  hitCtx ??= document.createElement('canvas').getContext('2d');
  if (!hitCtx) return null;
  const { regions, decor } = getShapes();
  if (decor.some((d) => hitCtx!.isPointInPath(d.path, x, y, 'evenodd'))) return null;
  return regions.find((r) => hitCtx!.isPointInPath(r.path, x, y, 'evenodd'))?.id ?? null;
}

export function UkraineMap({ drones, dronesPerRegion, names, onSelect, disabled = false }: UkraineMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, dpr: 1 });
  const hovered = useRef<string | null>(null);
  const flashes = useRef(new Map<string, number>());
  const blasts = useRef<{ regionId: string; index: number; start: number }[]>([]);
  const prevDrones = useRef<Record<string, number>>(drones);
  const frame = useRef(0);
  const props = useRef({ drones, dronesPerRegion, names, disabled });
  props.current = { drones, dronesPerRegion, names, disabled };
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  const leftIn = (id: string) => props.current.drones[id] ?? props.current.dronesPerRegion;

  const draw = useCallback((now: number): boolean => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { width, dpr } = size.current;
    if (!canvas || !ctx || !width) return false;
    const { drones, dronesPerRegion, names, disabled } = props.current;
    const left = (id: string) => drones[id] ?? dronesPerRegion;
    const { regions, decor } = getShapes();
    const s = width / MAP_WIDTH;
    let animating = false;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ----- regions (map units) -----
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    ctx.lineJoin = 'round';
    for (const r of regions) {
      const cleared = left(r.id) === 0;
      const hot = !disabled && !cleared && hovered.current === r.id;
      ctx.fillStyle = cleared ? COLORS.cleared : hot ? COLORS.regionHover : COLORS.region;
      ctx.fill(r.path, 'evenodd');

      const started = flashes.current.get(r.id);
      if (started !== undefined) {
        const t = (now - started) / FLASH_MS;
        if (t >= 1) flashes.current.delete(r.id);
        else {
          ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - t) ** 2})`;
          ctx.fill(r.path, 'evenodd');
          animating = true;
        }
      }
    }
    ctx.lineWidth = 1 / s;
    for (const r of regions) {
      ctx.strokeStyle = left(r.id) === 0 ? COLORS.clearedBorder : COLORS.border;
      ctx.stroke(r.path);
    }
    ctx.fillStyle = COLORS.decor;
    ctx.strokeStyle = COLORS.border;
    for (const d of decor) {
      ctx.fill(d.path, 'evenodd');
      ctx.stroke(d.path);
    }
    const hot = hovered.current && !disabled ? regions.find((r) => r.id === hovered.current) : undefined;
    if (hot && left(hot.id) > 0) {
      ctx.strokeStyle = COLORS.hoverBorder;
      ctx.lineWidth = 2.5 / s;
      ctx.stroke(hot.path);
    }

    // ----- labels, drones and blasts (CSS pixels, crisp at any size) -----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (width >= LABEL_MIN_WIDTH) {
      const base = Math.min(13, Math.max(9, width / 85));
      for (const r of regions) {
        const name = names[r.id];
        if (!name) continue;
        const label = r.id === 'crimea' ? 'АР Крим' : name;
        const cleared = left(r.id) === 0;
        ctx.font = `600 ${label.length > 13 ? base * 0.85 : base}px system-ui, -apple-system, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = cleared ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.8)';
        ctx.fillStyle = cleared ? '#ffffff' : '#422006';
        const [x, y] = [r.label[0] * s, r.label[1] * s];
        ctx.strokeText(label, x, y);
        ctx.fillText(label, x, y);
      }
    }

    // A row of 3 drones needs room; on narrow maps show one drone with a "×N" badge.
    const compact = ROW_SPACING * s < 15;
    const r = compact ? Math.max(6, Math.min(9, width / 45)) : Math.min(11, ROW_SPACING * s * 0.46);
    const drawDrone = (x: number, y: number, alpha = 1, scale = 1) => {
      ctx.globalAlpha = alpha;
      traceDrone(ctx, x, y, r * scale);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = COLORS.droneEdge;
      ctx.stroke();
      ctx.fillStyle = COLORS.drone;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = COLORS.drone;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    for (const region of regions) {
      const n = left(region.id);
      const spots = region.drones ?? [];
      if (!n || !spots.length) continue;
      if (compact) {
        const [mx, my] = spots[Math.floor(spots.length / 2)]!;
        drawDrone(mx * s, my * s);
        if (n > 1) {
          ctx.font = `700 ${Math.round(r * 1.1)}px system-ui, -apple-system, sans-serif`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#ffffff';
          ctx.fillStyle = COLORS.drone;
          ctx.strokeText(`×${n}`, mx * s + r * 1.6, my * s + r * 0.6);
          ctx.fillText(`×${n}`, mx * s + r * 1.6, my * s + r * 0.6);
        }
      } else {
        for (let i = 0; i < Math.min(n, spots.length); i++) drawDrone(spots[i]![0] * s, spots[i]![1] * s);
      }
    }

    // Shot-down drones: the drone shrinks and fades inside an expanding orange blast.
    blasts.current = blasts.current.filter((b) => now - b.start < BLAST_MS);
    for (const b of blasts.current) {
      const region = regions.find((x) => x.id === b.regionId);
      const spots = region?.drones ?? [];
      const spot = compact ? spots[Math.floor(spots.length / 2)] : spots[b.index];
      if (!spot) continue;
      const t = (now - b.start) / BLAST_MS;
      const [x, y] = [spot[0] * s, spot[1] * s];
      ctx.beginPath();
      ctx.arc(x, y, r * (0.6 + 1.8 * t), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(249,115,22,${0.85 * (1 - t)})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r * (0.3 + 1.1 * t), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(254,240,138,${0.9 * (1 - t)})`;
      ctx.fill();
      if (t < 0.5) drawDrone(x, y, 1 - t * 2, 1 - t);
      animating = true;
    }
    return animating;
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frame.current) return;
    const tick = (now: number) => {
      frame.current = 0;
      if (draw(now)) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [draw]);

  // Keep the canvas backing store matched to its CSS size × devicePixelRatio.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const width = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const height = (width * MAP_HEIGHT) / MAP_WIDTH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      size.current = { width, dpr };
      draw(performance.now());
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [draw]);

  // Animate drones that were just shot down and regions that were just cleared.
  useEffect(() => {
    const now = performance.now();
    for (const [id, n] of Object.entries(drones)) {
      const before = prevDrones.current[id] ?? dronesPerRegion;
      for (let i = before - 1; i >= n; i--) blasts.current.push({ regionId: id, index: i, start: now });
      if (n === 0 && before > 0) flashes.current.set(id, now);
    }
    prevDrones.current = drones;
    scheduleDraw();
  }, [drones, dronesPerRegion, names, disabled, scheduleDraw]);

  const toMap = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = rect.width / MAP_WIDTH;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s, cssX: e.clientX - rect.left, cssY: e.clientY - rect.top };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const p = toMap(e);
    const id = hitTest(p.x, p.y);
    if (id !== hovered.current) {
      hovered.current = id;
      scheduleDraw();
    }
    canvasRef.current!.style.cursor = id && !disabled && leftIn(id) > 0 ? 'pointer' : 'default';
    setTooltip(id ? { id, x: p.cssX, y: p.cssY } : null);
  };

  const onPointerLeave = () => {
    hovered.current = null;
    setTooltip(null);
    scheduleDraw();
  };

  const onClick = (e: React.MouseEvent) => {
    if (disabled || !onSelect) return;
    const p = toMap(e);
    const id = hitTest(p.x, p.y);
    if (id && leftIn(id) > 0) onSelect(id);
  };

  const tipLeft = tooltip ? leftIn(tooltip.id) : 0;

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ touchAction: 'manipulation' }}>
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        aria-hidden="true"
        className="block"
      />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900/90 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-white shadow"
          style={{ left: tooltip.x, top: tooltip.y - 10 }}
        >
          {names[tooltip.id] ?? tooltip.id}
          {tipLeft === 0 ? ' · очищено' : ` · дронів: ${tipLeft}`}
        </div>
      )}
      {/* Accessible fallback: the same regions as buttons for keyboard / screen-reader users. */}
      <ul className="sr-only">
        {REGION_SHAPES.map((r) => (
          <li key={r.id}>
            <button type="button" disabled={disabled || leftIn(r.id) === 0} onClick={() => onSelect?.(r.id)}>
              {names[r.id] ?? r.id}: дронів {leftIn(r.id)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm ring-1 ring-amber-700" style={{ background: COLORS.region }} />
        {MAP_LABELS.hasDrones}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm ring-1 ring-green-700" style={{ background: COLORS.cleared }} />
        {MAP_LABELS.cleared}
      </span>
      <span className="inline-flex items-center gap-1">
        <DroneIcon className="h-4 w-4" /> = 1 питання, правильна відповідь збиває дрон
      </span>
    </div>
  );
}
