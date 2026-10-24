// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState, type ComponentProps } from "react";
import type { Attachment, Note, UserBoard } from "../types";

/**
 * The store reaches IndexedDB and the network, and neither is the subject here.
 * What is: that a file on a note is shown once, that the picture is a way in to
 * looking at it properly, and that closing the picture is not closing the note.
 */
vi.mock("../store/useFileUrl", () => ({
  useFileUrl: () => ({ url: "blob:real-bytes", missing: false }),
}));

// The bytes behind a file, for Share — this device's copy, without the store.
vi.mock("../store/attachments", async (actual) => ({
  ...(await actual<typeof import("../store/attachments")>()),
  fetchFile: async (att: Attachment) => new Blob(["bytes"], { type: att.mime }),
}));

import { NoteView } from "./NoteView";
import { markKeyOpen } from "../lib/keyOpen";
import { MIN_WORKING_MS } from "./SyncMark";
import { CLOSE_MS, LIT_MS, VANISH_MS } from "../lib/motion";
import {
  recallReadingPosition,
  rememberReadingPosition,
} from "../lib/readingPosition";

afterEach(cleanup);

const shot: Attachment = {
  id: "a1",
  name: "1000025005.jpg",
  mime: "image/jpeg",
  size: 812_000,
  width: 1080,
  height: 1920,
  thumb: "data:image/jpeg;base64,xx",
  path: null,
  added_at: "2026-08-10T09:00:00.000Z",
};

const recording: Attachment = {
  ...shot,
  id: "a2",
  name: "voice-note.mp3",
  mime: "audio/mpeg",
  thumb: null,
};

const clip: Attachment = {
  ...shot,
  id: "a3",
  name: "walkthrough.mp4",
  mime: "video/mp4",
  thumb: null,
};

function fileNote(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    raw_content: "",
    body: "",
    source: "web",
    created_at: "2026-08-10T09:00:00.000Z",
    updated_at: "2026-08-10T09:00:00.000Z",
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [shot],
    ...over,
  };
}

function view(
  note: Note,
  onClose = () => {},
  onEditBody: (id: string, body: string) => void = () => {},
  onEditBodyIfBase?: (id: string, body: string, expectedBody: string) => boolean,
) {
  return render(
    <NoteView
      note={note}
      origin={null}
      closing={false}
      onClosed={() => {}}
      onClose={onClose}
      onEditBody={onEditBody}
      onEditBodyIfBase={onEditBodyIfBase}
      onSetStatus={() => {}}
      onTogglePriority={() => {}}
      onAttach={() => {}}
      onDetach={() => {}}
      registerInner={() => {}}
    />,
  );
}

describe("a note carrying a file", () => {
  it("never writes the filename into the page", () => {
    const { container } = view(fileNote());
    const written = container.textContent ?? "";
    // The square says its name to a screen reader and the viewer writes it.
    // The note's own text used to repeat it, which read as a sentence the
    // user had typed and had to delete; the row under the picture went with
    // the row (2026-10-17).
    expect(written.split(shot.name).length - 1).toBe(0);
    expect(screen.getByLabelText(`View ${shot.name}`)).toBeTruthy();
  });

  it("puts the words first and the files under them", () => {
    const { container } = view(fileNote({ body: "what are these called" }));
    const files = container.querySelector(".attachments")!;
    const words = container.querySelector(".reader")!;
    expect(words.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const strip = container.querySelector(".sheet-verbs")!;
    expect(files.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("removes a picture from its viewer, asking first", () => {
    const onDetach = vi.fn();
    viewWith(fileNote({ attachments: [{ ...shot, path: "u/n1/a1" }] }), { onDetach });
    fireEvent.click(screen.getByLabelText(`View ${shot.name}`));
    fireEvent.click(screen.getByRole("button", { name: `Remove ${shot.name}` }));
    expect(screen.queryByRole("dialog", { name: shot.name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(onDetach).toHaveBeenCalledWith(expect.any(String), shot.id);
  });

  it("does not throw the keyboard up over the picture", () => {
    view(fileNote());
    // An empty note opens straight into typing; an empty note holding a file
    // has plenty to look at, and opening it was for looking at it.
    expect(screen.queryByRole("textbox", { name: "Note text" })).toBeNull();
  });

  it("says a file is still on its way, and stops once it lands", () => {
    view(fileNote());
    expect(screen.getByLabelText("Sending")).toBeTruthy();
    cleanup();

    view(fileNote({ attachments: [{ ...shot, path: "u/n1/a1" }] }));
    expect(screen.queryByLabelText("Sending")).toBeNull();
    expect(screen.getByLabelText("Sent")).toBeTruthy();
  });

  it("reserves the picture's shape before it has decoded", () => {
    // `.attach-shot` is `width: 100%` with no intrinsic size, so without the
    // two attributes the row lays out at zero height and every word below it
    // jumps down by the height of a photograph the instant the image decodes.
    // The attachment has carried these since it was made, for this.
    const { container } = view(fileNote());
    const img = container.querySelector("img.attach-shot")!;
    expect(img.getAttribute("width")).toBe(String(shot.width));
    expect(img.getAttribute("height")).toBe(String(shot.height));
  });

  it("reserves nothing for an attachment that never recorded its shape", () => {
    // Every file written before those fields existed. Nothing to reserve is
    // not a reason to reserve the wrong thing.
    const { container } = view(
      fileNote({ attachments: [{ ...shot, width: null, height: null }] }),
    );
    const img = container.querySelector("img.attach-shot")!;
    expect(img.hasAttribute("width")).toBe(false);
    expect(img.hasAttribute("height")).toBe(false);
  });

  it("groups image attachments into one gallery", () => {
    const second = { ...shot, id: "a2", name: "1000025006.jpg" };
    const { container } = view(fileNote({ attachments: [shot, second] }));
    expect(container.querySelectorAll(".attach-grid .attach-tile")).toHaveLength(2);
    expect(container.querySelectorAll(".attachments > .attach")).toHaveLength(0);
  });

  it("renders native controls for audio and video attachments", () => {
    const { container } = view(fileNote({ attachments: [recording, clip] }));

    expect(container.querySelector("audio.attach-player")?.getAttribute("controls")).not.toBeNull();
    expect(container.querySelector("video.attach-player")?.getAttribute("controls")).not.toBeNull();
    expect(screen.getByLabelText(`Play ${recording.name}`)).toBeTruthy();
    expect(screen.getByLabelText(`Play ${clip.name}`)).toBeTruthy();
  });

  it("shows a preview for every link", () => {
    const { container } = view(
      fileNote({
        body: "https://one.example/a\nhttps://two.example/b",
        attachments: [],
      }),
    );
    expect(container.querySelectorAll(".link-previews .link-preview")).toHaveLength(2);
  });
});

/**
 * Formatting is characters in the note and nothing else. The marks stay in the
 * string and are drawn hidden, exactly as the ``` fences are, so the reading
 * view still equals the stored note character for character — which is the one
 * thing `offsetAtPoint` cannot survive being wrong about.
 */
describe("emphasis and headings", () => {
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });
  const read = (c: HTMLElement) => c.querySelector(".reader")?.textContent;

  it("draws exactly the note, marks and all", () => {
    const body =
      "# Shopping\nsome **bold** and *italic* and `code`\n\n## Later\n– milk";
    const { container } = view(note(body));
    expect(read(container)).toBe(body);
  });

  it("sets the marked words and draws the marks themselves, muted", () => {
    const { container } = view(note("a **b** c"));
    const strong = container.querySelector('.em[data-strong="true"]');
    expect(strong?.textContent).toBe("b");
    // The asterisks are drawn: the textarea tapping in swaps to shows them,
    // and a mark that appeared only then would move every word after it.
    const marks = Array.from(container.querySelectorAll(".reader .note-mark"));
    expect(marks.map((el) => el.textContent)).toEqual(["**", "**"]);
  });

  it("draws a heading, hashes drawn", () => {
    const { container } = view(note("# One\n## Two"));
    // Both spellings, one appearance. A subheading rendered identically to
    // inline bold, so it was withdrawn rather than left to confuse — but "##"
    // is pasted in constantly and still has to mean something.
    expect(container.querySelectorAll(".heading")).toHaveLength(2);
    expect(container.querySelector(".heading")?.textContent).toBe("# One\n");
    expect(container.querySelector(".heading .note-mark")?.textContent).toBe("# ");
  });

  /**
   * Reading and writing are one picture (styles.css, "one line grid"). The
   * editor is a textarea that draws every character, so the reader may hide
   * none — a hidden fence, hash or asterisk is a line or a word that appears
   * the moment the note is tapped, and moves everything after it.
   */
  it("hides no character of a formatted note", () => {
    const body =
      "# Plan\nsome **bold** and *slant* and `code`\n\n- [ ] box\n- [x] done\n1. one\n\n```\nlet a = 1;\n```\nend";
    const { container } = view(note(body));
    expect(read(container)).toBe(body);
    expect(container.querySelectorAll(".reader [hidden]")).toHaveLength(0);
  });

  /**
   * A code block is a panel in the reader, and the editor draws the same panel
   * behind its text, laid out on the same characters, so tapping in neither
   * moves a line nor takes the panel away (CodeBands.tsx, 2026-10-16).
   */
  it("draws a code block's panel while reading and while writing", () => {
    const body = "notes\n```js\nlet a = 1;\n```\nend";
    const { container } = view(note(body));
    expect(container.querySelector(".reader .codeblock")?.textContent).toBe("```js\nlet a = 1;\n```\n");
    fireEvent.click(container.querySelector(".reader")!);
    const bands = container.querySelector(".editor-bands")!;
    expect(bands.getAttribute("aria-hidden")).toBe("true");
    expect(bands.textContent).toBe(body);
    expect(bands.querySelector(".codeblock")?.textContent).toBe("```js\nlet a = 1;\n```\n");
  });

  /**
   * A long note scrolled to its end, tapped near the bottom: the textarea
   * arrives shorter than the reader it replaces, and the browser clamps the
   * body's scroll to the shorter height — the text was thrown up and the caret
   * left the finger. jsdom has no layout, so the clamp is played by hand.
   */
  it("keeps the note where it was scrolled when a tap starts typing", () => {
    const { container } = view(note("a long note\n".repeat(80)));
    const body = container.querySelector<HTMLElement>(".sheet-body")!;
    let top = 0;
    Object.defineProperty(body, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    top = 1800;
    fireEvent.scroll(body);
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    // The swap shortens the body for a moment, and the browser clamps.
    const reader = container.querySelector(".reader")!;
    top = 120;
    fireEvent.click(reader);
    expect(screen.getByRole("textbox", { name: "Note text" })).toBeTruthy();
    expect(top).toBe(1800);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("offers one heading control and no second level", () => {
    const { container } = view(note("milk"));
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.click(screen.getByLabelText("Insert"));
    expect(screen.queryByRole("button", { name: "Subheading" })).toBeNull();
    expect(screen.getByRole("button", { name: "Heading" })).toBeTruthy();
  });

  it("keeps the live address in the shared inline renderer", () => {
    const { container } = view(note("follow https://example.com/read"));
    expect(container.querySelector('.reader a[href="https://example.com/read"]')).toBeTruthy();
    expect(read(container)).toBe("follow https://example.com/read");
  });

  /**
   * This row has now been one, then two, then one again, and the history is
   * worth keeping: the split existed because a file input with no `accept`
   * makes Android offer camera, camcorder and a list of filenames, so
   * photographs arrived three taps deep and shown as names. What settled it
   * the other way is that a photograph now has two shorter paths in that do
   * not touch a picker at all — Ctrl+V on the desktop, and the phone's own
   * share sheet — so the picker is left doing the job it can actually do for
   * everything: reach anything a note can carry, under the same word the
   * capture bar's panel uses.
   */
  it("offers one attachment row, and closes from outside", () => {
    const { container } = view(note("milk"));
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.click(screen.getByLabelText("Insert"));

    expect(screen.getByRole("menuitem", { name: "Attachment" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Photos" })).toBeNull();
    // One picker, and it states no `accept` — a narrowed one would silently
    // cost PDFs, audio and everything else while the row still read as fine.
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].accept).toBe("");
    expect(inputs[0].multiple).toBe(true);
    expect(inputs[0].hasAttribute("capture")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Close insert menu" }));
    expect(screen.queryByRole("menu", { name: "Insert" })).toBeNull();
  });

  it("puts a heading mark on the line the caret is on, and takes it off again", () => {
    const saved = vi.fn();
    const { container } = view(note("milk\nbread"), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.select(field, { target: { selectionStart: 2, selectionEnd: 2 } });

    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    expect((field as HTMLTextAreaElement).value).toBe("# milk\nbread");

    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    // A toggle. A control that can only be turned on is half a control, and
    // the second line is never touched either way.
    expect((field as HTMLTextAreaElement).value).toBe("milk\nbread");
  });

  it("persists typed text before the editor loses focus", () => {
    const saved = vi.fn();
    const { container } = view(note("milk"), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });

    fireEvent.change(field, { target: { value: "milk and bread" } });

    expect(saved).toHaveBeenCalledWith("f1", "milk and bread");
  });

  it("wraps what was selected even when the field lost it", () => {
    // The phone: select three words, tap +, tap B. Tapping the panel can blur
    // the field, and a blurred field on Android collapses its selection — so
    // this used to lay down an empty "****" beside the words it was meant to
    // wrap. Nothing the user does collapses a selection without onSelect
    // saying so, which is what makes the remembered range safe to trust.
    const { container } = view(note("milk and bread"));
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", {
      name: "Note text",
    }) as HTMLTextAreaElement;

    field.setSelectionRange(0, 4);
    fireEvent.select(field);
    // The blur, as the phone performs it: the range is gone from the field.
    field.setSelectionRange(4, 4);

    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(field.value).toBe("**milk** and bread");
  });

  it("still puts an empty pair where the caret is", () => {
    const { container } = view(note("milk"));
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", {
      name: "Note text",
    }) as HTMLTextAreaElement;
    // A real collapse, reported as one — the remembered range must not
    // resurrect a selection the user has since given up.
    field.setSelectionRange(0, 4);
    fireEvent.select(field);
    field.setSelectionRange(4, 4);
    fireEvent.select(field);

    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(field.value).toBe("milk****");
    expect(field.selectionStart).toBe(6);
  });

  it("wraps the selection in bold, and unwraps it", () => {
    const { container } = view(note("milk and bread"));
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", {
      name: "Note text",
    }) as HTMLTextAreaElement;
    field.setSelectionRange(0, 4);

    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(field.value).toBe("**milk** and bread");
    // Still selected, so bolding then italicising the same phrase does not
    // mean picking it out twice.
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe("milk");

    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(field.value).toBe("milk and bread");
  });
});

/* Review 2026-10-01, UX-14: spellcheck off turned a phone keyboard's word
   suggestions and autocorrect off with it. On where the keyboard is on the
   screen; still off at a hardware keyboard, where it would only draw squiggles. */
describe("the editor's spellcheck", () => {
  afterEach(() => vi.unstubAllGlobals());
  const editor = () => {
    const { container } = view(fileNote({ id: "sp1", body: "teh words", attachments: [] }));
    fireEvent.click(container.querySelector(".reader")!);
    return screen.getByLabelText("Note text");
  };

  it("is off at a hardware keyboard", () => {
    expect(editor().getAttribute("spellcheck")).toBe("false");
  });

  it("is on with a screen keyboard, so the phone offers its words", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query !== "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    expect(editor().getAttribute("spellcheck")).toBe("true");
  });
});

/* Review 2026-10-01, UX-24: the underlined trash line did nothing, and the
   bar's Put back was an unworded mark drawn the same as Import. */
describe("a note in the trash", () => {
  it("puts it back from the underlined line above its text", () => {
    const onSetStatus = vi.fn();
    const onClose = vi.fn();
    viewWith(
      fileNote({ id: "tr1", body: "printer ink", attachments: [], status: "trashed" }),
      { onSetStatus, onClose },
    );
    fireEvent.click(screen.getByRole("button", { name: /in trash — \d+d left · put back/ }));
    expect(onSetStatus).toHaveBeenCalledWith("tr1", "active");
    expect(onClose).toHaveBeenCalled();
  });

  it("words the bar's Put back, so it is not a bare arrow", () => {
    viewWith(fileNote({ id: "tr3", body: "printer ink", attachments: [], status: "trashed" }));
    const mark = screen.getByRole("button", { name: "Put back" });
    expect(mark.textContent?.toLowerCase()).toBe("put back");
  });

  it("does not draw Put back the way Import is drawn", () => {
    viewWith(fileNote({ id: "tr2", body: "printer ink", attachments: [], status: "trashed" }));
    const mark = screen.getByRole("button", { name: "Put back" }).querySelector("svg")!;
    // Import's tray, "M3 16.5v2.25…", is not in it.
    expect(mark.innerHTML).not.toContain("M3 16.5");
  });
});

describe("naming a note", () => {
  const note = (body: string, over: Partial<Note> = {}) =>
    fileNote({ id: "nm", body, attachments: [], ...over });

  it("offers a name above an unnamed note and writes it as the first line", () => {
    const saved = vi.fn();
    const { container } = view(note("buy the tiles"), () => {}, saved);
    fireEvent.click(screen.getByRole("button", { name: "Add a name" }));
    const field = screen.getByLabelText("Note name");
    fireEvent.change(field, { target: { value: "Bathroom" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(saved).toHaveBeenLastCalledWith("nm", "# Bathroom\n\nbuy the tiles");
    // The name is now the note's heading, drawn in the text itself, and the
    // control has nothing left to offer.
    expect(container.querySelector(".reader .heading")?.textContent).toBe("# Bathroom\n");
    expect(screen.queryByRole("button", { name: "Add a name" })).toBeNull();
  });

  it("opens on the name a held row already has, so stepping away keeps it", () => {
    // The row is held while typing, so it is still up over a `# ` line typed
    // by hand. Opened empty, a tap and a blur wrote "no name" over it.
    const saved = vi.fn();
    view(note("buy the tiles"), () => {}, saved);
    fireEvent.click(screen.getByLabelText("Note text"));
    fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), {
      target: { value: "# Tiles\n\nbuy the tiles" },
    });
    expect(saved).toHaveBeenLastCalledWith("nm", "# Tiles\n\nbuy the tiles");
    fireEvent.click(screen.getByRole("button", { name: "Add a name" }));
    const field = screen.getByLabelText("Note name") as HTMLInputElement;
    expect(field.value).toBe("Tiles");
    fireEvent.blur(field);
    expect(saved).toHaveBeenLastCalledWith("nm", "# Tiles\n\nbuy the tiles");
  });

  it("keeps a name still in the field when the note closes under it", () => {
    // Android's back gesture removes the focused field without a blur.
    const saved = vi.fn();
    const { unmount } = view(note("buy the tiles"), () => {}, saved);
    fireEvent.click(screen.getByRole("button", { name: "Add a name" }));
    fireEvent.change(screen.getByLabelText("Note name"), { target: { value: "Bathroom" } });
    unmount();
    expect(saved).toHaveBeenLastCalledWith("nm", "# Bathroom\n\nbuy the tiles");
  });

  it("does not commit on the Enter that finishes an IME word", () => {
    const saved = vi.fn();
    view(note("buy the tiles"), () => {}, saved);
    fireEvent.click(screen.getByRole("button", { name: "Add a name" }));
    const field = screen.getByLabelText("Note name");
    fireEvent.change(field, { target: { value: "Kylpy" } });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    expect(screen.getByLabelText("Note name")).toBe(field);
    expect(saved).not.toHaveBeenCalled();
  });

  it("offers nothing on a note that already has a name", () => {
    view(note("# Tiles\n\nbuy them"));
    expect(screen.queryByRole("button", { name: "Add a name" })).toBeNull();
  });

  it("offers nothing on a note in the trash", () => {
    view(note("buy the tiles", { status: "trashed" }));
    expect(screen.queryByRole("button", { name: "Add a name" })).toBeNull();
  });

  it("Escape drops the name and leaves the note open", () => {
    const saved = vi.fn();
    const closed = vi.fn();
    view(note("buy the tiles"), closed, saved);
    fireEvent.click(screen.getByRole("button", { name: "Add a name" }));
    const field = screen.getByLabelText("Note name");
    fireEvent.change(field, { target: { value: "Bathroom" } });
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(saved).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Note name")).toBeNull();
  });
});

describe("editor recovery", () => {
  it("does not put old words over a newer copy", () => {
    const saved = vi.fn();
    const cas = vi.fn(() => true);
    const initial = fileNote({ id: "conflict", body: "old words", attachments: [] });
    const rendered = view(initial, () => {}, saved, cas);
    fireEvent.click(rendered.container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.change(field, { target: { value: "my words" } });

    rendered.rerender(
      <NoteView
        note={{ ...initial, body: "newer words", updated_at: "2026-08-10T10:01:00.000Z" }}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={saved}
        onEditBodyIfBase={() => false}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Note text" }));

    // The third argument is the body the draft grew out of, not a clock —
    // `editBodyIfBase`. The stamp read off props was the version of this that
    // a single keystroke could defeat.
    expect(cas).toHaveBeenCalledWith("conflict", "my words", initial.body);
    // The close path must not make a second compare-and-save attempt with the
    // stale draft after the newer copy arrives.
    expect(cas).toHaveBeenCalledTimes(1);
  });
});

/**
 * The order of a list is part of what it says. The grip lives in the reading
 * view because that is where the list exists as a list — editing is a textarea,
 * which has characters in it and no items to take hold of.
 */
/**
 * Untick all and Clear done, in the strip under the text. The write is the
 * note's own save, and the board is told afterwards so it can offer it back.
 */
describe("the list's two verbs", () => {
  function listView(
    body: string,
    over: Partial<ComponentProps<typeof NoteView>> = {},
  ) {
    const saved = vi.fn();
    const told = vi.fn();
    const utils = render(
      <NoteView
        note={fileNote({ id: "l1", body, raw_content: body, attachments: [] })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={saved}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onListRewritten={told}
        {...over}
      />,
    );
    return { ...utils, saved, told };
  }

  it("offers neither while nothing is ticked", () => {
    listView("[ ] milk\n[ ] bread");
    expect(screen.queryByRole("button", { name: "Untick all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear done" })).toBeNull();
  });

  it("unticks every box, saves it, and hands the board both bodies to offer back", () => {
    const { saved, told } = listView("Shop\n[ ] milk\n[x] eggs\n☑ jam");
    fireEvent.click(screen.getByRole("button", { name: "Untick all" }));
    expect(saved).toHaveBeenCalledWith("l1", "Shop\n[ ] milk\n[ ] eggs\n☐ jam");
    expect(told).toHaveBeenCalledWith(
      "l1",
      "Shop\n[ ] milk\n[x] eggs\n☑ jam",
      "Shop\n[ ] milk\n[ ] eggs\n☐ jam",
      "Unticked 2",
    );
    // Nothing is ticked any more, so the two marks go with the ticks.
    expect(screen.queryByRole("button", { name: "Untick all" })).toBeNull();
  });

  it("clears the ticked items and keeps every other line", () => {
    const { saved, told } = listView("Shop\n[ ] milk\n[x] eggs\nafter");
    fireEvent.click(screen.getByRole("button", { name: "Clear done" }));
    expect(saved).toHaveBeenCalledWith("l1", "Shop\n[ ] milk\nafter");
    expect(told).toHaveBeenCalledWith(
      "l1",
      "Shop\n[ ] milk\n[x] eggs\nafter",
      "Shop\n[ ] milk\nafter",
      "Cleared 1 done",
    );
  });

  it("offers nothing back when the write was refused", () => {
    const { told } = listView("[x] milk\n[ ] bread", {
      onEditBodyIfBase: () => false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear done" }));
    expect(told).not.toHaveBeenCalled();
  });

  it("is not offered in the trash", () => {
    const body = "[x] milk\n[ ] bread";
    listView(body, {
      note: fileNote({ id: "l1", body, raw_content: body, attachments: [], status: "trashed" }),
    });
    expect(screen.queryByRole("button", { name: "Untick all" })).toBeNull();
  });
});

describe("dragging a list item", () => {
  const list = (body: string) =>
    fileNote({ id: "l1", body, attachments: [] });

  /** jsdom measures everything as zero, so the items are given real heights. */
  function stack(container: HTMLElement) {
    const items = Array.from(container.querySelectorAll<HTMLElement>(".item"));
    items.forEach((el, n) => {
      el.getBoundingClientRect = () =>
        ({ top: n * 40, height: 40, bottom: n * 40 + 40 }) as DOMRect;
    });
    return items;
  }

  it("offers a grip on every item of a real list", () => {
    const { container } = view(list("– milk\n– bread\n– jam"));
    expect(container.querySelectorAll(".item-grip")).toHaveLength(3);
  });

  it("offers none on a lone item — a run of one is not a list", () => {
    const { container } = view(list("shopping\n– milk"));
    expect(container.querySelector(".item-grip")).toBeNull();
  });

  it("moves the item and saves at once, like a tick", () => {
    const saved = vi.fn();
    const { container } = view(list("– milk\n– bread\n– jam"), () => {}, saved);
    const items = stack(container);
    const grip = items[2].querySelector(".item-grip")!;

    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 10, pointerId: 1 });

    expect(saved).toHaveBeenCalledWith("l1", "– jam\n– milk\n– bread");
  });

  it("counts a numbered list again once it has been reordered", () => {
    const saved = vi.fn();
    const { container } = view(list("1. a\n2. b\n3. c"), () => {}, saved);
    const items = stack(container);
    const grip = items[0].querySelector(".item-grip")!;

    fireEvent.pointerDown(grip, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 110, pointerId: 1 });

    expect(saved).toHaveBeenCalledWith("l1", "1. b\n2. c\n3. a");
  });

  it("writes nothing when the item is put back where it came from", () => {
    const saved = vi.fn();
    const { container } = view(list("– milk\n– bread"), () => {}, saved);
    const items = stack(container);
    const grip = items[0].querySelector(".item-grip")!;

    fireEvent.pointerDown(grip, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 14, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 14, pointerId: 1 });

    expect(saved).not.toHaveBeenCalled();
  });

  /**
   * The hard rule the whole reading view rests on: what is drawn must equal
   * what is stored, character for character, or `offsetAtPoint` puts the caret
   * in the wrong place for every tap after the first difference. The grip is an
   * element inside that text, so it has to carry no characters of its own.
   */
  it("draws exactly the note, grips and all", () => {
    const body = "shopping\n– milk\n– bread\n\n1. first\n2. second";
    const { container } = view(list(body));
    expect(container.querySelector(".reader")?.textContent).toBe(body);
  });

  it("does not drop a caret into the note when a grip is touched", () => {
    const { container } = view(list("– milk\n– bread"));
    const items = stack(container);
    fireEvent.click(items[0].querySelector(".item-grip")!);
    // Still reading. A grab is not a click, and the editor must not swap in
    // under a drag that has not started yet.
    expect(screen.queryByRole("textbox", { name: "Note text" })).toBeNull();
  });

  /**
   * A blank line ends a list. It leaves no prose block between the two items
   * either side of it — its newline is claimed as the second item's lead — so
   * reading adjacency alone made them one run, and dragging the lower item up
   * carried it over the gap and moved the blank line to the bottom of the note.
   * `settleChecklist` has always stopped at the blank; the grips now agree.
   */
  it("offers no grip across a blank line — the items either side are two lists", () => {
    const { container } = view(list("[ ] a\n\n[ ] b"));
    expect(container.querySelector(".item-grip")).toBeNull();
  });

  it("moves an item only within its own list, and never the blank line above it", () => {
    const saved = vi.fn();
    const { container } = view(list("– a\n– b\n\n– c\n– d"), () => {}, saved);
    const items = stack(container);
    expect(container.querySelectorAll(".item-grip")).toHaveLength(4);
    const grip = items[3].querySelector(".item-grip")!;

    fireEvent.pointerDown(grip, { clientY: 140, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 0, pointerId: 1 });

    expect(saved).toHaveBeenCalledWith("l1", "– a\n– b\n\n– d\n– c");
  });
});

/**
 * A tick is a decision about one item, and the decision moves the item
 * somewhere: done boxes sink below the open ones, so the eye lands on what is
 * left. The box stays the note's own characters — the list has just been put
 * back in order, not replaced by widgets.
 */
describe("ticking a box settles the list", () => {
  const list = (body: string) => fileNote({ id: "l1", body, attachments: [] });

  it("moves the box you just ticked below the open ones", () => {
    const saved = vi.fn();
    const { container } = view(list("[ ] 1\n[ ] 2\n[ ] 3"), () => {}, saved);
    const hits = container.querySelectorAll<HTMLElement>(".check-hit");
    expect(hits).toHaveLength(3);

    fireEvent.click(hits[1]);
    expect(saved).toHaveBeenCalledWith("l1", "[ ] 1\n[ ] 3\n[x] 2");
  });

  it("lifts a box back up when it is unticked", () => {
    const saved = vi.fn();
    const { container } = view(list("[x] a\n[x] b"), () => {}, saved);
    fireEvent.click(container.querySelectorAll<HTMLElement>(".check-hit")[1]);
    expect(saved).toHaveBeenCalledWith("l1", "[ ] b\n[x] a");
  });

  it("draws exactly the note it saved, new order and all", () => {
    const saved = vi.fn();
    const { container } = view(list("[ ] 1\n[ ] 2\n[ ] 3"), () => {}, saved);
    fireEvent.click(container.querySelectorAll<HTMLElement>(".check-hit")[1]);
    expect(saved).toHaveBeenCalledWith("l1", "[ ] 1\n[ ] 3\n[x] 2");
    expect(container.querySelector(".reader")?.textContent).toBe("[ ] 1\n[ ] 3\n[x] 2");
  });

  it("touches no other list in the note", () => {
    const saved = vi.fn();
    const { container } = view(
      list("errands\n[ ] a\n[ ] b\n\nlater\n\n[ ] x\n[ ] y"),
      () => {},
      saved,
    );
    fireEvent.click(container.querySelectorAll<HTMLElement>(".check-hit")[0]);
    expect(saved).toHaveBeenCalledWith("l1", "errands\n[ ] b\n[x] a\n\nlater\n\n[ ] x\n[ ] y");
  });
});

describe("looking at a picture properly", () => {
  it("opens it at the size of the screen when tapped", () => {
    view(fileNote());
    expect(screen.queryByRole("dialog", { name: shot.name })).toBeNull();

    fireEvent.click(screen.getByLabelText(`View ${shot.name}`));
    const full = screen.getByRole("dialog", { name: shot.name });
    // The real bytes, not the thumbnail carried in the note row.
    expect(full.querySelector("img")?.getAttribute("src")).toBe("blob:real-bytes");
  });

  it("walks to the file beside it, from the index the row it was opened from has", () => {
    // The list the viewer walks is the list of rows the note drew, in that
    // order — so opening the second picture opens *at* the second, and the
    // arrow keys move along the note rather than back to the beginning.
    const second: Attachment = { ...shot, id: "a9", name: "receipt.jpg" };
    view(fileNote({ attachments: [shot, second] }));

    fireEvent.click(screen.getByLabelText(`View ${second.name}`));
    expect(screen.getByRole("dialog", { name: second.name })).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: shot.name })).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();

    // Nothing before the first: the end of the note is the end of the walk.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog", { name: shot.name })).toBeTruthy();
  });

  /** The note as the app hands it over, for a test that hands it a newer copy. */
  const sheet = (n: Note) => (
    <NoteView
      note={n}
      origin={null}
      closing={false}
      onClosed={() => {}}
      onClose={() => {}}
      onEditBody={() => {}}
      onSetStatus={() => {}}
      onTogglePriority={() => {}}
      onAttach={() => {}}
      onDetach={() => {}}
      registerInner={() => {}}
    />
  );

  /**
   * The viewer holds *which file*, not where it stood. Held as an index, a sync
   * that added or removed a file anywhere before it silently swapped the
   * picture on screen for its neighbour.
   */
  it("stays on the file it is showing when a sync puts another in front of it", () => {
    const second: Attachment = { ...shot, id: "a9", name: "receipt.jpg" };
    const arrived: Attachment = { ...shot, id: "a8", name: "from-the-phone.jpg" };
    const r = render(sheet(fileNote({ attachments: [shot, second] })));
    fireEvent.click(screen.getByLabelText(`View ${second.name}`));
    expect(screen.getByText("2 / 2")).toBeTruthy();

    r.rerender(sheet(fileNote({ attachments: [arrived, shot, second] })));
    expect(screen.getByRole("dialog", { name: second.name })).toBeTruthy();
    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  it("stays on it when another file goes, and closes only when it is the one gone", () => {
    const second: Attachment = { ...shot, id: "a9", name: "receipt.jpg" };
    const r = render(sheet(fileNote({ attachments: [shot, second] })));
    fireEvent.click(screen.getByLabelText(`View ${second.name}`));

    r.rerender(sheet(fileNote({ attachments: [second] })));
    expect(screen.getByRole("dialog", { name: second.name })).toBeTruthy();

    r.rerender(sheet(fileNote({ attachments: [] })));
    expect(screen.queryByRole("dialog", { name: second.name })).toBeNull();
  });

  it("closes the picture on Escape, and leaves the note open", () => {
    const onClose = vi.fn();
    view(fileNote(), onClose);
    fireEvent.click(screen.getByLabelText(`View ${shot.name}`));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: shot.name })).toBeNull();
    // Escape means the top thing on screen, which was the picture.
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands its close upward, so Back can play it", () => {
    let inner: (() => void) | null = null;
    render(
      <NoteView
        note={fileNote()}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={(close) => {
          inner = close;
        }}
      />,
    );

    // Nothing inside the note yet, so Back has nothing to reach for.
    expect(inner).toBeNull();
    fireEvent.click(screen.getByLabelText(`View ${shot.name}`));
    expect(inner).toBeTypeOf("function");

    act(() => inner!());
    expect(screen.queryByRole("dialog", { name: shot.name })).toBeNull();
    expect(inner).toBeNull();
  });
});

/**
 * Counting a list straight again after an item has been deleted.
 *
 * The one thing in the app allowed to rewrite a line the caret is not standing
 * on — and the reason it is allowed is that it never fires while the line is
 * being written. See the note at the top of lib/reorder.ts.
 */
describe("a numbered list after an item is deleted", () => {
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });

  it("closes the gap when the editor is committed", () => {
    const saved = vi.fn();
    const { container } = view(note("1. one\n2. two\n3. three"), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });

    // The second item is gone. The third still calls itself 3.
    fireEvent.change(field, { target: { value: "1. one\n3. three" } });
    expect(saved).toHaveBeenLastCalledWith("f1", "1. one\n3. three");

    fireEvent.blur(field);
    expect(saved).toHaveBeenLastCalledWith("f1", "1. one\n2. three");
  });

  it("leaves the numbers alone while they are still being typed", () => {
    // The invariant this feature had to be built around: nothing may rewrite
    // text under a caret that is still in the note.
    const saved = vi.fn();
    const { container } = view(note("1. one\n2. two\n3. three"), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });

    fireEvent.change(field, { target: { value: "1. one\n5. two\n3. three" } });
    expect(saved).toHaveBeenLastCalledWith("f1", "1. one\n5. two\n3. three");
  });

  it("writes nothing at all when the note was only read", () => {
    // Opening a note and closing it again may never rewrite a line — that
    // would edit a note nobody edited, and pull its card to the top of a board
    // now ordered on the edit.
    const saved = vi.fn();
    const { container, unmount } = view(note("1. one\n3. three"), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.blur(screen.getByRole("textbox", { name: "Note text" }));
    unmount();
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("what the open note says about when", () => {
  const day = "2026-08-10T09:00:00.000Z";

  /**
   * Whether a date prints its year is a fact about when it is being *read*, so
   * the reader has to stand somewhere definite. Only `Date` is faked — the
   * timers themselves stay real, because everything else in this file depends
   * on them.
   */
  function readingOn(iso: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dates a note nobody has edited by the day it was written", () => {
    readingOn("2026-08-28T09:00:00.000Z");
    const { container } = view(fileNote({ body: "hello", attachments: [] }));
    const foot = container.querySelector(".sheet-verbs")?.textContent ?? "";
    expect(foot).toContain("10 Aug");
    expect(foot).not.toContain("edited");
    expect(foot).not.toContain("written");
  });

  it("leads with the edit and keeps the capture date behind it", () => {
    readingOn("2026-09-04T09:00:00.000Z");
    const { container } = view(
      fileNote({
        body: "hello",
        attachments: [],
        created_at: day,
        updated_at: "2026-09-02T09:00:00.000Z",
        field_updated_at: { body: "2026-09-02T09:00:00.000Z" },
      }),
    );
    // The edit date lives in the footer now; the capture date stays a fact in
    // the row above the text.
    const foot = container.querySelector(".sheet-verbs")?.textContent ?? "";
    expect(foot).toContain("2 Sep");
    const meta = container.querySelector(".sheet-meta")?.textContent ?? "";
    expect(meta).toContain("written 10 Aug");
  });

  /**
   * The year is dropped only while the reader is standing in it. Nothing is
   * written to the note when the year turns — the same stamp simply starts
   * saying more, because the date is read off the shared clock.
   */
  it("says nothing about the year until the reader is in a different one", () => {
    readingOn("2026-08-28T09:00:00.000Z");
    const one = view(fileNote({ body: "hello", attachments: [], created_at: day }));
    expect(one.container.querySelector(".sheet-verbs")?.textContent ?? "").not.toContain("2026");
    one.unmount();

    readingOn("2027-01-01T09:00:00.000Z");
    const two = view(fileNote({ body: "hello", attachments: [], created_at: day }));
    expect(two.container.querySelector(".sheet-verbs")?.textContent ?? "").toContain(
      "10 Aug 2026",
    );
  });

  /** A line of memory (joy review 2026-10-14, #14): past a year, the stamp names
   *  the month the note was last touched instead of only the day. */
  it("says how long ago an old note was last touched, once it is over a year", () => {
    readingOn("2027-09-01T09:00:00.000Z");
    const old = view(fileNote({ body: "hello", attachments: [], created_at: day }));
    const foot = old.container.querySelector(".sheet-verbs")?.textContent ?? "";
    expect(foot).toContain("Untouched since August 2026");
    expect(foot).not.toContain("10 Aug");
    old.unmount();

    readingOn("2027-08-01T09:00:00.000Z");
    const recent = view(fileNote({ body: "hello", attachments: [], created_at: day }));
    const text = recent.container.querySelector(".sheet-verbs")?.textContent ?? "";
    expect(text).not.toContain("Untouched");
    expect(text).toContain("10 Aug 2026");
  });
});

/**
 * The note sheet is `role="dialog" aria-modal="true"` but until now had none
 * of the behaviour that makes those attributes true: nothing moved focus in,
 * Tab walked straight through it onto the grid behind it, and closing it
 * left focus wherever it happened to be. Lightbox.tsx and Dialog.tsx already
 * do this correctly for their own layers; this is the same pattern ported to
 * the sheet.
 */
describe("the open note traps focus like a dialog", () => {
  function openFrom(note: Note) {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open note
          </button>
          {open && (
            <NoteView
              note={note}
              origin={null}
              closing={false}
              onClosed={() => {}}
              onClose={() => setOpen(false)}
              onEditBody={() => {}}
              onSetStatus={() => {}}
              onTogglePriority={() => {}}
              onAttach={() => {}}
              onDetach={() => {}}
              registerInner={() => {}}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open note" });
    opener.focus();
    fireEvent.click(opener);
    return opener;
  }

  it("moves focus inside on open, and restores it to the triggering element on close", () => {
    const opener = openFrom(fileNote({ id: "f1", body: "milk", attachments: [] }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close note" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("wraps Tab at the sheet's boundary instead of escaping onto the grid", () => {
    openFrom(fileNote({ id: "f1", body: "milk", attachments: [] }));
    const sheet = screen.getByRole("dialog", { name: "Note" });
    // The same selector onSheetKeyDown itself uses — an incomplete copy here
    // would silently test the wrong boundary.
    const SELECTOR =
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(sheet.querySelectorAll<HTMLElement>(SELECTOR));

    let list = focusable();
    expect(list.length).toBeGreaterThan(1);
    const first = list[0];

    // The reader sits last, and by design (see NoteView's onFocus on
    // `.reader`) focusing it — which wrapping onto it does — starts editing,
    // swapping it for a textarea. That is real behaviour the trap has to
    // survive, not a reason to avoid testing the boundary: re-read the list
    // after the event settles rather than trusting a reference captured
    // before it.
    list[list.length - 1].focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    list = focusable();
    expect(document.activeElement).toBe(list[list.length - 1]);
    // Whatever it landed on, it is still inside the sheet — Tab never once
    // escaped it in either direction.
    expect(sheet.contains(document.activeElement)).toBe(true);
  });
});

/**
 * `#word` used to be a hand-typed tag with a tap of its own. Tagging is gone
 * (see git history): it is plain text now, same as any other word.
 */
describe("#word in a note", () => {
  it("renders as plain text, with no special styling or tap target", () => {
    const { container } = view(
      fileNote({ id: "t1", body: "buy milk #todo", attachments: [] }),
    );
    expect(container.querySelector(".reader")?.textContent).toBe("buy milk #todo");
    expect(container.querySelector(".reader a")).toBeNull();
    expect(container.querySelector(".inline-tag")).toBeNull();
  });
});

/**
 * Review UX-B-05: the open note's panels take the focus when they open and
 * hand it back to the mark that opened them. Review UI-A-03: with a mouse,
 * the Move chooser and the reminder panel hang under what opened them.
 */
describe("the open note's panels and the focus", () => {
  afterEach(() => vi.unstubAllGlobals());
  const boards: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];
  const withMouse = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  const open = () =>
    viewWith(fileNote({ id: "f1", body: "buy milk", attachments: [] }), {
      boards,
      onMove: vi.fn(),
    });
  /** A mark pressed from the keyboard: focused, then clicked. */
  const press = (el: HTMLElement) => {
    el.focus();
    fireEvent.click(el, { detail: 0 });
  };

  it("puts a keyboard in the Move chooser's field, and gives it back to the mark", () => {
    withMouse();
    open();
    const mark = screen.getByRole("button", { name: "Move to a board" });
    press(mark);
    expect(document.activeElement).toBe(screen.getByLabelText("Search boards or name a new one"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Search boards or name a new one")).toBeNull();
    expect(document.activeElement).toBe(mark);
  });

  it("gives the focus back to the Move mark once a board is chosen", () => {
    withMouse();
    open();
    const mark = screen.getByRole("button", { name: "Move to a board" });
    press(mark);
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(document.activeElement).toBe(mark);
  });

  it("does not put a phone's focus in the field, where it would raise the keyboard", () => {
    open();
    press(screen.getByRole("button", { name: "Move to a board" }));
    expect(document.activeElement).not.toBe(
      screen.getByLabelText("Search boards or name a new one"),
    );
    expect(document.activeElement).toBe(screen.getByRole("group", { name: "Move to a board" }));
  });

  it("hangs the Move chooser under its mark with a mouse, and in the corner without", () => {
    withMouse();
    open();
    press(screen.getByRole("button", { name: "Move to a board" }));
    const panel = screen.getByRole("group", { name: "Move to a board" });
    expect(panel.classList.contains("selpanel-under")).toBe(true);
    expect(panel.classList.contains("selpanel-right")).toBe(false);
    vi.unstubAllGlobals();
    cleanup();
    open();
    press(screen.getByRole("button", { name: "Move to a board" }));
    expect(
      screen.getByRole("group", { name: "Move to a board" }).classList.contains("selpanel-right"),
    ).toBe(true);
  });

  it("closes the Move chooser on a click anywhere off it, without moving the note", () => {
    const onMove = vi.fn();
    viewWith(fileNote({ id: "f1", body: "buy milk", attachments: [] }), { boards, onMove });
    press(screen.getByRole("button", { name: "Move to a board" }));
    expect(screen.getByRole("group", { name: "Move to a board" }).classList.contains("selpanel-over")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close board chooser" }));
    expect(screen.queryByRole("group", { name: "Move to a board" })).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("hangs the Insert menu under the + with a mouse, and in the corner without", () => {
    withMouse();
    open();
    press(screen.getByRole("button", { name: "Insert" }));
    const panel = screen.getByRole("menu", { name: "Insert" });
    expect(panel.classList.contains("selpanel-under")).toBe(true);
    expect(panel.classList.contains("selpanel-right")).toBe(false);
    vi.unstubAllGlobals();
    cleanup();
    open();
    press(screen.getByRole("button", { name: "Insert" }));
    expect(
      screen.getByRole("menu", { name: "Insert" }).classList.contains("selpanel-right"),
    ).toBe(true);
  });

  /* Under 700px the marks stand in the bar at the foot of the glass, so a
     panel hung from one has no room: a desktop window snapped to half a
     screen, with a mouse, opened Insert with its top at the window's bottom
     edge and no height. There the panels stand in the corner above the bar,
     as they do for a finger. */
  const withMouseAtPhoneWidth = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)" || query === "(max-width: 699px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  it("stands the Insert menu above the bar, not under the +, in a narrow window with a mouse", () => {
    withMouseAtPhoneWidth();
    open();
    press(screen.getByRole("button", { name: "Insert" }));
    const panel = screen.getByRole("menu", { name: "Insert" });
    expect(panel.classList.contains("selpanel-under")).toBe(false);
    expect(panel.classList.contains("selpanel-right")).toBe(true);
    // Still a mouse's panel in every other way: the first row takes the focus.
    expect(document.activeElement).toBe(panel.querySelector("button"));
  });

  it("stands the Move chooser above the bar, not under its mark, in a narrow window with a mouse", () => {
    withMouseAtPhoneWidth();
    open();
    press(screen.getByRole("button", { name: "Move to a board" }));
    const panel = screen.getByRole("group", { name: "Move to a board" });
    expect(panel.classList.contains("selpanel-under")).toBe(false);
    expect(panel.classList.contains("selpanel-right")).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Search boards or name a new one"));
  });

  it("puts the focus on the reminder panel's first row, and back on the stamp", () => {
    withMouse();
    open();
    const stamp = screen.getByRole("button", { name: "Set a reminder" });
    press(stamp);
    const panel = screen.getByRole("menu", { name: "Reminder" });
    expect(panel.classList.contains("selpanel-under")).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector("button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Reminder" })).toBeNull();
    expect(document.activeElement).toBe(stamp);
  });

  // The + is an ordinary mark in the bar, not a button floating over the words
  // (review UI-02): it stays in its place while a panel is up.
  it("keeps the + in the marks bar, where it is a mark like the rest", () => {
    open();
    const plus = screen.getByRole("button", { name: "Insert" });
    expect(plus.classList.contains("iconbtn")).toBe(true);
    expect(plus.parentElement?.classList.contains("sheet-marks")).toBe(true);
    expect(plus.parentElement?.firstElementChild).toBe(plus);
    press(plus);
    expect(screen.getByRole("button", { name: "Insert" })).toBe(plus);
  });

  it("puts the focus in the insert panel, and back on the +", () => {
    open();
    press(screen.getByRole("button", { name: "Insert" }));
    const panel = screen.getByRole("menu", { name: "Insert" });
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Insert" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Insert" }));
  });
});

/** The Move mark opens the same board chooser the multi-select panel uses. */
describe("the Move mark", () => {
  const boards: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];

  it("only appears when the app hands it something to move into", () => {
    view(fileNote({ id: "t2", body: "buy milk", attachments: [] }));
    expect(screen.queryByRole("button", { name: "Move to a board" })).toBeNull();
  });

  it("opens a board chooser, and files the note into the board tapped", () => {
    const onMove = vi.fn();
    render(
      <NoteView
        note={fileNote({ id: "t3", body: "buy milk", attachments: [] })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        boards={boards}
        onMove={onMove}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move to a board" }));
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(onMove).toHaveBeenCalledWith("t3", "b1");
  });

  /** A note with words beside its address has no folder it belongs in, and
   *  used to sit in the Inbox for good. Links is offered beside the folders. */
  function withLinks(note: Note, onLinks = vi.fn(), onMove = vi.fn()) {
    render(
      <NoteView
        note={note}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        boards={boards}
        onMove={onMove}
        onLinks={onLinks}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move to a board" }));
    return { onLinks, onMove };
  }

  it("offers Links to a note with an address in it, and puts it there", () => {
    const { onLinks } = withLinks(
      fileNote({ id: "t5", body: "try this https://example.com/bread", attachments: [] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Links" }));
    expect(onLinks).toHaveBeenCalledWith("t5");
  });

  it("does not offer Links to a note with no address in it", () => {
    withLinks(fileNote({ id: "t6", body: "buy milk", attachments: [] }));
    expect(screen.queryByRole("button", { name: "Links" })).toBeNull();
  });

  it("offers the Inbox back to a note already on Links", () => {
    const { onMove } = withLinks(
      fileNote({
        id: "t7",
        body: "try this https://example.com/bread",
        note_type: "link",
        attachments: [],
      }),
    );
    expect(screen.queryByRole("button", { name: "Links" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    expect(onMove).toHaveBeenCalledWith("t7", null);
  });
});

/** The Todo-toggle mark: the one field a person still sets by hand. */
describe("the Todo-toggle mark", () => {
  it("marks a note as a to-do", () => {
    const onToggleTodo = vi.fn();
    const note = fileNote({ id: "t4", body: "call the bank", note_type: null, attachments: [] });
    render(
      <NoteView
        note={note}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onToggleTodo={onToggleTodo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "To-do", pressed: false }));
    expect(onToggleTodo).toHaveBeenCalledWith(note);
  });

  it("offers to unmark a note already marked as one", () => {
    render(
      <NoteView
        note={fileNote({ id: "t5", body: "call the bank", note_type: "todo", attachments: [] })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onToggleTodo={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "To-do", pressed: true })).toBeTruthy();
  });

  /**
   * The fault this mark was rebuilt for. A note whose every line is a tick box
   * is on the Todos board by its own text, with `note_type` still null — and
   * read off that field the mark drew *off* and offered to "mark as to-do" a
   * note already sitting on the board. Pressing it flipped the label and moved
   * nothing, in both directions.
   */
  it("draws on for a checklist nobody has typed, because it is already on Todos", () => {
    render(
      <NoteView
        note={fileNote({
          id: "t6",
          body: "[ ] milk\n[ ] eggs",
          note_type: null,
          attachments: [],
        })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onToggleTodo={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "To-do", pressed: true })).toBeTruthy();
  });

  /**
   * And what the other half of the switch buys: the same list, opted out, reads
   * off — which is *"this list is not a to-do list"* said out loud. Before
   * `"note"` existed there was no way to say it at any price.
   */
  it("draws off for a checklist the user has said is not one", () => {
    render(
      <NoteView
        note={fileNote({
          id: "t7",
          body: "[ ] Kind of Blue\n[ ] Blue Train",
          note_type: "note",
          attachments: [],
        })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onToggleTodo={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "To-do", pressed: false })).toBeTruthy();
  });
});

/**
 * Setting a reminder writes reminder_at through onSetReminder and nothing
 * else: delivery is the server's job (migration 0015, the send-reminders
 * sweep), found by reading the note rather than scheduled from here. So there
 * is nothing to cancel when one is moved, and setting one offline still works.
 *
 * What this file does test is the honesty of the panel — a device that cannot
 * ring has to say so rather than promise a sound it will not make.
 */
describe("a reminder", () => {
  function reminderNote(id: string, reminder_at: string | null = null): Note {
    return fileNote({ id, body: "call the dentist", attachments: [], reminder_at });
  }

  it("writes reminder_at when a preset is picked, and nothing before that", () => {
    const onSetReminder = vi.fn();
    render(
      <NoteView
        note={reminderNote("r1")}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={onSetReminder}
      />,
    );
    expect(onSetReminder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set a reminder" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Tomorrow \d/ }));

    expect(onSetReminder).toHaveBeenCalledTimes(1);
    const [id, at] = onSetReminder.mock.calls[0];
    expect(id).toBe("r1");
    expect(Number.isNaN(Date.parse(at))).toBe(false);
    expect(Date.parse(at)).toBeGreaterThan(Date.now());
  });

  /* Dogfooding 2026-10-18: the panel's backdrop swallowed the next tap on Back
     after a picked time. A preset closes the panel; opened again on a note that
     has the reminder, it ticks the row, spells the time out and offers repeat
     and Clear. */
  it("closes on a picked time, and offers the repeat when opened again", () => {
    const onSetReminder = vi.fn();
    const props = {
      origin: null,
      closing: false,
      onClosed: () => {},
      onClose: () => {},
      onEditBody: () => {},
      onSetStatus: () => {},
      onTogglePriority: () => {},
      onAttach: () => {},
      onDetach: () => {},
      registerInner: () => {},
      onSetReminder,
    };
    const { rerender } = render(<NoteView note={reminderNote("r30")} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Set a reminder" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "every day" })).toBe(null);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Tomorrow \d/ }));
    const [, at] = onSetReminder.mock.calls[0];
    expect(screen.queryByRole("menu", { name: "Reminder" })).toBeNull();
    // The store writes the time back into the note, as App does.
    rerender(<NoteView note={reminderNote("r30", at)} {...props} />);
    expect(screen.queryByRole("button", { name: "Close reminder menu" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /reminder/i }));
    expect(screen.getByRole("menu", { name: "Reminder" })).toBeTruthy();
    expect(
      screen.getByRole("menuitemradio", { name: /^Tomorrow \d/ }).getAttribute("aria-checked"),
    ).toBe("true");
    const day = new Date(at).toLocaleString("en", { weekday: "short" });
    expect(screen.getByText(`Set for ${day} 09:00`)).toBeTruthy();
    expect(screen.getByRole("menuitemcheckbox", { name: "every day" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Clear reminder" })).toBeTruthy();
  });

  it("shows each preset's time, and refuses a custom time in the past", () => {
    const onSetReminder = vi.fn();
    render(
      <NoteView
        note={reminderNote("r8")}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={onSetReminder}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set a reminder" }));
    expect(screen.getByRole("menuitemradio", { name: /^Tomorrow 09:00$/ })).toBeTruthy();

    const custom = screen.getByLabelText("Custom reminder time") as HTMLInputElement;
    expect(custom.min).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    fireEvent.change(custom, { target: { value: "2020-01-01T10:00" } });
    expect(onSetReminder).not.toHaveBeenCalled();
    // Still open: a refused time leaves the panel where it was.
    expect(screen.getByRole("menu", { name: "Reminder" })).toBeTruthy();
  });

  /**
   * The repeat rows, which only exist once there is a time to repeat.
   *
   * A rule with no anchor is not a reminder — the series would have no
   * members — so the picker offers "every day" only after a time is set, and
   * clearing the time clears the rule in the same write (`App.tsx`).
   */
  function pickerOn(note: Note, onSetRepeat = vi.fn()) {
    render(
      <NoteView
        note={note}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={() => {}}
        onSetRepeat={onSetRepeat}
      />,
    );
    // The stamp row is the way in, and its name is the reminder itself once
    // there is one — "reminds in an hour. Change or clear the reminder."
    fireEvent.click(screen.getByRole("button", { name: /reminder/i }));
    return onSetRepeat;
  }

  it("offers no repeat until there is a time to repeat", () => {
    pickerOn(reminderNote("r20"));
    expect(screen.queryByRole("menuitemcheckbox", { name: "every day" })).toBe(null);
  });

  it("writes the rule when one is picked", () => {
    const onSetRepeat = pickerOn(
      reminderNote("r21", new Date(Date.now() + 3_600_000).toISOString()),
    );
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "every week" }));
    expect(onSetRepeat).toHaveBeenCalledWith("r21", "weekly");
  });

  /* A row is a switch, not a choice in a list: pressing the rule already in
     force is the only way back to a reminder that rings once. */
  it("turns the rule off again when the row already in force is pressed", () => {
    const note = {
      ...reminderNote("r22", new Date(Date.now() + 3_600_000).toISOString()),
      reminder_repeat: "daily" as const,
    };
    const onSetRepeat = pickerOn(note);
    const row = screen.getByRole("menuitemcheckbox", { name: "every day" });
    expect(row.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row);
    expect(onSetRepeat).toHaveBeenCalledWith("r22", null);
  });

  /* The row counts down to the occurrence that is coming, and says the rule
     that brings it round — never "due 9 months ago" about a note that rang
     this morning and rings again tomorrow. */
  it("counts to the next occurrence and names the rule beside it", () => {
    const anchor = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString();
    render(
      <NoteView
        note={{ ...reminderNote("r23", anchor), reminder_repeat: "daily" }}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={() => {}}
        pushStatus="on"
      />,
    );
    const row = screen.getByRole("button", { name: /reminder/i });
    expect(row.textContent).toContain("every day");
    expect(row.textContent).toContain("reminds");
    expect(row.textContent).not.toContain("due");
  });

  /** Opens the reminder panel on a note, at a given push state. */
  function panelAt(
    pushStatus: "on" | "askable" | "denied" | "unavailable",
    onEnableRing = vi.fn(),
    onDisableRing = vi.fn(),
  ) {
    render(
      <NoteView
        note={reminderNote("r9")}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={() => {}}
        pushStatus={pushStatus}
        onEnableRing={onEnableRing}
        onDisableRing={onDisableRing}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set a reminder" }));
    return onEnableRing;
  }

  it("offers to turn this device on when it is off but could be switched on", () => {
    // The gap this closes: permission used to be asked only when a *new*
    // reminder was set, so anyone who already had reminders was never asked
    // and had no control anywhere to go looking for.
    const onEnableRing = panelAt("askable");
    const row = screen.getByRole("menuitem", { name: "Notify on this device" });

    fireEvent.click(row);
    expect(onEnableRing).toHaveBeenCalledTimes(1);
  });

  it("explains rather than offers once the browser has been told no", () => {
    // A browser that has been refused stops asking, so a control here could
    // not work — and a control that cannot work is worse than a sentence.
    const onEnableRing = panelAt("denied");

    expect(screen.queryByRole("menuitem", { name: "Notify on this device" })).toBeNull();
    expect(
      screen.getByText("Notifications are blocked for this site. Allow them in the browser's site settings."),
    ).toBeTruthy();
    expect(onEnableRing).not.toHaveBeenCalled();
  });

  it("offers to turn this device off again once it rings", () => {
    // Ringing here is a switch, and the app could only ever be told yes:
    // `disablePush` existed and was tested from the day reminders shipped, and
    // nothing called it. The device somebody actually wants to silence — the
    // phone on a bedside table — had nowhere to say so.
    const onDisableRing = vi.fn();
    panelAt("on", vi.fn(), onDisableRing);

    expect(screen.queryByRole("menuitem", { name: "Notify on this device" })).toBeNull();
    expect(screen.queryByText(/Notifications are blocked/)).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop notifying on this device" }));
    expect(onDisableRing).toHaveBeenCalledTimes(1);
    // The presets are still the panel; the device row is one line under them.
    expect(screen.getByRole("menuitemradio", { name: /^Tomorrow \d/ })).toBeTruthy();
  });

  it("does not offer to turn off a device that was never on", () => {
    panelAt("askable");
    expect(screen.queryByRole("menuitem", { name: "Stop notifying on this device" })).toBeNull();
  });

  it("is also reachable from the insert menu, for anyone who never finds the timestamp", () => {
    const onSetReminder = vi.fn();
    const { container } = render(
      <NoteView
        note={reminderNote("r5")}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={onSetReminder}
      />,
    );
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Set reminder" }));

    // The insert menu closed and the reminder panel took its place — same
    // panel the timestamp row opens, not a second one.
    expect(screen.queryByRole("menu", { name: "Insert" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Reminder" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Tomorrow \d/ }));
    expect(onSetReminder).toHaveBeenCalledTimes(1);
  });

  it("offers to change, not set, once a reminder already exists", () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { container } = view(reminderNote("r6", soon));
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.click(screen.getByLabelText("Insert"));
    expect(screen.getByRole("menuitem", { name: "Change reminder" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Set reminder" })).toBeNull();
  });

  it("swaps the timestamp row to the reminder framing once one is set", () => {
    // A minute of slack so the odd slow CI tick can't round this down to
    // "1 hour" between building the timestamp and reading the rendered text.
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60_000).toISOString();
    const { container } = view(reminderNote("r2", soon));
    const foot = container.querySelector(".sheet-verbs")?.textContent ?? "";
    expect(foot).toContain("reminds in 2 hours");
    expect(foot).not.toContain("edited");
  });

  it("says an archived note's reminder will not ring, since the server rings only active notes", () => {
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60_000).toISOString();
    const { container } = view({ ...reminderNote("r7", soon), status: "archived" });
    const foot = container.querySelector(".sheet-verbs")?.textContent ?? "";
    expect(foot).toContain("reminds in 2 hours not while archived");
    expect(foot).not.toContain("not on this device");
  });

  it("shows the overdue framing, in the app's error vocabulary, once the reminder has passed", () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { container } = view(reminderNote("r3", past));
    const overdue = container.querySelector(".meta-overdue");
    expect(overdue?.textContent).toContain("due");
    expect(overdue?.textContent).toContain("3 hours ago");
  });

  it("clears the reminder from the picker, reverting to the edit-time framing", () => {
    const onSetReminder = vi.fn();
    const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    render(
      <NoteView
        note={reminderNote("r4", soon)}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        onSetReminder={onSetReminder}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reminds in/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear reminder" }));
    expect(onSetReminder).toHaveBeenCalledWith("r4", null);
  });
});

/**
 * A note emptied while it was open goes to the trash when it closes — but only
 * then, and only if the user was the one who emptied it. These tests pin down
 * who counts as emptied: words typed this session, or words the immutable
 * original still holds after a trashed-and-undone note came back empty.
 */
describe("a note the user emptied", () => {
  const withRaw = (id: string, raw: string, body: string) =>
    fileNote({ id, raw_content: raw, body, attachments: [] });

  /**
   * The app keeps NoteView mounted through the closing animation and unmounts
   * it on `onClosed`; this harness does the same, so the emptied check — which
   * lives in the unmount cleanup — runs for real instead of being asserted on
   * a layer that never went away.
   */
  function closableView(
    note: Note,
    onEmptied: (id: string) => void,
    opts: { strict?: boolean } = {},
  ) {
    let askClose: () => void = () => {};
    function Harness() {
      const [open, setOpen] = useState(true);
      const [closing, setClosing] = useState(false);
      askClose = () => setClosing(true);
      if (!open) return null;
      return (
        <NoteView
          note={note}
          origin={null}
          closing={closing}
          onClosed={() => setOpen(false)}
          onClose={() => setClosing(true)}
          onEditBody={() => {}}
          onEditBodyIfBase={() => true}
          onSetStatus={() => {}}
          onTogglePriority={() => {}}
          onAttach={() => {}}
          onDetach={() => {}}
          registerInner={() => {}}
          onEmptied={onEmptied}
        />
      );
    }
    const rendered = render(
      opts.strict ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    );
    return { ...rendered, close: () => act(() => askClose()) };
  }

  it("reports a note that closed with nothing in it", () => {
    const onEmptied = vi.fn();
    const { close } = closableView(withRaw("e1", "milk", "milk"), onEmptied);
    fireEvent.click(document.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.change(field, { target: { value: "" } });
    close();
    expect(onEmptied).toHaveBeenCalledWith("e1");
  });

  it("reports a note typed into and then emptied, even though it arrived empty", () => {
    const onEmptied = vi.fn();
    const { close } = closableView(withRaw("e2", "", ""), onEmptied);
    const field = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.change(field, { target: { value: "" } });
    close();
    expect(onEmptied).toHaveBeenCalledWith("e2");
  });

  it("reports a note emptied in an earlier session once the user walks away again", () => {
    const onEmptied = vi.fn();
    // Trashed for being empty, undone, and reopened: `raw_content` still holds
    // the words the user cut, so this is a note the user emptied — not one
    // that merely arrived empty.
    const { close } = closableView(withRaw("e3", "was milk", ""), onEmptied);
    close();
    expect(onEmptied).toHaveBeenCalledWith("e3");
  });

  it("leaves a note that still holds words alone", () => {
    const onEmptied = vi.fn();
    const { close } = closableView(withRaw("e4", "milk", "milk"), onEmptied);
    close();
    expect(onEmptied).not.toHaveBeenCalled();
  });

  it("does not bin a note that arrived empty and was never touched", () => {
    const onEmptied = vi.fn();
    const { close } = closableView(withRaw("e5", "", ""), onEmptied);
    close();
    expect(onEmptied).not.toHaveBeenCalled();
  });

  it("does not bin a note the user closed onto a mark instead of walking away", () => {
    const onEmptied = vi.fn();
    closableView(withRaw("e6", "milk", "milk"), onEmptied);
    fireEvent.click(document.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    // It really did close — onto the archive mark, which is a decision about
    // the note, not a walk-away from it — so the emptied check stands down.
    expect(document.querySelector(".sheet")).toBeNull();
    expect(onEmptied).not.toHaveBeenCalled();
  });

  it("lets StrictMode's simulated unmount open an empty note without binning it", () => {
    const onEmptied = vi.fn();
    const { close } = closableView(withRaw("e7", "was milk", ""), onEmptied, {
      strict: true,
    });
    // Mount/unmount/remount is done; the simulated unmount must not have read
    // as a walk-away.
    expect(onEmptied).not.toHaveBeenCalled();
    close();
    expect(onEmptied).toHaveBeenCalledWith("e7");
  });
});

/**
 * A horizontal swipe on the open note moves to the note beside it on the
 * board, mirroring the board deck's own paging gesture. The note is swapped
 * by id; it has no card it grew out of, so it travels in from the side the
 * last one left. These tests drive the sheet's touch handlers directly —
 * jsdom implements TouchEvent, and without `el.animate` the commit fires
 * synchronously, so each swipe is one gesture and one assertion.
 */
describe("swiping between notes", () => {
  const a = fileNote({ id: "s1", body: "one", attachments: [] });
  const b = fileNote({ id: "s2", body: "two", attachments: [] });
  const c = fileNote({ id: "s3", body: "three", attachments: [] });
  const list = [a, b, c];

  function swipeView(
    note: Note,
    siblings: Note[],
    siblingIndex: number,
    onOpenSibling = vi.fn(),
  ) {
    render(
      <NoteView
        note={note}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        siblings={siblings}
        siblingIndex={siblingIndex}
        onOpenSibling={onOpenSibling}
      />,
    );
    return { sheet: screen.getByRole("dialog", { name: "Note" }), onOpenSibling };
  }

  function swipe(el: HTMLElement, dx: number, dy = 0) {
    const start = { clientX: 200, clientY: 100 };
    const end = { clientX: 200 + dx, clientY: 100 + dy };
    fireEvent.touchStart(el, { touches: [start] });
    fireEvent.touchMove(el, { touches: [end] });
    fireEvent.touchEnd(el, { changedTouches: [end] });
  }

  it("swipes left to the next note", () => {
    const { sheet, onOpenSibling } = swipeView(b, list, 1);
    swipe(sheet, -100);
    expect(onOpenSibling).toHaveBeenCalledWith(2);
  });

  it("swipes right to the previous note", () => {
    const { sheet, onOpenSibling } = swipeView(b, list, 1);
    swipe(sheet, 100);
    expect(onOpenSibling).toHaveBeenCalledWith(0);
  });

  it("does nothing at the ends of the board", () => {
    const first = swipeView(a, list, 0);
    swipe(first.sheet, 100);
    expect(first.onOpenSibling).not.toHaveBeenCalled();

    cleanup();
    const last = swipeView(c, list, 2);
    swipe(last.sheet, -100);
    expect(last.onOpenSibling).not.toHaveBeenCalled();
  });

  it("does nothing to a vertical drag — the note scrolls instead", () => {
    const { sheet, onOpenSibling } = swipeView(b, list, 1);
    swipe(sheet, 20, -120);
    expect(onOpenSibling).not.toHaveBeenCalled();
  });

  it("does nothing to a short swipe — that is a tap", () => {
    const { sheet, onOpenSibling } = swipeView(b, list, 1);
    swipe(sheet, -40);
    expect(onOpenSibling).not.toHaveBeenCalled();
  });

  it("stands down while the note is being edited", () => {
    // An empty note opens straight into typing; the editor owns the finger.
    const { sheet, onOpenSibling } = swipeView(
      fileNote({ id: "s4", body: "", attachments: [] }),
      list,
      1,
    );
    expect(screen.getByRole("textbox", { name: "Note text" })).toBeTruthy();
    swipe(sheet, -100);
    expect(onOpenSibling).not.toHaveBeenCalled();
  });

  it("does nothing when the note is not among the siblings", () => {
    // A note opened from the canvas or a notification has no board order to
    // swipe along, so the sheet must not offer a neighbour that isn't there.
    const { sheet, onOpenSibling } = swipeView(b, list, -1);
    swipe(sheet, -100);
    expect(onOpenSibling).not.toHaveBeenCalled();
  });
});

/**
 * The row under the bar is where the note says things about itself, and Copy
 * is its one verb. It takes the words on screen — including a sentence typed
 * and not yet saved — and answers in the row's own grammar for a moment. A
 * note with no words has no Copy, because there is nothing to take.
 */
describe("copying the note", () => {
  function fakeClipboard() {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  it("puts the text on the clipboard and says so for a moment", async () => {
    vi.useFakeTimers();
    const writeText = fakeClipboard();
    view(fileNote({ body: "Ja tämä paikka herää vasta illalla.", attachments: [] }));

    const copy = screen.getByRole("button", { name: "Copy note text" });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith("Ja tämä paikka herää vasta illalla.");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByRole("button", { name: "Copy note text" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("offers nothing to copy on a note with no words", () => {
    fakeClipboard();
    view(fileNote());
    expect(screen.queryByRole("button", { name: "Copy note text" })).toBeNull();
  });

  /**
   * Under the text, not on the bar and not in the facts row: the strip sits
   * where a reader's hand is once they have read the note, the way a chat
   * message carries its own strip under itself. Six marks on the bar stay six.
   */
  it("sits under the text, not on the bar", () => {
    fakeClipboard();
    view(fileNote({ body: "words", attachments: [] }));
    const bar = document.querySelector(".sheet-bar");
    expect(bar).toBeTruthy();
    expect(bar?.querySelector('[title="Copy"]')).toBeNull();
    expect(document.querySelector(".sheet-meta .meta-verb")).toBeNull();

    const strip = screen.getByRole("group", { name: "Note actions" });
    expect(strip.classList.contains("sheet-verbs")).toBe(true);
    const text = screen.getByLabelText("Note text");
    // The strip comes after the text in reading order.
    expect(text.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // And the empty space is on the far side of it, so the strip sits against
    // the last line rather than a screen below it. Nothing but the strip may
    // come between the text and that space.
    const rest = document.querySelector(".sheet-rest");
    expect(rest).toBeTruthy();
    expect(strip.nextElementSibling).toBe(rest);
    expect(text.nextElementSibling).toBe(strip);
  });

  /**
   * The tap target the reader used to carry as 60dvh of its own height moved
   * below the strip; it still has to open the note for writing, at the end.
   */
  it("still starts writing when the empty space below is tapped", () => {
    fakeClipboard();
    const { container } = view(fileNote({ body: "words", attachments: [] }));
    expect(screen.queryByRole("textbox", { name: "Note text" })).toBeNull();

    fireEvent.click(container.querySelector(".sheet-rest")!);
    const editor = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    expect(editor.selectionStart).toBe("words".length);
  });
});

/**
 * Share and Read aloud are the meta row's other two verbs, and each is drawn
 * only where the browser can do it. Share hands the words to the browser's
 * own sheet and says nothing when the sheet is merely closed. Read aloud is
 * one switch: the same mark starts the voice and stops it, and closing the
 * note stops it too.
 */
describe("sharing and reading the note", () => {
  function giveShare(share: ((data: ShareData) => Promise<void>) | undefined) {
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
  }

  function fakeSpeech() {
    const spoken: string[] = [];
    const synth = {
      cancel: vi.fn(),
      getVoices: () => [] as SpeechSynthesisVoice[],
      speak: vi.fn((u: { text: string }) => spoken.push(u.text)),
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    class Utterance {
      text: string;
      lang = "";
      voice: unknown = null;
      onend: null | (() => void) = null;
      onerror: null | (() => void) = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: Utterance,
      configurable: true,
    });
    return { synth, spoken };
  }

  afterEach(() => {
    giveShare(undefined);
    Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
  });

  it("draws Share only where there is a sheet, and hands it the words", async () => {
    view(fileNote({ body: "hei", attachments: [] }));
    expect(screen.queryByRole("button", { name: "Share note" })).toBeNull();
    cleanup();

    const share = vi.fn(async () => {});
    giveShare(share);
    view(fileNote({ body: "hei", attachments: [] }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share note" }));
    });
    expect(share).toHaveBeenCalledWith({ text: "hei" });
    // A sheet that opened and was used has nothing more to say.
    expect(screen.getByRole("button", { name: "Share note" })).toBeTruthy();
  });

  it("shares a note that is only a photograph, as the file itself", async () => {
    const share = vi.fn(async () => {});
    giveShare(share);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    try {
      view(fileNote({ body: "", attachments: [shot] }));
      // No words: nothing to copy or read aloud, but the photo can still go.
      expect(screen.queryByRole("button", { name: "Copy note text" })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Share note" }));
      });
      expect(share).toHaveBeenCalledTimes(1);
      const [data] = share.mock.calls[0] as unknown as [ShareData];
      expect(data.text).toBeUndefined();
      expect(data.files?.map((f) => f.name)).toEqual([shot.name]);
    } finally {
      Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
    }
  });

  it("draws Read only where there is a voice, and reads in sentence-sized pieces", () => {
    view(fileNote({ body: "hei", attachments: [] }));
    expect(screen.queryByRole("button", { name: "Read note aloud" })).toBeNull();
    cleanup();

    const { synth, spoken } = fakeSpeech();
    view(fileNote({ body: "Yksi lause. Toinen lause.\n[ ] maitoa", attachments: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Read note aloud" }));
    expect(spoken).toEqual(["Yksi lause.", "Toinen lause.", "maitoa"]);
    expect(synth.speak).toHaveBeenCalledTimes(3);

    // The same mark is now the way to stop.
    const stop = screen.getByRole("button", { name: "Stop reading" });
    expect(stop.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(stop);
    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Read note aloud" })).toBeTruthy();
  });

  it("stops the voice when the note closes", () => {
    const { synth } = fakeSpeech();
    const { unmount } = view(fileNote({ body: "Pitkä tarina.", attachments: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Read note aloud" }));
    synth.cancel.mockClear();
    unmount();
    expect(synth.cancel).toHaveBeenCalled();
  });
});

/**
 * Where a note lives is a fact about the note, so it is read where the note's
 * other facts are read: the footer, between the stamp and the verbs.
 *
 * It sat in the meta row above the text until now. That row is read *before*
 * the note, and which folder something is filed in is not a thing anyone needs
 * to know in order to start reading it — the date and the board are the same
 * kind of fact and now keep each other's company under the last line.
 */
describe("where the note is, in the footer", () => {
  const boards: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];

  function filed(board_id: string | null) {
    return render(
      <NoteView
        note={fileNote({ id: "k1", body: "buy milk", attachments: [], board_id })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        boards={boards}
        onMove={() => {}}
      />,
    );
  }

  it("names the board in the footer strip and not in the row above the text", () => {
    const { container } = filed("b1");
    const strip = screen.getByRole("group", { name: "Note actions" });
    expect(strip.querySelector(".meta-board")?.textContent).toContain("Work");
    expect(container.querySelector(".sheet-meta .meta-board")).toBeNull();
  });

  it("stands between the stamp and the verbs, in that order", () => {
    const { container } = filed("b1");
    const strip = screen.getByRole("group", { name: "Note actions" });
    const kids = [...strip.children].map((el) => el.className);
    // The facts in a box of their own, so the verbs keep one place at the
    // right end of the first line (review 2026-10-01, UI-17).
    expect(kids).toEqual(["sheet-facts", "meta-verb-row"]);
    const facts = [...strip.children[0].children].map((el) => el.className);
    expect(facts).toEqual(["meta-stamp", "meta-board"]);
    // And nothing is left standing in the row above for a note whose only
    // fact was its board, so the empty box does not charge the text its
    // margin — `.sheet-meta:empty` in styles.css does the rest.
    expect(container.querySelector(".sheet-meta")?.children.length).toBe(0);
  });

  it("says nothing at all about a note in no folder", () => {
    const { container } = filed(null);
    expect(container.querySelector(".meta-board")).toBeNull();
  });
});

/**
 * The note being saved as it is typed, drawn with the sync mark — because it
 * is the same fact that mark already draws on a note on its way up and on a
 * file being uploaded. Parted means the edit is on its way out of this window;
 * closed back into one dot means it has gone.
 */
describe("the save mark in the open note", () => {
  it("is not drawn on a note that is only being read", () => {
    const { container } = view(fileNote({ body: "words", attachments: [] }));
    expect(container.querySelector(".save-state")).toBeNull();
  });

  it("rests as a single dot when the editor opens, and works on a keystroke", () => {
    vi.useFakeTimers();
    try {
      const { container } = view(fileNote({ body: "words", attachments: [] }));
      // Into the editor, which is where anything can be saved from.
      act(() => {
        fireEvent.click(screen.getByLabelText("Note text"));
      });
      const mark = container.querySelector(".save-state");
      expect(mark, "the mark belongs to the editor").toBeTruthy();
      expect(mark?.getAttribute("data-state")).toBe("idle");

      const field = screen.getByRole("textbox", { name: "Note text" });
      act(() => {
        fireEvent.change(field, { target: { value: "words and more" } });
      });
      expect(
        container.querySelector(".save-state")?.getAttribute("data-state"),
        "typing puts it to work",
      ).toBe("working");

      // ...and it settles back to the dot once the typing stops, after one
      // whole turn of the animation rather than mid-gesture.
      act(() => {
        vi.advanceTimersByTime(MIN_WORKING_MS + 10);
      });
      expect(container.querySelector(".save-state")?.getAttribute("data-state")).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A panel inside the open note is stepped out of by Escape, and by Escape
 * only.
 *
 * This handler used to ask *which panel is open* before it asked *which key
 * was pressed*, so every keystroke closed whatever was open and was cancelled
 * on the way. Two of the three panels hold a field you type into — the board
 * chooser's "search or new board", and the reminder panel's own date and time
 * — which meant that from inside an open note a board could not be searched
 * for, named or created, and a custom reminder could not be typed at all: the
 * first letter shut the panel. The identical chooser worked from the
 * multi-select panel the whole time, because `App.tsx`'s listener has always
 * settled the key first.
 */
describe("typing inside a panel in the open note", () => {
  const boards: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];

  function withChooser() {
    render(
      <NoteView
        note={fileNote({ id: "k1", body: "buy milk", attachments: [] })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        boards={boards}
        onMove={() => {}}
        onCreateBoard={() => ({ id: "b2", name: "Home", position: 1 })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move to a board" }));
    return screen.getByRole("textbox", { name: "Search boards or name a new one" });
  }

  it("keeps the board chooser open while a board name is typed into it", () => {
    const field = withChooser();

    // One letter at a time, the way a name is actually typed. Each keystroke
    // reached the window listener; every one of them used to close the panel.
    for (const ch of "Home") {
      fireEvent.keyDown(field, { key: ch });
      fireEvent.change(field, { target: { value: field.getAttribute("value") ?? "" } });
    }

    expect(
      screen.queryByRole("textbox", { name: "Search boards or name a new one" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Work" })).toBeTruthy();
  });

  it("is not closed by any of the keys that are not Escape", () => {
    const field = withChooser();
    for (const key of ["Shift", "Tab", "a", "1", "ArrowDown", "Backspace", " "]) {
      fireEvent.keyDown(field, { key });
    }
    expect(
      screen.queryByRole("textbox", { name: "Search boards or name a new one" }),
    ).toBeTruthy();
  });

  it("still steps out of the panel on Escape, and leaves the note open", () => {
    const onClose = vi.fn();
    render(
      <NoteView
        note={fileNote({ id: "k2", body: "buy milk", attachments: [] })}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={onClose}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        boards={boards}
        onMove={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move to a board" }));
    expect(screen.queryByRole("button", { name: "Work" })).toBeTruthy();

    // The panel goes; the note stays. One layer at a time.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Work" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // And the next Escape, with nothing left over the note, closes the note.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * A newer copy arrived while these words were being written.
 *
 * The conflict rule itself does not move: a stale copy must never be written
 * over a newer one, so `commit` still refuses. What is tested here is the
 * other half — that the person is told, in the app's own error grammar rather
 * than shouted in the row of short mono facts where this used to live, and
 * that the sentence they typed is handed back rather than simply dropped.
 */
describe("an edit overtaken by the other device", () => {
  function conflicted(body = "") {
    const onEditBodyIfBase = vi.fn(() => false);
    const r = view(
      fileNote({ id: "c1", body, attachments: [] }),
      () => {},
      () => {},
      onEditBodyIfBase,
    );
    const field = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.change(field, { target: { value: "a sentence of mine" } });
    return { ...r, onEditBodyIfBase };
  }

  it("says what happened, where the words are, and not in the facts row", () => {
    const { container } = conflicted();

    const said = container.querySelector(".sheet-conflict");
    expect(said).toBeTruthy();
    expect(said?.textContent).toContain("changed on another device");
    // Announced, because it appears while the eye is on the text rather than
    // on this line.
    expect(said?.getAttribute("role")).toBe("status");
    // It is stated against the words, above them — never again as one more
    // uppercase fact beside "324 CHARS".
    expect(container.querySelector(".sheet-meta .meta-warn")).toBeNull();
    // Nothing may come between the message and the words it is about. The
    // editor is wrapped in `.editor-field` — the box its lamp is drawn in —
    // so that wrapper is what follows the message, and the words are checked
    // to be inside it rather than somewhere further down the sheet.
    const next = container.querySelector(
      ".sheet-conflict + .editor-field, .sheet-conflict + .reader",
    );
    expect(next).toBeTruthy();
    expect(next?.classList.contains("reader") || next?.querySelector(".editor")).toBeTruthy();
  });

  it("is not drawn at all while nothing has been overtaken", () => {
    const { container } = view(
      fileNote({ id: "c2", body: "", attachments: [] }),
      () => {},
      () => {},
      () => true,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), {
      target: { value: "written and saved" },
    });
    expect(container.querySelector(".sheet-conflict")).toBeNull();
  });

  it("hands the typed words back on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    conflicted();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy your version of this note" }),
      );
    });
    // The words on screen, which are the ones that were refused — not the
    // note's own body, which is the copy that won.
    expect(writeText).toHaveBeenCalledWith("a sentence of mine");
    expect(screen.getByRole("button", { name: "Copied your version" })).toBeTruthy();
  });

  /**
   * The guard, driven by the real rule rather than by a constant.
   *
   * Every other test in this block hands the editor a stub that always says
   * no, which proves the *banner* and proves nothing about the *guard* — and
   * the guard was broken the whole time. It compared `note.updated_at` read
   * from its own props, so the moment the remote row landed the editor was
   * holding the remote's stamp, the next keystroke compared equal, and the
   * local draft was written straight over the other device's words with the
   * banner clearing itself on the way past. One character was the whole
   * distance between "your words were not saved" and the other device's note
   * being gone.
   *
   * So this one stands a miniature of `editBodyIfBase` behind the editor —
   * a body that only moves when the base matches — and then does the thing
   * that used to be fatal: it keeps typing.
   */
  it("goes on refusing after the next keystroke, and does not clear itself", () => {
    const store = { body: "first words" };
    const onEditBodyIfBase = vi.fn((_id: string, body: string, base: string) => {
      if (store.body !== base) return false;
      store.body = body;
      return true;
    });
    const note = fileNote({ id: "c4", body: store.body, attachments: [] });
    const { container, rerender } = render(
      <NoteView
        note={note}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onEditBodyIfBase={onEditBodyIfBase}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
      />,
    );
    // A note that already has words opens as a reader; tap into it to type.
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });
    // An ordinary edit, which saves.
    fireEvent.change(field, { target: { value: "first words and mine" } });
    expect(store.body).toBe("first words and mine");
    expect(container.querySelector(".sheet-conflict")).toBeNull();

    // The other device wins the race. `applyRemote` writes the store before
    // React re-renders, so the refusal comes from the guard itself and the
    // props catch up a moment later — which is the order the app really does
    // this in, and the only way a conflict can start.
    store.body = "what the phone wrote";
    fireEvent.change(field, { target: { value: "first words and mine, unsaved" } });
    expect(container.querySelector(".sheet-conflict")).toBeTruthy();
    rerender(
      <NoteView
        note={{ ...note, body: "what the phone wrote", updated_at: "2026-08-10T10:00:00.000Z" }}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onEditBodyIfBase={onEditBodyIfBase}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
      />,
    );
    expect(container.querySelector(".sheet-conflict")).toBeTruthy();

    // The keystroke that used to undo all of it.
    fireEvent.change(field, { target: { value: "first words and mine, unsaved!" } });
    expect(store.body).toBe("what the phone wrote");
    expect(container.querySelector(".sheet-conflict")).toBeTruthy();
  });

  /* The notice's two ways out (audit 2026-10-10, UX-5). */
  function clashed() {
    const onEditBody = vi.fn();
    const note = fileNote({ id: "c9", body: "what the phone wrote", attachments: [] });
    const r = render(
      <NoteView
        note={note}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={onEditBody}
        onEditBodyIfBase={() => false}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
      />,
    );
    fireEvent.click(r.container.querySelector(".reader")!);
    fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), {
      target: { value: "my own words" },
    });
    expect(r.container.querySelector(".sheet-conflict")).toBeTruthy();
    return { ...r, onEditBody };
  }

  it("shows the newer one on asking, and drops the words on screen", () => {
    const { container, onEditBody } = clashed();
    fireEvent.click(screen.getByRole("button", { name: "show the newer one" }));
    expect(container.querySelector(".sheet-conflict")).toBeNull();
    expect(container.textContent).toContain("what the phone wrote");
    expect(container.textContent).not.toContain("my own words");
    expect(onEditBody).not.toHaveBeenCalled();
  });

  it("keeps mine on asking, writing the words on screen over the newer one", () => {
    const { container, onEditBody } = clashed();
    fireEvent.click(screen.getByRole("button", { name: "keep mine" }));
    expect(onEditBody).toHaveBeenCalledWith("c9", "my own words");
    expect(container.querySelector(".sheet-conflict")).toBeNull();
  });

  it("still refuses to write the stale copy over the newer one", () => {
    const onEditBody = vi.fn();
    const onEditBodyIfBase = vi.fn(() => false);
    const { unmount } = view(
      fileNote({ id: "c3", body: "", attachments: [] }),
      () => {},
      onEditBody,
      onEditBodyIfBase,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Note text" }), {
      target: { value: "a sentence of mine" },
    });
    onEditBodyIfBase.mockClear();
    // Closing the note commits on unmount — and must not, here.
    unmount();
    expect(onEditBodyIfBase).not.toHaveBeenCalled();
    expect(onEditBody).not.toHaveBeenCalled();
  });
});

/**
 * Reopening a long note puts you back where you were reading it.
 *
 * Per device and local-only, by the same argument the canvas zoom is made
 * with: two machines never agree on where you were, because the column is a
 * different width and the lines fall in different places. `lib/readingPosition.ts`
 * holds the rules and its own tests; what these prove is the wiring — that the
 * open note asks on the way in, records on the way out, and that neither
 * touches the note itself.
 */
describe("where you had got to in a long note", () => {
  const LONG = "Se oli pitka ilta ja kirjoitin taman muistiin. ".repeat(300);
  const body = () => document.querySelector(".sheet-body") as HTMLElement;

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("opens already scrolled to where it was left", () => {
    rememberReadingPosition("r1", 640, LONG.length);
    view(fileNote({ id: "r1", body: LONG, attachments: [] }));
    // Set in a layout effect, so the first frame is the right one and there
    // is no scroll to watch — see NoteView's own comment.
    expect(body().scrollTop).toBe(640);
  });

  it("opens at the top when the text has changed under it", () => {
    rememberReadingPosition("r2", 640, LONG.length);
    // The other device edited it: the offset counts pixels into text that is
    // no longer this text.
    view(fileNote({ id: "r2", body: LONG + " and one more line", attachments: [] }));
    expect(body().scrollTop).toBe(0);
  });

  it("writes down where you got to when the note closes", () => {
    const { unmount } = view(fileNote({ id: "r3", body: LONG, attachments: [] }));
    const el = body();
    el.scrollTop = 900;
    fireEvent.scroll(el);
    // Nothing is stored while the note is open — one write, on the way out.
    expect(recallReadingPosition("r3", LONG.length)).toBe(0);

    unmount();
    expect(recallReadingPosition("r3", LONG.length)).toBe(900);
  });

  it("remembers nothing about a note that was never scrolled", () => {
    const { unmount } = view(fileNote({ id: "r4", body: LONG, attachments: [] }));
    unmount();
    expect(recallReadingPosition("r4", LONG.length)).toBe(0);
  });

  /**
   * A scroll offset is not an edit. Nothing here may reach the note, the
   * outbox, or `updated_at` — a note dragged to the top of a board because
   * somebody read it would be the board lying about what changed.
   */
  it("never writes to the note to record a reading position", () => {
    const onEditBody = vi.fn();
    const onEditBodyIfBase = vi.fn(() => true);
    const { unmount } = view(
      fileNote({ id: "r5", body: LONG, attachments: [] }),
      () => {},
      onEditBody,
      onEditBodyIfBase,
    );
    const el = body();
    el.scrollTop = 700;
    fireEvent.scroll(el);
    unmount();

    expect(recallReadingPosition("r5", LONG.length)).toBe(700);
    expect(onEditBody).not.toHaveBeenCalled();
    expect(onEditBodyIfBase).not.toHaveBeenCalled();
  });
});

/**
 * Everything that changes the note's text saves it in the same breath.
 *
 * That is what makes a tab Android kills mid-sentence cost at most the
 * character still under the finger — and one branch of the insert panel did
 * not do it. Turning a selection into tick boxes *from reading mode* (where
 * the selection is the one `lastRange` remembers from before the editor was
 * tapped out of) changed the draft and left it in memory until the note
 * happened to be blurred or closed. Its twin, the ordinary insert three lines
 * below it, had always written.
 */
describe("an insert made from reading mode", () => {
  it("is saved at once, not left waiting for a blur", () => {
    const onEditBody = vi.fn();
    const note = fileNote({ id: "i1", body: "milk\nbread\neggs", attachments: [] });
    view(note, () => {}, onEditBody);

    // Select two lines in the editor, then leave editing — which is what puts
    // a range in `lastRange` with no live textarea to read it back from.
    fireEvent.click(document.querySelector(".reader")!);
    const editor = screen.getByRole("textbox", { name: "Note text" });
    fireEvent.select(editor, { target: { selectionStart: 0, selectionEnd: 10 } });
    fireEvent.blur(editor);
    onEditBody.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tick box" }));

    expect(onEditBody).toHaveBeenCalledWith("i1", "[ ] milk\n[ ] bread\neggs");
  });
});


/**
 * A picture on the clipboard belongs to the note that is open — attached to it,
 * not made into a second note beside it. The handler sits on the whole sheet
 * rather than on the textarea, because the textarea is the element that does
 * not exist while the note is being read.
 */
describe("pasting a file into the open note", () => {
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });

  function withAttach(n: Note) {
    const onAttach = vi.fn();
    const r = render(
      <NoteView
        note={n}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={onAttach}
        onDetach={() => {}}
        registerInner={() => {}}
      />,
    );
    return { ...r, onAttach };
  }

  it("hangs the file on this note and takes the event", () => {
    const { container, onAttach } = withAttach(note("hello"));
    const file = new File(["x"], "shot.png", { type: "image/png" });

    const taken = fireEvent.paste(container.querySelector(".sheet")!, {
      clipboardData: { files: [file] },
    });

    expect(onAttach).toHaveBeenCalledWith("f1", [file]);
    // Taking the event is also what tells App's window-level handler to stand
    // down, so the same screenshot does not become a new note as well.
    expect(taken).toBe(false);
  });

  it("leaves pasted text entirely alone", () => {
    const { container, onAttach } = withAttach(note("hello"));

    const taken = fireEvent.paste(container.querySelector(".sheet")!, {
      clipboardData: { files: [] },
    });

    expect(onAttach).not.toHaveBeenCalled();
    expect(taken).toBe(true);
  });

  /**
   * Cells copied out of a spreadsheet arrive as a picture of the cells *and*
   * the cells as text. Taking the event for the picture took the text with it,
   * so the words the user was pasting into the note never arrived. The editor
   * gets the words, the note gets the file.
   */
  it("keeps the words when the clipboard carries a file as well, as copied cells do", () => {
    const { container, onAttach } = withAttach(note("hello "));
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    const file = new File(["x"], "cells.png", { type: "image/png" });

    const taken = fireEvent.paste(field, {
      clipboardData: {
        files: [file],
        getData: (type: string) => (type === "text/plain" ? "a\tb\r\nc\td" : ""),
      },
    });

    // Line endings as a native paste into a textarea would leave them.
    expect(field.value).toBe("hello a\tb\nc\td");
    expect(onAttach).toHaveBeenCalledWith("f1", [file]);
    expect(taken).toBe(false);
  });
});

/**
 * Ctrl+Enter is the keyboard's way out of an open note: save what is written
 * and go back to the board, without the hand leaving the keys. Escape already
 * did the same thing; this is the shape every other text box on the machine
 * has meant by that chord for years, and it is the one a desktop user reaches
 * for while typing.
 */
describe("Ctrl+Enter, the way out of a note", () => {
  const boards: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });

  function open(body: string, onClose: () => void, saved?: (id: string, body: string) => void) {
    const { container } = view(note(body), onClose, saved);
    fireEvent.click(container.querySelector(".reader")!);
    return screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
  }

  it("commits the words and closes the note", () => {
    const onClose = vi.fn();
    const saved = vi.fn();
    const field = open("milk", onClose, saved);

    fireEvent.change(field, { target: { value: "milk and bread" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });

    expect(saved).toHaveBeenCalledWith("f1", "milk and bread");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("counts a list straight on the way out, as a blur would", () => {
    // Proof that the commit really ran rather than the close alone: renumbering
    // happens on commit and nowhere else.
    const onClose = vi.fn();
    const saved = vi.fn();
    const field = open("1. milk", onClose, saved);

    fireEvent.change(field, { target: { value: "1. milk\n1. bread" } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });

    expect(saved).toHaveBeenLastCalledWith("f1", "1. milk\n2. bread");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes from the reader too, not only from the field", () => {
    const onClose = vi.fn();
    view(note("milk"), onClose);

    // The note can be read as well as written, and the chord means the same
    // thing wherever inside the sheet the focus happens to be.
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("answers to Cmd+Enter as well, for the Mac", () => {
    const onClose = vi.fn();
    open("milk", onClose);

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a plain Enter and the modified ones to the editor", () => {
    const onClose = vi.fn();
    const field = open("milk", onClose);

    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true, altKey: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stands down while a panel holds the keyboard", () => {
    const onClose = vi.fn();
    render(
      <NoteView
        note={note("buy milk")}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={onClose}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        boards={boards}
        onMove={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Move to a board" }));
    const field = screen.getByRole("textbox", { name: "Search boards or name a new one" });

    // The chooser has a field of its own; Enter in it belongs to the board
    // being named. Stepping out of a panel is Escape's job, one layer at a
    // time — the note must not vanish from under it.
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Work" })).toBeTruthy();
  });
});

/**
 * The shelf, from inside the note. On a phone the bar carries the same burger
 * the board row does, beside Back, so another board is one tap away rather
 * than Back and then the burger. At this seam: the mark exists only where
 * there is a drawer to open, it says whether that drawer is open, and while
 * something of the app's stands over the note the note's keys leave it alone.
 * The drawer itself, over a real note, is exercised in `Shelf.test.tsx`.
 */
describe("the shelf from inside the note", () => {
  const worded = fileNote({ body: "a note with words", attachments: [] });

  function withShelf(over: Partial<ComponentProps<typeof NoteView>> = {}) {
    return render(
      <NoteView
        note={worded}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={() => {}}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
        {...over}
      />,
    );
  }

  it("is not drawn where there is no drawer to open", () => {
    withShelf();
    expect(screen.queryByRole("button", { name: "Boards" })).toBeNull();
  });

  it("opens the shelf from beside Back, not among the note's own marks", () => {
    const onOpenShelf = vi.fn();
    const { container } = withShelf({ onOpenShelf });
    const mark = screen.getByRole("button", { name: "Boards" });
    expect(mark.getAttribute("aria-expanded")).toBe("false");

    // On the near side of the spacer, with Back: where you are, not a verb.
    const bar = [...container.querySelector(".sheet-bar")!.children];
    const spacer = bar.findIndex((el) => el.classList.contains("spacer"));
    expect(bar.indexOf(mark)).toBeGreaterThan(-1);
    expect(bar.indexOf(mark)).toBeLessThan(spacer);

    fireEvent.click(mark);
    expect(onOpenShelf).toHaveBeenCalledTimes(1);
  });

  it("says the drawer is open while it is", () => {
    withShelf({ onOpenShelf: () => {}, shelfOpen: true });
    expect(screen.getByRole("button", { name: "Boards" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("leaves Escape and Ctrl+Enter to whatever stands over the note", () => {
    const uncovered = vi.fn();
    withShelf({ onClose: uncovered, onOpenShelf: () => {} });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(uncovered).toHaveBeenCalled();
    cleanup();

    const onClose = vi.fn();
    withShelf({ onClose, onOpenShelf: () => {}, shelfOpen: true, covered: true });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * The reader and the editor are one surface, and the caret goes where the
 * finger went. In a browser focus arrives with the press, before the click —
 * so a reader that opened the editor on focus was already gone by the time the
 * click could say where the tap was, and every tap put the caret at the end.
 */
describe("tapping into the note", () => {
  const note = (body: string) => fileNote({ id: "t1", body, attachments: [] });
  const field = () => screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;

  /** jsdom has no caret hit-testing. This one answers `offset` characters into `root`. */
  function hitAt(root: HTMLElement, offset: number) {
    (document as unknown as { caretRangeFromPoint: () => Range | null }).caretRangeFromPoint =
      () => {
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let left = offset;
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const len = n.textContent?.length ?? 0;
          if (left <= len) {
            const range = document.createRange();
            range.setStart(n, left);
            range.collapse(true);
            return range;
          }
          left -= len;
        }
        return null;
      };
  }

  afterEach(() => {
    delete (document as unknown as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
  });

  it("lands the caret where the finger did, though focus arrives before the click", () => {
    const { container } = view(note("alpha beta gamma"));
    const reader = container.querySelector<HTMLElement>(".reader")!;
    hitAt(reader, 6);

    // The order a browser sends them in: the press, the focus it gives, the click.
    fireEvent.pointerDown(reader);
    act(() => reader.focus());
    fireEvent.click(reader);

    expect(field().selectionStart).toBe(6);
  });

  it("still goes straight to editing when the keyboard brings the focus in", () => {
    const { container } = view(note("alpha beta gamma"));
    act(() => container.querySelector<HTMLElement>(".reader")!.focus());
    expect(field()).toBeTruthy();
  });

  it("counts a tap the way the field does, in a note whose lines end \\r\\n", () => {
    const { container } = view(note("one\r\ntwo three"));
    const reader = container.querySelector<HTMLElement>(".reader")!;
    // Just after "two", counted in the stored note, carriage return and all.
    hitAt(reader, 8);
    fireEvent.click(reader);
    expect(field().value.slice(0, field().selectionStart)).toBe("one\ntwo");
  });
});

/**
 * The app saves every keystroke and the saved body comes straight back down as
 * `note.body`, so by the time the editor is committed the note already holds
 * the draft. A commit that asked "is the draft different from the note?" found
 * nothing to do, and no numbered list was ever counted straight in the real
 * app. The question is whether this stretch of editing changed anything.
 */
describe("a numbered list, with every keystroke saved underneath", () => {
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });

  /** The loop App closes: a save goes out and comes back in as the note. */
  function Live({ initial, saved }: { initial: Note; saved: (id: string, body: string) => void }) {
    const [current, setCurrent] = useState(initial);
    return (
      <NoteView
        note={current}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={(id, body) => {
          saved(id, body);
          setCurrent((was) => ({ ...was, body }));
        }}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
      />
    );
  }

  it("counts the list straight when the editor is committed", () => {
    const saved = vi.fn();
    const { container } = render(<Live initial={note("1. one\n2. two\n3. three")} saved={saved} />);
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" });

    fireEvent.change(field, { target: { value: "1. one\n3. three" } });
    expect(saved).toHaveBeenLastCalledWith("f1", "1. one\n3. three");

    fireEvent.blur(field);
    expect(saved).toHaveBeenLastCalledWith("f1", "1. one\n2. three");
    expect(container.querySelector(".reader")?.textContent).toBe("1. one\n2. three");
  });

  it("writes nothing when the note was opened into the editor and closed with no edit", () => {
    const saved = vi.fn();
    const { container, unmount } = render(<Live initial={note("1. one\n3. three")} saved={saved} />);
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.blur(screen.getByRole("textbox", { name: "Note text" }));
    unmount();
    expect(saved).not.toHaveBeenCalled();
  });

  it("does not count straight a newer copy that arrived while the note was open", () => {
    // The gap came from the other device. Closing the note is not an edit to it.
    const saved = vi.fn();
    const first = note("1. one\n2. two");
    const r = view(first, () => {}, saved);
    fireEvent.click(r.container.querySelector(".reader")!);
    r.rerender(
      <NoteView
        note={{ ...first, body: "1. one\n3. three" }}
        origin={null}
        closing={false}
        onClosed={() => {}}
        onClose={() => {}}
        onEditBody={saved}
        onSetStatus={() => {}}
        onTogglePriority={() => {}}
        onAttach={() => {}}
        onDetach={() => {}}
        registerInner={() => {}}
      />,
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Note text" }));
    r.unmount();
    expect(saved).not.toHaveBeenCalled();
  });
});

/**
 * Insert and the formatting marks act on what is selected — and "what is
 * selected" is counted in the field, which is not always the same string as
 * the note, nor always the span a person means.
 */
describe("formatting and inserting what is really selected", () => {
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });

  function open(body: string, saved: (id: string, body: string) => void = () => {}) {
    const { container } = view(note(body), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    return screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
  }

  function select(field: HTMLTextAreaElement, from: number, to: number) {
    field.setSelectionRange(from, to);
    fireEvent.select(field);
  }

  function tickBox() {
    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tick box" }));
  }

  it("boxes the whole line when the selection starts partway along it", () => {
    // Boxing only the selected slice wrote "buy [ ] milk today": a box in the
    // middle of a sentence, which is two brackets and not an item.
    const field = open("buy milk today\nget bread");
    select(field, 4, 8);
    tickBox();
    expect(field.value).toBe("[ ] buy milk today\nget bread");
  });

  it("boxes every line the selection touches, from the start of the first", () => {
    const field = open("buy milk\nget bread today");
    select(field, 4, 12);
    tickBox();
    expect(field.value).toBe("[ ] buy milk\n[ ] get bread today");
  });

  it("puts the spaces a selection caught outside the marks", () => {
    // A double-click takes the word and the space after it, and `**milk **` is
    // a pair of marks `inline.ts` rightly refuses to draw.
    const field = open("milk and bread");
    select(field, 0, 5);
    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(field.value).toBe("**milk** and bread");
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe("milk");

    select(field, 8, 13);
    fireEvent.keyDown(field, { key: "i", ctrlKey: true });
    expect(field.value).toBe("**milk** *and* bread");
  });

  it("leaves a bold run picked out with its stars alone rather than unwrapping it", () => {
    const saved = vi.fn();
    const field = open("a **bold** b", saved);
    select(field, 2, 10);
    fireEvent.keyDown(field, { key: "i", ctrlKey: true });
    // Not "a *bold* b" (the bold gone for an italic nobody asked for), and not
    // "a ***bold*** b" either, which `lib/inline.ts` draws as bold "*bold"
    // followed by a stray star. Nothing is written at all.
    expect(field.value).toBe("a **bold** b");
    expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe("**bold**");
    expect(saved).not.toHaveBeenCalledWith(expect.anything(), "a *bold* b");
    expect(saved).not.toHaveBeenCalledWith(expect.anything(), "a ***bold*** b");
  });

  it("wraps what is selected in a note whose lines end \\r\\n", () => {
    const saved = vi.fn();
    const field = open("line1\r\nline2 word", saved);
    expect(field.value).toBe("line1\nline2 word");
    select(field, 12, 15);
    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(field.value).toBe("line1\nline2 **wor**d");
    expect(saved).toHaveBeenLastCalledWith("f1", "line1\nline2 **wor**d");
  });

  it("puts a heading on the line the caret is on, in such a note", () => {
    const field = open("one\r\ntwo\r\nthree");
    select(field, 9, 9);
    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    expect(field.value).toBe("one\ntwo\n# three");
  });

  it("writes nothing to such a note just for opening it in the editor", () => {
    const saved = vi.fn();
    const { container, unmount } = view(note("one\r\ntwo"), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.blur(screen.getByRole("textbox", { name: "Note text" }));
    unmount();
    expect(saved).not.toHaveBeenCalled();
  });
});

/** The note with whatever else a test hands it, on top of `view`'s defaults. */
function viewWith(
  note: Note,
  extra: Partial<ComponentProps<typeof NoteView>> = {},
  onEditBody: (id: string, body: string) => void = () => {},
) {
  return render(
    <NoteView
      note={note}
      origin={null}
      closing={false}
      onClosed={() => {}}
      onClose={() => {}}
      onEditBody={onEditBody}
      onSetStatus={() => {}}
      onTogglePriority={() => {}}
      onAttach={() => {}}
      onDetach={() => {}}
      registerInner={() => {}}
      {...extra}
    />,
  );
}

/**
 * Opened from a search result, the note opens where the words are and says
 * which words they were — the card's own two moves (`shiftToMatch`,
 * `markHits`), made once more in the note so the hit the card pointed at is
 * not lost again the moment it is opened.
 */
describe("a note opened from a search", () => {
  const note = (body: string) => fileNote({ id: "s1", body, attachments: [] });
  const hits = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.reader [data-hit="true"]')).map((el) => el.textContent);

  it("marks the words the search matched, and draws every character still", () => {
    const body = "# Shopping\nbuy **milk** and more milk\n- [ ] Milk, oat\nhttps://milk.example/x";
    const { container } = viewWith(note(body), { searchTerms: ["milk"] });
    expect(hits(container)).toEqual(["milk", "milk", "Milk", "milk"]);
    // The round trip every tap is measured against: nothing added, nothing
    // dropped, the marks only split what was already there.
    expect(container.querySelector(".reader")?.textContent).toBe(body);
    expect(container.querySelector(".reader")?.getAttribute("data-dim")).toBe("true");
    // The address is still one live address, split or not.
    const links = container.querySelectorAll('.reader a[href="https://milk.example/x"]');
    expect(Array.from(links).map((a) => a.textContent).join("")).toBe("https://milk.example/x");
  });

  it("lights up round the hits over LIT_MS, and carries that number only when it lights", () => {
    const lit = viewWith(note("buy milk"), { searchTerms: ["milk"] });
    expect(
      (lit.container.querySelector(".reader") as HTMLElement).style.getPropertyValue("--lit-ms"),
    ).toBe(`${LIT_MS}ms`);
    cleanup();
    const plain = viewWith(note("buy milk"));
    expect(
      (plain.container.querySelector(".reader") as HTMLElement).style.getPropertyValue("--lit-ms"),
    ).toBe("");
  });

  it("opens exactly as it always did when nothing was searched for", () => {
    const { container } = viewWith(note("buy milk"));
    expect(hits(container)).toEqual([]);
    expect(container.querySelector(".reader")?.hasAttribute("data-dim")).toBe(false);
  });

  it("does not dim a note whose match is nowhere it draws a hit", () => {
    // The card's rule: stepped down only when something stands back up out of
    // it. A match inside a code block is found, and nothing is marked.
    const { container } = viewWith(note("notes\n```\nlet milk = 1;\n```"), {
      searchTerms: ["milk"],
    });
    expect(hits(container)).toEqual([]);
    expect(container.querySelector(".reader")?.hasAttribute("data-dim")).toBe(false);
  });

  it("drops the marks for good at the first tap into the text", () => {
    const { container } = viewWith(note("buy milk"), { searchTerms: ["milk"] });
    fireEvent.click(container.querySelector(".reader")!);
    fireEvent.blur(screen.getByRole("textbox", { name: "Note text" }));
    // Back in the reader, and the query is behind you: nothing marked, nothing
    // dimmed, for as long as the note stays open.
    expect(hits(container)).toEqual([]);
    expect(container.querySelector(".reader")?.hasAttribute("data-dim")).toBe(false);
  });

  /**
   * jsdom has no layout, so the geometry is played by hand: a 600px window
   * onto the note, and the first hit 2400px down it.
   */
  it("opens with the first hit in view, one line down from the top", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const top = this.dataset.hit === "true" ? 2400 : 0;
        return { top, height: 26, bottom: top + 26, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      });
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    try {
      const { container } = viewWith(note(`${"a line\n".repeat(90)}the milk is here`), {
        searchTerms: ["milk"],
      });
      const body = container.querySelector<HTMLElement>(".sheet-body")!;
      expect(body.scrollTop).toBe(2374);
    } finally {
      rect.mockRestore();
      height.mockRestore();
    }
  });

  // Review 2026-10-04, UI-A-11: "number 50" opened at the first "number".
  it("opens a search of several words at the line holding them all, lit most strongly", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const top = this.dataset.best === "true" ? 2400 : this.dataset.hit === "true" ? 100 : 0;
        return { top, height: 26, bottom: top + 26, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      });
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    try {
      const body = `- number one\n${"a line\n".repeat(90)}Page **number** 50, see\n50 more`;
      const { container } = viewWith(note(body), { searchTerms: ["number", "50"] });
      const lit = Array.from(container.querySelectorAll('.reader [data-best="true"]')).map(
        (el) => el.textContent,
      );
      expect(lit).toEqual(["number", "50"]);
      expect(hits(container)).toEqual(["number", "number", "50", "50"]);
      const reader = container.querySelector(".reader")!;
      expect(reader.getAttribute("data-ranked")).toBe("true");
      expect(reader.textContent).toBe(body);
      expect(container.querySelector<HTMLElement>(".sheet-body")!.scrollTop).toBe(2374);
    } finally {
      rect.mockRestore();
      height.mockRestore();
    }
  });

  it("singles out no line for a search of one word", () => {
    const { container } = viewWith(note("number one\nnumber 50"), { searchTerms: ["number"] });
    expect(container.querySelector('.reader [data-best="true"]')).toBeNull();
    expect(container.querySelector(".reader")?.hasAttribute("data-ranked")).toBe(false);
  });

  it("stays at the top when the first hit is already on screen", () => {
    const { container } = viewWith(note("the milk is here\nand more"), { searchTerms: ["milk"] });
    expect(container.querySelector<HTMLElement>(".sheet-body")!.scrollTop).toBe(0);
  });
});

// Review 2026-10-04, FX-A-05: the board's E, M and F, with Ctrl+Shift, in the note.
describe("archive, move and flag from the keyboard in the open note", () => {
  const note = () => fileNote({ id: "k1", body: "a note", attachments: [] });
  const chord = (key: string) =>
    fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey: true });

  it("flags with Ctrl+Shift+F, and leaves the bare letter to the typing", () => {
    const onTogglePriority = vi.fn();
    viewWith(note(), { onTogglePriority });
    fireEvent.keyDown(window, { key: "f" });
    expect(onTogglePriority).not.toHaveBeenCalled();
    chord("F");
    expect(onTogglePriority).toHaveBeenCalledTimes(1);
  });

  it("archives with Ctrl+Shift+E the way the mark does, and closes the note", () => {
    const onSetStatus = vi.fn();
    const onClose = vi.fn();
    viewWith(note(), { onSetStatus, onClose });
    chord("E");
    expect(onSetStatus).toHaveBeenCalledWith("k1", "archived");
    expect(onClose).toHaveBeenCalled();
  });

  it("opens the board chooser with Ctrl+Shift+M", () => {
    viewWith(note(), { onMove: vi.fn() });
    chord("M");
    expect(screen.getByLabelText("Search boards or name a new one")).toBeTruthy();
  });
});

describe("today's date, from the insert panel", () => {
  afterEach(() => vi.useRealTimers());

  it("goes into the line at the caret, with its year, and the caret after it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 27, 9, 0, 0));
    const saved = vi.fn();
    const { container } = view(fileNote({ id: "d1", body: "call back on\nthen", attachments: [] }), () => {}, saved);
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    field.setSelectionRange(12, 12);
    fireEvent.select(field);

    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Today's date" }));

    // Inline, not on a line of its own: a date is a word in a sentence.
    expect(field.value).toBe("call back on 27 Sep 2026\nthen");
    expect(field.selectionStart).toBe("call back on 27 Sep 2026".length);
    expect(saved).toHaveBeenLastCalledWith("d1", "call back on 27 Sep 2026\nthen");
  });
});

describe("new note from selection", () => {
  const note = (body: string) => fileNote({ id: "p1", body, attachments: [] });

  function open(body: string, onSplit = vi.fn(() => true), saved = vi.fn()) {
    const r = viewWith(note(body), { onSplit }, saved);
    fireEvent.click(r.container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    return { ...r, field, onSplit, saved };
  }

  function select(field: HTMLTextAreaElement, from: number, to: number) {
    field.setSelectionRange(from, to);
    fireEvent.select(field);
  }

  const splitRow = () => screen.queryByRole("menuitem", { name: "New note from selection" });

  it("moves the picked words out, and tidies the join they leave", () => {
    const { field, onSplit, saved } = open("one\n\ntwo\n\nthree");
    select(field, 5, 8);
    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(splitRow()!);

    expect(onSplit).toHaveBeenCalledWith("p1", "two", "one\n\ntwo\n\nthree", "one\n\nthree");
    expect(field.value).toBe("one\n\nthree");
    expect(saved).toHaveBeenLastCalledWith("p1", "one\n\nthree");
    expect(screen.queryByRole("menu", { name: "Insert" })).toBeNull();
  });

  it("is not offered with nothing selected, nor for the whole note", () => {
    const { field } = open("one two");
    select(field, 3, 3);
    fireEvent.click(screen.getByLabelText("Insert"));
    expect(splitRow()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close insert menu" }));

    select(field, 0, 7);
    fireEvent.click(screen.getByLabelText("Insert"));
    expect(splitRow()).toBeNull();
  });

  it("leaves the note exactly as it was when no new note was made", () => {
    const { field, saved } = open("one two", vi.fn(() => false));
    select(field, 4, 7);
    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(splitRow()!);
    expect(field.value).toBe("one two");
    expect(saved).not.toHaveBeenCalled();
  });

  it("counts a numbered list straight in the same act, so its undo knows the text", () => {
    const { field, onSplit } = open("1. a\n2. b\n3. c");
    select(field, 5, 9);
    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(splitRow()!);
    expect(onSplit).toHaveBeenCalledWith("p1", "2. b", "1. a\n2. b\n3. c", "1. a\n2. c");
    expect(field.value).toBe("1. a\n2. c");
  });

  it("splits what is selected on the page while the note is being read", () => {
    const onSplit = vi.fn(() => true);
    const { container } = viewWith(note("keep this\n\nmove this"), { onSplit });
    const reader = container.querySelector(".reader")!;
    // The reader's text is the note character for character, so a selection
    // in it is counted straight into the note.
    const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    while (walker.nextNode()) {
      if ((walker.currentNode as Text).data.includes("move this")) text = walker.currentNode as Text;
    }
    const range = document.createRange();
    const at = text!.data.indexOf("move this");
    range.setStart(text!, at);
    range.setEnd(text!, at + "move this".length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    fireEvent.click(screen.getByLabelText("Insert"));
    fireEvent.click(splitRow()!);
    window.getSelection()!.removeAllRanges();

    expect(onSplit).toHaveBeenCalledWith("p1", "move this", "keep this\n\nmove this", "keep this");
    expect(container.querySelector(".reader")?.textContent).toBe("keep this");
  });

  /**
   * A selection from an editing session that has ended is highlighted
   * nowhere. The format marks may still use it (a phone's blur is the case it
   * exists for), but a row that cuts words out of the note must not offer to
   * take ones nobody can see.
   */
  it("does not offer to cut a selection left over from before the editor closed", () => {
    const { field } = open("one two three");
    select(field, 4, 7);
    fireEvent.blur(field);
    fireEvent.click(screen.getByLabelText("Insert"));
    expect(splitRow()).toBeNull();
  });
});

/* The note's right-click menu (NoteMenu): the board's right-click on a card,
   said inside the open note. A mouse's right button only; the browser's own
   menu is kept for links, Shift, and a finger's long press. */
describe("right-click in the open note", () => {
  function rightClick(el: Element, init: { clientX?: number; clientY?: number; shiftKey?: boolean } = {}) {
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 2 });
    return fireEvent.contextMenu(el, { button: 2, clientX: 120, clientY: 140, ...init });
  }
  const menu = () => screen.queryByRole("group", { name: "This note" });
  const note = (body: string) => fileNote({ id: "f1", body, attachments: [] });

  it("opens the note's own verbs at the pointer, and refuses the browser's menu", () => {
    const { container } = viewWith(note("milk and bread"), {
      onToggleTodo: () => {},
      onMove: () => {},
      onSetReminder: () => {},
    });
    expect(rightClick(container.querySelector(".reader")!), "the browser's menu is refused").toBe(false);
    const panel = menu()!;
    expect(panel.getAttribute("style")).toContain("left: 120px");
    const rows = Array.from(panel.querySelectorAll(".selpanel-label")).map((r) => r.textContent);
    // The selection panel's order: what leaves the note where it is, then the
    // hairline, then what changes where it is.
    expect(rows).toEqual(["Copy", "Important", "To-do", "Set reminder", "Delete", "Archive", "Move"]);
    // Nothing picked out, so nothing about picked words.
    expect(panel.querySelector(".fmtrow")).toBeNull();
    // The dismiss layer paints nothing: the grey screen was a bare <button>.
    expect(container.querySelector(".menu-dismiss")).not.toBeNull();
    expect(container.querySelector(".ctx-dismiss")).toBeNull();
  });

  it("opens anywhere in the note, the empty space under the words too", () => {
    const { container } = viewWith(note("milk"));
    rightClick(container.querySelector(".sheet-rest")!);
    expect(menu()).not.toBeNull();
  });

  it("leads with the picked words' rows, and a format lands on them", () => {
    const { container } = viewWith(note("milk and bread"), { onSplit: () => true });
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    field.setSelectionRange(0, 4);
    rightClick(field);
    const panel = menu()!;
    expect(panel.querySelector(".fmtrow")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy selection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New note from selection" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(field.value).toBe("**milk** and bread");
    expect(menu()).toBeNull();
  });

  it("puts the picked lines in a code block", () => {
    const { container } = viewWith(note("see this\nconst a = 1;\nconst b = 2;\nok"));
    fireEvent.click(container.querySelector(".reader")!);
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    field.setSelectionRange(9, 34);
    rightClick(field);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Code block" }));
    expect(field.value).toBe("see this\n```\nconst a = 1;\nconst b = 2;\n```\nok");
    expect(menu()).toBeNull();
  });

  it("offers Code block only for picked words", () => {
    const { container } = viewWith(note("milk"));
    rightClick(container.querySelector(".reader")!);
    expect(within(menu()!).queryByRole("button", { name: "Code block" })).toBeNull();
  });

  it("formats words picked out while reading", () => {
    const { container } = viewWith(note("milk and bread"));
    const reader = container.querySelector(".reader")!;
    const text = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT).nextNode()!;
    const picked = document.createRange();
    picked.setStart(text, 0);
    picked.setEnd(text, 4);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(picked);
    rightClick(reader);
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect((screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement).value).toBe(
      "*milk* and bread",
    );
  });

  it("copies the picked words, or the whole note", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      const { container } = viewWith(note("milk and bread"));
      fireEvent.click(container.querySelector(".reader")!);
      const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
      field.setSelectionRange(9, 14);
      rightClick(field);
      fireEvent.click(screen.getByRole("button", { name: "Copy selection" }));
      expect(writeText).toHaveBeenLastCalledWith("bread");
      field.setSelectionRange(0, 0);
      rightClick(field);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(writeText).toHaveBeenLastCalledWith("milk and bread");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("runs a verb through the note's own path and closes", () => {
    const onTogglePriority = vi.fn();
    const onSetStatus = vi.fn();
    const n = note("milk");
    const { container } = viewWith(n, { onTogglePriority, onSetStatus });
    rightClick(container.querySelector(".reader")!);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Important" }));
    expect(onTogglePriority).toHaveBeenCalledWith(n);
    expect(menu()).toBeNull();
    rightClick(container.querySelector(".reader")!);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Archive" }));
    expect(onSetStatus).toHaveBeenCalledWith(n.id, "archived");
  });

  it("opens Move's chooser from the menu", () => {
    const { container } = viewWith(note("milk"), { onMove: () => {}, boards: [] });
    rightClick(container.querySelector(".reader")!);
    fireEvent.click(within(menu()!).getByRole("button", { name: "Move" }));
    expect(menu()).toBeNull();
    expect(container.querySelector(".selpanel")).not.toBeNull();
  });

  it("says Put back in the trash, never Delete", () => {
    const { container } = viewWith({ ...note("milk"), status: "trashed" });
    rightClick(container.querySelector(".reader")!);
    expect(within(menu()!).getByRole("button", { name: "Put back" })).toBeTruthy();
    expect(within(menu()!).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("Escape closes the menu and leaves the note open", () => {
    const onClose = vi.fn();
    const { container } = viewWith(note("milk"), { onClose });
    rightClick(container.querySelector(".reader")!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a second right-click moves the menu rather than showing the browser's", () => {
    const { container } = viewWith(note("milk"));
    rightClick(container.querySelector(".reader")!);
    const layer = container.querySelector(".menu-dismiss")!;
    expect(fireEvent.contextMenu(layer, { button: 2, clientX: 300, clientY: 200 })).toBe(false);
    expect(menu()!.getAttribute("style")).toContain("left: 300px");
  });

  it("leaves the browser's menu alone with Shift, on a link, and for a finger", () => {
    const { container } = viewWith(note("see https://example.com today"));
    const reader = container.querySelector(".reader")!;
    expect(rightClick(reader, { shiftKey: true })).toBe(true);
    expect(rightClick(reader.querySelector("a")!)).toBe(true);
    fireEvent.pointerDown(reader, { pointerId: 2, pointerType: "touch", button: 0 });
    expect(fireEvent.contextMenu(reader)).toBe(true);
    expect(menu()).toBeNull();
  });
});

describe("link previews in the open note can be put away", () => {
  const body = [1, 2, 3, 4, 5].map((n) => `https://site${n}.example/a`).join("\n");
  const entry = (n: number, over: Record<string, unknown> = {}) => ({
    href: `https://site${n}.example/a`,
    domain: `site${n}.example`,
    title: `T${n}`,
    description: null,
    image: null,
    fetched_at: "2026-09-01T00:00:00.000Z",
    ...over,
  });

  it("draws three, a row for the other two, and a hide button on each box", () => {
    const { container } = viewWith(fileNote({ body, attachments: [] }), { onHidePreviews: () => {} });
    expect(container.querySelectorAll(".link-previews .link-preview")).toHaveLength(3);
    expect(container.querySelectorAll(".link-previews button.link-preview-hide")).toHaveLength(3);
    expect(screen.getByText("Show 2 more")).toBeTruthy();
  });

  it("hides through the board, by address, without touching the text", () => {
    const onHide = vi.fn();
    const onEditBody = vi.fn();
    viewWith(fileNote({ id: "f9", body, attachments: [] }), { onHidePreviews: onHide }, onEditBody);
    fireEvent.click(screen.getByLabelText("Hide preview of site2.example"));
    expect(onHide).toHaveBeenCalledWith("f9", ["https://site2.example/a"], true);
    expect(onEditBody).not.toHaveBeenCalled();
  });

  it("does not draw a hidden preview, and says how many are put away", () => {
    const onHide = vi.fn();
    const { container } = viewWith(
      fileNote({
        id: "f9",
        body,
        attachments: [],
        link_previews: [entry(1, { hidden: true }), entry(2, { hidden: true })],
      }),
      { onHidePreviews: onHide },
    );
    const drawn = [...container.querySelectorAll(".link-preview-title")].map((t) => t.textContent);
    expect(drawn).not.toContain("T1");
    expect(container.querySelectorAll(".link-previews .link-preview")).toHaveLength(3);
    fireEvent.click(screen.getByText("2 hidden · show"));
    expect(onHide).toHaveBeenCalledWith("f9", ["https://site1.example/a", "https://site2.example/a"], false);
  });

  it("offers no hiding for a note in the trash, where a write would restart its thirty days", () => {
    const { container } = viewWith(
      fileNote({ body, attachments: [], status: "trashed" }),
      { onHidePreviews: () => {} },
    );
    expect(container.querySelector(".link-preview-hide")).toBeNull();
  });
});

/**
 * The open note's own layers, top first: the picture, the remove-attachment
 * question, the Move chooser, the reminder panel, the insert panel, the
 * right-click menu. Back (through `registerInner`) and Escape must step out of
 * the same one, one at a time, and the note's own keys — Ctrl+Enter and the
 * Ctrl+Shift verbs — stand down under every one of them.
 *
 * Most of these cannot be up together by touch, because every panel lays a
 * dismiss layer over the sheet. From the keyboard they can: Tab keeps cycling
 * through the whole sheet while a panel is open, so the marks under it can be
 * pressed. Each pair is opened the way the code allows, and a pair the code
 * itself refuses (opening the menu closes the corner panels, the + stands
 * down under them) is not a pair. Nor is anything opened over the picture or
 * the remove question: both are modal, cover the sheet and trap Tab inside
 * themselves, so nothing under them can be pressed.
 */
describe("the open note's panels, top first", () => {
  const boards: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];
  const PANELS = ["picture", "remove", "move", "remind", "insert", "menu"] as const;
  type Panel = (typeof PANELS)[number];

  const shown: Record<Panel, () => HTMLElement | null> = {
    picture: () => screen.queryByRole("dialog", { name: shot.name, hidden: true }),
    remove: () => screen.queryByRole("alertdialog", { name: "Remove attachment?", hidden: true }),
    move: () => screen.queryByRole("group", { name: "Move to a board", hidden: true }),
    remind: () => screen.queryByRole("menu", { name: "Reminder", hidden: true }),
    insert: () => screen.queryByRole("menu", { name: "Insert", hidden: true }),
    menu: () => screen.queryByRole("group", { name: "This note", hidden: true }),
  };
  /** Presses whatever opens the panel, if the code draws it right now. */
  const openers: Record<Panel, () => void> = {
    picture: () => {
      const el = screen.queryByLabelText(`View ${shot.name}`);
      if (el) fireEvent.click(el);
    },
    // A picture is removed from the viewer, which goes as the note asks.
    remove: () => {
      const view = screen.queryByLabelText(`View ${shot.name}`);
      if (view) fireEvent.click(view);
      const el = screen.queryByRole("button", { name: `Remove ${shot.name}`, hidden: true });
      if (el) fireEvent.click(el);
    },
    move: () => {
      const el = screen.queryByRole("button", { name: "Move to a board", hidden: true });
      if (el) fireEvent.click(el);
    },
    remind: () => {
      const el = screen.queryByRole("button", { name: "Set a reminder", hidden: true });
      if (el) fireEvent.click(el);
    },
    insert: () => {
      const el = screen.queryByRole("button", { name: "Insert", hidden: true });
      if (el) fireEvent.click(el);
    },
    menu: () => {
      const el = document.querySelector(".sheet-rest");
      if (!el) return;
      fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 2 });
      fireEvent.contextMenu(el, { button: 2, clientX: 120, clientY: 140 });
    },
  };
  const up = () => PANELS.filter((p) => shown[p]() !== null);

  function open() {
    const onClose = vi.fn();
    const onSetStatus = vi.fn();
    const onTogglePriority = vi.fn();
    const back: { inner: (() => void) | null } = { inner: null };
    viewWith(fileNote({ id: "p1", body: "buy milk", attachments: [shot] }), {
      boards,
      onMove: vi.fn(),
      onSetReminder: vi.fn(),
      onClose,
      onSetStatus,
      onTogglePriority,
      registerInner: (close) => {
        back.inner = close;
      },
    });
    /** Back, as the app plays it: the inner layer's close, else the note's. */
    const pressBack = () => {
      if (back.inner) act(() => back.inner!());
      else onClose();
    };
    /** Escape, sent where a real key goes: the focused element, bubbling up. */
    const pressEscape = () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    };
    return { onClose, onSetStatus, onTogglePriority, pressBack, pressEscape };
  }

  it("Back steps out of each panel alone, and leaves the note open", () => {
    for (const p of PANELS) {
      const { onClose, pressBack } = open();
      openers[p]();
      expect(up(), p).toEqual([p]);
      pressBack();
      expect(up(), p).toEqual([]);
      expect(onClose, p).not.toHaveBeenCalled();
      pressBack();
      expect(onClose, p).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("Back closes the panels one at a time, top first", () => {
    const { onClose, pressBack } = open();
    // The menu first, since opening it closes the corner panels.
    openers.menu();
    openers.insert();
    openers.remind();
    openers.move();
    openers.remove();
    expect(up()).toEqual(["remove", "move", "remind", "insert", "menu"]);
    const order: Panel[] = [];
    for (let i = 0; i < 5; i++) {
      const before = up();
      pressBack();
      const gone = before.filter((p) => !up().includes(p));
      expect(gone).toHaveLength(1);
      order.push(gone[0]);
    }
    expect(order).toEqual(["remove", "move", "remind", "insert", "menu"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  // One test per panel underneath, so no single one outgrows the slow-test
  // budget. What can be opened over each: everything but the menu, which
  // closes the corner panels first.
  it.each([
    ["move", 4],
    ["remind", 4],
    ["insert", 4],
    ["menu", 5],
  ] as const)("Escape and Back close the same panel over the %s", (a, reachable) => {
    let pairs = 0;
    for (const b of PANELS) {
      if (a === b) continue;
      const closedBy = (press: "escape" | "back") => {
        const keys = open();
        openers[a]();
        openers[b]();
        const before = up();
        if (before.length < 2) {
          cleanup();
          return null;
        }
        if (press === "escape") keys.pressEscape();
        else keys.pressBack();
        const after = up();
        expect(keys.onClose, `${a} then ${b}, ${press}`).not.toHaveBeenCalled();
        cleanup();
        return before.filter((p) => !after.includes(p));
      };
      const byEscape = closedBy("escape");
      if (byEscape === null) continue;
      pairs++;
      expect(byEscape, `${a} then ${b}`).toHaveLength(1);
      expect(closedBy("back"), `${a} then ${b}`).toEqual(byEscape);
    }
    expect(pairs).toBe(reachable);
  });

  it("Ctrl+Enter and Ctrl+Shift+E, M and F stand down under every panel", () => {
    for (const p of PANELS) {
      const { onClose, onSetStatus, onTogglePriority } = open();
      openers[p]();
      expect(up(), p).toEqual([p]);
      fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
      fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
      expect(onClose, p).not.toHaveBeenCalled();
      expect(onSetStatus, p).not.toHaveBeenCalled();
      expect(onTogglePriority, p).not.toHaveBeenCalled();
      // Move would have joined the panel, not replaced it.
      expect(up(), p).toEqual([p]);
      cleanup();
    }
  });

  it("…and answer once nothing is open", () => {
    const { onClose, onSetStatus, onTogglePriority } = open();
    fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
    expect(up()).toEqual(["move"]);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    expect(onTogglePriority).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "E", ctrlKey: true, shiftKey: true });
    expect(onSetStatus).toHaveBeenCalledWith("p1", "archived");
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * The sheet's close waits for its animation, and carries a timer for a tab put
 * in the background, which never fires `onfinish`: the layer must not be able
 * to strand itself over the grid. jsdom has no Web Animations, so the close is
 * reached with a stand-in that records which element it was played on.
 */
describe("closing the sheet", () => {
  type Flight = { el: Element; onfinish: (() => void) | null; cancel: () => void };
  let flights: Flight[] = [];
  const proto = HTMLElement.prototype as unknown as { animate?: unknown };
  let had: unknown;
  beforeEach(() => {
    vi.useFakeTimers();
    flights = [];
    had = proto.animate;
    proto.animate = function (this: Element) {
      const flight: Flight = { el: this, onfinish: null, cancel: () => {} };
      flights.push(flight);
      return flight;
    };
  });
  afterEach(() => {
    cleanup();
    proto.animate = had;
    vi.useRealTimers();
  });

  const sheet = (closing: boolean, onClosed: () => void) => (
    <NoteView
      note={fileNote({ id: "c1", body: "milk", attachments: [] })}
      origin={null}
      closing={closing}
      onClosed={onClosed}
      onClose={() => {}}
      onEditBody={() => {}}
      onSetStatus={() => {}}
      onTogglePriority={() => {}}
      onAttach={() => {}}
      onDetach={() => {}}
      registerInner={() => {}}
    />
  );
  /** The sheet's own close: the last thing played on the sheet. */
  const closeFlight = () => flights.filter((f) => f.el.classList.contains("sheet")).at(-1)!;

  it("ends by its timer when the animation never finishes", () => {
    const onClosed = vi.fn();
    const r = render(sheet(false, onClosed));
    r.rerender(sheet(true, onClosed));
    act(() => vi.advanceTimersByTime(CLOSE_MS + 139));
    expect(onClosed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("waits the longer vanish when the note is leaving into a mark", () => {
    const onClosed = vi.fn();
    const r = render(sheet(false, onClosed));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    r.rerender(sheet(true, onClosed));
    act(() => vi.advanceTimersByTime(VANISH_MS + 139));
    expect(onClosed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("ends when the animation lands, and the timer goes with the layer", () => {
    const onClosed = vi.fn();
    const r = render(sheet(false, onClosed));
    r.rerender(sheet(true, onClosed));
    act(() => closeFlight().onfinish?.());
    expect(onClosed).toHaveBeenCalledTimes(1);
    // The app takes the layer away on onClosed.
    r.unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  // Held by the app until onClosed, the layer was ended twice when the
  // animation landed and the timer still went off after it.
  it("is ended once, even while the layer is still held", () => {
    const onClosed = vi.fn();
    const r = render(sheet(false, onClosed));
    r.rerender(sheet(true, onClosed));
    act(() => closeFlight().onfinish?.());
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("is not ended by a timer from a layer that has already gone", () => {
    const onClosed = vi.fn();
    const r = render(sheet(false, onClosed));
    r.rerender(sheet(true, onClosed));
    r.unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClosed).not.toHaveBeenCalled();
  });
});

describe("a note opened by a key", () => {
  const words = fileNote({ body: "Call the dentist", attachments: [] });

  // Ctrl+K, a word, Enter, Enter: the second Enter opens the card, and the
  // words were nine Tabs away. Opened by a key, the caret is at the end of
  // them, and Escape still closes (review UX-06).
  afterEach(() => markKeyOpen(null));

  it("puts the caret at the end of its words", () => {
    const onClose = vi.fn();
    markKeyOpen(words.id);
    view(words, onClose);
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(words.body.length);
    expect(field.selectionEnd).toBe(words.body.length);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays a reader when it was tapped open, so a phone's keyboard stays down", () => {
    view(words);
    expect(screen.queryByRole("textbox", { name: "Note text" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close note" }));
  });

  it("leaves a note with no words but a file as a reader", () => {
    markKeyOpen(fileNote().id);
    view(fileNote());
    expect(screen.queryByRole("textbox", { name: "Note text" })).toBeNull();
  });

  it("asks once, and only for the note the key opened", () => {
    markKeyOpen("another");
    view(words);
    expect(screen.queryByRole("textbox", { name: "Note text" })).toBeNull();
  });

  // Opened by a key from a search, the note stays where the hit is and the
  // caret goes just after it, not to the end (2026-10-13, the lead's call).
  it("puts the caret just after the search hit it opened on", () => {
    const body = "Call the dentist\nthen the bank about the card\nand the rest";
    markKeyOpen("s2");
    viewWith(fileNote({ id: "s2", body, attachments: [] }), { searchTerms: ["bank"] });
    const field = screen.getByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    const after = body.indexOf("bank") + "bank".length;
    expect(field.selectionStart).toBe(after);
    expect(field.selectionEnd).toBe(after);
  });
});

describe("closing", () => {
  it("marks the sheet while it closes, so its marks take no more clicks", () => {
    const props = {
      note: fileNote({ id: "c1", body: "a note being closed", attachments: [] }),
      origin: null,
      onClosed: () => {},
      onClose: () => {},
      onEditBody: () => {},
      onSetStatus: () => {},
      onTogglePriority: () => {},
      onAttach: () => {},
      onDetach: () => {},
      registerInner: () => {},
    };
    const { container, rerender } = render(<NoteView {...props} closing={false} />);
    expect(container.querySelector(".sheet")?.hasAttribute("data-closing")).toBe(false);
    rerender(<NoteView {...props} closing />);
    expect(container.querySelector(".sheet")?.hasAttribute("data-closing")).toBe(true);
  });
});
