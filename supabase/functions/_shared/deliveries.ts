// deliveries.ts — which of a person's devices a due reminder still owes.
//
// Pure and dependency-free, shared like `notification.ts`: `send-reminders`
// and the spår server's own sweep (`server/src/push.ts`) both ask it, and the
// root suite (`tests/deliveries.test.ts`) checks it without Deno.
//
// An occurrence used to be recorded as delivered the moment *any* device
// accepted it, so with a phone and a laptop, a push the laptop's service
// answered 503 was never tried again: the next sweep saw the occurrence as
// done. Now each device that accepted is written down
// (`reminder_device_deliveries`, migration 0031), the rest are tried again on
// later sweeps, and the occurrence is closed once every live device has it —
// or, so one device that keeps failing does not cost a push attempt a minute
// for the whole day of grace, an hour after it was due as long as some device
// has it (bughunt 2026-10-24).

/** How long the devices that have not yet taken an occurrence are tried again. */
export const DEVICE_RETRY_MS = 60 * 60 * 1000;

/**
 * The devices to send to now, or `done` when there is nothing left to send and
 * the occurrence should be recorded as delivered. `delivered` holds the
 * endpoints that already took this very occurrence.
 */
export function devicesToSend(
  devices: string[],
  delivered: ReadonlySet<string>,
  occurrenceMs: number,
  nowMs: number,
): { send: string[]; done: boolean } {
  if (delivered.size > 0 && nowMs - occurrenceMs > DEVICE_RETRY_MS) return { send: [], done: true };
  const send = devices.filter((endpoint) => !delivered.has(endpoint));
  if (send.length === 0 && delivered.size > 0) return { send, done: true };
  return { send, done: false };
}

/**
 * Whether a sweep's sends close the occurrence: every device sent to either
 * took it or is gone for good, and at least one device — now or before — has
 * it. Nothing taken anywhere leaves it due, as it always was.
 */
export function doneAfter(
  results: { ok: boolean; gone?: boolean }[],
  deliveredBefore: number,
): boolean {
  const left = results.filter((r) => !r.ok && !r.gone).length;
  const someoneHasIt = deliveredBefore > 0 || results.some((r) => r.ok);
  return left === 0 && someoneHasIt;
}
