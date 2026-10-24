/**
 * The pure parts: instants, IP classification, the URL shape check, clock
 * comparison, and the constants the server shares with the rest of the repo.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFLICT_FIELDS } from "../../web/src/lib/versions";
import { TOMBSTONE_DAYS } from "../../web/src/lib/trash";
import { MAX_FILE_BYTES, parseFilePath } from "../src/files";
import { isPrivateAddress, parseIPv6, publicUrlShape } from "../src/netguard";
import { MERGE_FIELDS, TOMBSTONE_US } from "../src/notes";
import { GRACE_SECONDS, occurrence, ttlFor } from "../src/push";
import { TokenBucket, WindowCounter } from "../src/ratelimit";
import { createClock, DAY_US, formatInstant, parseInstant } from "../src/time";
import { compareClocks, jsonEqual } from "../src/values";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("instants", () => {
  it("reads a client stamp and a server instant as the same moment", () => {
    expect(parseInstant("2026-09-27T12:00:00.123Z")).toBe(parseInstant("2026-09-27T12:00:00.123000+00:00"));
    expect(parseInstant("2026-09-27T14:00:00.123+02:00")).toBe(parseInstant("2026-09-27T12:00:00.123Z"));
    expect(parseInstant("2026-09-27 12:00:00+0000")).toBe(parseInstant("2026-09-27T12:00:00Z"));
    expect(parseInstant("2026-09-27")).toBe(parseInstant("2026-09-27T00:00:00Z"));
  });

  it("keeps microseconds and rounds a longer fraction to them", () => {
    const base = parseInstant("2026-09-27T12:00:00Z")!;
    expect(parseInstant("2026-09-27T12:00:00.123456Z")).toBe(base + 123_456);
    expect(parseInstant("2026-09-27T12:00:00.1234565Z")).toBe(base + 123_457);
  });

  it("writes the server spelling, trimming trailing zeros", () => {
    const at = parseInstant("2026-09-27T12:00:00.120Z")!;
    expect(formatInstant(at)).toBe("2026-09-27T12:00:00.12+00:00");
    expect(formatInstant(at + 1)).toBe("2026-09-27T12:00:00.120001+00:00");
    expect(formatInstant(parseInstant("2031-01-01T00:00:01Z")!)).toBe("2031-01-01T00:00:01+00:00");
    expect(formatInstant(parseInstant("1969-12-31T23:59:59.999999Z")!)).toBe("1969-12-31T23:59:59.999999+00:00");
  });

  it("refuses what is not an instant", () => {
    for (const bad of ["", "yesterday", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-09-27T25:00:00Z", 42, null, "9999999-01-01"]) {
      expect(parseInstant(bad)).toBeNull();
    }
  });

  it("hands out strictly increasing stamps even when the wall clock stands still", () => {
    const clock = createClock(() => 1_000);
    const a = clock();
    const b = clock();
    expect(b).toBe(a + 1);
  });
});

describe("addresses the server may reach", () => {
  it("refuses private and reserved IPv4", () => {
    for (const a of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ["1.1.1.1", "93.184.215.14", "8.8.8.8"]) expect(isPrivateAddress(a)).toBe(false);
  });

  it("refuses IPv6 outside global unicast, and the special blocks inside it", () => {
    for (const a of ["::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "100::1", "2001:db8::1", "2001::1", "3fff::1"]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ["2606:4700:4700::1111", "2a00:1450:4001:81d::200e"]) expect(isPrivateAddress(a)).toBe(false);
  });

  it("judges IPv4-mapped, NAT64 and 6to4 addresses by the IPv4 address inside", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:1.1.1.1")).toBe(false);
    expect(isPrivateAddress("64:ff9b::10.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateAddress("64:ff9b::101:101")).toBe(false); // 1.1.1.1
    expect(isPrivateAddress("64:ff9b:1::1")).toBe(true); // local-use NAT64
    expect(isPrivateAddress("2002:c0a8:0101::1")).toBe(true); // 192.168.1.1
    expect(isPrivateAddress("2002:7f00:0001::1")).toBe(true); // 127.0.0.1
    expect(isPrivateAddress("2002:0101:0101::1")).toBe(false); // 1.1.1.1
  });

  it("parses the IPv6 spellings it meets", () => {
    expect([...parseIPv6("::1")!]).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIPv6("::ffff:10.0.0.1")!.slice(12)).toEqual(new Uint8Array([10, 0, 0, 1]));
    expect(parseIPv6("fe80::1%eth0")).not.toBeNull();
    expect(parseIPv6("not an address")).toBeNull();
    expect(isPrivateAddress("garbage")).toBe(true);
  });

  it("reads an IPv6 address only where Node's own parser does", () => {
    // A dotted quad with a leading zero is no address to `node:net`; read by
    // hand alone it would pass as 1.1.1.1. The server refuses it.
    expect(parseIPv6("::ffff:01.1.1.1")).toBeNull();
    expect(isPrivateAddress("::ffff:01.1.1.1")).toBe(true);
    // A `::` has to stand for at least one group.
    expect(parseIPv6("1:2:3:4:5:6:7:8::")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7::")).not.toBeNull();
    expect(parseIPv6("1::2::3")).toBeNull();
  });

  it("refuses URL shapes before any lookup", () => {
    for (const bad of [
      "ftp://example.com/",
      "https://user:pw@example.com/",
      "http://localhost/",
      "http://localhost./",
      "http://x.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/",
      "http://anything.internal/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://[::1]/",
      "http://[2606:4700:4700::1111]/",
    ]) {
      expect(publicUrlShape(bad), bad).toBeNull();
    }
    expect(publicUrlShape("https://example.com/a?b=c")).not.toBeNull();
    expect(publicUrlShape("http://1.1.1.1/")).not.toBeNull();
  });

  it("leaves the port to its callers", () => {
    // pinnedFetch and the push subscription each judge the port themselves;
    // unlike the Supabase functions', this shape check refuses none.
    expect(publicUrlShape("https://example.com:8443/")).not.toBeNull();
  });
});

describe("per-field clocks", () => {
  it("compares instants as instants, whatever their spelling", () => {
    expect(compareClocks("2031-03-14T11:00:00+02:00", "2031-03-14T09:00:00.000Z")).toBe(0);
    expect(compareClocks("2031-03-14T09:00:00.001Z", "2031-03-14T09:00:00.000Z")).toBe(1);
  });

  it("falls back to text for anything else", () => {
    expect(compareClocks("b", "a")).toBe(1);
    expect(compareClocks("a", "a")).toBe(0);
  });

  it("compares clock maps as JSON, not as text", () => {
    expect(jsonEqual({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(jsonEqual({ a: "1" }, { a: "1", b: null })).toBe(false);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe("file paths", () => {
  const user = "6c1b3a2e-7d45-4b8a-9c0e-1f2a3b4c5d6e";

  it("takes <user>/<note>/<attachment> and nothing else", () => {
    expect(parseFilePath(`${user}/note-1/att_2`, false)?.path).toBe(`${user}/note-1/att_2`);
    for (const bad of [
      `${user}/../x`,
      `${user}/note/..`,
      `${user}/note/.hidden`,
      `${user}/note`,
      `${user}/a/b/c`,
      `../${user}/a/b`,
      `${user}/a\\b/c`,
      `${user}/a/b\u0000`,
      `shared/a/b`,
      `/${user}/a`,
    ]) {
      expect(parseFilePath(bad, false), bad).toBeNull();
    }
    expect(parseFilePath(`${user}/%2e%2e/x`, true)).toBeNull();
    expect(parseFilePath(`${user}/a%2Fb/c`, true)).toBeNull();
    expect(parseFilePath(`${user}/a/%E0%A4%A`, true)).toBeNull();
  });
});

describe("the reminder projection", () => {
  it("is the app's own, carried to microseconds", () => {
    const anchor = parseInstant("2026-01-31T09:00:00Z")!;
    expect(formatInstant(occurrence(anchor, "monthly", parseInstant("2026-03-28T12:00:00Z")!))).toBe("2026-02-28T09:00:00+00:00");
    expect(occurrence(anchor + 7, "daily", anchor + 2 * DAY_US + 10)).toBe(anchor + 7 + 2 * DAY_US);
    expect(occurrence(anchor, "yearly", anchor + 400 * DAY_US)).toBe(anchor);
  });

  it("gives a push what is left of the grace window, never less than a minute", () => {
    const at = parseInstant("2026-01-01T09:00:00Z")!;
    expect(ttlFor(at, at)).toBe(GRACE_SECONDS);
    expect(ttlFor(at, at + 23 * 3_600_000_000)).toBe(3600);
    expect(ttlFor(at, at + DAY_US - 1_000_000)).toBe(60);
  });
});

describe("rate limits", () => {
  it("counts inside a window", () => {
    let now = 0;
    const counter = new WindowCounter(2, 1_000, () => now);
    counter.hit("k");
    counter.hit("k");
    expect(counter.blocked("k")).toBe(true);
    expect(counter.retryAfterMs("k")).toBe(1_000);
    now = 1_001;
    expect(counter.blocked("k")).toBe(false);
  });

  it("refills a bucket over time", () => {
    let now = 0;
    const bucket = new TokenBucket(2, 100, () => now);
    expect(bucket.take("u")).toBe(0);
    expect(bucket.take("u")).toBe(0);
    expect(bucket.take("u")).toBeGreaterThan(0);
    now = 100;
    expect(bucket.take("u")).toBe(0);
  });
});

describe("one fact, one value, wherever it is written", () => {
  it("merges exactly the client's CONFLICT_FIELDS", () => {
    expect([...MERGE_FIELDS]).toEqual([...CONFLICT_FIELDS]);
  });

  it("keeps tombstones as long as the client does", () => {
    expect(TOMBSTONE_US).toBe(TOMBSTONE_DAYS * DAY_US);
  });

  it("caps a file where the bucket does", () => {
    expect(readFileSync(join(ROOT, "supabase", "migrations", "0027_prefs_history_and_bigger_files.sql"), "utf8")).toMatch(new RegExp(String(MAX_FILE_BYTES)));
    expect(MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("keeps an occurrence due for as long as send-reminders does", () => {
    // One constant, in the file both sweeps import.
    const shared = readFileSync(join(ROOT, "supabase", "functions", "_shared", "notification.ts"), "utf8");
    expect(shared).toMatch(new RegExp(`export const GRACE_SECONDS = 24 \\* 60 \\* 60;`));
    expect(GRACE_SECONDS).toBe(24 * 60 * 60);
  });
});
