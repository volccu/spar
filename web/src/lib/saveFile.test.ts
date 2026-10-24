// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OBJECT_URL_TTL_MS, passingUrl, saveBlob, saveHref } from "./saveFile";

let made = 0;
const create = vi.fn(() => `blob:made-${++made}`);
const revoke = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  create.mockClear();
  revoke.mockClear();
});

describe("saving a file", () => {
  /**
   * One length for every address the app hands the browser to save from.
   * Lightbox used 8 s where Settings and the sign-in screen used 60 s, and a
   * save on a slow phone can still be reading the address after 8 s.
   */
  it("keeps an address alive for a minute", () => {
    expect(OBJECT_URL_TTL_MS).toBe(60_000);
    const url = passingUrl(new Blob(["x"]));
    expect(url).toBe(`blob:made-${made}`);
    vi.advanceTimersByTime(8_001);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OBJECT_URL_TTL_MS - 8_001);
    expect(revoke).toHaveBeenCalledWith(url);
  });

  it("hands the browser an anchor named for the file, and leaves nothing behind in the page", () => {
    const seen: { href: string; download: string; rel: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ href: this.href, download: this.download, rel: this.rel, attached: this.isConnected });
    });
    saveHref("blob:somewhere", "notes.zip");
    expect(seen).toEqual([{ href: "blob:somewhere", download: "notes.zip", rel: "noopener", attached: true }]);
    expect(document.querySelector("a")).toBeNull();
  });

  it("saves bytes through an address of its own, given back after the minute", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    saveBlob(new Blob(["x"]), "film.mp4");
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(OBJECT_URL_TTL_MS);
    expect(revoke).toHaveBeenCalledWith(`blob:made-${made}`);
  });
});
