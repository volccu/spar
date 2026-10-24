import { describe, expect, it } from "vitest";
import {
  backTarget,
  coveredAbove,
  escapeTarget,
  layerFlags,
  LAYERS,
  type LayerId,
  type OpenLayers,
} from "./useLayerStack";

const ids = LAYERS.map((l) => l.id) as LayerId[];

function openOnly(...up: LayerId[]): OpenLayers {
  return Object.fromEntries(ids.map((id) => [id, up.includes(id)])) as OpenLayers;
}

/**
 * Audit 2026-10-10, CODE-6. Escape and Back used to walk two hand-kept lists,
 * and with a selection under a folder's menu they closed different things.
 * Both now read one table; this holds them to it.
 */
describe("Escape and Back close the same layer", () => {
  it("for every pair of layers, whichever two are up", () => {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const open = openOnly(a, b);
        const back = backTarget(open);
        const escape = escapeTarget(open);
        expect(escape?.id, `${a} + ${b}`).toBe(back);
        // And it is one of the two, the one higher in the table.
        expect([a, b]).toContain(back);
        expect(back).toBe(ids.indexOf(a) < ids.indexOf(b) ? a : b);
      }
    }
  });

  /**
   * The pairs that really can be up together, each with the one that goes
   * first. The table's order answers for every pair; these are the ones a
   * person can reach, written out so a reorder that breaks one says which.
   */
  const together: [LayerId, LayerId, LayerId][] = [
    // The CODE-6 repro: select notes, then a folder's menu from its tab.
    ["boardMenu", "selection", "boardMenu"],
    ["look", "selection", "look"],
    ["drawer", "selection", "drawer"],
    ["boardMenu", "drawer", "boardMenu"],
    ["look", "drawer", "look"],
    ["newBoardInDrawer", "drawer", "newBoardInDrawer"],
    // The drawer opened from inside the open note stands over it.
    ["drawer", "note", "drawer"],
    ["boardMenu", "note", "boardMenu"],
    ["look", "note", "look"],
    ["newBoardInDrawer", "note", "newBoardInDrawer"],
    ["picture", "note", "picture"],
    ["dialog", "note", "dialog"],
    // A note opened from the canvas stands over it.
    ["note", "canvas", "note"],
    ["dialog", "canvas", "dialog"],
    ["note", "search", "note"],
    ["note", "reminders", "note"],
    ["canvas", "search", "canvas"],
    ["add", "search", "add"],
    ["add", "reminders", "add"],
    ["moveChooser", "selectionPanel", "moveChooser"],
    ["moveChooser", "selection", "moveChooser"],
    ["selectionPanel", "selection", "selectionPanel"],
    ["dialog", "selection", "dialog"],
    ["dialog", "selectionPanel", "dialog"],
    ["selection", "search", "selection"],
    ["selection", "reminders", "selection"],
    ["drawer", "search", "drawer"],
    ["wall", "search", "wall"],
    ["sorter", "search", "sorter"],
    ["about", "search", "about"],
    ["import", "reminders", "import"],
    ["dialog", "sorter", "dialog"],
    ["dialog", "about", "dialog"],
  ];
  it.each(together)("%s over %s: both close %s", (a, b, first) => {
    expect(backTarget(openOnly(a, b))).toBe(first);
    expect(escapeTarget(openOnly(a, b))?.id).toBe(first);
  });

  it("stands the app's Escape down when the top layer answers it itself", () => {
    // The note takes its own Escape; the drawer over it does not hold the
    // focus, so the app's listener closes the drawer and the note stays.
    expect(escapeTarget(openOnly("drawer", "note"))).toEqual({ id: "drawer", by: "app" });
    expect(escapeTarget(openOnly("note", "selection"))).toEqual({ id: "note", by: "own" });
    // A question over a selection: the dialog answers, the selection stays.
    expect(escapeTarget(openOnly("dialog", "selection"))).toEqual({ id: "dialog", by: "own" });
  });

  it("reads a layer it learns of by registration at the moment it is asked", () => {
    let picture = false;
    const open = { ...openOnly("note"), picture: () => picture };
    expect(backTarget(open)).toBe("note");
    picture = true;
    expect(backTarget(open)).toBe("picture");
  });

  it("closes nothing with nothing up", () => {
    expect(backTarget(openOnly())).toBeNull();
    expect(escapeTarget(openOnly())).toBeNull();
  });
});

/**
 * The lists the board reads, derived from the same table. These are the sets
 * `App.tsx` wrote out by hand before 2026-10-11, held here so the derivation
 * changes nothing about which keys stand down and what leaves the tab order.
 */
describe("what each layer does to the board", () => {
  const where = (pick: (f: ReturnType<typeof layerFlags>) => boolean) =>
    ids.filter((id) => pick(layerFlags(openOnly(id)))).sort();

  it("takes the board out of the tab order under the full-screen layers and the note", () => {
    expect(where((f) => f.inertBoard)).toEqual(
      ["note", "canvas", "drawer", "sorter", "ticker", "about", "settings", "import", "wall"].sort(),
    );
  });

  it("takes the board row with it under all of those but the note", () => {
    expect(where((f) => f.inertRow)).toEqual(
      ["canvas", "drawer", "sorter", "ticker", "about", "settings", "import", "wall"].sort(),
    );
  });

  it("stands the grid's keys down under everything that covers it, search apart", () => {
    const covered = [
      "note",
      "wall",
      "canvas",
      "menu",
      "selectionPanel",
      "dialog",
      "boardMenu",
      "look",
      "newBoardInDrawer",
      "newBoardOnStrip",
      "drawer",
      "sorter",
      "ticker",
      "about",
      "settings",
      "import",
    ].sort();
    expect(where((f) => f.coveredOtherThanSearch)).toEqual(covered);
    expect(where((f) => f.gridCovered)).toEqual([...covered, "search"].sort());
  });

  it("gives Back something to close for every layer", () => {
    expect(where((f) => f.layerOpen)).toEqual([...ids].sort());
  });

  it("says when something stands over a given layer", () => {
    expect(coveredAbove(openOnly("drawer", "note"), "note")).toBe(true);
    expect(coveredAbove(openOnly("note", "search"), "note")).toBe(false);
    expect(coveredAbove(openOnly("picture", "note"), "note", ["picture"])).toBe(false);
  });
});

/*
 * Ctrl+K and Ctrl+E stand down under any open layer (web/CLAUDE.md), except
 * those the keys put away on the way and a selection, which no key with a
 * modifier stands down for. Until the table had a column for it the guard in
 * `App.tsx` was a hand-kept list that missed About, Settings, the import and
 * the wall.
 */
describe("the two verbs' keys", () => {
  it("stand down under every layer but the ones they close and a selection", () => {
    const work = ["look", "boardMenu", "drawer", "selectionPanel", "selection", "menu", "search", "reminders"];
    expect(ids.filter((id) => !layerFlags(openOnly(id)).verbKeysWait).sort()).toEqual(work.sort());
    expect(layerFlags(openOnly()).verbKeysWait).toBe(false);
    // One layer that waits is enough, whatever else is up with it.
    expect(layerFlags(openOnly("about", "search")).verbKeysWait).toBe(true);
  });
});
