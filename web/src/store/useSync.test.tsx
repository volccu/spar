// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types";

/**
 * The sync loop itself, which had no tests: the order the four halves run in,
 * which failures may stop which, and what a change landing mid-flight does.
 *
 * Both HIGH findings of the 2026-09-06 audit lived in the gap between "the
 * tick started" and "the row landed", and neither the order below nor the
 * raise-last rule was written down anywhere a test could hold it. The four
 * collaborators are scripted per case and every call is recorded, so a case
 * can say not only what the loop concluded but what it did on the way.
 */

/** Every collaborator call, in order. */
let calls: string[] = [];
let uploaded: Note[] = [];
let uploadFailed: Error | null = null;
let pulled: Note[] = [];
let refused: Error | null = null;
/** False when the tick could not read the notes themselves. */
let notesPulled: boolean | undefined;
let canvasThrows: Error | null = null;
/** What the canvas half hands back: a refusal, and canvases it holds. */
let canvasRefused: Error | null = null;
let canvasHeld: { id: string; stamp: string; message: string; count: number }[] = [];
let prefsThrows: Error | null = null;
/** When set, `syncOnce` waits here until `release()` — a tick held open. */
let hold = false;
let release: (() => void) | null = null;
/** What the combined pull answers this tick, and what each half was handed. */
let ahead: unknown = null;
/** When set, the combined pull fails instead of answering. */
let aheadThrows: Error | null = null;
/** What the tick reports as held, and what the two ways out did. */
let heldFromTick: { id: string; stamp: string; message: string; count: number }[] = [];
let forgotten: string[] = [];
let droppedFromOutbox: { id: string; stamp: string }[] = [];
/** The same two ways out, as they reached the canvases' book and outbox. */
let forgottenCanvases: string[] = [];
let droppedCanvases: { id: string; stamp: string }[] = [];
/** What the canvases' outbox holds when "keep here only" reads it. */
let canvasOutbox: { id: string; stamp: string }[] = [];
let received: { notes?: unknown; canvases?: unknown; prefs?: unknown } = {};

vi.mock("./attachments", () => ({
  uploadPending: async () => {
    calls.push("files");
    return { uploaded, failed: uploadFailed };
  },
}));
vi.mock("./pullChanges", () => ({
  pullChanges: async () => {
    calls.push("ahead");
    if (aheadThrows) throw aheadThrows;
    return ahead;
  },
}));
vi.mock("./sync", () => ({
  syncOnce: async (_local: Note[], given: unknown) => {
    calls.push("notes");
    received.notes = given;
    if (hold) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return { pushed: 0, pulled, refused, held: heldFromTick, notesPulled };
  },
}));
vi.mock("./canvasSync", () => ({
  serverKnowsCanvases: async () => false,
  syncCanvasesOnce: async (_folders: unknown, given: unknown) => {
    calls.push("canvases");
    received.canvases = given;
    if (canvasThrows) throw canvasThrows;
    return { pushed: 0, pulled: [], refused: canvasRefused, held: canvasHeld };
  },
}));
vi.mock("./boardSync", () => ({
  syncBoardsOnce: async (_local: unknown, given: unknown) => {
    calls.push("prefs");
    received.prefs = given;
    if (prefsThrows) throw prefsThrows;
    return { pushed: false, pulled: null };
  },
}));
// No client: the realtime channels stand down, and nothing here needs them.
vi.mock("./supabase", () => ({ getSupabase: async () => null, syncConfigured: true }));
vi.mock("./held", () => ({
  HELD_CANVASES: "heldCanvases",
  clearRefusals: async (ids: string[], key?: string) => {
    (key === "heldCanvases" ? forgottenCanvases : forgotten).push(...ids);
  },
}));
vi.mock("./db", () => ({
  clearDirtySent: async (sent: { id: string; stamp: string }[]) => {
    droppedFromOutbox.push(...sent);
  },
  dirtyCanvasEntries: async () => canvasOutbox,
  clearCanvasDirtySent: async (sent: { id: string; stamp: string }[]) => {
    droppedCanvases.push(...sent);
  },
}));
vi.mock("../components/SyncMark", () => ({ MIN_WORKING_MS: 50 }));

import { useSync } from "./useSync";
import { note as base } from "../test/fixtures";

const note = (id: string): Note =>
  base({
    id,
    raw_content: id,
    body: id,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  });


function loop(localVersion = 0) {
  const applyRemote = vi.fn();
  const applyUploaded = vi.fn();
  const canvas = { folders: [], version: 0, applyRemote: vi.fn() };
  const prefs = {
    boards: [],
    inboxSince: null,
    at: "2026-09-01T00:00:00.000Z",
    dirty: false,
    sinceDirty: false,
    version: 0,
    applyRemote: vi.fn(),
    clearDirty: vi.fn(),
  };
  const hook = renderHook(
    ({ version }) =>
      useSync({
        enabled: true,
        notes: [note("a")],
        applyRemote,
        applyUploaded,
        localVersion: version,
        canvas,
        prefs,
      }),
    { initialProps: { version: localVersion } },
  );
  return { ...hook, applyRemote, applyUploaded, canvas, prefs };
}

/** The tick has run to its end, whichever way it ended. */
async function settled(result: { current: { busy: boolean } }) {
  await waitFor(() => expect(result.current.busy).toBe(true));
  await waitFor(() => expect(result.current.busy).toBe(false));
}

beforeEach(() => {
  calls = [];
  uploaded = [];
  uploadFailed = null;
  pulled = [];
  refused = null;
  notesPulled = undefined;
  canvasThrows = null;
  canvasRefused = null;
  canvasHeld = [];
  prefsThrows = null;
  hold = false;
  release = null;
  ahead = null;
  aheadThrows = null;
  received = {};
  heldFromTick = [];
  forgotten = [];
  droppedFromOutbox = [];
  forgottenCanvases = [];
  droppedCanvases = [];
  canvasOutbox = [];
});

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("the combined pull", () => {
  it("is asked first, and its answer is handed to all three halves", async () => {
    const folders = { rows: [], cursor: null, complete: true };
    const prefs = { boards: [], at: "2026-09-01T00:00:00.000Z", inboxSince: null };
    ahead = { notes: { rows: [], cursor: null, complete: true }, tombstones: folders, folders, prefs };
    const { result } = loop();
    await settled(result);

    expect(calls[0]).toBe("ahead");
    expect(received.notes).toBe(ahead);
    expect(received.canvases).toBe(folders);
    expect(received.prefs).toBe(prefs);
  });

  it("leaves each half to read for itself on a server that has no such function", async () => {
    ahead = null;
    const { result } = loop();
    await settled(result);

    expect(received.notes).toBeNull();
    expect(received.canvases).toBeUndefined();
    expect(received.prefs).toBeUndefined();
  });
});

describe("one tick", () => {
  it("runs notes, then files, then canvases, then the folder list, and settles idle", async () => {
    const { result } = loop();
    await settled(result);
    expect(calls).toEqual(["ahead", "notes", "files", "canvases", "prefs"]);
    expect(result.current.lastError).toBeNull();
    await waitFor(() => expect(result.current.state).toBe("idle"));
  });

  it("applies what arrived even when a note was refused, and says so afterwards", async () => {
    pulled = [note("from-the-phone")];
    refused = new Error("row refused");
    const { result, applyRemote } = loop();
    await settled(result);
    expect(applyRemote).toHaveBeenCalledWith(pulled);
    // Refused or not, the halves after the notes still ran.
    expect(calls).toEqual(["ahead", "notes", "files", "canvases", "prefs"]);
    expect(result.current.state).toBe("error");
    expect(result.current.lastError).toBe("row refused");
  });

  it("lets a refused file stop nothing, and raises it last", async () => {
    uploadFailed = new Error("bucket says no");
    const { result } = loop();
    await settled(result);
    expect(calls).toEqual(["ahead", "notes", "files", "canvases", "prefs"]);
    expect(result.current.state).toBe("error");
    expect(result.current.lastError).toBe("bucket says no");
  });

  /**
   * The combined pull's failure is recorded first, and the files that follow
   * used to overwrite the record with their own answer — `null` when they went
   * up fine — so a tick whose pull had failed settled as a clean one.
   */
  it("keeps a failed combined pull on the record when the files beside it went up fine", async () => {
    aheadThrows = new Error("pull_changes timed out");
    const { result } = loop();
    await settled(result);
    expect(calls).toEqual(["ahead", "notes", "files", "canvases", "prefs"]);
    expect(result.current.state).toBe("error");
    expect(result.current.lastError).toBe("pull_changes timed out");
  });

  it("lets a canvas failure stop nothing after it, and raises it last", async () => {
    canvasThrows = new Error("folders table missing");
    const { result } = loop();
    await settled(result);
    expect(calls).toEqual(["ahead", "notes", "files", "canvases", "prefs"]);
    expect(result.current.lastError).toBe("folders table missing");
  });

  it("raises a canvas the server refused last, after everything else ran", async () => {
    canvasRefused = new Error("canvas c1: violates foreign key constraint");
    const { result } = loop();
    await settled(result);
    expect(calls).toEqual(["ahead", "notes", "files", "canvases", "prefs"]);
    expect(result.current.state).toBe("error");
    expect(result.current.lastError).toBe("canvas c1: violates foreign key constraint");
  });

  it("reports a refused note ahead of anything that went wrong beside it", async () => {
    refused = new Error("row refused");
    uploadFailed = new Error("bucket says no");
    prefsThrows = new Error("prefs refused");
    const { result } = loop();
    await settled(result);
    expect(result.current.lastError).toBe("row refused");
  });

  it("goes back to idle, with the error cleared, the tick after one that failed", async () => {
    refused = new Error("row refused");
    const { result } = loop();
    await settled(result);
    expect(result.current.lastError).toBe("row refused");

    refused = null;
    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.lastError).toBeNull();
    await waitFor(() => expect(result.current.state).toBe("idle"));
  });
});

/**
 * A server that is down fails every tick; going back to "working" at the start
 * of each retry flickered the failure into "Syncing" about half the time
 * (review CD-01). The failure stands until a tick comes round clean.
 */
describe("a failure that keeps failing", () => {
  it("stays a failure while the next tick is in flight", async () => {
    refused = new Error("upstream answered 502");
    const { result } = loop();
    await settled(result);
    expect(result.current.state).toBe("error");

    hold = true;
    release = null;
    await act(async () => {
      void result.current.syncNow();
    });
    await waitFor(() => expect(release).not.toBeNull());
    expect(result.current.busy).toBe(true);
    expect(result.current.state).toBe("error");

    hold = false;
    refused = null;
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(result.current.state).toBe("idle"));
  });
});

/**
 * A phone with its mobile data and SIM off can still say `navigator.onLine`
 * (2026-10-23), so a tick that got no answer at all is the device offline —
 * which is what draws the creature's static — not a sync that failed.
 */
describe("no answer at all", () => {
  it("is offline, not a failure, and asks again by itself until it is answered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      aheadThrows = new TypeError("NetworkError when attempting to fetch resource.");
      refused = new Error("TypeError: Failed to fetch");
      const { result } = loop();
      await settled(result);
      expect(result.current.state).toBe("offline");

      // The connection comes back without the browser ever saying `online`.
      aheadThrows = null;
      refused = null;
      calls = [];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      await waitFor(() => expect(calls[0]).toBe("ahead"));
      await waitFor(() => expect(result.current.state).toBe("idle"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays offline while a probe is in flight, so the static does not flicker", async () => {
    refused = new Error("Load failed");
    const { result } = loop();
    await settled(result);
    expect(result.current.state).toBe("offline");

    hold = true;
    release = null;
    await act(async () => {
      void result.current.syncNow();
    });
    await waitFor(() => expect(release).not.toBeNull());
    expect(result.current.state).toBe("offline");
    hold = false;
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.state).toBe("offline");
  });

  it("leaves a file that got no answer as a failure: the notes went up, so this is not offline", async () => {
    uploadFailed = new Error("photo.jpg: TypeError: Failed to fetch");
    const { result } = loop();
    await settled(result);
    expect(result.current.state).toBe("error");
    expect(result.current.lastError).toBe("photo.jpg: TypeError: Failed to fetch");
  });

  it("leaves a server that answered with a timeout as a failure", async () => {
    refused = new Error("canceling statement due to statement timeout");
    const { result } = loop();
    await settled(result);
    expect(result.current.state).toBe("error");
  });
});

describe("the loop's own rules", () => {
  it("does not go to the network offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = loop();
    await waitFor(() => expect(result.current.state).toBe("offline"));
    expect(calls).toEqual([]);
  });

  it("queues one re-run for a change that lands mid-flight, and stays busy across both", async () => {
    hold = true;
    const { result } = loop();
    await waitFor(() => expect(release).not.toBeNull());
    expect(result.current.busy).toBe(true);

    // Two asks while the tick is in flight are one re-run, not two.
    await act(async () => {
      void result.current.syncNow();
      void result.current.syncNow();
    });
    expect(result.current.busy).toBe(true);
    expect(calls.filter((c) => c === "notes")).toHaveLength(1);

    hold = false;
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(calls.filter((c) => c === "notes")).toHaveLength(2));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(calls.filter((c) => c === "notes")).toHaveLength(2);
  });
});

describe("when a tick is worth running", () => {
  // These answer window events, and every loop an earlier case left mounted
  // would answer them too.
  beforeEach(() => cleanup());

  it("runs one tick, not two, when focus and visibility arrive together", async () => {
    const { result } = loop();
    await settled(result);
    // Past the guard since the opening tick, so the arrival is a real one.
    await new Promise((r) => setTimeout(r, 2_100));
    calls = [];
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.filter((c) => c === "notes")).toHaveLength(1);
  }, 10_000);

  it("waits longer before uploading while a note is being typed into", async () => {
    const applyRemote = vi.fn();
    const applyUploaded = vi.fn();
    const hook = renderHook(
      ({ version, typing }) =>
        useSync({ enabled: true, typing, notes: [note("a")], applyRemote, applyUploaded, localVersion: version }),
      { initialProps: { version: 0, typing: true } },
    );
    await settled(hook.result);
    calls = [];
    hook.rerender({ version: 1, typing: true });
    // Well past the ordinary 700ms, and nothing has gone up yet.
    await new Promise((r) => setTimeout(r, 1_200));
    expect(calls).toEqual([]);
    // Closing the note re-arms at the ordinary wait.
    hook.rerender({ version: 1, typing: false });
    await waitFor(() => expect(calls).toContain("notes"), { timeout: 2_000 });
  }, 10_000);

  it("sends what is waiting when the app is hidden, and nothing when nothing is", async () => {
    const applyRemote = vi.fn();
    const applyUploaded = vi.fn();
    const hook = renderHook(
      ({ version }) =>
        useSync({ enabled: true, typing: true, notes: [note("a")], applyRemote, applyUploaded, localVersion: version }),
      { initialProps: { version: 0 } },
    );
    await settled(hook.result);
    const hide = async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    };

    calls = [];
    await hide();
    expect(calls).toEqual([]);

    hook.rerender({ version: 1 });
    await hide();
    await waitFor(() => expect(calls).toContain("notes"));
  });
});

/**
 * The two ways out of a note the server will not take. Both end the banner;
 * only one of them asks the server anything.
 */
describe("a note the server will not take", () => {
  const stuck = { id: "n1", stamp: "2026-09-01T00:00:00.000Z", message: "no", count: 5 };

  it("is reported by the tick, so the screen can name it", async () => {
    heldFromTick = [stuck];
    const { result } = loop();
    await settled(result);

    expect(result.current.held).toEqual([stuck]);
  });

  it("is asked about again, and only asked, when the user says try again", async () => {
    heldFromTick = [stuck];
    const { result } = loop();
    await settled(result);
    calls = [];

    await act(async () => {
      await result.current.retryHeld();
    });

    expect(forgotten).toEqual(["n1"]);
    expect(droppedFromOutbox).toEqual([]);
    // A tick really did follow, rather than the banner merely being dismissed.
    expect(calls).toContain("notes");
  });

  it("leaves the queue by its own stamp, and asks nothing, when kept here only", async () => {
    heldFromTick = [stuck];
    const { result } = loop();
    await settled(result);
    calls = [];

    await act(async () => {
      await result.current.keepHeldLocal();
    });

    expect(droppedFromOutbox).toEqual([{ id: "n1", stamp: stuck.stamp }]);
    expect(forgotten).toEqual(["n1"]);
    expect(result.current.held).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("takes an idea's queued layout with it when kept here only", async () => {
    // The layout cannot go up without its idea, so it would only be refused
    // five times and asked about again.
    heldFromTick = [stuck];
    canvasOutbox = [
      { id: "n1", stamp: "2026-09-03T00:00:00.000Z" },
      { id: "other", stamp: "2026-09-03T00:00:00.000Z" },
    ];
    const { result } = loop();
    await settled(result);

    await act(async () => {
      await result.current.keepHeldLocal();
    });

    expect(droppedCanvases).toEqual([{ id: "n1", stamp: "2026-09-03T00:00:00.000Z" }]);
    // Its refused tries are forgotten too, so an edit later starts afresh.
    expect(forgottenCanvases).toEqual(["n1"]);
  });
});

/**
 * An idea's layout the server will not take is held the same way (review
 * 2026-10-13, EH-07), and named by its idea in the same banner.
 */
describe("a canvas the server will not take", () => {
  const layout = { id: "idea1", stamp: "2026-09-02T00:00:00.000Z", message: "no", count: 5 };

  it("is named with the held notes, once, without failing the tick", async () => {
    heldFromTick = [{ ...layout, stamp: "2026-09-01T00:00:00.000Z" }];
    canvasHeld = [layout, { ...layout, id: "idea2" }];
    const { result } = loop();
    await settled(result);

    expect(result.current.lastError).toBeNull();
    await waitFor(() => expect(result.current.state).toBe("idle"));
    expect(result.current.held.map((h) => h.id)).toEqual(["idea1", "idea2"]);
  });

  it("is asked about again when the user says try again", async () => {
    canvasHeld = [layout];
    const { result } = loop();
    await settled(result);
    calls = [];

    await act(async () => {
      await result.current.retryHeld();
    });

    expect(forgottenCanvases).toEqual(["idea1"]);
    expect(droppedCanvases).toEqual([]);
    expect(calls).toContain("canvases");
  });

  it("leaves the canvas queue by its own stamp when kept here only", async () => {
    canvasHeld = [layout];
    const { result } = loop();
    await settled(result);
    calls = [];

    await act(async () => {
      await result.current.keepHeldLocal();
    });

    expect(droppedCanvases).toEqual([{ id: "idea1", stamp: layout.stamp }]);
    expect(forgottenCanvases).toEqual(["idea1"]);
    expect(droppedFromOutbox).toEqual([]);
    expect(result.current.held).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("a turn whose notes could not be read", () => {
  it("still hands over the deletes it read, but is not the first pull", async () => {
    pulled = [{ ...note("gone"), deleted: true } as unknown as Note];
    refused = new Error("connection lost");
    notesPulled = false;
    const { result, applyRemote } = loop();
    await settled(result);
    expect(applyRemote).toHaveBeenCalled();
    // Reminder answers wait for the first pull, against a fresh copy.
    expect(result.current.pulledOnce).toBe(false);
  });
});
