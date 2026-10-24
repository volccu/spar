// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { changedSpan, fieldOffset, fieldValue, writeThrough } from "./editText";

/**
 * A textarea reports its value with every line ending as "\n", whatever it was
 * handed. These two are the translation between the note as stored and the
 * note as the field counts it.
 */
describe("the note as the field holds it", () => {
  it("is the note itself when there is no carriage return in it", () => {
    const src = "line1\nline2";
    expect(fieldValue(src)).toBe(src);
    expect(fieldOffset(src, 8)).toBe(8);
  });

  it("counts every \\r\\n as one character, as the field does", () => {
    const src = "line1\r\nline2 word\r\nend";
    const field = fieldValue(src);
    expect(field).toBe("line1\nline2 word\nend");
    // Checked against a real textarea, which does its own normalising.
    const el = document.createElement("textarea");
    el.value = src;
    expect(el.value).toBe(field);
    // "wor" in the stored note, and the same three characters in the field.
    expect(field.slice(fieldOffset(src, 13), fieldOffset(src, 16))).toBe("wor");
    expect(field.slice(fieldOffset(src, 19))).toBe("end");
  });

  it("keeps an offset between \\r and \\n on its own line", () => {
    expect(fieldOffset("ab\r\ncd", 3)).toBe(2);
    expect(fieldOffset("ab\r\ncd", 4)).toBe(3);
  });
});

describe("the span that actually changed", () => {
  it("is the middle, not the whole value", () => {
    expect(changedSpan("- milk", "– milk")).toEqual({ from: 0, to: 1, text: "–" });
  });

  it("is an insertion at the caret with nothing to remove", () => {
    expect(changedSpan("a c", "a b c")).toEqual({ from: 2, to: 2, text: "b " });
  });

  it("is a deletion with nothing to put back", () => {
    expect(changedSpan("[ ] milk", "milk")).toEqual({ from: 0, to: 4, text: "" });
  });

  it("is empty for a value that did not change", () => {
    expect(changedSpan("same", "same")).toEqual({ from: 4, to: 4, text: "" });
  });

  it("does not run the head past the end of a shorter string", () => {
    expect(changedSpan("ab", "abcd")).toEqual({ from: 2, to: 2, text: "cd" });
    expect(changedSpan("abcd", "ab")).toEqual({ from: 2, to: 4, text: "" });
  });
});

/**
 * jsdom has no `execCommand`, which is the fallback path — the behaviour this
 * module replaced, and the one it must never do worse than. The command path
 * is exercised by standing a fake one in, because what matters about it is not
 * the browser's implementation but that the field ends up holding exactly what
 * was asked for and that a command which lies is not believed.
 */
describe("writing a programmatic edit into the field", () => {
  function field(value: string): HTMLTextAreaElement {
    const el = document.createElement("textarea");
    el.value = value;
    document.body.append(el);
    el.focus();
    return el;
  }

  it("falls back to assignment where there is no editing command", () => {
    const el = field("- milk");
    expect(writeThrough(el, "– milk", 2)).toBe(false);
    expect(el.value).toBe("– milk");
    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(2);
  });

  it("goes through the command when there is one, over the changed span only", () => {
    const el = field("- milk");
    const seen: { text: string; from: number; to: number }[] = [];
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(
      (name: string, _ui: boolean, text?: string) => {
        seen.push({ text: text ?? "", from: el.selectionStart, to: el.selectionEnd });
        if (name !== "insertText") return false;
        el.value = el.value.slice(0, el.selectionStart) + text + el.value.slice(el.selectionEnd);
        return true;
      },
    );
    try {
      expect(writeThrough(el, "– milk", 2)).toBe(true);
      // One character replaced, not six — a whole-value write would make the
      // entire note into a single undo step.
      expect(seen).toEqual([{ text: "–", from: 0, to: 1 }]);
      expect(el.value).toBe("– milk");
      expect(el.selectionStart).toBe(2);
    } finally {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it("does not believe a command that claims to have worked and has not", () => {
    const el = field("- milk");
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
    try {
      // Reported false, because the field does not hold what was asked for —
      // and the value is written anyway, which is the whole point.
      expect(writeThrough(el, "– milk", 2)).toBe(false);
      expect(el.value).toBe("– milk");
    } finally {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it("leaves a selection selected, for wrapping", () => {
    const el = field("one two");
    writeThrough(el, "**one** two", 2, 5);
    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(5);
  });
});
