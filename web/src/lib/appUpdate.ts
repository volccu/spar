/**
 * A newer build, noticed and offered — never forced, and never missed.
 *
 * The app is installed on a phone and left open in the background for days,
 * and that is the case a service worker handles worst. The browser only
 * *looks* for a new worker on a navigation or once a day, and an installed
 * app that is brought back from the background does neither — so a deploy
 * could sit on the server for a week while the phone ran the build before
 * it. And even once a new worker is found and lets itself in, the page that
 * is open keeps running the old code until something reloads it; nothing
 * did. The desktop saw every deploy because a desktop tab is closed and
 * reopened; the phone saw none of them (2026-09-16, the owner's own two
 * devices).
 *
 * Two jobs, then:
 *
 * 1. **Look.** Ask the registration to check for a new worker each time the
 *    app comes to the front, and every hour while it stays there
 *    (`scheduleUpdateChecks`). Coming to the front is the moment somebody is
 *    about to use it, which is the moment a stale build costs something.
 * 2. **Offer.** When a new worker is installed and waiting, tell the app, and
 *    the app puts an **Update** button in the header. Pressing it tells the
 *    waiting worker to take over and reloads the page once it has. The
 *    worker is built in `prompt` mode (vite.config.ts) precisely so that it
 *    *waits*: a worker that takes over on its own swaps the cache out from
 *    under a page still running the old build, which is what produced the
 *    chunk-404 reload in main.tsx. Waiting, nothing changes until the user
 *    says so — and if they never do, the new worker takes over by itself the
 *    next time the app is fully closed and reopened, which is the ordinary
 *    browser behaviour and needs nothing from us.
 *
 * The registering itself goes through vite-plugin-pwa's `virtual:pwa-register`,
 * which wraps workbox-window. It is reached by a dynamic import behind the
 * `serviceWorker in navigator` check, so a test environment — which has no
 * service workers — never loads it.
 */

/** How often to look for a new build while the app stays in front. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

export interface UpdateWatch {
  /** Tell the waiting worker to take over; the page reloads once it has. */
  apply: () => Promise<void>;
  /** Stop looking. */
  stop: () => void;
}

interface Options {
  /** A new build is installed and waiting for the user's say-so. */
  onReady: () => void;
}

/** The two clocks `scheduleUpdateChecks` reads, so a test can hand in its own. */
export interface Clocks {
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
  isHidden: () => boolean;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
}

const browserClocks = (): Clocks => ({
  addVisibilityListener: (l) => document.addEventListener("visibilitychange", l),
  removeVisibilityListener: (l) => document.removeEventListener("visibilitychange", l),
  isHidden: () => document.hidden,
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
});

/**
 * Run `check` each time the app comes to the front, and every
 * `UPDATE_CHECK_MS` while it stays there. Nothing runs while it is hidden:
 * a backgrounded tab has nobody to show an update to, and a phone keeping a
 * timer alive behind a locked screen is the same waste `lib/clock.ts` refuses.
 * Returns the function that stops it.
 */
export function scheduleUpdateChecks(check: () => void, clocks: Clocks = browserClocks()): () => void {
  let timer: number | null = null;

  const start = () => {
    if (timer === null) timer = clocks.setInterval(check, UPDATE_CHECK_MS);
  };
  const stop = () => {
    if (timer !== null) {
      clocks.clearInterval(timer);
      timer = null;
    }
  };
  const onVisibility = () => {
    if (clocks.isHidden()) {
      stop();
    } else {
      check();
      start();
    }
  };

  clocks.addVisibilityListener(onVisibility);
  if (!clocks.isHidden()) start();

  return () => {
    clocks.removeVisibilityListener(onVisibility);
    stop();
  };
}

/**
 * Register the worker and watch for a newer one. Resolves to nothing where
 * there are no service workers — a test, an old browser — and the app then
 * simply never offers an update, which is what it did before.
 */
export async function watchForUpdate({ onReady }: Options): Promise<UpdateWatch | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;

  const { registerSW } = await import("virtual:pwa-register");
  let stopChecks: () => void = () => {};

  const apply = registerSW({
    onNeedRefresh: onReady,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      stopChecks = scheduleUpdateChecks(() => {
        // A failed check while offline is nothing to report; the next one
        // will try again. Failing while online is worth a line in the console.
        registration.update().catch((error: unknown) => {
          if (navigator.onLine) console.warn("checking for a new build failed", error);
        });
      });
    },
  });

  return {
    apply: () => apply(true),
    stop: () => stopChecks(),
  };
}
