import { expect, test, type Page } from "@playwright/test";
import { PHONE, openDemoWithSamples } from "./helpers";

/**
 * A mark is drawn at the weight DESIGN.md §7 sets in every engine (review
 * 2026-10-13). Firefox once dropped the stylesheet's unitless calc() and drew
 * every mark at one user unit, a third of its weight; only a real engine can
 * see that. Tagged @core so it runs in Firefox, the owner's own browser.
 */
test.use({ viewport: PHONE, hasTouch: true });

async function stroke(page: Page, tier: string): Promise<number> {
  const mark = page.locator(`svg.icon.${tier}`).first();
  await expect(mark).toBeVisible();
  return mark.evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));
}

test("@core a mark's stroke is the same user-unit width in every tier", async ({ page }) => {
  await openDemoWithSamples(page);
  // 1.5 on a 24px box, 1.8 on 20px and 2.57 on 14px: each lands back on 1.5px drawn.
  expect(await stroke(page, "icon-nav")).toBeCloseTo(1.5, 1);
  expect(await stroke(page, "icon-inline")).toBeCloseTo(1.8, 1);
  expect(await stroke(page, "icon-data")).toBeCloseTo(2.57, 1);
});
