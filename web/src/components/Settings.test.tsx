// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSetting } from "../lib/settings";
import { SHORTCUTS } from "../lib/shortcuts";

// Asking the browser to keep the store is a real permission prompt; the
// screen shows the answer, and these tests are not about it.
const asked = vi.hoisted(() => ({ answer: null as boolean | null }));
vi.mock("../lib/keepStorage", () => ({ askToKeep: async () => asked.answer }));

import { Settings, type SettingsSection } from "./Settings";
import type { PushState } from "../store/push";

/** Settings (2026-10-11, owner approved). */

beforeEach(() => {
  localStorage.clear();
  asked.answer = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A machine answering the media queries it is asked: a phone, a keyboard. */
function device({ phone = false, keyboard = false, standalone = false } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      (phone && query === "(max-width: 699px)") ||
      (keyboard && query === "(hover: hover) and (pointer: fine)") ||
      (standalone && query === "(display-mode: standalone)"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  if (phone) vi.stubGlobal("innerWidth", 400);
}

function open(
  props: Partial<{
    at: SettingsSection;
    pushStatus: PushState;
    syncConfigured: boolean;
    signedIn: boolean;
    onClose: () => void;
    onImportKeep: () => void;
    onImportSpar: () => void;
    onAbout: () => void;
    onAccount: () => void;
    onOpenTrash: () => void;
    onEnableRing: () => void;
    onDisableRing: () => void;
    backRef: { current: (() => boolean) | null };
    shelfHidden: string[];
    onHideBoard: (key: string, hide: boolean) => void;
    hasInspiration: boolean;
  }> = {},
) {
  const noop = () => {};
  return render(
    <Settings
      notes={[]}
      folders={[]}
      canvases={[]}
      synced={false}
      onClose={props.onClose ?? noop}
      backRef={props.backRef}
      restoreTo={createRef<HTMLButtonElement>()}
      at={props.at}
      pushStatus={props.pushStatus ?? "askable"}
      onEnableRing={props.onEnableRing ?? noop}
      onDisableRing={props.onDisableRing ?? noop}
      trashCount={2}
      onOpenTrash={props.onOpenTrash ?? noop}
      onImportKeep={props.onImportKeep ?? noop}
      onImportSpar={props.onImportSpar}
      onAbout={props.onAbout ?? noop}
      syncConfigured={props.syncConfigured ?? false}
      signedIn={props.signedIn ?? false}
      onAccount={props.onAccount ?? noop}
      shelfHidden={props.shelfHidden}
      onHideBoard={props.onHideBoard}
      hasInspiration={props.hasInspiration}
    />,
  );
}

const section = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("the Settings screen", () => {
  it("opens on General, with the sections down the side in their groups", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const names = within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(names).toEqual([
      "General",
      "Notes",
      "Reminders",
      "Import and export",
      "This device",
      "About spår",
    ]);
    expect(section("General").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("group", { name: "Theme" })).toBeTruthy();
  });

  it("changes the theme the moment it is pressed, and says which answer is in force", () => {
    open();
    const theme = screen.getByRole("group", { name: "Theme" });
    const light = within(theme).getByRole("button", { name: "Light" });
    expect(within(theme).getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(light);
    expect(readSetting("theme")).toBe("light");
    expect(light.getAttribute("aria-pressed")).toBe("true");
  });

  it("explains the theme only when System is the choice", () => {
    open();
    expect(screen.queryByText(/System follows this device/)).toBeNull();
    fireEvent.click(within(screen.getByRole("group", { name: "Theme" })).getByRole("button", { name: "System" }));
    expect(screen.getByText(/System follows this device/)).toBeTruthy();
  });

  it("says what the Motion choice does, not what the other one would", () => {
    open();
    const group = () => screen.getByRole("group", { name: "Motion" });
    fireEvent.click(within(group()).getByRole("button", { name: "Reduced" }));
    expect(screen.getByText("Sliding and fading are off.")).toBeTruthy();
    expect(screen.queryByText(/Sliding and fading follow/)).toBeNull();
    fireEvent.click(within(group()).getByRole("button", { name: "System" }));
    expect(screen.getByText("Sliding and fading follow this device.")).toBeTruthy();
    expect(screen.queryByText("Sliding and fading are off.")).toBeNull();
  });

  it("offers the board row only on a phone, where it governs something", () => {
    open();
    expect(screen.queryByRole("group", { name: "Board row" })).toBeNull();
    cleanup();
    device({ phone: true });
    open({ at: "general" });
    fireEvent.click(within(screen.getByRole("group", { name: "Board row" })).getByRole("button", { name: "Bottom" }));
    expect(readSetting("boardRow")).toBe("bottom");
  });

  it("shows or hides each of the app's own boards, never the Inbox", () => {
    const onHideBoard = vi.fn();
    open({ shelfHidden: ["trash"], onHideBoard, hasInspiration: true });
    expect(screen.queryByRole("group", { name: "Inbox" })).toBeNull();
    for (const name of ["Archive", "Inspiration", "Todos", "Links", "Files", "All", "Trash"]) {
      expect(screen.getByRole("group", { name })).toBeTruthy();
    }
    const trash = screen.getByRole("group", { name: "Trash" });
    expect(within(trash).getByRole("button", { name: "Hidden" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(screen.getByRole("group", { name: "Links" })).getByRole("button", { name: "Hidden" }));
    expect(onHideBoard).toHaveBeenCalledWith("links", true);
  });

  it("turns link previews off for this device", () => {
    open({ at: "notes" });
    const previews = screen.getByRole("group", { name: "Link previews" });
    expect(within(previews).getByRole("button", { name: "On" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(previews).getByRole("button", { name: "Off" }));
    expect(readSetting("previews")).toBe("off");
  });

  it("opens the Keep import, a spår download and About from their rows", () => {
    const onImportKeep = vi.fn();
    const onImportSpar = vi.fn();
    const onAbout = vi.fn();
    open({ at: "data", onImportKeep, onImportSpar, onAbout });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    fireEvent.click(section("About spår"));
    expect(onImportKeep).toHaveBeenCalledOnce();
    expect(onImportSpar).toHaveBeenCalledOnce();
    expect(onAbout).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Download/ })).toBeTruthy();
  });

  it("finds a setting from any section by its words", () => {
    open();
    const field = screen.getByRole("searchbox", { name: "Search settings" });
    fireEvent.change(field, { target: { value: "keep" } });
    expect(screen.getByText("Import from Google Keep")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
    fireEvent.change(field, { target: { value: "nothing like this" } });
    expect(screen.getByText(/No setting matches/)).toBeTruthy();
  });

  it("clears a search with Escape before it closes", () => {
    const onClose = vi.fn();
    open({ onClose });
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "trash" } });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rings this device on and off from Reminders, and says why when it cannot", () => {
    const onEnableRing = vi.fn();
    const onDisableRing = vi.fn();
    open({ at: "reminders", pushStatus: "askable", onEnableRing, onDisableRing });
    const ring = screen.getByRole("group", { name: "Ring on this device" });
    expect(within(ring).getByRole("button", { name: "Off" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(ring).getByRole("button", { name: "On" }));
    expect(onEnableRing).toHaveBeenCalledOnce();
    cleanup();
    open({ at: "reminders", pushStatus: "denied" });
    expect(screen.queryByRole("group", { name: "Ring on this device" })).toBeNull();
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy();
  });

  it("has an Account section only where there is sync, and its row is the old menu row", () => {
    open();
    expect(screen.queryByRole("button", { name: /^Account/ })).toBeNull();
    cleanup();
    const onAccount = vi.fn();
    open({ syncConfigured: true, signedIn: true, at: "account", onAccount });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onAccount).toHaveBeenCalledOnce();
  });

  it("lists every shortcut under Keyboard, where there is a keyboard", () => {
    device({ keyboard: true });
    open({ at: "keys" });
    for (const group of SHORTCUTS) {
      for (const shortcut of group.shortcuts) expect(screen.getAllByText(shortcut.does).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Save to spår")).toBeTruthy();
  });

  it("says in words whether the browser will keep the notes", async () => {
    asked.answer = false;
    open({ at: "device" });
    expect(await screen.findByText("may be cleared")).toBeTruthy();
    expect(screen.getByText("Storage")).toBeTruthy();
    expect(screen.getByText(/The browser may clear the notes/)).toBeTruthy();
    cleanup();
    asked.answer = true;
    open({ at: "device" });
    expect(await screen.findByText("kept until you clear it")).toBeTruthy();
  });

  it("folds the build and the speeds under one closed line (review WD-04)", () => {
    open({ at: "device" });
    const fold = screen.getByText("Build and speed").closest("details")!;
    expect(fold.open).toBe(false);
    expect(within(fold).getByText("Build")).toBeTruthy();
    expect(within(fold).getByText("Capture")).toBeTruthy();
    // The notes count stays out in the open.
    expect(screen.getByText("Notes", { selector: ".settings-label" }).closest("details")).toBeNull();
  });

  it("says once, quietly, that sharing into spår needs the app from Chrome, in an app installed from Firefox on Android (review PS-01)", () => {
    const firefox = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
    vi.stubGlobal("navigator", Object.create(navigator, { userAgent: { value: firefox } }));
    device({ standalone: true });
    open({ at: "device" });
    expect(screen.getByText(/install it from Chrome/)).toBeTruthy();
    cleanup();
    // In a browser tab, the line is not there.
    device();
    open({ at: "device" });
    expect(screen.queryByText(/install it from Chrome/)).toBeNull();
    cleanup();
    // Nor in an app installed from Chrome on Android.
    const chrome =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    vi.stubGlobal("navigator", Object.create(navigator, { userAgent: { value: chrome } }));
    device({ standalone: true });
    open({ at: "device" });
    expect(screen.queryByText(/install it from Chrome/)).toBeNull();
  });

  it("explains a setting in one short line, and only where its label needs it (review WD-04)", () => {
    for (const at of ["general", "notes", "reminders", "data", "device"] as const) {
      open({ at });
      const lines = [...document.querySelectorAll(".settings-advice")].map((p) => p.textContent ?? "");
      for (const line of lines) {
        expect(line.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length, line).toBe(1);
        expect(line).not.toMatch(/ — /);
      }
      cleanup();
    }
  });

  it("offers the Inbox count switch in an installed app whose browser badges", () => {
    const nav = navigator as Navigator & { setAppBadge?: unknown; clearAppBadge?: unknown };
    nav.setAppBadge = vi.fn(async () => {});
    nav.clearAppBadge = vi.fn(async () => {});
    device({ standalone: true });
    open();
    const badge = screen.getByRole("group", { name: "Inbox count on the app icon" });
    fireEvent.click(within(badge).getByRole("button", { name: "Off" }));
    expect(localStorage.getItem("spar.appBadge")).toBe("off");
    delete nav.setAppBadge;
    delete nav.clearAppBadge;
  });
});

describe("Settings on a phone", () => {
  it("opens on the list of sections, goes into one, and comes back", () => {
    device({ phone: true });
    open();
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.dataset.inside).toBeUndefined();
    fireEvent.click(section("Notes"));
    expect(dialog.dataset.inside).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(dialog.dataset.inside).toBeUndefined();
  });

  it("steps back to the list on Escape before it closes", () => {
    device({ phone: true });
    const onClose = vi.fn();
    open({ onClose });
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.click(section("Notes"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog.dataset.inside).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  // bughunt 2026-10-15: the phone's Back agrees with Escape.
  it("steps back to the list on the phone's Back too", () => {
    device({ phone: true });
    const backRef: { current: (() => boolean) | null } = { current: null };
    open({ backRef });
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    // On the list there is no section to step out of: Back closes Settings.
    expect(backRef.current!()).toBe(false);
    fireEvent.click(section("Notes"));
    let stepped = false;
    act(() => {
      stepped = backRef.current!();
    });
    expect(stepped).toBe(true);
    expect(dialog.dataset.inside).toBeUndefined();
  });
});
