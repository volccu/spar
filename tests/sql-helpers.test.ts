import { describe, it, expect } from "vitest";
import { sqlString, sqlBool, sqlTags, sqlTimestamp } from "../src/migrate/sql-helpers.js";

describe("sqlString", () => {
  it("wraps a plain string in single quotes", () => {
    expect(sqlString("hello")).toBe("'hello'");
  });
  it("null -> null literal", () => {
    expect(sqlString(null)).toBe("null");
    expect(sqlString(undefined)).toBe("null");
  });
  it("escapes single quotes by doubling them (Postgres standard)", () => {
    expect(sqlString("it's")).toBe("'it''s'");
    expect(sqlString("a'b'c")).toBe("'a''b''c'");
  });
});

describe("sqlBool", () => {
  it("maps truthy to true, falsy to false", () => {
    expect(sqlBool(1)).toBe("true");
    expect(sqlBool(0)).toBe("false");
    expect(sqlBool(true)).toBe("true");
    expect(sqlBool(false)).toBe("false");
  });
});

describe("sqlTags", () => {
  it("parses a JSON array to a Postgres ARRAY[]::text[] literal", () => {
    expect(sqlTags('["baking","bread"]')).toBe("ARRAY['baking','bread']::text[]");
  });
  it("escapes single quotes inside tag names", () => {
    expect(sqlTags('["bread baker\'s"]')).toBe("ARRAY['bread baker''s']::text[]");
  });
  it("empty array -> ARRAY[]::text[]", () => {
    expect(sqlTags("[]")).toBe("ARRAY[]::text[]");
  });
  it("null or unparseable -> ARRAY[]::text[]", () => {
    expect(sqlTags(null)).toBe("ARRAY[]::text[]");
    expect(sqlTags("not json")).toBe("ARRAY[]::text[]");
  });
});

describe("sqlTimestamp", () => {
  it("null -> now()", () => {
    expect(sqlTimestamp(null)).toBe("now()");
  });
  it("ISO string -> '...'::timestamptz", () => {
    expect(sqlTimestamp("2026-07-16T12:00:00Z")).toBe("'2026-07-16T12:00:00Z'::timestamptz");
  });
  it("escapes quotes inside timestamps if any", () => {
    expect(sqlTimestamp("12'34")).toBe("'12''34'::timestamptz");
  });
});