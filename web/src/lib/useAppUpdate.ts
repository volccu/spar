import { useCallback, useEffect, useRef, useState } from "react";
import { watchForUpdate, type UpdateWatch } from "./appUpdate";

/**
 * Whether a newer build is waiting, and the way to take it (`lib/appUpdate.ts`).
 *
 * The watch is started once for the life of the app and stopped when it goes;
 * `applyUpdate` is what the header's Update button presses.
 */
export function useAppUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  /**
   * A newer build is installed and waiting for the word. Set once by
   * `watchForUpdate` and never cleared: the only way out is the reload that
   * pressing Update ends in. `web/CLAUDE.md`, "A new build is offered".
   */
  const [updateReady, setUpdateReady] = useState(false);
  const updateWatch = useRef<UpdateWatch | null>(null);
  useEffect(() => {
    let cancelled = false;
    void watchForUpdate({ onReady: () => setUpdateReady(true) }).then((watch) => {
      if (cancelled) watch?.stop();
      else updateWatch.current = watch;
    });
    return () => {
      cancelled = true;
      updateWatch.current?.stop();
      updateWatch.current = null;
    };
  }, []);
  const applyUpdate = useCallback(() => void updateWatch.current?.apply(), []);
  return { updateReady, applyUpdate };
}
