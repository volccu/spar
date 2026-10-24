import { lazy, Suspense, type ComponentType, type JSX } from "react";

/**
 * Three panels only a gesture opens — the menu (the burger), the selection's
 * verbs (a hold or a right-click) and a board's own menu (a hold on its tab).
 * None is on the first paint, and together they were some 3.5 KiB of the entry
 * chunk's gzip, which had ~0.1 KiB of room under its ceiling (audit PERF-7).
 *
 * Each is asked for at idle once the board has painted (`prefetchPanels`, from
 * `App` beside `prefetchNoteView`), so the gesture finds it already in memory.
 * **And once it is in memory it draws in the same commit as the tap**, not a
 * tick later as `React.lazy` alone would: a menu that opened a frame late would
 * be a menu that felt slow. Only a tap that beats the prefetch waits for the
 * chunk, and draws nothing until it lands.
 *
 * Back reaches all three through `App`'s own state (`menuOpen`, `selecting`,
 * `boardMenu`), not through anything they register, so a Back in the moment
 * before one arrives still closes it.
 */
export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>) {
  let ready: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const fetch = () =>
    (pending ??= load().then(
      (component) => (ready = component),
      (error: unknown) => {
        // Offline and not yet cached: the next ask tries again.
        pending = null;
        throw error;
      },
    ));
  const Waiting = lazy(() => fetch().then((component) => ({ default: component })));
  function Panel(props: P): JSX.Element {
    const Ready = ready;
    if (Ready) return <Ready {...props} />;
    const Later = Waiting as unknown as ComponentType<P>;
    return (
      <Suspense fallback={null}>
        <Later {...props} />
      </Suspense>
    );
  }
  return { Panel, fetch };
}

const menu = lazyPanel(() => import("./MenuPanel").then((m) => m.MenuPanel));
const selection = lazyPanel(() => import("./SelectionBar").then((m) => m.SelectionBar));
const boardMenu = lazyPanel(() => import("./BoardMenu").then((m) => m.BoardMenu));

export const MenuPanel = menu.Panel;
export const SelectionBar = selection.Panel;
export const BoardMenu = boardMenu.Panel;

/** All three, fetched; resolves once every one can draw at once. */
export function loadPanels(): Promise<unknown> {
  return Promise.all([menu.fetch(), selection.fetch(), boardMenu.fetch()]);
}

/** `loadPanels` at idle, cancellable — the shape `prefetchNoteView` has. */
export function prefetchPanels(): () => void {
  const run = () =>
    void loadPanels().catch(() => {
      /* offline and not yet cached: the gesture that opens one asks again */
    });
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}
