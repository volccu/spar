// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureBar, DRAFT_WRITE_MS, NO_CHOICE, type IncomingWords } from "./CaptureBar";
import { ENTER, LAMP_DIM_MS, LAMP_FADE_MS, LAMP_FOLLOW_MS, OPEN_MS } from "../lib/motion";
import { readCaptureDraft, writeCaptureDraft } from "../store/db";
import { note } from "../test/fixtures";

afterEach(cleanup);

/**
 * Capture is one field and zero decisions, checked rather than trusted.
 *
 * This is the first invariant in the product (CLAUDE.md: "Capture is one text
 * field, zero decisions. No title input, no tag picker, no board chooser at
 * capture time — ever") and until now it held only because nobody had added a
 * second field yet. Nothing failed if they did.
 *
 * A count of `<input>` elements would be the obvious check and would be wrong
 * twice over. The bar legitimately contains a second input — an
 * `<input type="file">` that the attach menu clicks programmatically — so a
 * naive count fails today. And a count says nothing about the thing that
 * actually matters, which is not how many elements exist but how many
 * decisions the user is asked for before their words are saved.
 *
 * So the assertions below are about what a person can type into and what they
 * are asked to choose, and the file picker is explicitly excused for the
 * reasons it is genuinely invisible: out of the tab order, out of the
 * accessibility tree, off screen.
 */
describe("capture asks for one thing", () => {
  function bar(overrides: Partial<Parameters<typeof CaptureBar>[0]> = {}) {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
        {...overrides}
      />,
    );
  }

  /** Everything a person could type into, the file picker aside. */
  function typeableFields(root: HTMLElement): Element[] {
    return [...root.querySelectorAll("input, textarea")].filter(
      (el) => !(el instanceof HTMLInputElement && el.type === "file"),
    );
  }

  it("offers exactly one place to type", () => {
    const { container } = bar();
    const fields = typeableFields(container);
    expect(fields.map((el) => el.tagName)).toEqual(["TEXTAREA"]);
    expect(screen.getByLabelText("Write a note")).toBe(fields[0]);
  });

  it("still offers exactly one once there is something to save", () => {
    // The right-hand slot swaps between Save and the menu depending on whether
    // the field has anything in it, so the bar has two distinct renderings and
    // a second field could be added to either.
    const { container } = bar();
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    expect(screen.getByRole("button", { name: "Save note" })).toBeTruthy();
    expect(typeableFields(container).map((el) => el.tagName)).toEqual(["TEXTAREA"]);
  });

  it("names the folder being stood on as where the note goes, without choosing it", () => {
    const onCapture = vi.fn();
    bar({ onCapture, boards: [{ id: "b1", name: "Recipes", position: 0 }], here: "b1" });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    const mark = screen.getByRole("button", { name: "Board: Recipes" });
    // A default, not a choice: the mark is not pressed, and a plain save
    // still hands up nothing chosen — the board underneath decides.
    expect(mark.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("kahvia", NO_CHOICE);
  });

  it("names where the words go on the field's edge only while the board row stands down", () => {
    const boards = [{ id: "b1", name: "Recipes", position: 0 }];
    const { rerender, container } = bar({ boards, here: "b1" });
    const typed = () => fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    typed();
    expect(container.querySelector(".capture-dest")).toBeNull();
    rerender(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={boards}
        here="b1"
        nameBoard
        onCreateBoard={vi.fn()}
      />,
    );
    expect(container.querySelector(".capture-dest")?.textContent).toBe("In Recipes");
    // Nothing chosen and no folder: where a capture falls through to.
    rerender(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={boards}
        nameBoard
        onCreateBoard={vi.fn()}
      />,
    );
    expect(container.querySelector(".capture-dest")?.textContent).toBe("In Inbox");
  });

  it("starts a one-line capture on Todos as a tick box, and leaves one anywhere else alone", () => {
    const todos = vi.fn();
    bar({ onCapture: todos, onTodos: true });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "bread" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(todos).toHaveBeenCalledWith("[ ] bread", NO_CHOICE);
    cleanup();

    const elsewhere = vi.fn();
    bar({ onCapture: elsewhere });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "bread" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(elsewhere).toHaveBeenCalledWith("bread", NO_CHOICE);
  });

  it("leaves a several-line capture on Todos as it was written", () => {
    const onCapture = vi.fn();
    bar({ onCapture, onTodos: true });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "bread\nmilk" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("bread\nmilk", NO_CHOICE);
  });

  it("leaves a capture on Todos alone when a board was chosen for it", () => {
    const onCapture = vi.fn();
    bar({ onCapture, onTodos: true, boards: [{ id: "b1", name: "Recipes", position: 0 }] });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "bread" } });
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("button", { name: /Recipes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("bread", { ...NO_CHOICE, board: "b1" });
  });

  it("asks for no choices — no title, no tag, nothing to fill in", () => {
    const { container } = bar();
    // A picker of any kind is the shape this invariant is guarding against.
    // The three marks the bar grew (priority, to-do, board — SPEC §2.1) are
    // not this shape and deliberately so: a `select` or a `combobox` is a
    // field with an empty value, and an empty value is a question. A toggle
    // that starts off is an offer, and an offer costs a glance.
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll("[role='combobox'], [role='listbox']")).toHaveLength(0);
    expect(container.querySelectorAll("input[type='checkbox'], input[type='radio']")).toHaveLength(
      0,
    );
  });

  /**
   * The marks are offered, not asked — and this is the test that says which.
   *
   * An empty bar carries none of them: there is nothing to be a priority yet,
   * and three dead controls beside an empty field are furniture. They appear
   * with the words and they all start off, so the fast path is unchanged —
   * type, Enter, gone, and `NO_CHOICE` goes up with it (asserted in the Enter
   * block below).
   */
  it("offers the four marks only once there is something to save, all of them off", () => {
    bar();
    for (const name of ["Important", "To-do", "Board", "Reminder"]) {
      expect(screen.queryByRole("button", { name }), `${name} before there are words`).toBeNull();
    }

    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    for (const name of ["Important", "To-do", "Board", "Reminder"]) {
      const mark = screen.getByRole("button", { name });
      expect(mark.getAttribute("aria-pressed"), `${name} must start off`).toBe("false");
    }
  });

  it("carries a mark that was pressed up with the words, and only that one", () => {
    const onCapture = vi.fn();
    bar({ onCapture });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    fireEvent.click(screen.getByRole("button", { name: "Important" }));
    expect(screen.getByRole("button", { name: "Important" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("kahvia", { ...NO_CHOICE, priority: true });
  });

  /**
   * To-do on a note of several lines saves each line as a tick box (review
   * 2026-10-01, UX-05) — the user asked by pressing it. Without the mark the
   * words go up exactly as typed.
   */
  it("saves a several-line to-do as a list to tick", () => {
    const onCapture = vi.fn();
    bar({ onCapture });
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "screws\nsandpaper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("[ ] screws\n[ ] sandpaper", { ...NO_CHOICE, todo: true });
  });

  it("leaves the lines alone without the to-do mark", () => {
    const onCapture = vi.fn();
    bar({ onCapture });
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "screws\nsandpaper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("screws\nsandpaper", NO_CHOICE);
  });

  /**
   * A file is a note, so a file capture carries the marks too.
   *
   * The marks are drawn while the attach row is one tap away, so they can be
   * set and *then* a file attached — and the file path is a different call
   * from Save. Left unthreaded it dropped them silently: the flag was lit, the
   * note was made without it, and nothing said so.
   */
  it("hands its marks to a file capture as well as to Save", async () => {
    const onCaptureFiles = vi.fn().mockResolvedValue(true);
    const { container } = bar({ onCaptureFiles });
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "the receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Important" }));

    const picker = container.querySelector<HTMLInputElement>("input[type='file']")!;
    const file = new File(["x"], "receipt.png", { type: "image/png" });
    Object.defineProperty(picker, "files", { value: [file] });
    fireEvent.change(picker);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await act(async () => {});
    expect(onCaptureFiles).toHaveBeenCalledWith([file], "the receipt", {
      ...NO_CHOICE,
      priority: true,
    });
  });

  /**
   * A mark is about the words in the field, so it goes when the words go.
   * Without this, a note marked urgent and then rewritten into something else
   * carries a decision made about text that no longer exists — the quietest
   * possible way for the bar to lie about what it is saving.
   */
  it("forgets its marks when the field is emptied", () => {
    const onCapture = vi.fn();
    bar({ onCapture });
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "kahvia" } });
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    expect(screen.getByRole("button", { name: "To-do" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.change(field, { target: { value: "something else entirely" } });
    expect(screen.getByRole("button", { name: "To-do" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("something else entirely", NO_CHOICE);
  });

  /**
   * The fourth mark (review 2026-10-04, FX-B-06, owner approved 2026-10-05):
   * a clock offering the open note's four presets. "Call mum Sunday" needed
   * five taps after Save; now it is two before it. Off until pressed, like
   * the other three, so a plain capture still hands up `NO_CHOICE`.
   */
  describe("the reminder mark", () => {
    const clock = () => screen.getByRole("button", { name: /^Reminder/ });

    it("offers the four presets, and carries the one picked up with the words", () => {
      const onCapture = vi.fn();
      bar({ onCapture });
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "soita äidille" } });
      expect(clock().getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(clock());
      const rows = screen.getAllByRole("menuitemradio");
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.textContent)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("In 1 hour"),
          expect.stringContaining("Tomorrow"),
          expect.stringContaining("Next week"),
        ]),
      );
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^Next week/ }));

      // The panel closes on the pick, the mark says what it holds, and the
      // caret is back in the words.
      expect(screen.queryByRole("menuitemradio")).toBeNull();
      expect(clock().getAttribute("aria-pressed")).toBe("true");
      expect(clock().getAttribute("aria-label")).toMatch(/^Reminder: Next week/);
      expect(document.activeElement).toBe(screen.getByLabelText("Write a note"));

      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      expect(onCapture).toHaveBeenCalledWith("soita äidille", { ...NO_CHOICE, reminder: "next-week" });
    });

    it("says when it will ring beside the clock, and nothing before one is picked", () => {
      bar();
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "soita äidille" } });
      expect(document.querySelector(".capture-when")).toBeNull();
      fireEvent.click(clock());
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^In 1 hour/ }));
      // The same time the mark's name and the panel's row carry: HH:MM, or a weekday and the time.
      expect(document.querySelector(".capture-when")?.textContent).toMatch(/^(\w{3} )?\d{2}:\d{2}$/);
      fireEvent.click(clock());
      fireEvent.click(screen.getByRole("menuitem", { name: "No reminder" }));
      expect(document.querySelector(".capture-when")).toBeNull();
    });

    it("takes the reminder off again from the same panel", () => {
      const onCapture = vi.fn();
      bar({ onCapture });
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
      fireEvent.click(clock());
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^In 1 hour/ }));
      fireEvent.click(clock());
      fireEvent.click(screen.getByRole("menuitem", { name: "No reminder" }));
      expect(clock().getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      expect(onCapture).toHaveBeenCalledWith("kahvia", NO_CHOICE);
    });

    it("closes on Escape, keeping what was chosen", () => {
      bar();
      const field = screen.getByLabelText("Write a note");
      fireEvent.change(field, { target: { value: "kahvia" } });
      fireEvent.click(clock());
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^Tomorrow(?! evening)/ }));
      fireEvent.click(clock());
      fireEvent.keyDown(field, { key: "Escape" });
      expect(screen.queryByRole("menuitemradio")).toBeNull();
      expect(clock().getAttribute("aria-pressed")).toBe("true");
    });

    it("is forgotten with the words", () => {
      const onCapture = vi.fn();
      bar({ onCapture });
      const field = screen.getByLabelText("Write a note");
      fireEvent.change(field, { target: { value: "kahvia" } });
      fireEvent.click(clock());
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^Tomorrow(?! evening)/ }));
      fireEvent.change(field, { target: { value: "" } });
      fireEvent.change(field, { target: { value: "jotain muuta" } });
      expect(clock().getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      expect(onCapture).toHaveBeenCalledWith("jotain muuta", NO_CHOICE);
    });
  });

  it("keeps the file picker out of the way rather than counting it as a field", () => {
    // The one input that is allowed to exist, and the three properties that
    // make it not a second field: no tab stop, no accessible name, no space on
    // screen. If any of these go, it has become a decision at capture time.
    const picker = bar().container.querySelector<HTMLInputElement>("input[type='file']");
    expect(picker).toBeTruthy();
    expect(picker!.tabIndex).toBe(-1);
    expect(picker!.getAttribute("aria-hidden")).toBe("true");
    expect(picker!.className).toContain("offscreen");
  });
});

/**
 * What Enter means depends on the keyboard. A hardware keyboard has Shift, so
 * Enter saves and Shift+Enter breaks the line. A screen keyboard has no
 * Shift+Enter at all — under the old rule ("Enter saves, always") a phone
 * could never reach a second line: every multi-line thought saved itself
 * mid-sentence. So where the pointer is touch, Enter breaks the line and Save
 * is the button, which is where a thumb saves from anyway.
 *
 * The bar and the drawn shortcut hint ask one predicate between them
 * (`hasKeyboard` in `lib/hotkeys.ts`), and they hand it opposite answers for
 * the case where no media query can be put at all — which is jsdom, and so
 * every test here. The bar asks with "hardware keyboard", because a capture
 * bar whose Enter never saves is a broken capture bar; that is the first
 * block. The screen-keyboard block stubs a matchMedia in that answers the
 * hardware-keyboard pair with false, which is what a phone reports.
 */
describe("Enter follows the keyboard", () => {
  function bar(onCapture = vi.fn()) {
    render(
      <CaptureBar
        onCapture={onCapture}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
    return onCapture;
  }

  function field(): HTMLTextAreaElement {
    return screen.getByLabelText("Write a note") as HTMLTextAreaElement;
  }

  it("saves on Enter from a hardware keyboard, and the key says done", () => {
    const onCapture = bar();
    fireEvent.change(field(), { target: { value: "yksi rivi" } });
    expect(field().getAttribute("enterkeyhint")).toBe("done");
    fireEvent.keyDown(field(), { key: "Enter" });
    // Nothing was marked, so the second argument is the untouched choice —
    // which is the whole claim of item 6: the quick path still says nothing.
    expect(onCapture).toHaveBeenCalledWith("yksi rivi", NO_CHOICE);
    expect(field().value).toBe("");
  });

  // Review 2026-10-01, UX-14: no squiggles under a desktop's words — the app
  // has no colour for them — but a phone's keyboard needs spellcheck on to
  // offer its suggestions and autocorrect at all.
  it("keeps spellcheck off at a hardware keyboard", () => {
    bar();
    expect(field().getAttribute("spellcheck")).toBe("false");
  });

  describe("on a screen keyboard", () => {
    beforeEach(() => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        // A phone: no hovering fine pointer anywhere, so no hardware keyboard.
        matches: query !== "(hover: hover) and (pointer: fine)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    });
    afterEach(() => vi.unstubAllGlobals());

    it("does not save on Enter, and the key says enter", () => {
      const onCapture = bar();
      fireEvent.change(field(), { target: { value: "kaksi riviä tulossa" } });
      expect(field().getAttribute("enterkeyhint")).toBe("enter");
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(onCapture).not.toHaveBeenCalled();
      expect(field().value).toBe("kaksi riviä tulossa");
    });

    it("continues a list on Enter, exactly as Shift+Enter does", () => {
      bar();
      fireEvent.change(field(), { target: { value: "– eka" } });
      field().setSelectionRange(5, 5);
      fireEvent.keyDown(field(), { key: "Enter" });
      expect(field().value).toBe("– eka\n– ");
    });

    it("turns spellcheck on, so the keyboard offers its words", () => {
      bar();
      expect(field().getAttribute("spellcheck")).toBe("true");
    });

    it("still saves from the button", () => {
      const onCapture = bar();
      fireEvent.change(field(), { target: { value: "kaksi\nriviä" } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      expect(onCapture).toHaveBeenCalledWith("kaksi\nriviä", NO_CHOICE);
      expect(field().value).toBe("");
    });

    // Review 2026-10-04, UX-A-11: a finger on Save took the focus, the field
    // blurred, and the keyboard dropped after every note — three thoughts in a
    // row cost a tap back into the field each time.
    it("keeps the caret in the field after Save, so the keyboard stays up", () => {
      bar();
      field().focus();
      fireEvent.change(field(), { target: { value: "eka ajatus" } });
      const save = screen.getByRole("button", { name: "Save note" });
      // The press that would take the focus is swallowed...
      expect(fireEvent.mouseDown(save)).toBe(false);
      // ...and a Save that took it anyway (a keyboard's Tab, a screen reader)
      // hands it straight back to the words.
      save.focus();
      fireEvent.click(save);
      expect(document.activeElement).toBe(field());
    });
  });
});

/**
 * Escape lets go of the write box, and the words stay (owner approved
 * 2026-10-18, dogfooding) — but never while an input method is composing:
 * there Escape is the method's own, cancelling the composition, and Firefox
 * sends it with `isComposing` set. Letting go as well dropped the composition
 * and threw the writer out of the box mid-word (review 2026-10-19).
 */
describe("Escape and the write box", () => {
  function field(): HTMLTextAreaElement {
    render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
    const el = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    el.focus();
    fireEvent.change(el, { target: { value: "still writ" } });
    return el;
  }

  it("lets go of the box and keeps the words, as before", () => {
    const el = field();
    fireEvent.keyDown(el, { key: "Escape" });
    expect(document.activeElement).not.toBe(el);
    expect(el.value).toBe("still writ");
  });

  it("does nothing while composing, by the flag", () => {
    const el = field();
    fireEvent.keyDown(el, { key: "Escape", isComposing: true });
    expect(document.activeElement).toBe(el);
    expect(el.value).toBe("still writ");
  });

  it("does nothing while composing, by key code 229", () => {
    const el = field();
    fireEvent.keyDown(el, { key: "Escape", keyCode: 229 });
    expect(document.activeElement).toBe(el);
  });
});

/**
 * On a phone the words take the whole width and the marks and Save stand on a
 * row under them (owner, 2026-09-29). The shape itself is the stylesheet's —
 * `styles.test.ts` holds the grid areas and keeps them inside the phone's
 * media block — so what is held here is what the component owes it: the
 * attribute the layout keys on, the order the row is read in, the visible
 * height the cap is measured against, and the row opening under a typing hand
 * rather than snapping in. And, above all, that none of it touched the quick
 * path: a plain capture from the phone's bar still hands up `NO_CHOICE`.
 */
describe("on a phone, the words take the whole width", () => {
  function bar(onCapture = vi.fn()) {
    const { container } = render(
      <CaptureBar
        onCapture={onCapture}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
    return { onCapture, form: container.querySelector("form.capture") as HTMLFormElement };
  }

  function field(): HTMLTextAreaElement {
    return screen.getByLabelText("Write a note") as HTMLTextAreaElement;
  }

  /** A phone: under the width breakpoint, no hovering fine pointer, and no
   *  preference against motion. */
  function onAPhone() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 699px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  /** Web Animations, which jsdom does not have, as a spy. */
  function watchAnimations() {
    const calls: Array<{ el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }> = [];
    const proto = Element.prototype as unknown as { animate?: unknown };
    proto.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
      calls.push({ el: this, frames, opts });
      return { cancel: () => {}, onfinish: null, oncancel: null };
    };
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  it("marks the bar as holding words only while it does", () => {
    const { form } = bar();
    expect(form.hasAttribute("data-ready")).toBe(false);
    fireEvent.change(field(), { target: { value: "kahvia" } });
    expect(form.hasAttribute("data-ready")).toBe(true);
    fireEvent.change(field(), { target: { value: "   " } });
    expect(form.hasAttribute("data-ready")).toBe(false);
  });

  it("reads the words, then Add and the four marks, then Save at the row's end", () => {
    onAPhone();
    const { form } = bar();
    fireEvent.change(field(), { target: { value: "kahvia" } });
    const inFlow = [...form.children].filter((el) =>
      ["capture-field", "capture-marks", "capture-save"].some((c) => el.classList.contains(c)),
    );
    expect(inFlow.map((el) => el.className)).toEqual([
      "capture-field",
      "capture-marks",
      "capture-save",
    ]);
    expect(form.lastElementChild).toBe(screen.getByRole("button", { name: "Save note" }));
    const group = screen.getByRole("group", { name: "Save as" });
    expect([...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Add",
      "Important",
      "To-do",
      "Board",
      "Reminder",
    ]);
  });

  it("still hands a plain capture up with nothing chosen", () => {
    onAPhone();
    const { onCapture } = bar();
    fireEvent.change(field(), { target: { value: "osta maitoa" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("osta maitoa", NO_CHOICE);
  });

  it("opens the row under a typing hand, on the note-opening curve", () => {
    onAPhone();
    const calls = watchAnimations();
    bar();
    field().focus();
    fireEvent.change(field(), { target: { value: "k" } });
    const grown = calls.map((c) => c.el);
    expect(grown).toContain(screen.getByRole("group", { name: "Save as" }));
    expect(grown).toContain(screen.getByRole("button", { name: "Save note" }));
    for (const { el, frames, opts } of calls.filter((c) => grown.includes(c.el))) {
      if (!el.matches(".capture-marks, .capture-save")) continue;
      expect(frames[0]).toEqual({ height: "0px" });
      expect(opts).toMatchObject({ duration: OPEN_MS, easing: ENTER });
    }
    // Once, with the first letter — not again with every one after it.
    const rows = () => calls.filter((c) => c.el.matches(".capture-marks, .capture-save")).length;
    const before = rows();
    fireEvent.change(field(), { target: { value: "ka" } });
    expect(rows()).toBe(before);
  });

  it("does not move on its own when words arrive without a hand in the field", () => {
    onAPhone();
    const calls = watchAnimations();
    bar();
    fireEvent.change(field(), { target: { value: "kahvia" } });
    expect(calls.filter((c) => c.el.matches(".capture-marks, .capture-save"))).toHaveLength(0);
  });

  it("leaves a desktop bar alone: nothing opens, the marks stand beside the words", () => {
    // No matchMedia is jsdom's own answer, and jsdom's window is 1024 wide.
    const calls = watchAnimations();
    bar();
    field().focus();
    fireEvent.change(field(), { target: { value: "kahvia" } });
    expect(calls.filter((c) => c.el.matches(".capture-marks, .capture-save"))).toHaveLength(0);
  });

  it("carries the visible height for the cap to be measured against, and follows it", () => {
    const vv = Object.assign(new EventTarget(), { height: 480.4 });
    vi.stubGlobal("visualViewport", vv);
    const { form } = bar();
    expect(form.style.getPropertyValue("--visible-h")).toBe("480px");
    // The keyboard goes down.
    vv.height = 812;
    act(() => {
      vv.dispatchEvent(new Event("resize"));
    });
    expect(form.style.getPropertyValue("--visible-h")).toBe("812px");
  });
});

/**
 * The + panel holds the things the bar cannot do by typing: a file, and a
 * sketch. Draw stands above the two attach rows — position is the only
 * emphasis in a panel, nearest the thumb wins, and attaching keeps the bottom
 * of the panel as the established habit.
 */
describe("the Draw row", () => {
  function bar(onDraw = vi.fn()) {
    render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={onDraw}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
    return onDraw;
  }

  it("stands above the attach rows, and starts a sketch closing the panel", () => {
    const onDraw = bar();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Order is the claim: least-used at the top, the thumb at the bottom.
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent)).toEqual(["Draw", "Attachment"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Draw" }));
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Add" })).toBeNull();
  });

  it("keeps Add once there are words, with a picture able to join them, and no Draw", () => {
    const onDraw = bar();
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "fridge receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual(["Attachment"]);
    expect(onDraw).not.toHaveBeenCalled();
    expect((field as HTMLTextAreaElement).value).toBe("fridge receipt");
  });

  /**
   * One row, one picker, and the picker has to reach everything a note can
   * carry — so it states no `accept` at all. There was an `image/*` row beside
   * it for a while, because Android reads that attribute as "offer me image
   * sources" and gives the gallery rather than a list of filenames; it is
   * withdrawn, and this asserts the attribute rather than the label because a
   * narrowed `accept` here would silently cost PDFs, audio and everything else
   * while the row still read as fine.
   *
   * It may not take `capture` either: that asks for the camera, which is a
   * different act from attaching something the device already has.
   */
  it("gives the one row a picker that can reach anything", () => {
    bar();
    const inputs = [...document.querySelectorAll<HTMLInputElement>(`input[type="file"]`)];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].accept).toBe("");
    // Several photographs are one note.
    expect(inputs[0].multiple).toBe(true);
    expect(inputs[0].hasAttribute("capture")).toBe(false);
  });
});

/**
 * The bar used to empty itself the instant a file was handed over — before the
 * write had started, let alone succeeded. On a device with no room left that
 * meant the note was never made, no card appeared, no message was shown, and
 * the words the user had typed alongside the file were gone too. The cleared
 * field was the worst part: it is the app saying "saved", which is the one
 * thing it must not say when nothing was saved.
 */
describe("the field is emptied only for a capture that happened", () => {
  function barWith(onCaptureFiles: (files: File[], text: string) => Promise<boolean>) {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={onCaptureFiles}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
  }

  /** Picks a file the way the bar's own picker does, then presses Save. */
  async function attach(container: HTMLElement) {
    const picker = container.querySelector<HTMLInputElement>("input[type='file']")!;
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    fireEvent.change(picker);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    // The handler is async now; let its promise settle before asserting.
    await act(async () => {});
  }

  it("keeps what was typed, and the file, when the capture fails", async () => {
    const { container } = barWith(vi.fn().mockResolvedValue(false));
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "receipt for the tyres" } });

    await attach(container);

    expect(field.value).toBe("receipt for the tyres");
    expect(container.querySelector(".capture-line")?.textContent).toContain("1 picture attached");
  });

  it("clears it when the capture succeeds", async () => {
    const { container } = barWith(vi.fn().mockResolvedValue(true));
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "receipt for the tyres" } });

    await attach(container);

    expect(field.value).toBe("");
  });

  /**
   * The note is not made at once: the first PDF of a session waits on the
   * viewer's import and a photograph on its thumbnail, and the field is live
   * the whole time. What was typed in that gap went nowhere, so the clear that
   * follows the capture must not take it.
   */
  it("keeps what was typed while the file was still being taken in", async () => {
    let finish: (made: boolean) => void = () => {};
    const { container } = barWith(
      () => new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "receipt for the tyres" } });

    await attach(container);
    fireEvent.change(field, { target: { value: "receipt for the tyres, and call the garage" } });
    await act(async () => {
      finish(true);
    });

    expect(field.value).toBe("receipt for the tyres, and call the garage");
  });
});

/**
 * What was typed here and not yet saved survives the app being closed.
 *
 * An open note has written `body` on every keystroke since it was built, so a
 * tab Android kills mid-sentence costs at most the character still under the
 * finger. This bar was the exception, and it was the worst place for one: the
 * one field in the app where writing *starts* was the one field that kept the
 * only copy in memory until Save was pressed. A reload, a link that took the
 * window, or an eviction while the app sat in the background threw it away.
 *
 * These render the bar twice on purpose. A second mount over the same store is
 * what "the tab died and you opened the app again" actually looks like from
 * here, and it is the only assertion that proves anything durable happened.
 */
describe("a half-written capture", () => {
  function bar(overrides: Partial<Parameters<typeof CaptureBar>[0]> = {}) {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
        {...overrides}
      />,
    );
  }

  /**
   * Flush React's effects *and* the store behind them.
   *
   * `act` alone only settles the component: the draft write it starts is an
   * IndexedDB transaction, and awaiting a read of the same store is what puts
   * this in the queue behind it. Without that the assertions raced the write
   * they were making assertions about.
   */
  const write = async () => {
    await act(async () => {
      await readCaptureDraft();
    });
  };
  const field = () => screen.getByLabelText("Write a note") as HTMLTextAreaElement;

  beforeEach(async () => {
    await writeCaptureDraft("");
  });

  it("is still there when the app is opened again", async () => {
    bar();
    await write();
    fireEvent.change(field(), { target: { value: "the thought I had on the bus" } });
    await write();

    // The tab dies here. Nothing was saved as a note, and Save was never hit.
    cleanup();

    bar();
    await write();
    expect(field().value).toBe("the thought I had on the bus");
  });

  it("is cleared once the words have become a note", async () => {
    const onCapture = vi.fn();
    bar({ onCapture });
    await write();
    fireEvent.change(field(), { target: { value: "buy milk" } });
    await write();
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await write();
    expect(onCapture).toHaveBeenCalledWith("buy milk", NO_CHOICE);

    cleanup();
    bar();
    await write();
    expect(field().value).toBe("");
  });

  it("is cleared when the field is cleared by hand", async () => {
    bar();
    await write();
    fireEvent.change(field(), { target: { value: "never mind" } });
    await write();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await write();

    cleanup();
    bar();
    await write();
    expect(field().value).toBe("");
  });

  /** A capture that failed for want of room keeps the words on screen; the
   *  draft has to agree with the screen, or closing the app then loses them. */
  it("is kept when the capture did not happen", async () => {
    bar({ onCaptureFiles: vi.fn().mockResolvedValue(false) });
    await write();
    fireEvent.change(field(), { target: { value: "words riding along with a file" } });
    await write();

    cleanup();
    bar();
    await write();
    expect(field().value).toBe("words riding along with a file");
  });

  /**
   * One write per pause, not per letter (audit PERF-8) — and never at the cost
   * of the words: a page being hidden or left writes them at once.
   */
  it("writes after a pause in typing, not on every letter", async () => {
    bar();
    await write();
    fireEvent.change(field(), { target: { value: "half" } });
    await write();
    expect(await readCaptureDraft()).toBe("");
    await act(async () => {
      await new Promise((r) => setTimeout(r, DRAFT_WRITE_MS + 50));
    });
    await write();
    expect(await readCaptureDraft()).toBe("half");
  });

  it("writes at once when the page is hidden", async () => {
    bar();
    await write();
    fireEvent.change(field(), { target: { value: "going into a pocket" } });
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      state.mockRestore();
    }
    await write();
    expect(await readCaptureDraft()).toBe("going into a pocket");
  });

  it("writes at once when the page is left", async () => {
    bar();
    await write();
    fireEvent.change(field(), { target: { value: "reloading" } });
    window.dispatchEvent(new Event("pagehide"));
    await write();
    expect(await readCaptureDraft()).toBe("reloading");
  });

  /**
   * The restore is one tick of IndexedDB and a fast thumb can beat it. A new
   * thought must never be replaced by an old one.
   */
  it("does not overwrite a thought already being typed", async () => {
    await writeCaptureDraft("yesterday's half sentence");
    bar();
    // Before the read has resolved.
    fireEvent.change(field(), { target: { value: "something new" } });
    await write();
    expect(field().value).toBe("something new");
  });

  /**
   * The mirror of the same race: the empty string this component mounts with
   * must never be written over the draft it is in the middle of fetching.
   */
  it("does not erase the draft it is still fetching", async () => {
    await writeCaptureDraft("still here");
    bar();
    cleanup(); // torn down before the read could land
    await write();
    expect(await readCaptureDraft()).toBe("still here");
  });
});

/**
 * The lamp is furniture for the field, and furniture has to stay out of the
 * way in every sense: out of the accessibility tree, out of the tab order, and
 * incapable of catching the tap meant for the words underneath.
 *
 * What cannot be checked here is what it looks like — jsdom has no layout, so
 * `caretPoint` reads zeroes and no mask is ever rasterised. That is fine, and
 * is the point of splitting it this way: the *placement* is one measured
 * number from `lib/caret.ts`, and everything else about the effect is
 * declarative and lives in styles.css, where `styles.test.ts`'s "the film"
 * block holds it to DESIGN.md §2c.
 */
/**
 * Words arriving from outside the app — a page shared from the phone, or the
 * desktop bookmark (review 2026-10-04, FX-A-02 and FX-A-03) — wait in the field
 * unsaved, caret on a blank first line above them, so why it was kept can be
 * said before Save. Never saved on their own, and never over words already
 * being written.
 */
describe("words arriving from outside", () => {
  const write = async () => {
    await act(async () => {
      await readCaptureDraft();
    });
  };
  const field = () => screen.getByLabelText("Write a note") as HTMLTextAreaElement;

  function bar(incoming: IncomingWords | null, onCapture = vi.fn()) {
    return render(
      <CaptureBar
        onCapture={onCapture}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
        incoming={incoming}
      />,
    );
  }

  beforeEach(async () => {
    await writeCaptureDraft("");
  });

  it("lands under a blank first line holding the caret, unsaved, and is drafted", async () => {
    const taken = vi.fn();
    const onCapture = vi.fn();
    bar({ text: "A page\nhttps://example.com/a", taken }, onCapture);
    await write();
    await write();
    expect(field().value).toBe("\nA page\nhttps://example.com/a");
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(0);
    // The marks are offered at once, and nothing was saved.
    expect(screen.getByRole("button", { name: "Important" })).toBeTruthy();
    expect(onCapture).not.toHaveBeenCalled();
    // Spent only once it is safe in the draft.
    expect(await readCaptureDraft()).toBe("\nA page\nhttps://example.com/a");
    expect(taken).toHaveBeenCalledTimes(1);
  });

  it("saves on one press, the blank line gone", async () => {
    const onCapture = vi.fn();
    bar({ text: "https://example.com/b", taken: vi.fn() }, onCapture);
    await write();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCapture).toHaveBeenCalledWith("https://example.com/b", NO_CHOICE);
  });

  it("offers Inspiration beside Save only for words that arrived by a share, and saves into it with one tap", async () => {
    const onCapture = vi.fn();
    const taken = vi.fn();
    bar({ text: "https://example.com/p", taken, boardOffer: { id: "insp", name: "Inspiration" } }, onCapture);
    const offer = await screen.findByRole("button", { name: "Save to Inspiration" });
    fireEvent.click(offer);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toBe("https://example.com/p");
    expect(onCapture.mock.calls[0][1]).toMatchObject({ board: "insp", priority: false, todo: false, reminder: null });
    // saved: the field is empty again and the offer went with the words
    await act(async () => {});
    expect(field().value).toBe("");
    expect(screen.queryByRole("button", { name: /Save to/ })).toBeNull();
  });

  it("keeps the other marks the reader chose when the offer is taken", async () => {
    const onCapture = vi.fn();
    bar({ text: "https://example.com/p", taken: vi.fn(), boardOffer: { id: "insp", name: "Inspiration" } }, onCapture);
    await screen.findByRole("button", { name: "Save to Inspiration" });
    fireEvent.click(screen.getByRole("button", { name: "Important" }));
    fireEvent.click(screen.getByRole("button", { name: "Save to Inspiration" }));
    expect(onCapture.mock.calls[0][1]).toMatchObject({ board: "insp", priority: true });
  });

  // A picture pasted under the shared words waits for Save like any other;
  // the offer is a Save, so it takes the picture with the words, into the board.
  it("takes a file waiting in the bar with the words when the offer is taken", async () => {
    const onCapture = vi.fn();
    const onCaptureFiles = vi.fn().mockResolvedValue(true);
    const { container } = render(
      <CaptureBar
        onCapture={onCapture}
        onCaptureFiles={onCaptureFiles}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
        incoming={{ text: "https://example.com/p", taken: vi.fn(), boardOffer: { id: "insp", name: "Inspiration" } }}
      />,
    );
    await screen.findByRole("button", { name: "Save to Inspiration" });
    const file = new File(["bytes"], "shot.png", { type: "image/png" });
    fireEvent.paste(field(), { clipboardData: { files: [file], getData: () => "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inspiration" }));
    await act(async () => {});
    expect(onCapture).not.toHaveBeenCalled();
    expect(onCaptureFiles).toHaveBeenCalledTimes(1);
    expect(onCaptureFiles.mock.calls[0][0]).toEqual([file]);
    expect(onCaptureFiles.mock.calls[0][1]).toBe("https://example.com/p");
    expect(onCaptureFiles.mock.calls[0][2]).toMatchObject({ board: "insp" });
    // Nothing is left waiting, and the offer went with the words.
    expect(container.querySelector(".capture-line")?.textContent ?? "").not.toContain("attached");
    expect(field().value).toBe("");
    expect(screen.queryByRole("button", { name: /Save to/ })).toBeNull();
  });

  it("still saves exactly as it always did when the offer is left alone", async () => {
    const onCapture = vi.fn();
    bar({ text: "https://example.com/p", taken: vi.fn(), boardOffer: { id: "insp", name: "Inspiration" } }, onCapture);
    await screen.findByRole("button", { name: "Save to Inspiration" });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith(expect.any(String), NO_CHOICE);
  });

  it("does not offer it for words that were typed or for a share with nothing to file", async () => {
    bar(null);
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    expect(screen.queryByRole("button", { name: /Save to/ })).toBeNull();
    cleanup();
    bar({ text: "https://example.com/p", taken: vi.fn() });
    await screen.findByLabelText("Write a note");
    await write();
    expect(field().value).toContain("https://example.com/p");
    expect(screen.queryByRole("button", { name: /Save to/ })).toBeNull();
  });

  it("goes under a draft already being written, never over it", async () => {
    await writeCaptureDraft("my own half thought");
    const taken = vi.fn();
    bar({ text: "https://example.com/c", taken });
    await write();
    await write();
    expect(field().value).toBe("my own half thought\n\nhttps://example.com/c");
    expect(field().selectionStart).toBe("my own half thought".length);
    expect(taken).toHaveBeenCalledTimes(1);
  });
});

/**
 * While notes are selected the burger is the door to what can be done with
 * them, and the one place on the bar that says so: the number rides beside
 * the mark, the name says it for a reader, and `data-selecting` is what the
 * stylesheet inverts on. With nothing picked it is the plain menu button.
 */
describe("the burger while notes are selected", () => {
  function bar(selectedCount: number) {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        selectedCount={selectedCount}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
  }

  it("carries the count, and says it in its name", () => {
    bar(3);
    const burger = screen.getByRole("button", { name: "Menu, 3 selected" });
    expect(burger.getAttribute("data-selecting")).toBe("true");
    expect(burger.querySelector(".capture-tally")?.textContent).toBe("3");
    expect(burger.querySelector(".capture-tally")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is the plain menu button when nothing is picked", () => {
    bar(0);
    const burger = screen.getByRole("button", { name: "Menu" });
    expect(burger.hasAttribute("data-selecting")).toBe(false);
    expect(burger.querySelector(".capture-tally")).toBeNull();
  });
});

describe("the lamp stays out of the way", () => {
  function lit() {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
  }

  it("is drawn, hidden from readers, and unreachable by the pointer", () => {
    const { container } = lit();
    const lamp = container.querySelector(".capture-lamp");
    expect(lamp, "the field is lit").not.toBeNull();
    expect(lamp!.getAttribute("aria-hidden")).toBe("true");
    expect(lamp!.hasAttribute("tabindex")).toBe(false);
    expect(lamp!.textContent, "a light says nothing").toBe("");
  });

  it("carries every duration down from lib/motion.ts", () => {
    // styles.css holds exactly one duration custom property (--nav-mark-ms),
    // which styles.test.ts asserts. These therefore have to arrive from the
    // component, or motion.ts stops being the only copy of the number.
    const { container } = lit();
    const lamp = container.querySelector<HTMLElement>(".capture-lamp")!;
    expect(lamp.style.getPropertyValue("--lamp-follow")).toBe(`${LAMP_FOLLOW_MS}ms`);
    expect(lamp.style.getPropertyValue("--lamp-fade")).toBe(`${LAMP_FADE_MS}ms`);
    expect(lamp.style.getPropertyValue("--lamp-dim")).toBe(`${LAMP_DIM_MS}ms`);
  });

  it("takes much longer to go out than it takes to come back", () => {
    // The asymmetry is the whole of the effect, and it is the one thing about
    // the lamp's fade that a component test can hold: going out is something
    // the room does unwatched, coming back is a reply to a keystroke. If the
    // two are ever levelled again the fade-out reads as a switch, which is
    // exactly what this pair of numbers was split to end.
    expect(LAMP_DIM_MS).toBeGreaterThan(LAMP_FADE_MS * 2);
  });

  it("leaves none of what is being written in the measuring mirror", () => {
    // The mirror is `visibility: hidden` and never seen, but a second copy of
    // the user's sentence should not sit in the DOM between keystrokes for
    // anything else to find. lib/caret.ts empties it on the way out.
    const { container } = lit();
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "a private half-thought" } });
    const mirror = container.querySelector(".capture-mirror");
    expect(mirror, "the caret is measured through a mirror").not.toBeNull();
    expect(mirror!.textContent).toBe("");
  });
});

/**
 * The bar's one line about a note — "Saved … · Open" while an address in the
 * field is already in another note, and the app's receipt otherwise. Said,
 * never asked: nothing about saving changes while it is up.
 */
describe("the line about an address already saved", () => {
  const twin = note({
    id: "twin",
    body: "https://example.com/soup",
    created_at: new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString(),
  });
  const findSaved = (text: string) => (text.includes("example.com/soup") ? twin : null);

  function bar(overrides: Partial<Parameters<typeof CaptureBar>[0]> = {}) {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
        findSaved={findSaved}
        onOpenSaved={vi.fn()}
        {...overrides}
      />,
    );
  }
  const line = () => document.querySelector(".capture-line");

  it("appears with the address, and goes with it", () => {
    bar();
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "soup www.example.com/soup" } });
    expect(line()?.textContent).toMatch(/Saved 3 days ago/);
    fireEvent.change(field, { target: { value: "soup" } });
    expect(line()).toBeNull();
  });

  it("opens the saved note", () => {
    const onOpenSaved = vi.fn();
    bar({ onOpenSaved });
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "https://example.com/soup" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Open/ }));
    expect(onOpenSaved).toHaveBeenCalledWith(twin);
  });

  it("blocks nothing: Enter still saves the new note, and the line goes with the words", () => {
    const onCapture = vi.fn();
    bar({ onCapture });
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "https://example.com/soup" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCapture).toHaveBeenCalledWith("https://example.com/soup", NO_CHOICE);
    expect(line()).toBeNull();
  });

  it("wins over the app's receipt while there is one, and gives it back after", () => {
    bar({ line: { key: "landed:x", said: "In Inbox", verb: "Go", act: vi.fn() } });
    expect(line()?.textContent).toMatch(/In Inbox/);
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "https://example.com/soup" } });
    expect(line()?.textContent).toMatch(/Saved/);
    fireEvent.change(field, { target: { value: "" } });
    expect(line()?.textContent).toMatch(/In Inbox/);
  });
});

/**
 * Save turns into the menu the moment the note is saved, in the same corner —
 * so a quick double tap on Save opened the menu (review 2026-10-01, UX-30).
 */
describe("the corner after a save", () => {
  function bar(onMenu = vi.fn(), onCapture = vi.fn()) {
    render(
      <CaptureBar
        onCapture={onCapture}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        selectedCount={0}
        onMenu={onMenu}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
    return { onMenu, onCapture };
  }

  it("ignores a tap on the menu straight after Save, and takes one a moment later", () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const { onMenu, onCapture } = bar();
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
      const save = screen.getByRole("button", { name: "Save note" });
      fireEvent.pointerDown(save, { pointerId: 1, pointerType: "touch" });
      fireEvent.click(save);
      expect(onCapture).toHaveBeenCalledTimes(1);
      // The second tap of a double tap lands on the menu that replaced Save.
      now += 150;
      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      expect(onMenu).not.toHaveBeenCalled();
      now += 1000;
      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      expect(onMenu).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("refuses the second click of a mouse double click on Save", () => {
    const { onMenu } = bar();
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }), { detail: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }), { detail: 2 });
    expect(onMenu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }), { detail: 1 });
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("draws Save as an arrow, not a page with a down arrow", () => {
    bar();
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    const save = screen.getByRole("button", { name: "Save note" });
    // The heroicons arrow-up path; the document-arrow-down had a page outline.
    expect(save.querySelector("path")?.getAttribute("d")).toBe("M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18");
  });
});

/**
 * A file picked or pasted into the bar waits for Save (2026-10-12, owner): it
 * used to become a note the moment the picker closed, before a word could be
 * typed to say why it was kept.
 */
describe("a file picked in the bar waits for Save", () => {
  function bar(overrides: Partial<Parameters<typeof CaptureBar>[0]> = {}) {
    return render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
        {...overrides}
      />,
    );
  }
  function pick(container: HTMLElement, ...files: File[]) {
    const picker = container.querySelector<HTMLInputElement>("input[type='file']")!;
    Object.defineProperty(picker, "files", { value: files, configurable: true });
    fireEvent.change(picker);
  }
  const photo = () => new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

  it("makes nothing until Save, says what is waiting, and saves it with the words", async () => {
    const onCaptureFiles = vi.fn().mockResolvedValue(true);
    const { container } = bar({ onCaptureFiles });
    const file = photo();
    pick(container, file);
    await act(async () => {});

    expect(onCaptureFiles).not.toHaveBeenCalled();
    expect(container.querySelector(".capture-line")?.textContent).toContain("1 picture attached");
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "the new rod" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await act(async () => {});

    expect(onCaptureFiles).toHaveBeenCalledOnce();
    expect(onCaptureFiles).toHaveBeenCalledWith([file], "the new rod", NO_CHOICE);
    expect(field.value).toBe("");
    expect(container.querySelector(".capture-line")).toBeNull();
  });

  it("offers Save with no words at all, and saves the file alone", async () => {
    const onCaptureFiles = vi.fn().mockResolvedValue(true);
    const { container } = bar({ onCaptureFiles });
    const file = photo();
    pick(container, file);
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await act(async () => {});

    expect(onCaptureFiles).toHaveBeenCalledWith([file], "", NO_CHOICE);
  });

  it("lets Remove drop what is waiting, and makes nothing", async () => {
    const onCaptureFiles = vi.fn().mockResolvedValue(true);
    const { container } = bar({ onCaptureFiles });
    pick(container, photo(), new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
    expect(container.querySelector(".capture-line")?.textContent).toContain("2 files attached");

    fireEvent.click(screen.getByRole("button", { name: "Remove: 2 files attached" }));

    expect(container.querySelector(".capture-line")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save note" })).toBeNull();
    expect(onCaptureFiles).not.toHaveBeenCalled();
  });

  it("holds a pasted picture too, keeping the clipboard's words", async () => {
    const onCaptureFiles = vi.fn().mockResolvedValue(true);
    const { container } = bar({ onCaptureFiles });
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    const file = photo();
    fireEvent.paste(field, {
      clipboardData: { files: [file], getData: () => "a chart from the sheet" },
    });

    expect(onCaptureFiles).not.toHaveBeenCalled();
    expect(field.value).toBe("a chart from the sheet");
    expect(container.querySelector(".capture-line")?.textContent).toContain("1 picture attached");
  });
});

/*
 * The board mark draws the folder's own glyph, chosen or merely where the note
 * goes by default, and the folder when the board has none: solid once a board
 * is chosen, the outline (with its flap) when it is only the default.
 */
describe("the board mark's glyph", () => {
  // Loaded ahead, as NoteCard's test does: the Heroicons set is the slowest
  // module in the app to transform, and the test measures only what it draws.
  beforeAll(async () => {
    await import("../lib/iconSet");
  }, 120_000);

  it("is the folder's own mark, else the solid or the outline folder", async () => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useBoardIcons } = await import("./BoardLook");
    const loaded = renderHook(() => useBoardIcons(["BookOpenIcon"]));
    await waitFor(() => expect(loaded.result.current).toBe(true), { timeout: 10_000 });
    const boards = [
      { id: "b1", name: "Books", position: 0, icon: "BookOpenIcon" },
      { id: "b2", name: "Plain", position: 1 },
    ];
    const draw = (here: string) =>
      render(
        <CaptureBar
          onCapture={vi.fn()}
          onCaptureFiles={vi.fn().mockResolvedValue(true)}
          onDraw={vi.fn()}
          menuOpen={false}
          onMenu={vi.fn()}
          boards={boards}
          onCreateBoard={vi.fn()}
          here={here}
        />,
      );
    const svg = () => screen.getByRole("button", { name: /^Board/ }).querySelector("svg")!;

    draw("b1");
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    expect(svg().getAttribute("class")).toBe("icon icon-inline");
    const glyph = svg().innerHTML;
    cleanup();

    draw("b2");
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    expect(svg().querySelector(".icon-folder-flap")).toBeTruthy();
    // Chosen: the same glyph for a dressed board, the solid folder for a plain one.
    fireEvent.click(screen.getByRole("button", { name: "Board: Plain" }));
    fireEvent.click(screen.getByRole("button", { name: "Books" }));
    expect(svg().getAttribute("class")).toBe("icon icon-inline");
    expect(svg().innerHTML).toBe(glyph);
    fireEvent.click(screen.getByRole("button", { name: "Board: Books" }));
    fireEvent.click(screen.getByRole("button", { name: "Plain" }));
    expect(svg().querySelector(".icon-folder-flap")).toBeNull();
    expect(svg().innerHTML).not.toBe(glyph);
  }, 20_000);
});

/** The empty field names the place a capture will land (joy review 2026-10-14, #7). */
describe("the empty field knows where it is", () => {
  function bar(extra: Partial<Parameters<typeof CaptureBar>[0]> = {}) {
    render(
      <CaptureBar
        onCapture={vi.fn()}
        onCaptureFiles={vi.fn().mockResolvedValue(true)}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[
          { id: "f1", name: "Recipes", position: 0 },
          { id: "i1", name: "Inspiration", position: 1, kind: "inspiration" },
        ]}
        onCreateBoard={vi.fn()}
        {...extra}
      />,
    );
    return screen.getByLabelText("Write a note").getAttribute("placeholder");
  }
  it("says Write… on the Inbox", () => expect(bar()).toBe("Write…"));
  it("names the folder it is standing in", () => expect(bar({ here: "f1" })).toBe("Write into Recipes…"));
  it("takes pasting on Inspiration", () => expect(bar({ here: "i1" })).toBe("Paste or write…"));
  it("speaks of a to-do on Todos", () => expect(bar({ onTodos: true })).toBe("Write a to-do…"));
});

/** A board chosen and then taken away (the undo of making it) is no choice at all. */
describe("a chosen board that goes away", () => {
  it("lets the mark go back to unasked, and a save asks for nothing", () => {
    const onCapture = vi.fn();
    const props = {
      onCapture,
      onCaptureFiles: vi.fn().mockResolvedValue(true),
      onDraw: vi.fn(),
      menuOpen: false,
      onMenu: vi.fn(),
      onCreateBoard: vi.fn(),
    };
    const { rerender } = render(
      <CaptureBar {...props} boards={[{ id: "b1", name: "Kitchen", position: 0 }]} />,
    );
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "kahvia" } });
    fireEvent.click(screen.getByRole("button", { name: "Board", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Kitchen" }));
    expect(screen.getByRole("button", { name: "Board: Kitchen" }).getAttribute("aria-pressed")).toBe("true");

    rerender(<CaptureBar {...props} boards={[]} />);
    expect(screen.getByRole("button", { name: "Board", exact: true }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onCapture).toHaveBeenCalledWith("kahvia", NO_CHOICE);
  });
});
