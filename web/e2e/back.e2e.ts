import { expect, test, type Page } from "@playwright/test";
import { PHONE, openDemoWithSamples, openDrawer, waitForNoUndo } from "./helpers";

// Motion on: the note's close animation is part of what Back has to wait out.
test.use({ viewport: PHONE, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });

/**
 * Back on the board leaves the app in one press (2026-10-12: "it takes two
 * backs to close spår"). Every flow below ends on the board, and the board
 * must then stand on the app's first history entry — no entry of ours under
 * it. `navigation.currentEntry.index` counts this origin's entries only, so 0
 * means the next Back leaves the app.
 */
async function expectFirstEntry(page: Page, where: string) {
  // history.back() is asynchronous, and the close animations run first.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { navigation: { currentEntry: { index: number } } }).navigation.currentEntry.index), {
      message: `${where}: the board must stand on the app's first entry`,
    })
    .toBe(0);
}

const noteDialog = (page: Page) => page.getByRole("dialog", { name: "Note" });
const card = (page: Page, name: RegExp) => page.getByRole("button", { name }).first();
/** The phone's Back. Never in the very frame a layer opened in: its entry is
 *  pushed by an effect, after the paint — no person's Back is that quick. */
async function back(page: Page) {
  await page.waitForTimeout(200);
  await page.evaluate(() => history.back());
}

async function ready(page: Page) {
  await page.goto("about:blank");
  await openDemoWithSamples(page);
  await page.reload();
  await card(page, /^Start here/).waitFor();
  await waitForNoUndo(page);
}

test("@core every flow ends on the app's first entry, and one Back then leaves", async ({ page }) => {
  await ready(page);

  await card(page, /^Start here/).click();
  await expect(noteDialog(page)).toBeVisible();
  await page.getByRole("button", { name: "Close note" }).click();
  await expect(noteDialog(page)).toHaveCount(0);
  await expectFirstEntry(page, "a note closed by its own button");

  await card(page, /^Start here/).click();
  await expect(noteDialog(page)).toBeVisible();
  await back(page);
  await expect(noteDialog(page)).toHaveCount(0);
  await expectFirstEntry(page, "a note closed by Back");

  await card(page, /^Start here/).click();
  await expect(noteDialog(page)).toBeVisible();
  await noteDialog(page).getByRole("button", { name: "Boards" }).click();
  await page.getByRole("tab", { name: /^Archive/ }).first().click();
  await expectFirstEntry(page, "note → drawer → a board");
  await openDrawer(page);
  await page.getByRole("tab", { name: /^Inbox/ }).first().click();
  await expectFirstEntry(page, "drawer → Inbox");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(300);
  await back(page);
  await expectFirstEntry(page, "Settings closed by Back");

  // A note closed and the next one opened in the very next task, before the
  // first Back is answered: the new note stays, on one entry.
  await card(page, /^Start here/).click();
  await expect(noteDialog(page)).toBeVisible();
  await page.evaluate(async () => {
    (document.querySelector('[aria-label="Close note"]') as HTMLElement).click();
    for (let i = 0; i < 500 && document.querySelector('[role="dialog"][aria-label="Note"]'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const next = [...document.querySelectorAll<HTMLElement>("button.card")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Printer ink"),
    );
    next?.click();
  });
  await page.waitForTimeout(500);
  await expect(noteDialog(page)).toBeVisible();
  await page.getByRole("button", { name: "Close note" }).click();
  await expectFirstEntry(page, "a note closed and the next opened at once");

  // Reloaded while standing on an entry of ours: the layer is gone, so is it.
  await page.evaluate(() => history.pushState({ spar: "layer" }, ""));
  await page.reload();
  await card(page, /^Start here/).waitFor();
  await expectFirstEntry(page, "reloaded onto a left-over layer entry");

  // And from the board, one Back is out of the app.
  await page.waitForTimeout(200);
  await page.goBack();
  await expect(page).toHaveURL("about:blank");
});
