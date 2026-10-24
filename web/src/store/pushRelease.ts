/**
 * Lets go of this browser's push subscription, on the browser's side only.
 *
 * Called when the local store changes hands — a different account signed in
 * over the previous one (`claimForOwner`'s switch). The previous account's row
 * on the server cannot be deleted from here: the session is now somebody
 * else's, and row level security keeps one owner's rows from another. But the
 * row is only an address, and once the browser lets go of the subscription the
 * address no longer reaches anything, so the old account's reminders stop
 * ringing here and the sweep marks the row failed on its next attempt
 * (audit 2026-10-10, SEC-7). The new account then subscribes afresh when it
 * sets a reminder, on a new address its own row can hold.
 *
 * Its own file, with no imports, so the store can call it without pulling the
 * server client in behind it. Never throws, and gives up after `waitMs`: the
 * claim it stands in front of gates sync.
 */
export async function releaseBrowserPush(waitMs = 3_000): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const release = (async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) await sub.unsubscribe();
  })().catch((error: unknown) =>
    console.error("could not release this browser's push subscription", error),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  await Promise.race([release, waited]);
  clearTimeout(timer);
}
