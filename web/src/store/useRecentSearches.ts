import { useCallback, useEffect, useRef, useState } from "react";
import { getMeta, setMeta } from "./db";
import { withRecentSearch } from "../lib/recentSearches";

const KEY = "recentSearches";

/**
 * The chips shown before the user has typed anything into search.
 *
 * Local only, and it stays that way — see the file comment in
 * lib/recentSearches.ts. There is no dirty flag and nothing here ever
 * reaches the outbox; it is read once on mount and written straight back to
 * the same device's own store on every remembered term. A write that fails
 * costs one chip and is not worth a word; it is caught so it costs nothing
 * else either.
 */
export function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  // The list as it stands, for `rememberSearch` to compute from. It used to
  // compute inside the state updater and write to IndexedDB from there — an
  // updater runs when React renders, twice under StrictMode and not at all
  // when it bails out, so a side effect in one is a write made a random
  // number of times.
  const listRef = useRef(recentSearches);

  useEffect(() => {
    let cancelled = false;
    getMeta<string[]>(KEY).then(
      (stored) => {
        if (cancelled || !stored) return;
        listRef.current = stored;
        setRecentSearches(stored);
      },
      () => {
        /* no chips this session */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const rememberSearch = useCallback((term: string) => {
    const next = withRecentSearch(listRef.current, term);
    if (next === listRef.current) return;
    listRef.current = next;
    setRecentSearches(next);
    setMeta(KEY, next).catch(() => {
      /* one chip, next open */
    });
  }, []);

  return { recentSearches, rememberSearch };
}
