/* push-sw.js — the part of the service worker that wakes you up.
 *
 * Pulled into the generated worker by `workbox.importScripts` in vite.config.ts
 * rather than by switching the whole build to injectManifest. The generated
 * worker already does something careful — precaching the shell, keeping the
 * 480kB PDF viewer out of it, falling back to index.html — and none of that is
 * worth rewriting to add two event listeners.
 *
 * This file is served as-is from /push-sw.js and is not bundled, so it gets no
 * TypeScript, no imports, and no build step. Keep it plain.
 *
 * What the phone draws from this is the browser's business, and worth knowing:
 * Firefox on Android shows *its own* logo as the small icon, our icon large,
 * the title, the body, and the site's host underneath — and it rings or stays
 * quiet according to Firefox's notification channel in Android's settings,
 * which no option here can override. Chrome gives an installed app its own
 * name, icon and channel. The payload is the same either way.
 */

// Short-long-short. Android honours it; everything else ignores it. A
// reminder is the one thing this app is allowed to interrupt with, so it is
// the one notification that buzzes.
const VIBRATE = [200, 100, 200];

/**
 * Where an answer given in the shade waits for the app to come up.
 *
 * The same trick `share-sw.js` uses, for the same reason: at the moment an
 * action button is pressed there may be no window at all, and this worker has
 * no business writing notes. IndexedDB holds the outbox, the per-field clocks
 * and the version rules that make a local write syncable, and every line of
 * that lives in TypeScript that cannot be imported here. So the worker records
 * *what was pressed* and nothing else; `web/src/lib/reminderActions.ts` turns
 * it into an ordinary edit on the next open, through the same `update` a tap
 * inside the app goes through.
 *
 * One entry per note, so answering the same reminder twice keeps the later
 * answer, and answering two different ones keeps both. Unlike the share inbox
 * this is never cleared wholesale — two reminders answered while the app was
 * shut are two independent facts, and dropping one because another arrived
 * would silently lose it.
 */
const ANSWER_INBOX = "reminder-answers";

self.addEventListener("push", (event) => {
  let payload = null;
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = null;
    }
  }

  if (!payload || typeof payload !== "object") {
    // A push that arrived unreadable — mangled, or from a subscription made
    // with a key that has since changed. It used to be dropped here, on the
    // theory that a notification that cannot say which note is worse than
    // silence. It is not: the subscription promised the browser every push
    // would show something (`userVisibleOnly`), Chrome shows a bare "this
    // site was updated" when a worker breaks that promise, and either way
    // the reminder itself — the one interruption the app owes — is lost.
    // So it says what it can and opens the app, where the overdue mark on
    // the card says the rest.
    event.waitUntil(
      self.registration.showNotification("Reminder", {
        body: "Open spår to see which note.",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "spar-reminder",
        vibrate: VIBRATE,
        data: { note_id: null },
      }),
    );
    return;
  }

  const title = payload.title || "Reminder";
  const at = payload.at ? Date.parse(payload.at) : NaN;
  const options = {
    body: payload.body || "",
    // The wordmark, in the one place the app cannot draw it itself.
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // The note's own id, so a second push about the same note replaces the
    // first in the shade instead of stacking beside it.
    tag: payload.note_id || "spar-reminder",
    renotify: true,
    vibrate: VIBRATE,
    // Never quietly. The subscription is the user saying "wake me".
    silent: false,
    // `for` is the occurrence this notification is about, carried so a Later
    // or a Done collected later can be checked against the reminder the note
    // holds *now* — see `answerPatch`.
    data: { note_id: payload.note_id || null, for: payload.at || null },
    // A reminder is the one thing in this app allowed to interrupt, so it
    // stays until it is dealt with rather than fading on its own.
    requireInteraction: true,
  };
  // The shade dates a notification by when it arrived. A reminder is about
  // when it was *for*, and a phone that slept through the minute should
  // still say so.
  if (Number.isFinite(at)) options.timestamp = at;
  // Composed in `_shared/notification.ts`, where the wording is tested. A
  // repeating reminder arrives with an empty list and gets no buttons — the
  // reasoning is written out there. Android draws at most two.
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    options.actions = payload.actions;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const noteId = event.notification.data && event.notification.data.note_id;

  // A button was pressed rather than the notification itself. The whole point
  // of these two words is that they are answered *without* going to the app,
  // so nothing is opened and nothing is focused: the answer is parked, any
  // window that happens to be running is nudged to collect it, and the phone
  // stays where it was.
  if (event.action === "later" || event.action === "done") {
    const about = event.notification.data && event.notification.data.for;
    event.waitUntil(answer(noteId, event.action, about));
    return;
  }
  // The note the reminder was about, opened directly. `?note=` is read once on
  // startup by App.tsx and then cleared out of the address bar.
  const url = noteId ? `/?note=${encodeURIComponent(noteId)}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Already open somewhere: bring that window forward and tell it which
      // note to show, rather than opening a second copy of the app.
      for (const client of clients) {
        if ("focus" in client) {
          if (noteId) client.postMessage({ type: "open-note", note_id: noteId });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

/**
 * Parks one answer, and tells an open window to come and get it.
 *
 * Never throws: a browser with no Cache API, a storage error, a notification
 * carrying no note id — every one of them is a press that does nothing, which
 * is the right failure. The reminder itself is untouched, so it is still
 * exactly where it was, and the note can be opened by hand.
 *
 * `at` is stamped **now**, when the button was pressed, not when the app next
 * comes up. A "Later" pressed at nine and collected at two in the afternoon
 * therefore asks for ten o'clock — a time already gone, so the app writes
 * the moment it collects it instead (`snoozedFrom`), and the sweep rings it
 * within the minute. That is the honest answer: the app
 * could not have rung at ten with nothing written to the server, so it rings
 * as soon as it can instead of quietly postponing the reminder five more
 * hours.
 */
async function answer(noteId, action, about) {
  if (!noteId || typeof caches === "undefined") return;
  try {
    const cache = await caches.open(ANSWER_INBOX);
    await cache.put(
      new Request(new URL(`/__reminder/${encodeURIComponent(noteId)}`, self.location.origin).href),
      new Response(
        JSON.stringify({
          note_id: noteId,
          action,
          at: new Date().toISOString(),
          for: about || null,
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    );
  } catch (error) {
    console.error("could not record the answer", error);
    return;
  }

  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "reminder-answered" });
  } catch {
    // No window to tell, which is the ordinary case: the app collects the
    // answer on its next open regardless.
  }
}
