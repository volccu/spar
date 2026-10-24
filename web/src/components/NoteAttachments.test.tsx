// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../types";

const fetchFile = vi.fn();
const passingBytes = vi.fn();
let refused = false;
/** What `useFileUrl` answers, and how far each file asked it to reach. */
let fileUrl: { url: string | null; missing: boolean } = { url: null, missing: true };
const reaches: string[] = [];

vi.mock("../store/useFileUrl", () => ({
  useFileUrl: (_att: unknown, reach: string) => {
    reaches.push(reach);
    return fileUrl;
  },
}));
vi.mock("../store/attachments", () => ({
  fetchFile: (...args: unknown[]) => fetchFile(...args),
  passingBytes: (...args: unknown[]) => passingBytes(...args),
  sendAgain: () => {
    refused = false;
  },
  uploadRefused: () => refused,
  watchRefusals: () => () => {},
}));

import { NoteAttachments, carrying } from "./NoteAttachments";
import { canPreview } from "../lib/files";

afterEach(() => {
  cleanup();
  refused = false;
  fileUrl = { url: null, missing: true };
  reaches.length = 0;
  vi.clearAllMocks();
});

const file = (over: Partial<Attachment> = {}): Attachment => ({
  id: "a1",
  name: "photo.jpg",
  mime: "image/jpeg",
  size: 1024,
  width: 100,
  height: 100,
  thumb: "data:image/jpeg;base64,xx",
  path: "u/n/a1",
  added_at: "2026-10-10T10:00:00.000Z",
  ...over,
});

/** The note's files, split the way NoteView splits them: what opens is a square. */
function showAll(atts: Attachment[], onRequestRemove: (att: Attachment) => void = () => {}) {
  return render(
    <NoteAttachments
      attachments={atts}
      tiles={atts.filter(canPreview)}
      rows={atts.filter((att) => !canPreview(att))}
      onRequestRemove={onRequestRemove}
      onOpenPreview={() => {}}
    />,
  );
}

function show(att: Attachment) {
  return showAll([att]);
}

describe("an attachment row", () => {
  /** Audit BUG-6: a file already on the server is not "on the other device". */
  it("says it could not fetch a file the server holds, not that the other device has it", () => {
    show(file());
    expect(screen.getByText("not reachable now")).toBeTruthy();
    expect(screen.queryByText("still on the other device")).toBeNull();
  });

  it("still says the other device has a file that was never sent", () => {
    show(file({ path: null }));
    expect(screen.getByText("still on the other device")).toBeTruthy();
  });

  it("says so when Save could not fetch the file", async () => {
    fetchFile.mockResolvedValue(null);
    show(file({ id: "z", name: "notes.zip", mime: "application/zip", thumb: null }));
    expect(screen.queryByText("not reachable now")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save notes.zip" }));
    await waitFor(() => expect(screen.getByText("not reachable now")).toBeTruthy());
  });

  /** Audit BUG-2: a refused file says so and can be sent again. */
  it("says the server would not take a refused file, and offers to send it again", () => {
    refused = true;
    show(file({ path: null, id: "big", name: "holiday.mp4", mime: "video/mp4", thumb: null }));
    expect(screen.getByText("the server would not take this file")).toBeTruthy();
    expect(screen.queryByLabelText("Sending")).toBeNull();
    expect(screen.getByRole("button", { name: "send again" })).toBeTruthy();
  });
});

/**
 * A saved file's address outlives a slow phone's save: a minute from its own
 * click, as every save in the app now is (`lib/saveFile.ts`). The rows and
 * Save all used to free it after eight seconds.
 */
describe("saving a note's files", () => {
  const zip = (id: string) => file({ id, name: `${id}.zip`, mime: "application/zip", thumb: null });
  let made: ReturnType<typeof vi.fn>;
  let freed: ReturnType<typeof vi.fn>;
  const real = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

  function stubUrls() {
    let n = 0;
    made = vi.fn(() => `blob:file-${++n}`);
    freed = vi.fn();
    URL.createObjectURL = made as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = freed as unknown as typeof URL.revokeObjectURL;
    // jsdom cannot follow a download link; the click is all this needs.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = real.create;
    URL.revokeObjectURL = real.revoke;
  });

  it("keeps a row's saved address for a minute, not eight seconds", async () => {
    stubUrls();
    fetchFile.mockResolvedValue(new Blob(["z"]));
    show(zip("one"));
    fireEvent.click(screen.getByRole("button", { name: "Save one.zip" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(made).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(freed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(52_000);
    expect(freed).toHaveBeenCalledWith("blob:file-1");
  });

  it("keeps every address Save all makes for a minute from its own click", async () => {
    stubUrls();
    fetchFile.mockResolvedValue(new Blob(["z"]));
    const both = [zip("one"), zip("two")];
    showAll(both);
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(made).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(freed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(52_000);
    expect(freed).toHaveBeenCalledTimes(2);
  });
});

/** The open note's files under the words, as small squares (owner, 2026-10-17). */
describe("the files under a note's words", () => {
  const pic = (id: string, over: Partial<Attachment> = {}) => file({ id, name: `${id}.png`, mime: "image/png", ...over });

  it("says what the note carries in one line", () => {
    expect(carrying([pic("a")])).toBe("1 picture · 1 KB");
    expect(carrying([pic("a"), pic("b"), file({ id: "z", name: "z.zip", mime: "application/zip", size: 2048 })])).toBe(
      "2 pictures · 1 file · 4 KB",
    );
    expect(carrying([file({ id: "z", name: "z.zip", mime: "application/zip" })])).toBe("1 file · 1 KB");
  });

  it("draws a picture as a square with no name, Save or Remove on it", () => {
    fileUrl = { url: "blob:here", missing: false };
    const { container } = showAll([pic("a"), pic("b")]);
    expect(container.querySelectorAll(".attach-tile")).toHaveLength(2);
    expect(screen.getByLabelText("View a.png")).toBeTruthy();
    expect(screen.queryByText("a.png")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove a.png" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save a.png" })).toBeNull();
    expect(screen.getByText("2 pictures · 2 KB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save all" })).toBeTruthy();
  });

  it("offers no Save all for one file", () => {
    fileUrl = { url: "blob:here", missing: false };
    showAll([pic("a")]);
    expect(screen.queryByRole("button", { name: "Save all" })).toBeNull();
  });

  /** A small square needs no more than a card does; the viewer fetches the rest. */
  it("reads only this device's card-sized copy for a picture drawn small, and fetches a lone one", () => {
    fileUrl = { url: null, missing: false };
    showAll([pic("a"), pic("b")]);
    expect(reaches).toEqual(expect.arrayContaining(["card"]));
    expect(reaches).not.toContain("any");
    cleanup();
    reaches.length = 0;
    showAll([pic("a")]);
    expect(reaches).toContain("any");
  });

  it("still fetches a picture that has no thumbnail to draw", () => {
    fileUrl = { url: null, missing: false };
    showAll([pic("a", { thumb: null }), pic("b")]);
    expect(reaches).toContain("any");
  });

  /** With no × on the square, a picture with a problem is named — and removable — under the grid. */
  it("names a picture whose bytes have a problem under the grid, with a way to remove it", async () => {
    fileUrl = { url: null, missing: true };
    const asked = vi.fn();
    const { container } = showAll([pic("a", { path: null, thumb: null }), pic("b")], asked);
    await waitFor(() => expect(screen.getByText("still on the other device")).toBeTruthy());
    expect(screen.getByText("a.png")).toBeTruthy();
    expect(container.querySelector('.attach-tile[data-warn="true"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  /** Not on this device is not missing: the server has it, and the viewer fetches it. */
  it("says nothing about a small square whose bytes are only on the server", () => {
    fileUrl = { url: null, missing: true };
    showAll([pic("a"), pic("b")]);
    expect(screen.queryByText("not reachable now")).toBeNull();
    expect(screen.queryByText("still on the other device")).toBeNull();
  });

  it("gives a lone document a square, not the whole measure", () => {
    fileUrl = { url: null, missing: false };
    const { container } = showAll([file({ id: "d", name: "report.pdf", mime: "application/pdf" })]);
    expect(container.querySelector(".attach-grid")!.hasAttribute("data-one")).toBe(false);
    expect(container.querySelector('img[data-doc="true"]')).toBeTruthy();
  });

  it("keeps Save and Remove on the row of a file that does not open", () => {
    fileUrl = { url: "blob:here", missing: false };
    showAll([file({ id: "z", name: "notes.zip", mime: "application/zip", thumb: null })]);
    expect(screen.getByRole("button", { name: "Save notes.zip" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove notes.zip" })).toBeTruthy();
  });
});
