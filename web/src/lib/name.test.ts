import { describe, expect, it } from "vitest";
import { noteName, withNoteName } from "./name";

describe("naming a note", () => {
  it("reads no name off a note nobody has named", () => {
    expect(noteName("some words\n\n———\n\nmore words")).toBeNull();
    expect(noteName("")).toBeNull();
    expect(noteName(null)).toBeNull();
  });

  it("reads the heading the user wrote on the first line", () => {
    expect(noteName("# Kitchen rebuild\n\nsome words")).toBe("Kitchen rebuild");
  });

  it("ignores a heading that is not the first line", () => {
    // The name is the top of the note. A heading further down is a heading
    // inside the note, which is a different thing and stays one.
    expect(noteName("some words\n\n# Later on\n\nmore")).toBeNull();
  });

  it("does not take a ## subheading on the first line for a name", () => {
    // Pasted markdown opens on one constantly, and a merge lays a source's own
    // `## Ingredients` at the top of an idea. Neither is the name of anything,
    // and `withNoteName` would put a name above it rather than replace it — so
    // reading it as one would show a name that renaming then left behind.
    expect(noteName("## Ingredients\n– flour")).toBeNull();
    expect(withNoteName("## Ingredients\n– flour", "Bread")).toBe(
      "# Bread\n\n## Ingredients\n– flour",
    );
  });

  it("reads a name written by hand exactly as one written from a control", () => {
    // Because they are the same thing: a `# ` line at the top of the body.
    expect(noteName(withNoteName("some words", "Kitchen"))).toBe("Kitchen");
  });

  it("puts a new name above the text and takes nothing away", () => {
    expect(withNoteName("some words", "Kitchen")).toBe("# Kitchen\n\nsome words");
  });

  it("replaces the line it wrote last time rather than stacking another", () => {
    expect(withNoteName("# Kitchen\n\nsome words", "Bathroom")).toBe(
      "# Bathroom\n\nsome words",
    );
  });

  it("names a note that has no text at all", () => {
    expect(withNoteName("", "Kitchen")).toBe("# Kitchen");
  });

  it("takes the blank line with it when the name is cleared", () => {
    // Or removing a name leaves the note opening on an empty line for ever.
    expect(withNoteName("# Kitchen\n\nsome words", "")).toBe("some words");
    expect(withNoteName("# Kitchen\n\nsome words", "   ")).toBe("some words");
  });

  it("leaves an unnamed note alone when the name is cleared", () => {
    const body = "some words";
    expect(withNoteName(body, "")).toBe(body);
  });

  it("trims the name it is given", () => {
    expect(withNoteName("words", "  Kitchen  ")).toBe("# Kitchen\n\nwords");
  });

  it("does not double the marker when the name is typed with one", () => {
    expect(withNoteName("words", "# Kitchen")).toBe("# Kitchen\n\nwords");
    expect(withNoteName("words", "#1 job")).toBe("# #1 job\n\nwords");
  });
});
