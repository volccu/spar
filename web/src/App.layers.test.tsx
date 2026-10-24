// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * Audit 2026-10-10, CODE-6: Escape and Back walked two different lists of
 * what is on top, and with a selection under a folder's menu they closed
 * different things. Both now read one table (`lib/useLayerStack.ts`, whose own
 * test runs every pair); these are the pairs a person really reaches, driven
 * through the whole app, each closed once by Escape and once by Back.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function boardIsUp() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

/** One card picked, its panel put away: a selection and nothing over it. */
async function selectOne() {
  fireEvent.contextMenu(document.querySelector<HTMLElement>(".card")!);
  await waitFor(() => expect(selected()).toBeTruthy());
  // Without a pointer to open at, the selection's panel stays shut.
  expect(screen.queryByRole("group", { name: "Selected notes" })).toBeNull();
}

async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  const tab = await screen.findByRole("tab", { name: new RegExp(name, "i") });
  // The new board opens; the test wants the Inbox's notes.
  fireEvent.click(await screen.findByRole("tab", { name: /^inbox/i }));
  return tab;
}

/** The capture bar's burger carries the count while anything is picked. */
const selected = () => screen.queryByRole("button", { name: /^Menu, 1 selected$/ });
const folderMenu = (name: string) => screen.queryByRole("group", { name: `${name} board` });
const drawer = () => screen.queryByRole("dialog", { name: "Boards" });

type Close = "escape" | "back";
async function closeTop(how: Close) {
  if (how === "escape") {
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    return;
  }
  const popped = new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );
  act(() => window.history.back());
  await popped;
  // The entry goes back a frame later when something is still open.
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

describe.each<Close>(["escape", "back"])("a folder's menu over a selection (%s)", (how) => {
  it("opens over the selection, and closes before it", async () => {
    await boardIsUp();
    const tab = await makeBoard(`zzzlayer${how}`);
    await selectOne();

    fireEvent.contextMenu(tab);
    await waitFor(() => expect(folderMenu(`zzzlayer${how}`)).toBeTruthy());

    await closeTop(how);
    await waitFor(() => expect(folderMenu(`zzzlayer${how}`)).toBeNull());
    expect(selected()).toBeTruthy();

    await closeTop(how);
    await waitFor(() => expect(selected()).toBeNull());
  });
});

describe.each<Close>(["escape", "back"])("the drawer over a selection (%s)", (how) => {
  it("closes the drawer first and leaves the selection", async () => {
    await boardIsUp();
    await selectOne();

    fireEvent.click(screen.getByRole("button", { name: "Boards" }));
    await waitFor(() => expect(drawer()).toBeTruthy());

    await closeTop(how);
    await waitFor(() => expect(drawer()).toBeNull());
    expect(selected()).toBeTruthy();

    await closeTop(how);
    await waitFor(() => expect(selected()).toBeNull());
  });
});
