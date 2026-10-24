import { describe, expect, it } from "vitest";
import type { UserBoard } from "../types";
import { mergeBoards } from "./boardsMerge";
import { foldersOf, inspirationOf, SHELF_ORDER_ID } from "./boards";

const f = (id: string, position: number, extra: Partial<UserBoard> = {}): UserBoard => ({
  id,
  name: id,
  position,
  ...extra,
});
const insp = (id: string, position = 9): UserBoard => ({ id, name: "Inspiration", position, kind: "inspiration" });
const ids = (list: UserBoard[]) => list.map((b) => b.id);

describe("mergeBoards", () => {
  const account = [f("a", 0), f("b", 1), f("c", 2), insp("i-old", 3)];

  it("never lets a device that has not seen the list take anything away (2026-10-09)", () => {
    // A browser used "on this device only": an empty shelf and an Inspiration
    // of its own, signing in to an account with folders.
    const merged = mergeBoards(account, [insp("i-new", 0)], null);
    expect(ids(merged).slice(0, 4)).toEqual(["a", "b", "c", "i-old"]);
  });

  it("adds a device's new folders after the server's", () => {
    const merged = mergeBoards(account, [f("x", 0), f("y", 1)], null);
    expect(ids(merged)).toEqual(["a", "b", "c", "i-old", "x", "y"]);
    expect(merged.find((b) => b.id === "x")?.position).toBe(3);
    expect(merged.find((b) => b.id === "y")?.position).toBe(4);
  });

  it("keeps a delete made here, and one made elsewhere", () => {
    const base = [f("a", 0), f("b", 1), f("c", 2)];
    // Here: b deleted. Elsewhere: c deleted, d added.
    const server = [f("a", 0), f("b", 1), f("d", 3)];
    const local = [f("a", 0), f("c", 2)];
    expect(ids(mergeBoards(server, local, base))).toEqual(["a", "d"]);
  });

  it("takes this device's edit only where it made one", () => {
    const base = [f("a", 0), f("b", 1)];
    const server = [f("a", 0, { name: "renamed there" }), f("b", 1)];
    const local = [f("a", 0), f("b", 1, { color: "teal" })];
    const merged = mergeBoards(server, local, base);
    expect(merged.find((b) => b.id === "a")?.name).toBe("renamed there");
    expect(merged.find((b) => b.id === "b")?.color).toBe("teal");
  });

  /**
   * Audit DATA-12 (2026-10-10). A reorder renumbers the whole run, so every
   * entry differed from `base` and was taken whole from this device — undoing
   * a rename, a mark or a tint the other device had made meanwhile. Each field
   * is now merged on its own.
   */
  describe("merged field by field", () => {
    const base = [f("a", 0), f("b", 1), f("c", 2)];

    it("a reorder here keeps a rename, a mark and a tint made there", () => {
      const server = [
        f("a", 0, { name: "Renamed there" }),
        f("b", 1, { icon: "BookOpenIcon" }),
        f("c", 2, { color: "teal" }),
      ];
      // Here: c dragged to the front, so every position changed.
      const local = [f("c", 0), f("a", 1), f("b", 2)];
      const merged = mergeBoards(server, local, base);
      const byId = new Map(merged.map((b) => [b.id, b]));
      expect(byId.get("a")).toEqual({ id: "a", name: "Renamed there", position: 1 });
      expect(byId.get("b")).toEqual({ id: "b", name: "b", position: 2, icon: "BookOpenIcon" });
      expect(byId.get("c")).toEqual({ id: "c", name: "c", position: 0, color: "teal" });
    });

    it("a reorder there keeps a rename made here", () => {
      const server = [f("c", 0), f("a", 1), f("b", 2)];
      const local = [f("a", 0, { name: "Renamed here" }), f("b", 1), f("c", 2)];
      const byId = new Map(mergeBoards(server, local, base).map((b) => [b.id, b]));
      expect(byId.get("a")).toEqual({ id: "a", name: "Renamed here", position: 1 });
      expect(byId.get("c")?.position).toBe(0);
    });

    it("a mark taken off here stays off, while a tint added there stays on", () => {
      const seen = [f("a", 0, { icon: "BookOpenIcon" })];
      const server = [f("a", 0, { icon: "BookOpenIcon", color: "moss" })];
      const local = [f("a", 0)];
      expect(mergeBoards(server, local, seen)[0]).toEqual({ id: "a", name: "a", position: 0, color: "moss" });
    });

    it("two reorders: one whole order wins, never a mix that seats two folders in one place", () => {
      // Here a and b swapped; there c went to the front.
      const server = [f("c", 0), f("a", 1), f("b", 2)];
      const local = [f("b", 0), f("a", 1), f("c", 2)];
      const merged = mergeBoards(server, local, base);
      const positions = merged.map((b) => b.position);
      expect(new Set(positions).size).toBe(positions.length);
      expect(Object.fromEntries(merged.map((b) => [b.id, b.position]))).toEqual({ a: 1, b: 0, c: 2 });
    });

    it("the same field changed on both: this device's change is the one that goes up", () => {
      const server = [f("a", 0, { name: "There" })];
      const local = [f("a", 0, { name: "Here" })];
      expect(mergeBoards(server, local, [f("a", 0)])[0].name).toBe("Here");
    });

    it("the shelf's lens order merges as one field, beside the folders", () => {
      const order = (lenses: string[]): UserBoard =>
        ({ id: SHELF_ORDER_ID, name: "Shelf order", position: 1_000_000, lenses }) as UserBoard;
      const seen = [f("a", 0), order(["todos", "links", "files"])];
      const server = [f("a", 0, { name: "Renamed there" }), order(["todos", "links", "files"])];
      const local = [f("a", 0), order(["files", "todos", "links"])];
      const merged = mergeBoards(server, local, seen);
      expect(merged[0].name).toBe("Renamed there");
      expect((merged[1] as UserBoard & { lenses: string[] }).lenses).toEqual(["files", "todos", "links"]);
    });
  });

  it("reads an entry as unchanged whatever order its fields were written in", () => {
    const base = [{ position: 0, name: "a", id: "a" } as UserBoard];
    const server = [f("a", 0, { name: "renamed there" })];
    expect(mergeBoards(server, [f("a", 0)], base)[0].name).toBe("renamed there");
  });

  it("keeps the account's own Inspiration when the device made a second", () => {
    const base = [f("a", 0)];
    const merged = mergeBoards([f("a", 0), insp("i-old")], [f("a", 0), insp("i-new")], base);
    expect(inspirationOf(merged)?.id).toBe("i-old");
    expect(merged.filter((b) => b.kind === "inspiration").map((b) => b.id)).toEqual(["i-old"]);
  });

  /**
   * Audit DATA-3 (2026-10-10). The device's own Inspiration used to be dropped
   * outright: its notes kept a `board_id` naming a board that no longer existed
   * anywhere, fell into the Inbox, and — the entry never having reached the
   * server — `prefs_history` could not bring it back. It is now demoted to a
   * plain folder, so every note filed there stays filed.
   */
  describe("a device's own Inspiration, when the account already has one", () => {
    it("signing in from device-only: the device's wall becomes a folder, and its notes stay filed", () => {
      const merged = mergeBoards(account, [insp("i-new", 0)], null);
      expect(ids(merged)).toEqual(["a", "b", "c", "i-old", "i-new"]);
      const demoted = merged.find((b) => b.id === "i-new")!;
      expect(demoted.kind).toBeUndefined();
      expect(demoted.name).toBe("Inspiration 2");
      // After the account's folders, never on top of one of them.
      expect(demoted.position).toBe(3);
      expect(inspirationOf(merged)?.id).toBe("i-old");
      // A note filed into the device's wall is still in a folder the shelf draws.
      const note = { board_id: "i-new" };
      expect(foldersOf(merged).some((b) => b.id === note.board_id)).toBe(true);
    });

    it("two devices that each made one before syncing: the second to arrive keeps its notes in a folder", () => {
      const base = [f("a", 0)];
      // Device A's adoption reached the server first.
      const server = [f("a", 0), insp("i-a", 1)];
      const merged = mergeBoards(server, [f("a", 0), insp("i-b", 1)], base);
      expect(inspirationOf(merged)?.id).toBe("i-a");
      const demoted = merged.find((b) => b.id === "i-b")!;
      expect(demoted).toBeDefined();
      expect(demoted.kind).toBeUndefined();
      expect(foldersOf(merged).map((b) => b.id)).toContain("i-b");
    });

    it("wins nothing by having the lower id: the account's wall stays the wall", () => {
      // Lowest id picks among entries already on the server; a newcomer
      // with a lower id must not take the wall's notes off it.
      const merged = mergeBoards([f("a", 0), insp("z-account", 1)], [f("a", 0), insp("0-device", 1)], [f("a", 0)]);
      expect(inspirationOf(merged)?.id).toBe("z-account");
    });

    it("two devices that each adopted a different folder: the server's adoption stays the wall", () => {
      const base = [f("a", 0), f("b", 1)];
      // Elsewhere "a" became Inspiration and reached the server; here "b" did.
      const server = [insp("a", 0), f("b", 1)];
      const local = [f("a", 0), { ...f("b", 1), kind: "inspiration" as const }];
      const merged = mergeBoards(server, local, base);
      expect(inspirationOf(merged)?.id).toBe("a");
      expect(merged.find((b) => b.id === "b")?.kind).toBeUndefined();
      expect(merged.find((b) => b.id === "b")?.name).toBe("b");
    });

    it("keeps an adopted folder's own name, and picks a free number for a made one", () => {
      const adopted: UserBoard = { id: "i-new", name: "inspo", position: 0, kind: "inspiration" };
      expect(mergeBoards(account, [adopted], null).find((b) => b.id === "i-new")?.name).toBe("inspo");
      const taken = [...account, f("x", 4, { name: "Inspiration 2" })];
      expect(mergeBoards(taken, [insp("i-new", 0)], null).find((b) => b.id === "i-new")?.name).toBe("Inspiration 3");
    });
  });

  it("lets a device's Inspiration in when the account has none", () => {
    expect(ids(mergeBoards([f("a", 0)], [f("a", 0), insp("i-new")], [f("a", 0)]))).toEqual(["a", "i-new"]);
  });

  it("carries the shelf's order entry like any other, and never renumbers it", () => {
    const order: UserBoard = { id: SHELF_ORDER_ID, name: "Shelf order", position: 1_000_000 };
    const merged = mergeBoards([f("a", 0)], [f("a", 0), order], [f("a", 0)]);
    expect(merged.find((b) => b.id === SHELF_ORDER_ID)?.position).toBe(1_000_000);
  });

  it("hands back the server's list untouched when this device changed nothing", () => {
    const base = account.slice();
    expect(mergeBoards(account, account.slice(), base)).toEqual(account);
  });
});

describe("the shelf's hidden boards", () => {
  const order = (hidden?: string[]): UserBoard =>
    ({ id: "shelf-order", name: "Shelf order", position: 1_000_000, lenses: ["todos", "links", "files"], ...(hidden ? { hidden } : {}) }) as UserBoard;

  it("keeps both devices' hides when each hid a different board", () => {
    const merged = mergeBoards([order(["trash"])], [order(["archive"])], [order()]);
    expect((merged[0] as UserBoard & { hidden?: string[] }).hidden?.sort()).toEqual(["archive", "trash"]);
  });

  it("lets this device show a board again that both had hidden", () => {
    const merged = mergeBoards([order(["links", "trash"])], [order(["trash"])], [order(["links", "trash"])]);
    expect((merged[0] as UserBoard & { hidden?: string[] }).hidden).toEqual(["trash"]);
  });
});
