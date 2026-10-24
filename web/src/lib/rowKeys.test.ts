// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { shownRows } from "./rowKeys";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shownRows", () => {
  // A hidden row cannot take focus, whether it is hidden itself or sits in a
  // box that is (review QA-01).
  it("leaves out a row hidden itself or by a box around it", () => {
    document.body.innerHTML = `
      <div id="panel">
        <button class="row" style="display: none">Settings</button>
        <div style="display: none"><button class="row">Hidden by its box</button></div>
        <button class="row">Reminders</button>
      </div>`;
    const panel = document.getElementById("panel")!;
    expect(shownRows(panel, ".row").map((el) => el.textContent)).toEqual(["Reminders"]);
  });
});
