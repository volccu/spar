import { existsSync } from "node:fs";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Screenshot comparison with a 0.1% tolerance (quality-bar.md §7).
 *
 * **The baseline pictures are not committed.** Text is anti-aliased differently
 * on Windows, macOS and the CI's Linux, so a picture taken on a developer's
 * machine would fail on the first CI run for no reason at all. The first CI run
 * therefore *takes* the baselines instead of comparing (a missing baseline is
 * written, noted on the test, and does not fail), and uploads them as the
 * `e2e-baselines` artifact. Download that and commit it to
 * `web/e2e/baselines/` — from then on every run compares against it. Re-take
 * with `E2E_UPDATE=1` after a deliberate change to how something looks.
 */
export async function expectScreen(page: Page, name: string, info: TestInfo) {
  // Let transitions that survive reduced motion, and the fonts, finish.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const file = `${name}.png`;
  if (!process.env.E2E_UPDATE && !existsSync(info.snapshotPath(file))) {
    info.annotations.push({ type: "baseline", description: `${file} did not exist and was taken` });
    await page.screenshot({ path: info.snapshotPath(file), animations: "disabled", caret: "hide" });
    return;
  }
  await expect.soft(page).toHaveScreenshot(file, { maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide" });
}
