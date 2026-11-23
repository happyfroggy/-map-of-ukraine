import { useCallback, useEffect, useRef, useState } from 'react';
import type { RegionStatus } from '../../../shared/types.ts';
import { DECOR_SHAPES, MAP_HEIGHT, MAP_WIDTH, REGION_SHAPES, type RegionShape } from './geometry.ts';

export interface UkraineMapProps {
  statuses: Record<string, RegionStatus>;
  names: Record<string, string>;
  /** Called with a region id when a not-yet-explored region is clicked (blue ones can be retried). */
  onSelect?: (regionId: string) => void;
  disabled?: boolean;
}

const COLORS = {
  neutral: '#ffffff', // не досліджено
  neutralHover: '#e0ecff',
  in_progress: '#fcd34d', // не допройдено
  in_progressHover: '#fbbf24',
  green: '#22c55e', // досліджено
  red: '#3b82f6', // неправильно досліджено (status 'red' in the data model)
  redHover: '#2563eb',
  decor: '#cbd5e1',
  border: '#94a3b8',
  hoverBorder: '#0f172a',
};

/** Legend / tooltip wording for each state. */
export const STATUS_LABELS = {
  none: 'Не досліджено',
  in_progress: 'Не допройдено',
  red: 'Неправильно досліджено',
  green: 'Досліджено',
} as const;
const FLASH_MS = 700;
const LABEL_MIN_WIDTH = 560; // CSS px; below this labels would overlap

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

/** Finished a round (green or blue) — used for the colour-change flash. */
const isResolved = (s: RegionStatus | undefined) => s === 'green' || s === 'red';
/** Everything except explored regions can be opened; blue ones start a retry. */
const isClickable = (s: RegionStatus | undefined) => s !== 'green';

export function UkraineMap({ statuses, names, onSelect, disabled = false }: UkraineMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, dpr: 1 });
  const hovered = useRef<string | null>(null);
  const flashes = useRef(new Map<string, number>());
  const prevStatuses = useRef<Record<string, RegionStatus>>(statuses);
  const frame = useRef(0);
  const props = useRef({ statuses, names, disabled });
  props.current = { statuses, names, disabled };
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);

  const draw = useCallback((now: number): boolean => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { width, dpr } = size.current;
    if (!canvas || !ctx || !width) return false;
    const { statuses, names, disabled } = props.current;
    const { regions, decor } = getShapes();
    const s = width / MAP_WIDTH;
    let animating = false;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, 0);
    ctx.lineJoin = 'round';

    for (const r of regions) {
      const status = statuses[r.id];
      const hot = !disabled && hovered.current === r.id && isClickable(status);
      ctx.fillStyle =
        status === 'green' ? COLORS.green
        : status === 'red' ? (hot ? COLORS.redHover : COLORS.red)
        : status === 'in_progress' ? (hot ? COLORS.in_progressHover : COLORS.in_progress)
        : hot ? COLORS.neutralHover
        : COLORS.neutral;
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

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1 / s;
    for (const r of regions) ctx.stroke(r.path);

    ctx.fillStyle = COLORS.decor;
    for (const d of decor) {
      ctx.fill(d.path, 'evenodd');
      ctx.stroke(d.path);
    }

    const hot = hovered.current && !disabled ? regions.find((r) => r.id === hovered.current) : undefined;
    if (hot && isClickable(statuses[hot.id])) {
      ctx.strokeStyle = COLORS.hoverBorder;
      ctx.lineWidth = 2.5 / s;
      ctx.stroke(hot.path);
    }

    // Labels are drawn in CSS pixels so text stays crisp and readable at any size.
    if (width >= LABEL_MIN_WIDTH) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const base = Math.min(13, Math.max(9, width / 85));
      for (const r of regions) {
        const name = names[r.id];
        if (!name) continue;
        const label = r.id === 'crimea' ? 'АР Крим' : name;
        const status = statuses[r.id];
        const onColor = isResolved(status);
        ctx.font = `600 ${label.length > 13 ? base * 0.85 : base}px system-ui, -apple-system, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = onColor ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.85)';
        ctx.fillStyle = onColor ? '#ffffff' : '#334155';
        const [x, y] = [r.label[0] * s, r.label[1] * s];
        ctx.strokeText(label, x, y);
        ctx.fillText(label, x, y);
      }
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

  // Flash regions whose status just changed.
  useEffect(() => {
    const now = performance.now();
    for (const [id, status] of Object.entries(statuses)) {
      if (prevStatuses.current[id] !== status && isResolved(status)) flashes.current.set(id, now);
    }
    prevStatuses.current = statuses;
    scheduleDraw();
  }, [statuses, names, disabled, scheduleDraw]);

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
    const clickable = id && !disabled && isClickable(statuses[id]);
    canvasRef.current!.style.cursor = clickable ? 'pointer' : 'default';
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
    if (id && isClickable(statuses[id])) onSelect(id);
  };

  const tipStatus = tooltip ? statuses[tooltip.id] : undefined;

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
          {tipStatus === 'green' && ` · ${STATUS_LABELS.green.toLowerCase()}`}
          {tipStatus === 'red' && ` · ${STATUS_LABELS.red.toLowerCase()} — спробуйте ще раз`}
          {tipStatus === 'in_progress' && ` · ${STATUS_LABELS.in_progress.toLowerCase()}`}
        </div>
      )}
      {/* Accessible fallback: the same regions as buttons for keyboard / screen-reader users. */}
      <ul className="sr-only">
        {REGION_SHAPES.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              disabled={disabled || !isClickable(statuses[r.id])}
              onClick={() => onSelect?.(r.id)}
            >
              {names[r.id] ?? r.id}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MapLegend() {
  const items = [
    [COLORS.neutral, STATUS_LABELS.none],
    [COLORS.in_progress, STATUS_LABELS.in_progress],
    [COLORS.red, STATUS_LABELS.red],
    [COLORS.green, STATUS_LABELS.green],
  ] as const;
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map(([color, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm ring-1 ring-slate-400" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
