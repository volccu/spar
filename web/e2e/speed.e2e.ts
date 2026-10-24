import { expect, test } from "@playwright/test";
import { PHONE, openDemoWithSamples, waitForNoUndo } from "./helpers";

/**
 * Speed budget (quality-bar.md §7): the first letter typed into Search answers
 * within 200 ms of a slow phone, which is Chrome's own limit for "good" on
 * Interaction to Next Paint. "Slow" is a CPU four times slower than this
 * machine's. Lighthouse is not here; the entry-chunk ceiling already lives in
 * the unit suite.
 */
const BUDGET_MS = 200;

test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

test("first search letter answers within 200 ms on a 4x slower CPU", async ({ page, context }) => {
  await openDemoWithSamples(page);
  await page.reload();
  await page.getByRole("button", { name: /^call dentist/ }).waitFor();
  await waitForNoUndo(page);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.evaluate(() => {
    const w = window as unknown as { __inp: number[] };
    w.__inp = [];
    // Interaction to Next Paint is the longest "event" entry that belongs to an
    // interaction: input delay, handlers and the paint that follows them.
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEventTiming & { interactionId?: number })[]) if (e.interactionId) w.__inp.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });

  await page.getByRole("button", { name: "Search", exact: true }).first().click();
  const field = page.locator("input.search");
  await field.waitFor();
  await page.evaluate(() => ((window as unknown as { __inp: number[] }).__inp.length = 0));
  await field.press("b");
  // Give the paint after the keystroke time to be reported.
  await page.waitForTimeout(800);
  await expect(field).toHaveValue("b");

  const durations = await page.evaluate(() => (window as unknown as { __inp: number[] }).__inp);
  const inp = durations.length ? Math.max(...durations) : 0;
  console.log(`[speed] first search letter, 4x CPU: ${Math.round(inp)} ms (events seen: ${durations.length})`);
  expect(inp, "interaction to next paint for the first search letter").toBeLessThanOrEqual(BUDGET_MS);
});
