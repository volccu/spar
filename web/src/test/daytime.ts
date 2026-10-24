import { beforeAll } from "vitest";

/**
 * The header's creature is drowsy from 23:00 to 05:00 (`isLate`,
 * `components/mascot-element.ts`). A test asserting its calm face would then
 * fail only at night — and the deploy hook runs this suite — so every test
 * starts in the daytime. `Mascot.moments.test.tsx` asks for the real clock
 * where it tests the night itself.
 */
beforeAll(async () => {
  if (typeof document === "undefined") return;
  const { setLateClock } = await import("../components/mascot-element");
  setLateClock(() => false);
});
