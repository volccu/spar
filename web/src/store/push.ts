import { nowIso } from "../lib/when";
import { syncConfigured } from "./supabase";
import { getBackend } from "./backend";
import { RUNTIME_CONFIG, knownConfig } from "./backend/config";

/**
 * push.ts — registering this device as somewhere a reminder can arrive.
 *
 * `reminder_at` has been a real field since Phase 2 and nothing ever fired,
 * because the web has no way to schedule a local alarm that survives the tab
 * closing — the Notification Triggers API never shipped. Web Push is the only
 * route that works on an installed Android PWA, and it needs three things this
 * file arranges: the user's permission, a subscription minted by the browser's
 * own push service, and that subscription stored server-side so the sweep in
 * `supabase/functions/send-reminders` can reach it (SPEC §10, migration 0015).
 *
 * Everything here degrades to nothing. A browser without push, a user who says
 * no, a device-only install with no Supabase keys — all of them leave the rest
 * of the app exactly as it was. A reminder still gets set, still shows on the
 * card and still syncs; it simply doesn't ring on *this* device. Nothing on the
 * 90% path may ever wait on any of this.
 */

/**
 * The public half of the push signing key, from `VITE_VAPID_PUBLIC_KEY`.
 *
 * It is not a secret and cannot be made one: the browser requires it at
 * subscribe time, so it ships inside the client bundle either way, and it is
 * quoted verbatim in the VAPID header of every push we send. What it buys an
 * attacker is nothing — the private half, which lives only in Supabase's
 * secrets, is what signs.
 *
 * It is a setting rather than a line of source because each instance signs
 * with its own pair. The cost is the one a missing key always has: a build
 * without it cannot ring, and says so — `pushSupported` answers false, which
 * is exactly how a device with no push service is treated, so the open note
 * says reminders will not sound here instead of promising one. Rotating it
 * invalidates every existing subscription and needs a rebuild either way.
 *
 * Read on each call rather than once, so a test can set it. A build that reads
 * `/config.json` takes the key from there when the file names one
 * (`vapidPublicKey`), and the build's variable otherwise.
 */
function vapidPublicKey(): string {
  const configured = RUNTIME_CONFIG ? knownConfig()?.vapidPublicKey : undefined;
  return (configured ?? (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "").trim();
}

/**
 * Whether there is a server to register with at all. A build that reads
 * `/config.json` knows only once it has read it, and reminders are set long
 * after that; until then the answer is no, which is the safe one.
 */
function serverConfigured(): boolean {
  return RUNTIME_CONFIG ? (knownConfig()?.backend ?? "none") !== "none" : syncConfigured;
}

export type PushState =
  /** This browser has no push at all, or there is no server (or signing key) to register with. */
  | "unavailable"
  /** Everything is ready and the user has not been asked yet. */
  | "askable"
  /** Asked and refused. Only the browser's own site settings can undo this. */
  | "denied"
  /** Registered — a reminder set here will arrive here. */
  | "on";

/**
 * The browser wants the signing key as bytes, and it travels as base64url
 * everywhere else — in the env, in the database, in the VAPID header.
 */
// The explicit ArrayBuffer is not a flourish: `subscribe` wants a BufferSource
// backed by a plain ArrayBuffer, and a bare `new Uint8Array(n)` is typed over
// ArrayBufferLike, which admits SharedArrayBuffer and so is refused.
function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = b64u.length % 4 === 0 ? "" : "=".repeat(4 - (b64u.length % 4));
  const raw = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Whether this device could ever receive a push.
 *
 * The service worker is the part that is still running when the tab is gone,
 * so no worker means no reminder however willing the user is. iOS only exposes
 * `PushManager` to an installed app, which is why this is a capability check
 * and not a browser check.
 */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    serverConfigured() &&
    vapidPublicKey() !== ""
  );
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  // A live `PushSubscription` is not by itself permission to show anything.
  // Only `denied` used to be consulted here, and permission has a third state:
  // **reset** to `default` — Chrome's site settings, Android's per-app
  // notification switch, a profile where the subscription outlived the grant.
  // The subscription object survives all of those, so the app said "on", the
  // open note dropped its "not on this device" clause, and the user was
  // promised a sound this device will not make. Anything but a live grant is
  // `askable`: the way back is the same prompt, and it costs nothing to offer.
  if (Notification.permission !== "granted") return "askable";
  const reg = await navigator.serviceWorker.getRegistration();
  const existing = await reg?.pushManager.getSubscription();
  // Permission granted with no subscription is still "askable": subscribing is
  // the step that has not happened, and it costs the user no prompt because
  // the browser only asks once.
  return existing ? "on" : "askable";
}

/** The three fields the server needs, pulled off the browser's own object. */
function rowFor(sub: PushSubscription) {
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!keys.p256dh || !keys.auth) return null;
  // Every push service a browser hands out is https; `push_subscriptions`
  // refuses anything else since migration 0029, and the sender would never
  // post to it (audit SEC-3). Not stored rather than stored and refused.
  if (!sub.endpoint.startsWith("https://")) return null;
  return {
    endpoint: sub.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
    seen_at: nowIso(),
    // A device that comes back clears its own headstone. The sweep marks an
    // endpoint failed when the push service says it is gone for good, and
    // re-subscribing is exactly the event that makes it live again.
    failed_at: null,
  };
}

async function store(sub: PushSubscription): Promise<boolean> {
  const row = rowFor(sub);
  if (!row) return false;
  const backend = await getBackend();
  if (!backend) return false;
  // Read locally, as `uploadPending` reads it: the row's policy is what
  // vouches for the owner, not a round trip made here first.
  const owner = (await backend.session())?.user?.id;
  // Signed out there is nobody to own the row. The subscription still exists
  // in the browser, so signing in later and calling this again registers it.
  if (!owner) return false;
  const { error } = await backend.upsertPushSubscription({ ...row, owner_id: owner });
  if (error) {
    console.error("registering this device for reminders failed:", error.message);
    return false;
  }
  return true;
}

/**
 * Ask, subscribe, register. Safe to call more than once — the browser returns
 * the subscription it already has rather than minting a second one, which is
 * what makes `endpoint` a usable primary key.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "askable";

  // `ready` rather than `getRegistration`, because the very first call can land
  // before the worker generated at build time has finished activating.
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Every push carries a payload here, and a payload cannot be sent to a
      // subscription that didn't promise to be visible about it.
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidPublicKey()),
    }));

  // Whether the *server* knows is the whole test, and it is why this does not
  // simply return "on" once the browser has handed over a subscription.
  //
  // The browser subscribing is half the job: the sweep sends to rows in
  // `push_subscriptions`, so a subscription the upsert never landed — signed
  // out, offline, or refused by row level security — is a device that will
  // never be told anything. Reporting "on" there put the app back to promising
  // a sound it could not make, which is the exact fault this whole feature
  // exists to end. "askable" is the honest answer and leaves it retryable.
  return (await store(sub)) ? "on" : "askable";
}

/**
 * Stop this device ringing, without touching the reminders themselves.
 *
 * The row goes rather than being marked failed: a device the user has switched
 * off by hand is not a device that broke, and leaving a headstone would have
 * the next sweep treating a deliberate choice as an error to report.
 */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unavailable";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return "askable";
  const endpoint = sub.endpoint;
  // The browser refusing to let go is logged, not fatal: the server row below
  // is what decides whether a push is sent here, and it still goes.
  await sub.unsubscribe().catch((error: unknown) =>
    console.error("the browser kept this device's push subscription", error),
  );
  const backend = await getBackend();
  if (backend) {
    const { error } = await backend.deletePushSubscription(endpoint);
    if (error) console.error("removing this device failed:", error.message);
  }
  return "askable";
}

/**
 * Called once on startup when already subscribed.
 *
 * Two things go stale on their own: a push service may rotate an endpoint, and
 * the sweep may have marked this device failed while it was uninstalled or
 * simply asleep for a long time. Re-storing the current subscription fixes
 * both, costs one upsert, and never asks the user anything.
 */
export async function refreshPush(): Promise<void> {
  if (!pushSupported()) return;
  if (Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await store(sub);
  } catch {
    // A refresh is a courtesy. It must never be the reason the app fails to
    // start, so nothing here is allowed to escape.
  }
}

/**
 * "Stop notifying on this device", remembered.
 *
 * `disablePush` unsubscribes and drops this device's row, which stops the
 * sweep sending to it — and then setting any reminder anywhere called
 * `enablePush` again. Permission is still granted, so there is no prompt: the
 * phone that was deliberately silenced starts ringing again with nothing on
 * screen having said so. The answer has to outlive the tab, so it is written
 * where the device's other per-device answers are written, behind the same
 * guard the rest of the app puts around `localStorage` (a strict private mode
 * throws on the property itself, not merely on the write).
 *
 * It is deliberately *not* synced: which devices ring is a fact about a
 * device, exactly as `reminder_at` is a fact about a note.
 */
const RINGING_OFF = "spar.ringing-off";

export function ringingOff(): boolean {
  try {
    return window.localStorage.getItem(RINGING_OFF) === "1";
  } catch {
    return false;
  }
}

export function setRingingOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(RINGING_OFF, "1");
    else window.localStorage.removeItem(RINGING_OFF);
  } catch {
    /* a preference that cannot be stored is one the device asks about again */
  }
}
