import { DRONE_SVG_PATH, DRONE_TILT } from '../map/drone.ts';

/** The drone silhouette as an inline SVG; `down` shows a shot-down (faded, crossed) drone. */
export function DroneIcon({ down = false, className = 'h-6 w-6' }: { down?: boolean; className?: string }) {
  return (
    <svg viewBox="-1.15 -1.15 2.3 2.3" className={className} aria-hidden="true">
      <g transform={`rotate(${(DRONE_TILT * 180) / Math.PI})`}>
        <path
          d={DRONE_SVG_PATH}
          fill={down ? '#cbd5e1' : '#1f2937'}
          stroke={down ? '#cbd5e1' : '#1f2937'}
          strokeWidth={0.1}
          strokeLinejoin="round"
        />
      </g>
      {down && <path d="M-0.8 -0.8 L0.8 0.8 M0.8 -0.8 L-0.8 0.8" stroke="#dc2626" strokeWidth={0.18} strokeLinecap="round" />}
    </svg>
  );
}

/** A row of drones for a region: remaining ones dark, shot-down ones faded and crossed. */
export function DroneRow({ left, total, className }: { left: number; total: number; className?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Дронів лишилося: ${left} з ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <DroneIcon key={i} down={i >= left} className={className} />
      ))}
    </span>
  );
}
