import { expect, test, type Page } from "@playwright/test";
import { PHONE, goBoard, menuItem, openAbout, openDemoWithSamples, waitForNoUndo } from "./helpers";

test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

/**
 * Copy and undo checks (quality-bar.md §7). The demo has no backend at all, so
 * words that talk about a server, another device or "Synced" would be untrue
 * here, and wrong on any one-device copy of the app (CD-03).
 */
const FORBIDDEN = [/\bserver\b/i, /other device/i, /\bsynced\b/i];
// About says, truthfully, that the demo has no server, what a server of your
// own would add, and that running your own copy brings "a small server" with it
// (review PL-06). Those three are the only places the word may appear.
const HONEST = [/\bno server\b/gi, /\bserver of your own\b/gi, /\ba small server\b/gi];

async function expectNoSyncTalk(page: Page, where: string) {
  // The open dialog when there is one: the board behind it holds only sample notes.
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
  let text = await dialog.innerText();
  for (const ok of HONEST) text = text.replace(ok, "");
  for (const word of FORBIDDEN) expect(text, `${where} must not say ${word}`).not.toMatch(word);
}

async function ready(page: Page) {
  await openDemoWithSamples(page);
  await page.reload();
  await page.getByRole("button", { name: /^Start here/ }).waitFor();
  await waitForNoUndo(page);
}

test("About, an open note with a reminder, and the empty-trash dialog say nothing about a server", async ({ page }) => {
  await ready(page);

  await openAbout(page);
  await expect(page.getByRole("dialog", { name: /About/ })).toBeVisible();
  await expectNoSyncTalk(page, "About");
  await page.reload();
  await page.getByRole("button", { name: /^Start here/ }).waitFor();

  // A note that has a reminder, opened.
  await page.getByRole("button", { name: /^call dentist/ }).click();
  await expect(page.getByRole("dialog", { name: "Note" })).toBeVisible();
  await expectNoSyncTalk(page, "an open note with a reminder");

  // Trash one note, then open the empty-trash dialog.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await goBoard(page, /^Trash/);
  await menuItem(page, /^Empty trash/);
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoSyncTalk(page, "the empty-trash dialog");
});

test("deleting a note offers an undo, and the undo puts the note back", async ({ page }) => {
  await ready(page);
  const note = page.getByRole("button", { name: /^Start here/ });
  await note.click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(note).toHaveCount(0);
  const undo = page.getByRole("button", { name: /^Undo/ });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(note).toBeVisible();
});

test("archiving a note offers an undo", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: /^Start here/ }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();
});

test("a mode opened after a board action shows no stale undo offer", async ({ page }) => {
  // Loading the samples is an action with an undo; opening Tidy up straight
  // after must not carry that offer into a screen where it would undo something
  // out of sight (UX-B-03).
  await openDemoWithSamples(page);
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();
  await menuItem(page, /^Tidy up/);
  await expect(page.getByRole("button", { name: /^Leave/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
});
