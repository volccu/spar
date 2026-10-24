/* share-sw.js — the door *into* the app from the phone's own share sheet.
 *
 * `lib/share.ts` is the way out: the note's words handed to Android or to the
 * Windows share panel. This is the way in. The manifest's `share_target` names
 * `/share` as a POST endpoint, Android posts the shared photos to it as an
 * ordinary multipart form, and no server ever sees it — the request is a
 * navigation inside the app's own scope, so this worker answers it.
 *
 * Pulled into the generated worker by `workbox.importScripts` in vite.config.ts,
 * beside push-sw.js and for the same reason: two listeners are not worth
 * rewriting the precaching for. It is served as-is from /share-sw.js and is not
 * bundled, so it gets no TypeScript, no imports, and no build step. Keep it
 * plain.
 *
 * It is deliberately the dumbest half of the feature. It reads the form, parks
 * what it found in a cache, and redirects to the app — nothing here decides
 * what the note says or what a shared file becomes. That lives in
 * `lib/shareTarget.ts`, where it can be read in TypeScript and tested.
 *
 * Why a cache and a redirect rather than handing the files straight to a
 * window: at the moment this runs there may be no window at all. The share is
 * what *starts* the app. So the bytes are parked where a page can find them,
 * and the page comes looking on every open.
 *
 * Ordering note: this listener is registered before workbox's, and workbox's
 * router holds routes for GET only — a POST it cannot match returns undefined
 * and it never calls `respondWith`. So the two do not fight over the response.
 */

/** Where a share waits for the app to come up. Read by lib/shareTarget.ts. */
const SHARE_INBOX = "share-inbox";

/** The path the manifest's `share_target` posts to. It exists only here. */
const SHARE_PATH = "/share";

/**
 * Where the browser is sent afterwards.
 *
 * The `?shared=1` is not read for meaning — the app drains the inbox on every
 * open regardless. It is there to make this a *different* URL from the one an
 * already-open window is sitting on, so the navigation actually happens
 * instead of being treated as a no-op reload of the current page.
 */
const LANDING = "/?shared=1";

/*
 * The bounds on what one share may park (2026-10-10, owner approved, audit
 * SEC-1). Any website can submit a form to `/share` — a service worker sees a
 * cross-site form navigation like any other — so this door takes no more than
 * a phone's share sheet plausibly sends. These are bounds, not decisions: the
 * app still decides what a share becomes, and since SEC-1 it asks first.
 *
 * MAX_FILE_BYTES is `MAX_FILE_BYTES` in lib/files.ts (and the bucket's own
 * `file_size_limit`) — a file over it is one the app would refuse anyway. The
 * count and the total are this door's alone. A file left out is named in the
 * words entry, under `left`, so the app can say so rather than lose it quietly.
 */
const MAX_FILES = 30;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** How many left-out names are worth carrying — the rest are just a count. */
const MAX_LEFT_NAMED = 20;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "POST") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname !== SHARE_PATH) return;
  event.respondWith(receive(request));
});

async function receive(request) {
  try {
    // A body far past anything the bounds below would keep is not read at all:
    // `formData()` would hold the whole of it before a single file could be
    // weighed. (Multipart framing is small; the slack is for it.) A request
    // with no length given is read, and bounded file by file below.
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_TOTAL_BYTES + MAX_FILE_BYTES) {
      throw new Error(`a share of ${length} bytes is past the bound`);
    }
    await stash(await request.formData());
  } catch (error) {
    // A share that will not parse still has to land somewhere: the user tapped
    // spår and is owed the app, not a browser error page. It opens empty.
    console.error("could not read the share", error);
  }
  return Response.redirect(new URL(LANDING, self.location.origin).href, 303);
}

/**
 * Parks one share.
 *
 * The inbox is cleared first, so a share the app never came to collect is
 * *replaced* by the next one rather than mixed into it. Two unrelated shares
 * merged into one note would be worse than losing the first — and nothing is
 * really lost either way: the photos are still in the gallery.
 */
async function stash(form) {
  // `getAll` on a file field yields File objects; anything else in there is a
  // text part under a name we did not ask for, and is not a file.
  const offered = form
    .getAll("files")
    .filter((v) => v && typeof v === "object" && typeof v.name === "string");

  // Kept in the order they were picked, until a bound says stop. A file over
  // the size bound is left out on its own; once the count or the total is
  // reached, everything after it is.
  const files = [];
  const left = [];
  let total = 0;
  for (const file of offered) {
    const size = typeof file.size === "number" ? file.size : 0;
    if (size > MAX_FILE_BYTES || files.length >= MAX_FILES || total + size > MAX_TOTAL_BYTES) {
      left.push({ name: String(file.name || "file"), size });
      continue;
    }
    files.push(file);
    total += size;
  }

  const words = {
    title: text(form.get("title")),
    text: text(form.get("text")),
    url: text(form.get("url")),
  };
  if (left.length > 0) {
    words.left = left.slice(0, MAX_LEFT_NAMED);
    words.leftCount = left.length;
  }

  if (files.length === 0 && left.length === 0 && !words.title && !words.text && !words.url) return;

  await caches.delete(SHARE_INBOX);
  const cache = await caches.open(SHARE_INBOX);

  await cache.put(
    new Request(new URL("/__share/text", self.location.origin).href),
    new Response(JSON.stringify(words), { headers: { "content-type": "application/json" } }),
  );

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Zero-padded so the reader can sort the keys back into the order the
    // pictures were picked in. Ten photos must not come back 1, 10, 2.
    const key = new URL(`/__share/f/${String(i).padStart(4, "0")}`, self.location.origin).href;
    await cache.put(
      new Request(key),
      new Response(file, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          // Percent-encoded, because a header value must be ASCII and a
          // filename here very often is not — "Räkna om.jpg" is an ordinary
          // name on this phone. The reader decodes it back.
          "x-share-name": encodeURIComponent(file.name || "file"),
          // The type again, verbatim, including the empty string Android hands
          // over surprisingly often. `content-type` above cannot carry that —
          // it had to be given a fallback to be a legal header.
          "x-share-type": encodeURIComponent(file.type || ""),
        },
      }),
    );
  }
}

function text(value) {
  return typeof value === "string" ? value : "";
}
