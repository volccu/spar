/**
 * Instants, as the sync contract spells and compares them (docs/sync-contract.md §1).
 *
 * Every instant the server stores is an integer count of **microseconds** since
 * the Unix epoch. The contract's `+1µs` floor on `updated_at` is observable, so
 * milliseconds (what `Date` speaks) are not enough, and an integer compares in
 * SQLite exactly as it does here. The range is whatever a JavaScript number
 * holds exactly — about the years 1685 to 2255 — and anything outside it is
 * refused rather than rounded.
 *
 * Input accepts both spellings the contract names — a client stamp
 * (`2026-09-27T12:00:00.123Z`) and a server instant
 * (`2026-09-27T12:00:00.123456+00:00`) — plus the forms Postgres would also
 * have taken (a space for the `T`, an offset without a colon, a bare date).
 * Output is always the server spelling: RFC 3339, `+00:00`, up to six
 * fractional digits with trailing zeros trimmed, as Postgres writes it.
 */

export type Micros = number;

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Microseconds since the epoch, or null when `value` is not an instant. */
export function parseInstant(value: unknown): Micros | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const m = INSTANT.exec(value.trim());
  if (!m) return null;
  const [, ys, mos, ds, hs = "0", mis = "0", ss = "0", fraction = "", zone = "Z"] = m;
  const year = Number(ys);
  const month = Number(mos);
  const day = Number(ds);
  const hour = Number(hs);
  const minute = Number(mis);
  const second = Number(ss);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (zone !== "Z" && zone !== "z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (oh > 15 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  // Rounded to the microsecond, as Postgres rounds a longer fraction.
  let us = 0;
  if (fraction) {
    const padded = (fraction + "0000000").slice(0, 7);
    us = Math.round(Number(padded) / 10);
  }
  const total = ms * 1000 + us;
  return Number.isSafeInteger(total) ? total : null;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** The server spelling of an instant: `2026-09-27T12:00:00.123456+00:00`. */
export function formatInstant(us: Micros): string {
  const ms = Math.floor(us / 1000);
  const micro = us - ms * 1000;
  const d = new Date(ms);
  const base =
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}` +
    `T${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`;
  const frac = (pad(d.getUTCMilliseconds(), 3) + pad(micro, 3)).replace(/0+$/, "");
  return `${base}${frac ? `.${frac}` : ""}+00:00`;
}

export function formatNullable(us: Micros | null): string | null {
  return us === null ? null : formatInstant(us);
}

/** Milliseconds to microseconds. */
export const fromMs = (ms: number): Micros => Math.round(ms * 1000);

/** Microseconds to (whole) milliseconds. */
export const toMs = (us: Micros): number => Math.floor(us / 1000);

export const DAY_US = 86_400_000_000;

/**
 * The server's clock, in microseconds, strictly increasing within one process
 * so two stamps it hands out are never equal. It follows the wall clock
 * otherwise (a stamp is compared against clients' stamps, which are wall
 * clock).
 */
export function createClock(read: () => number = Date.now): () => Micros {
  let last = 0;
  return () => {
    const now = fromMs(read());
    last = now > last ? now : last + 1;
    return last;
  };
}
