import { useEffect, useState } from 'react';

/** 125000 → "2:05", 3725000 → "1:02:05" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Re-renders every `intervalMs` while active and returns Date.now(). */
export function useNow(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Сталася помилка');

/** Short region label for the map. */
export const shortRegionName = (id: string, name: string) => (id === 'crimea' ? 'АР Крим' : name);
