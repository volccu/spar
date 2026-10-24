// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The About page in the public demo's build (review PL-06): a visitor is told
 * how to go on using spår. `DEMO` is a build-time literal, so the only way to
 * see the demo's page in a test is to say it is on — which the mock does, as
 * `SampleOffer.test.tsx` does for the empty Inbox. `About.test.tsx` sees the
 * owner's build, where the section does not exist.
 */
vi.mock("../lib/demo", () => ({ DEMO: true }));

import { About } from "./About";

afterEach(cleanup);

function page() {
  return render(
    <About
      synced={false}
      onClose={() => {}}
      restoreTo={createRef<HTMLButtonElement>()}
    />,
  );
}

describe("the demo's About page", () => {
  it("says how to keep using spår: install it, run a copy of your own, take the notes out", () => {
    const { container } = page();
    screen.getByRole("heading", { name: "Keep using spår" });
    // The export itself is in Settings now (2026-10-11), and the page says where.
    expect(screen.queryByRole("button", { name: /Download everything/ })).toBeNull();

    const links = [...container.querySelectorAll<HTMLAnchorElement>(".about-body a")].map((a) => a.href);
    expect(links).toContain("https://github.com/volccu/spar#run-it-with-docker");
    expect(links).toContain("https://github.com/volccu/spar/blob/main/docs/self-hosting.md");

    const words = container.querySelector(".about-body")?.textContent ?? "";
    expect(words).toMatch(/Install/);
    expect(words).toMatch(/Download everything, in Settings/);
    // Explained once on the page, not three times (review WD-04).
    expect(words.match(/Download everything/g)).toHaveLength(1);
    // Loading a download back in is not offered (PL-01 was declined), so
    // nothing here may promise it.
    expect(words).not.toMatch(/load it back|import it back|bring it back|restore/i);
  });
});
