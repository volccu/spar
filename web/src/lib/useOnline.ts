import { useEffect, useState } from "react";

/** Reactively exposes the browser's connectivity state to local-first UI. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

/**
 * Online as far as anything that draws it is concerned: the browser says so
 * *and* the last sync got an answer. A phone can report itself online with no
 * way out at all (mobile data and SIM off, 2026-10-23), and then only a sync
 * that went unanswered knows — `useSync` reports that as `offline`.
 */
export function useReachable(syncState: string): boolean {
  return useOnline() && syncState !== "offline";
}
