// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { watchForUpdate } from "./lib/appUpdate";

/*
 * The header's Update offer, end to end — `web/CLAUDE.md`, "A new build is
 * offered, never forced, and never missed".
 *
 * `lib/appUpdate.test.ts` covers the watch itself. This is the wiring on the
 * app's side of it: the word appears only once the watch says a build is
 * waiting, pressing it asks that same watch to apply the build, and the watch
 * is stopped when the app goes. jsdom has no service worker, so the watch is
 * handed in here and its `onReady` is called by hand.
 */

vi.mock("./lib/appUpdate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/appUpdate")>()),
  watchForUpdate: vi.fn(),
}));

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

describe("a newer build, waiting", () => {
  it("is said by the header's creature, and pressing Reload applies it", async () => {
    let ready: () => void = () => {};
    const apply = vi.fn(async () => {});
    const stop = vi.fn();
    vi.mocked(watchForUpdate).mockImplementation(async ({ onReady }) => {
      ready = onReady;
      return { apply, stop };
    });

    const { unmount } = render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    await waitFor(() => expect(watchForUpdate).toHaveBeenCalled());
    // Nothing is waiting yet, so nothing is offered.
    expect(screen.queryByRole("button", { name: /^Reload/ })).toBeNull();

    act(() => ready());
    const offer = await screen.findByRole("button", { name: /^Reload/ });
    expect(offer.closest(".topbar .speech")?.textContent).toMatch(/A new version is ready/);
    expect(screen.getByText("A new version is ready. Reload to use it.")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(offer);
    expect(apply).toHaveBeenCalledTimes(1);

    unmount();
    expect(stop).toHaveBeenCalled();
  });
});
