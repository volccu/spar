import { describe, expect, it } from "vitest";
import { cardName, type CardNameParts } from "./cardName";

const parts = (over: Partial<CardNameParts>): CardNameParts => ({
  kind: "text",
  idea: false,
  todo: false,
  name: null,
  body: "",
  items: [],
  fileName: null,
  linkTitle: null,
  files: 0,
  cut: false,
  checkDone: 0,
  checkCount: 0,
  priority: false,
  reminder: "none",
  boardName: null,
  archived: false,
  trashDaysLeft: null,
  ...over,
});

const item = (text: string, done = false) => ({ text, done, segs: [{ text }] });

/** Review UX-13: what a card is called out loud. */
describe("cardName", () => {
  it("names a plain note by its opening, with no kind word in front", () => {
    expect(cardName(parts({ body: "Pay the electricity bill" }))).toBe(
      "Pay the electricity bill",
    );
  });

  it("names an unnamed list by its first items and says how far through it is", () => {
    const name = cardName(
      parts({
        kind: "checklist",
        items: [item("oat milk"), item("eggs"), item("rye bread", true)],
        checkDone: 2,
        checkCount: 8,
        cut: true,
      }),
    );
    expect(name).toBe("List: oat milk, eggs, rye bread, 2 of 8 done, continues");
    expect(name).not.toMatch(/Empty note/);
  });

  it("names a named list by its name", () => {
    expect(
      cardName(
        parts({ kind: "checklist", name: "Packing", items: [item("passport")], checkDone: 1, checkCount: 7 }),
      ),
    ).toBe("List: Packing, 1 of 7 done");
  });

  it("stops the items at the length of an opening", () => {
    const long = Array.from({ length: 20 }, (_, i) => item(`thing number ${i}`));
    const name = cardName(parts({ kind: "checklist", items: long }));
    expect(name.length).toBeLessThanOrEqual("List: ".length + 60);
  });

  it("says a reminder, a passed one, and the folder the note is filed in", () => {
    expect(cardName(parts({ body: "Call", reminder: "set" }))).toBe("Call, reminder");
    expect(cardName(parts({ body: "Call", reminder: "passed" }))).toBe("Call, reminder passed");
    expect(cardName(parts({ body: "Call", boardName: "Home" }))).toBe("Call, in Home");
  });

  it("keeps the marks it already said", () => {
    expect(cardName(parts({ body: "x", priority: true }))).toBe("x, marked important");
    expect(cardName(parts({ kind: "file", fileName: "a.jpg", files: 3 }))).toBe(
      "File: a.jpg, 3 attachments",
    );
    expect(cardName(parts({ idea: true, name: "Kitchen" }))).toBe("Idea: Kitchen");
  });

  it("says a to-do that is written as prose is one", () => {
    expect(cardName(parts({ body: "Renew the card", todo: true }))).toBe("To-do: Renew the card");
  });

  it("names a link with no words of its own by the link", () => {
    expect(cardName(parts({ kind: "link", linkTitle: "Lisbon" }))).toBe("Link: Lisbon");
  });

  it("reads the opening's lines as words, not run together", () => {
    expect(cardName(parts({ body: "Water the plants\nThe fern" }))).toBe("Water the plants The fern");
  });

  it("still says an empty note is empty", () => {
    expect(cardName(parts({}))).toBe("Empty note");
  });
});

/* A screen reader hears what the face draws (audit 2026-10-10, UX-10): an
   archived card is drawn faded with a dashed edge, and a card near the end of
   its month in the trash draws its countdown. */
describe("cardName says the state the card is drawn in", () => {
  it("says a note is archived", () => {
    expect(cardName(parts({ body: "Old plan", archived: true }))).toBe("Old plan, archived");
  });

  it("says how long a note has left in the trash", () => {
    expect(cardName(parts({ body: "Old plan", trashDaysLeft: 3 }))).toBe(
      "Old plan, 3 days left in the trash",
    );
    expect(cardName(parts({ body: "Old plan", trashDaysLeft: 1 }))).toBe(
      "Old plan, 1 day left in the trash",
    );
    expect(cardName(parts({ body: "Old plan", trashDaysLeft: 0 }))).toBe(
      "Old plan, leaves the trash today",
    );
  });
});
