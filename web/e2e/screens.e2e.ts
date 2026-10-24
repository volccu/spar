import { test, type Page } from "@playwright/test";
import {
  DESKTOP,
  PHONE,
  expectNoSeriousViolations,
  goBoard,
  menuItem,
  openAbout,
  openDemoWithSamples,
  openDrawer,
  waitForNoUndo,
} from "./helpers";
import { expectScreen } from "./shots";

/**
 * axe and screenshots on the key screens, on a phone and on a desktop
 * (quality-bar.md §7). One walk per size: the samples are loaded once, then each
 * screen is reached by tapping, checked, and left by reloading the page, which
 * lands on the Inbox again with the same notes.
 */
const screens: { name: string; go: (p: Page) => Promise<void> }[] = [
  { name: "inbox", go: async () => {} },
  { name: "open-note", go: (p) => p.getByRole("button", { name: /^call dentist/ }).click() },
  {
    name: "drawer",
    go: async (p) => {
      // The desktop shelf is already a strip; its burger opens the same drawer over it.
      await openDrawer(p);
    },
  },
  { name: "tidy-up", go: (p) => menuItem(p, /^Tidy up/) },
  {
    name: "tick-off",
    go: async (p) => {
      await goBoard(p, /Todos/);
      await menuItem(p, /^Tick off/);
    },
  },
  { name: "search", go: (p) => p.getByRole("button", { name: "Search", exact: true }).first().click() },
  { name: "about", go: (p) => openAbout(p) },
  {
    name: "links",
    go: (p) => goBoard(p, /Links/),
  },
];

for (const [size, viewport, isMobile] of [
  ["phone", PHONE, true],
  ["desktop", DESKTOP, false],
] as const) {
  test.describe(size, () => {
    test.use({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: 1 });

    test(`key screens: axe and pictures at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
      await openDemoWithSamples(page);
      for (const screen of screens) {
        await test.step(screen.name, async () => {
          await page.reload();
          await page.getByRole("button", { name: /^call dentist/ }).waitFor();
          await waitForNoUndo(page);
          await screen.go(page);
          await page.waitForTimeout(500);
          await expectNoSeriousViolations(page, `${screen.name} (${size})`);
          await expectScreen(page, `${screen.name}-${size}`, info);
        });
      }
    });
  });
}
