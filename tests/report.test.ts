import { test, expect } from "vitest";
import { renderSearchReport } from "../src/report.js";

/**
 * The review report went with the cancelled AI phase — it rendered enrichment
 * before/after, and there is no enrichment and no `review` command to reach it
 * from. The search report is still wired, through `npm run search -- --html`.
 */
test("search report lists hits and marks archived", () => {
  const html = renderSearchReport("bread", [
    {
      id: "n1",
      title: "Bread baking",
      gist: "yeast and dough",
      note_type: "delve",
      status: "archived",
      raw_content: "...",
      score: 0.1,
    },
  ]);
  expect(html).toContain("Bread baking");
  expect(html).toContain("archived");
});
