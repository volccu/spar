// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { note } from "./test/fixtures";

vi.mock("./lib/shareTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/shareTarget")>()),
  takeShared: vi.fn(async () => null),
}));
vi.setConfig({ testTimeout: 60_000 });
afterEach(cleanup);
beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

describe("merging two notes that already belong to an idea (from the Archive)", () => {
  it("takes them out of the old idea, as joining another idea does", async () => {
    const t = new Date().toISOString();
    await putNote(note({ id: "ideaA", body: "# Old idea\n\nzzz one\n\nzzz two", raw_content: "x", merged_from: ["s1", "s2"], created_at: t, updated_at: t }));
    await putNote(note({ id: "s1", body: "zzzsource one", raw_content: "zzzsource one", status: "archived", merged_into: "ideaA", created_at: t, updated_at: t }));
    await putNote(note({ id: "s2", body: "zzzsource two", raw_content: "zzzsource two", status: "archived", merged_into: "ideaA", created_at: t, updated_at: t }));
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), { timeout: 10_000 });
    fireEvent.click(await screen.findByRole("tab", { name: /^archive/i }));
    const one = await screen.findByRole("button", { name: /zzzsource one/i });
    fireEvent.contextMenu(one);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /zzzsource two/i }));
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Menu, 2 selected$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /merge 2/i }));
    await screen.findByRole("dialog", { name: "Idea canvas" }, { timeout: 15_000 });
    const all = await allNotes();
    const a = all.find((n) => n.id === "ideaA")!;
    const s1 = all.find((n) => n.id === "s1")!;
    const newIdea = s1.merged_into;
    expect(newIdea).not.toBe("ideaA");
    // Each source is named by exactly one idea.
    expect(a.merged_from ?? [], "old idea still names notes that now belong to another idea").not.toContain("s1");
  });

  it("is taken back whole by undo: the old idea names its notes again, in the Archive where it was", async () => {
    const t = new Date().toISOString();
    await putNote(note({ id: "ideaB", body: "# Older idea", raw_content: "x", status: "archived", merged_from: ["u1", "u2"], created_at: t, updated_at: t }));
    await putNote(note({ id: "u1", body: "yyysource one", raw_content: "yyysource one", status: "archived", merged_into: "ideaB", created_at: t, updated_at: t }));
    await putNote(note({ id: "u2", body: "yyysource two", raw_content: "yyysource two", status: "archived", merged_into: "ideaB", created_at: t, updated_at: t }));
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), { timeout: 10_000 });
    fireEvent.click(await screen.findByRole("tab", { name: /^archive/i }));
    fireEvent.contextMenu(await screen.findByRole("button", { name: /yyysource one/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /yyysource two/i }));
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Menu, 2 selected$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /merge 2/i }));
    await screen.findByRole("dialog", { name: "Idea canvas" }, { timeout: 15_000 });
    await waitFor(async () => expect((await allNotes()).find((n) => n.id === "ideaB")?.merged_from).toEqual([]));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(async () => {
      const all = await allNotes();
      const b = all.find((n) => n.id === "ideaB")!;
      expect(b.merged_from).toEqual(["u1", "u2"]);
      expect(b.status).toBe("archived");
      expect(all.find((n) => n.id === "u1")?.merged_into).toBe("ideaB");
    });
  });
});
