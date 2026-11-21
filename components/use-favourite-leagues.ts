'use client';
// Device-local favourite leagues (canonical competition ids). Favourites only change ordering; they never filter.
import {useCallback, useEffect, useState} from 'react';

const KEY = 'mnemba-favourite-leagues', EVENT = 'mnemba-favourite-leagues';
const read = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 50) : []; } catch { return []; }
};

export function useFavouriteLeagues() {
  const [favourites, setFavourites] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setFavourites(read());
    sync();
    window.addEventListener(EVENT, sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const toggle = useCallback((id: string) => {
    const now = read(), next = now.includes(id) ? now.filter(x => x !== id) : [...now, id];
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep the in-memory state */ }
    setFavourites(next); window.dispatchEvent(new Event(EVENT));
  }, []);
  return {favourites, isFavourite: (id: string) => favourites.includes(id), toggle};
}
