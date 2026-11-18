// localStorage can throw (private mode, blocked storage) — never let that break the app.

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function slot<T>(key: string) {
  return {
    get(): T | null {
      const raw = read(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set(value: T | null) {
      write(key, value === null ? null : JSON.stringify(value));
    },
  };
}

export const playerTokenStore = slot<string>('mou.playerToken');
export const adminTokenStore = slot<string>('mou.adminToken');
export const adminRoomStore = slot<import('../../../shared/types.ts').CreatedSession>('mou.adminRoom');
