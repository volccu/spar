/**
 * Shared helpers for the conformance suite. Nothing here talks to a backend
 * except through the driver.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, it } from "vitest";
import type { ConformanceDriver, Deviation, NoteWrite, Session } from "./driver";
import { makeDriver } from "./drivers";

/**
 * The fields the server merges by per-field clock, in the contract's order.
 * It must equal `CONFLICT_FIELDS` in web/src/lib/versions.ts and the array in
 * the newest `merge_note_field_versions` (migration 0020); `contract.test.ts`
 * holds all three together.
 */
export const MERGE_FIELDS = [
  "body",
  "note_type",
  "board_id",
  "status",
  "priority",
  "reminder_at",
  "reminder_repeat",
  "done",
  "merged_from",
  "merged_into",
  "attachments",
  "link_previews",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

export const uuid = (): string => randomUUID();

/** A canonical client stamp: `toISOString()`, milliseconds, `Z`. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A fixed base far from "now", so stamps are obviously the test's own. */
export const BASE = Date.parse("2031-03-14T09:00:00.000Z");
export const at = (offsetMs: number): string => iso(BASE + offsetMs);

/**
 * An instant as microseconds since the epoch, from any RFC 3339 spelling —
 * `Date.parse` stops at milliseconds, and the contract is about the sixth
 * digit (the `+1µs` floor).
 */
export function micros(value: string): bigint {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/);
  if (!match) throw new Error(`not an RFC 3339 instant: ${value}`);
  const [, whole, fraction = "", zone = "Z"] = match;
  const offset = zone === "Z" ? "Z" : zone.length === 3 ? `${zone}:00` : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const seconds = BigInt(Date.parse(`${whole.replace(" ", "T")}${offset}`)) / 1000n;
  const us = BigInt((fraction + "000000").slice(0, 6));
  return seconds * 1_000_000n + us;
}

export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == b;
  return micros(a) === micros(b);
}

/** Every merge field clocked at one instant — what a client sends for a note
 *  it has just made (`fieldClocks` in web/src/lib/versions.ts). */
export function clocksAt(stamp: string): Record<MergeField, string> {
  return Object.fromEntries(MERGE_FIELDS.map((field) => [field, stamp])) as Record<MergeField, string>;
}

/** A complete note upload, as `toRow` in web/src/store/sync.ts builds it. */
export function note(overrides: Partial<NoteWrite> = {}): NoteWrite {
  const stamp = overrides.updated_at ?? at(0);
  return {
    id: uuid(),
    raw_content: "a captured thought",
    body: overrides.raw_content ?? "a captured thought",
    source: "web",
    created_at: stamp,
    updated_at: stamp,
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    reminder_repeat: null,
    done: null,
    merged_from: null,
    merged_into: null,
    keep_id: null,
    attachments: [],
    link_previews: [],
    field_updated_at: clocksAt(stamp),
    ...overrides,
  };
}

/** One driver per test file, started before the first test and cleaned up after the last. */
export function useDriver(): ConformanceDriver {
  const driver = makeDriver();
  beforeAll(() => driver.start());
  afterAll(() => driver.cleanup());
  return driver;
}

/** Signs in `count` fresh users. */
export async function users(driver: ConformanceDriver, count: number): Promise<Session[]> {
  const out: Session[] = [];
  for (let i = 0; i < count; i++) out.push(await driver.createUser());
  return out;
}

/**
 * `it`, or `it.fails` when the backend under test carries this known deviation
 * — so a deviation that gets fixed turns the suite red until it is struck off
 * the driver's list and the contract's.
 */
export function itUnless(driver: ConformanceDriver, deviation: Deviation) {
  return (name: string, fn: () => Promise<void>, timeout?: number) => {
    if (driver.deviations.has(deviation)) {
      it.fails(`${name} [known deviation: ${deviation}]`, fn, timeout);
    } else {
      it(name, fn, timeout);
    }
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `check` is true or `ms` pass; returns whether it became true. */
export async function eventually(check: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}
