import { describe, expect, it } from "vitest";
import { headerWords } from "./headerWords";

const base = { selecting: false, selected: 0, remindersOpen: false, shown: 4, gridSearching: false, isPhone: false };

describe("headerWords", () => {
  it("says nothing on a plain board", () => {
    expect(headerWords(base)).toEqual({ headerCount: null, fieldCount: null });
  });
  it("counts a selection and reminders", () => {
    expect(headerWords({ ...base, selecting: true, selected: 3 }).headerCount).toBe("3 selected");
    expect(headerWords({ ...base, remindersOpen: true, shown: 1 }).headerCount).toBe("1 reminder");
    expect(headerWords({ ...base, remindersOpen: true }).headerCount).toBe("4 reminders");
  });
  it("puts the search count in the field on a desktop and in the header on a phone", () => {
    expect(headerWords({ ...base, gridSearching: true })).toEqual({ headerCount: null, fieldCount: "4 found" });
    expect(headerWords({ ...base, gridSearching: true, isPhone: true })).toEqual({
      headerCount: "4 found",
      fieldCount: null,
    });
  });
});
