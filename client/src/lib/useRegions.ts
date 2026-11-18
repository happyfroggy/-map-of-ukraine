import { useEffect, useState } from 'react';
import type { Region } from '../../../shared/types.ts';
import { api } from './api.ts';

let cache: Promise<Region[]> | null = null;

/** Region list from the server (fetched once per page load). */
export function useRegions(): Region[] {
  const [regions, setRegions] = useState<Region[]>([]);
  useEffect(() => {
    cache ??= api<Region[]>('/regions').catch((err) => {
      cache = null;
      throw err;
    });
    let alive = true;
    cache.then((r) => alive && setRegions(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return regions;
}
