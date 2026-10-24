import { beforeAll } from "vitest";

/**
 * The menu, the selection's verbs and a board's own menu follow a dynamic
 * import (`components/lazyPanels.tsx`, audit PERF-7), fetched at idle once the
 * board has painted. A person meets them long after that; a test taps the
 * burger the moment the first card is in, and would meet the half-second
 * before. So every test that has a page starts where the person does — with
 * the three already in memory and drawing in the tap's own commit.
 * `lazyPanels.test.tsx` covers the tap that beats the fetch.
 */
beforeAll(async () => {
  if (typeof document === "undefined") return;
  const { loadPanels } = await import("../components/lazyPanels");
  await loadPanels();
});
