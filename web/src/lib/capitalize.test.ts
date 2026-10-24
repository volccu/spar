import { describe, expect, it } from "vitest";
import { capitalizeCapture } from "./capitalize";

describe("capitalizeCapture", () => {
  it("sets a plain first letter upright", () => {
    expect(capitalizeCapture("bought milk")).toBe("Bought milk");
  });

  it("handles Finnish letters", () => {
    expect(capitalizeCapture("äitienpäivä on sunnuntaina")).toBe("Äitienpäivä on sunnuntaina");
  });

  it("reads past a dash marker, typed or already substituted", () => {
    expect(capitalizeCapture("- milk")).toBe("- Milk");
    expect(capitalizeCapture("– milk")).toBe("– Milk");
    expect(capitalizeCapture("* milk")).toBe("* Milk");
  });

  it("reads past a heading", () => {
    expect(capitalizeCapture("# shopping")).toBe("# Shopping");
    expect(capitalizeCapture("## shopping")).toBe("## Shopping");
  });

  it("reads past a tick box", () => {
    expect(capitalizeCapture("[ ] call the bank")).toBe("[ ] Call the bank");
  });

  it("reads past a numbered item, inside the three-digit bound", () => {
    expect(capitalizeCapture("1. milk")).toBe("1. Milk");
    expect(capitalizeCapture("3) call the bank")).toBe("3) Call the bank");
    // Four digits is a year opening a sentence, not a list.
    expect(capitalizeCapture("1998. best year")).toBe("1998. best year");
  });

  it("only touches the first letter of the note, never later lines", () => {
    expect(capitalizeCapture("milk\neggs")).toBe("Milk\neggs");
    expect(capitalizeCapture("– milk\n– eggs")).toBe("– Milk\n– eggs");
  });

  it("leaves an address exactly as typed", () => {
    expect(capitalizeCapture("https://example.com/a")).toBe("https://example.com/a");
    expect(capitalizeCapture("www.example.com")).toBe("www.example.com");
    expect(capitalizeCapture("– www.example.com")).toBe("– www.example.com");
  });

  it("leaves code alone", () => {
    expect(capitalizeCapture("```\nnpm run dev\n```")).toBe("```\nnpm run dev\n```");
    expect(capitalizeCapture("`grep` is the tool")).toBe("`grep` is the tool");
  });

  it("leaves digits and emoji alone", () => {
    expect(capitalizeCapture("3 eggs")).toBe("3 eggs");
    expect(capitalizeCapture("🎉 party on friday")).toBe("🎉 party on friday");
  });

  it("leaves a capital that is already there", () => {
    expect(capitalizeCapture("Bought milk")).toBe("Bought milk");
  });

  it("does nothing to nothing", () => {
    expect(capitalizeCapture("")).toBe("");
    expect(capitalizeCapture("– ")).toBe("– ");
  });

  // bughunt 2026-10-15: a name, a domain or an address is not a plain word.
  it("leaves a word with its own capitals, a domain or an email alone", () => {
    for (const text of ["iPhone 15 case", "eBay order", "youtube.com/watch?v=1", "me@example.com", "src/app.ts"]) {
      expect(capitalizeCapture(text)).toBe(text);
    }
  });

  it("still capitalises a word that ends in punctuation", () => {
    expect(capitalizeCapture("milk.")).toBe("Milk.");
    expect(capitalizeCapture("note: buy eggs")).toBe("Note: buy eggs");
    expect(capitalizeCapture("- ipad charger")).toBe("- Ipad charger");
  });
});
