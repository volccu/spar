import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const PHONE = { width: 390, height: 844 };
export const DESKTOP = { width: 1440, height: 900 };

/** Every screen below is reached the way a person reaches it: by tapping. */
export async function openDemoWithSamples(page: Page) {
  // Notes are dated "now" in the demo's sample set; a fixed clock keeps every
  // "due in 2 days" word, and so every screenshot, the same on every run.
  await page.clock.setFixedTime(new Date("2026-10-08T10:00:00"));
  await page.goto("/");
  await page.getByRole("button", { name: /sample notes/i }).first().click();
  await expect(page.getByRole("button", { name: /^call dentist/ })).toBeVisible();
  // The load is done once its undo offer stands; a reload before that is aborted in Firefox.
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();
}

/** The undo offer that follows loading the samples counts down; wait it out so it is not in a picture. */
export async function waitForNoUndo(page: Page, timeout = 20_000) {
  await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0, { timeout });
}

export async function openDrawer(page: Page) {
  await page.getByRole("button", { name: /^Boards/ }).first().click();
}

/** Switch board by name, from the drawer (phone) or the strip (desktop). */
export async function goBoard(page: Page, name: RegExp) {
  const tab = page.getByRole("tab", { name }).first();
  if (!(await tab.isVisible())) await openDrawer(page);
  await tab.click();
}

export async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
}

export async function menuItem(page: Page, name: RegExp) {
  await openMenu(page);
  await page.getByRole("menuitem", { name }).click();
}

/** About lives in Settings (2026-10-11), and Settings is the header's cog (2026-10-12). */
export async function openAbout(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /About spår/ }).click();
}

/**
 * axe-core on whatever is on screen. Serious and critical violations fail the
 * check; minor and moderate ones are printed so they can be read, not failed
 * on (they are the bar's "worth knowing", not its "must not ship").
 */
export async function expectNoSeriousViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const brief = (v: (typeof result.violations)[number]) =>
    `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" | ")}`;
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  for (const v of result.violations.filter((v) => !bad.includes(v))) console.log(`[axe note] ${label}: ${brief(v)}`);
  expect.soft(bad.map(brief), `axe, serious or critical, on ${label}`).toEqual([]);
}
