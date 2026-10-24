// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { bookmarklet, takeLaunchIntent, takeLaunchText } from "./launch";

/**
 * The launcher shortcut's half of the bargain. The other half is the manifest
 * (`publicIcons.test.ts` holds it to a URL this file can actually read) and
 * `App.capture.test.tsx`, which checks that the caret really lands.
 */

const at = (url: string) => window.history.replaceState({}, "", url);
const here = () => window.location.pathname + window.location.search;

beforeEach(() => at("/"));

describe("why the app was opened", () => {
  it("hears the shortcut, and takes it back out of the address bar", () => {
    at("/?do=capture");
    expect(takeLaunchIntent()).toBe("capture");
    expect(here()).toBe("/");
  });

  it("answers once — a reload weeks later is an ordinary open", () => {
    at("/?do=capture");
    takeLaunchIntent();
    expect(takeLaunchIntent()).toBeNull();
  });

  it("says nothing on an ordinary open, and leaves the address bar alone", () => {
    at("/?note=abc");
    expect(takeLaunchIntent()).toBeNull();
    expect(here()).toBe("/?note=abc");
  });

  /**
   * A shortcut installed from a newer manifest than this build. The app cannot
   * do it, so it does nothing — but it still clears the parameter, or a reload
   * asks the same unanswerable question again.
   */
  it("refuses a word it does not know, and still clears it", () => {
    at("/?do=teleport");
    expect(takeLaunchIntent()).toBeNull();
    expect(here()).toBe("/");
  });

  /**
   * `?note=` and `?shared=1` both clear the whole query when they are done
   * with it, which is safe only while nothing else is ever in it. This one
   * puts the rest back instead, so it can never be the reader that ate
   * somebody else's parameter.
   */
  it("keeps the rest of the query", () => {
    at("/?note=abc&do=capture&shared=1");
    expect(takeLaunchIntent()).toBe("capture");
    expect(here()).toBe("/?note=abc&shared=1");
  });
  // Review 2026-10-04, FX-A-03: the desktop bookmark. The words are handed to
  // the field and nothing else, once, and leave the address bar with the intent.
  it("hands over the words a bookmark brought, once, and clears them", () => {
    at("/?do=capture&text=" + encodeURIComponent("A page\nhttps://example.com/x\nthe bit I selected"));
    expect(takeLaunchIntent()).toBe("capture");
    expect(here()).toBe("/");
    expect(takeLaunchText()).toBe("A page\nhttps://example.com/x\nthe bit I selected");
    expect(takeLaunchText()).toBeNull();
  });

  it("ignores words that come without the capture intent", () => {
    at("/?text=sneaky");
    expect(takeLaunchIntent()).toBeNull();
    expect(takeLaunchText()).toBeNull();
    at("/?do=teleport&text=sneaky");
    expect(takeLaunchIntent()).toBeNull();
    expect(takeLaunchText()).toBeNull();
    expect(here()).toBe("/");
  });

  it("writes the bookmark against the app's own address", () => {
    const href = bookmarklet("https://spar.example");
    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).toContain("https://spar.example/?do=capture&text=");
    expect(href).toContain("encodeURIComponent(document.title+'\\n'+location.href+'\\n'+String(getSelection()))");
  });
});
