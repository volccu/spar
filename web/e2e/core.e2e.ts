import { expect, test } from "@playwright/test";
import { PHONE, menuItem, openDemoWithSamples } from "./helpers";

/**
 * The everyday path, tagged @core so it also runs in Firefox, the owner's own
 * browser (CH-01): capture, open, Tidy up. Back is in back.e2e.ts.
 */
test.use({ viewport: PHONE, hasTouch: true });

test("@core a note is captured, shows on the board, and opens", async ({ page }) => {
  await openDemoWithSamples(page);
  await page.getByRole("textbox", { name: "Write a note" }).fill("Buy oat milk");
  await page.getByRole("button", { name: "Save note" }).click();
  const card = page.getByRole("button", { name: /^Buy oat milk/ });
  await expect(card).toBeVisible();

  await card.click();
  await expect(page.getByRole("dialog", { name: "Note" })).toBeVisible();
  await page.getByRole("button", { name: "Close note" }).click();
  await expect(page.getByRole("dialog", { name: "Note" })).toHaveCount(0);
});

test("@core Tidy up shows a note to leave, and leaving moves on", async ({ page }) => {
  await openDemoWithSamples(page);
  await menuItem(page, /^Tidy up/);
  await expect(page.getByRole("button", { name: /^Leave/ }).first()).toBeVisible();
  // Nothing to step back to on the first note; after leaving it, there is.
  await expect(page.getByRole("button", { name: "Back one note" })).toBeDisabled();
  await page.getByRole("button", { name: /^Leave/ }).first().click();
  await expect(page.getByRole("button", { name: "Back one note" })).toBeEnabled();
  await page.getByRole("button", { name: "Stop tidying up" }).click();
  await expect(page.getByRole("button", { name: /^Leave/ })).toHaveCount(0);
});
