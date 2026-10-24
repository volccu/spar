// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types";

/**
 * Settings in the public demo's build (review UX-08): a visitor who has tried
 * the sample notes can send them to the trash before importing their own.
 * `DEMO` is a build-time literal, so the test says it is on, as
 * `About.demo.test.tsx` does; `Settings.test.tsx` sees the owner's build, where
 * the row does not exist.
 */
const demo = vi.hoisted(() => ({ removeSamples: vi.fn(async () => 53) }));
vi.mock("../lib/demo", () => ({ DEMO: true, removeSamples: demo.removeSamples }));

import { Settings } from "./Settings";

afterEach(cleanup);

const note = (source: string, status: Note["status"] = "active") => ({ id: source + status, source, status }) as Note;

function open(notes: Note[], onClose = () => {}) {
  const noop = () => {};
  return render(
    <Settings
      notes={notes}
      folders={[]}
      canvases={[]}
      synced={false}
      onClose={onClose}
      restoreTo={createRef<HTMLButtonElement>()}
      at="data"
      pushStatus="askable"
      onEnableRing={noop}
      onDisableRing={noop}
      trashCount={0}
      onOpenTrash={noop}
      onImportKeep={noop}
      onAbout={noop}
      syncConfigured={false}
      signedIn={false}
      onAccount={noop}
    />,
  );
}

describe("the demo's Settings", () => {
  it("offers to remove the sample notes while any is in use, and closes so the undo can be seen", async () => {
    demo.removeSamples.mockClear();
    const onClose = vi.fn();
    open([note("sample"), note("typed")], onClose);
    expect(screen.getByText("Remove the sample notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(demo.removeSamples).toHaveBeenCalledOnce();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("has no such row once they are gone, or when there never were any", () => {
    open([note("sample", "trashed"), note("typed")]);
    expect(screen.queryByText("Remove the sample notes")).toBeNull();
  });
});
