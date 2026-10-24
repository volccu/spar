/**
 * Checking and comparing the values a client sends, the way the Postgres
 * column types behind the Supabase backend would: a value of the wrong type is
 * a **row refusal** (SQLSTATE class 22/23 there), never silently coerced.
 */
import { rowRefused } from "./http";
import { parseInstant, type Micros } from "./time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(column: string, what: string, id?: string): never {
  throw rowRefused("invalid", `${column} must be ${what}`, id);
}

/** Text as Postgres keeps it: any string without a NUL character. */
export function text(column: string, value: unknown, nullable: boolean, id?: string): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string") invalid(column, nullable ? "a string or null" : "a string", id);
  if (value.includes("\u0000")) invalid(column, "text without NUL characters", id);
  // A lone surrogate cannot be stored as UTF-8: SQLite would turn it into
  // U+FFFD, and the next upload of the same row would then differ from what was
  // kept and be refused as a change to raw_content. Replacing it here, as
  // SQLite would, means what is stored is exactly what was sent.
  return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export function uuid(column: string, value: unknown, nullable: boolean, id?: string): string | null {
  if (value === null && nullable) return null;
  if (!isUuid(value)) invalid(column, nullable ? "a UUID or null" : "a UUID", id);
  return value.toLowerCase();
}

export function instant(column: string, value: unknown, nullable: boolean, id?: string): Micros | null {
  if (value === null && nullable) return null;
  const us = parseInstant(value);
  if (us === null) invalid(column, nullable ? "an RFC 3339 instant or null" : "an RFC 3339 instant", id);
  return us;
}

export function smallint(column: string, value: unknown, id?: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -32768 || value > 32767) {
    invalid(column, "an integer", id);
  }
  return value;
}

export function boolOrNull(column: string, value: unknown, id?: string): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  invalid(column, "true, false or null", id);
}

export function uuidArray(column: string, value: unknown, id?: string): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.every(isUuid)) invalid(column, "an array of UUIDs or null", id);
  return (value as string[]).map((v) => v.toLowerCase());
}

export function jsonArray(column: string, value: unknown, id?: string): unknown[] {
  if (!Array.isArray(value)) invalid(column, "a JSON array", id);
  return value;
}

export function jsonObject(column: string, value: unknown, id?: string): Record<string, unknown> {
  if (!isPlainObject(value)) invalid(column, "a JSON object", id);
  return value;
}

/** Structural JSON equality, as `jsonb` compares: key order does not matter. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((v, i) => jsonEqual(v, other[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function clockText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Orders two per-field clocks. Instants compare as instants (so any spelling
 * of the same moment is equal); anything else falls back to text, which is
 * what the Supabase trigger always does and agrees with instant order for
 * canonical client stamps (docs/sync-contract.md §4.2).
 */
export function compareClocks(a: unknown, b: unknown): number {
  const at = clockText(a);
  const bt = clockText(b);
  const au = parseInstant(at);
  const bu = parseInstant(bt);
  if (au !== null && bu !== null) return au < bu ? -1 : au > bu ? 1 : 0;
  return at < bt ? -1 : at > bt ? 1 : 0;
}
