// @vitest-environment jsdom
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mascot } from "./Mascot";
import { MASCOT_TAG, mascotNotice, setPoofRandom, type MascotState } from "./mascot-element";

/** A small seeded random source (mulberry32), so a cloud can be asserted on. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** jsdom has no matchMedia of its own worth relying on, so state it. */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function mount(state: MascotState = "idle") {
  const { container } = render(<Mascot state={state} />);
  const host = container.querySelector(MASCOT_TAG)!;
  return { host, svg: () => host.shadowRoot!.querySelector("svg")! };
}

describe("the mascot element", () => {
  it("draws itself into a shadow root, at the size it was given", () => {
    stubReducedMotion(false);
    const { host, svg } = mount();

    expect(host.shadowRoot).toBeTruthy();
    expect(svg().getAttribute("width")).toBe("56");
    // The boil filter is what makes the lines look drawn rather than plotted.
    expect(svg().querySelector("#boil")).toBeTruthy();
  });

  /**
   * Each state is a different face and a different antenna over the same body,
   * and the class on the svg is what starts the right animation. Checked as
   * four separate drawings because the offline one is the odd one out — it has
   * no face at all, just a screen full of static.
   */
  it("paints a different face for every state", () => {
    stubReducedMotion(false);
    for (const state of ["idle", "working", "empty", "offline"] as MascotState[]) {
      const { svg } = mount(state);
      expect(svg().classList.contains(`is-${state}`)).toBe(true);
      const face = svg().querySelector(".face")!;
      if (state === "offline") expect(face.innerHTML).toBe("");
      else expect(face.innerHTML).not.toBe("");
      cleanup();
    }
  });

  /**
   * The one that matters most: a state change is an *attribute* on the element
   * that is already there, never a new element. The crossfade lives inside —
   * the screen dips for SWAP_MS, the face is swapped underneath it, and it
   * comes back up — and replacing the element would skip all of it and hard
   * cut, as well as restarting the breathing from zero.
   */
  it("crossfades between states without being replaced", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { container, rerender } = render(<Mascot state="idle" />);
    const host = container.querySelector(MASCOT_TAG)!;
    const svg = host.shadowRoot!.querySelector("svg")!;

    rerender(<Mascot state="working" />);

    // The same node, and the same drawing inside it.
    expect(container.querySelector(MASCOT_TAG)).toBe(host);
    expect(host.shadowRoot!.querySelector("svg")).toBe(svg);
    // Dipped, and still showing the old face for the length of the dip.
    expect(svg.classList.contains("swapping")).toBe(true);
    expect(svg.classList.contains("is-idle")).toBe(true);

    vi.advanceTimersByTime(70);
    expect(svg.classList.contains("is-working")).toBe(true);
    expect(svg.classList.contains("is-idle")).toBe(false);
  });

  it("startles when poked, by click and by key, and goes nowhere", () => {
    stubReducedMotion(false);
    const { host, svg } = mount("empty");
    const poked = vi.fn();
    host.addEventListener("mascot-poke", poked);

    fireEvent.click(host);
    expect(svg().classList.contains("poked")).toBe(true);
    svg().classList.remove("poked");

    fireEvent.keyDown(host, { key: "Enter" });
    expect(svg().classList.contains("poked")).toBe(true);
    svg().classList.remove("poked");

    fireEvent.keyDown(host, { key: " " });
    expect(svg().classList.contains("poked")).toBe(true);

    expect(poked).toHaveBeenCalledTimes(3);
    // Not a link and not a button: there is nowhere for it to take you.
    expect(host.closest("a")).toBeNull();
    expect(host.closest("button")).toBeNull();
  });

  /**
   * There is no silent instance any more. The header's mascot used to be
   * `decorative` — hidden from a screen reader, no tab stop, and with that no
   * poke — on the grounds that the live region beside it does the talking. The
   * live region still does the talking, but the drawing is pokeable wherever it
   * stands, and a control a pointer can find and a keyboard cannot is the trap
   * the flag existed to avoid. So every mascot is named and reachable.
   */
  it("is named and reachable in every state, so every one of them can be poked", () => {
    stubReducedMotion(false);
    for (const state of ["idle", "working", "empty", "offline"] as MascotState[]) {
      const { host, svg } = mount(state);

      expect(host.getAttribute("role")).toBe("img");
      expect(host.getAttribute("tabindex")).toBe("0");
      expect(host.getAttribute("aria-label")).toBeTruthy();
      expect(host.hasAttribute("aria-hidden")).toBe(false);

      fireEvent.click(host);
      expect(svg().classList.contains("poked")).toBe(true);
      cleanup();
    }
  });

  /** With nothing to sync to the idle creature is not "Synced" (review CD-03). */
  it("names idle Online, not Synced, where there is nothing to sync to", () => {
    stubReducedMotion(false);
    const { host } = mount("idle");
    expect(host.getAttribute("aria-label")).toBe("Synced");
    host.setAttribute("local", "");
    expect(host.getAttribute("aria-label")).toBe("Online");
  });

  /**
   * The legs are drawn outside `.body`, so the startle reaches them only by
   * name — left to itself it squashes the body against feet that never move,
   * which is what shipped and what looked wrong. Both legs must be named, and
   * they must be named *individually* rather than through their group: that is
   * what outscores the walk's own rule on the same elements, so all four
   * animations are replaced together and restart together in phase.
   *
   * jsdom runs no animation, so what is checked is the rule itself.
   */
  it("startles the legs too, and takes them from the walk to do it", () => {
    stubReducedMotion(false);
    const { host } = mount("working");
    const css = host.shadowRoot!.querySelector("style")!.textContent!;

    expect(css).toContain("svg.poked .leg-l, svg.poked .leg-r");
    expect(css).toContain("@keyframes startle-legs");
    // Pivoting on the feet, not on the hips the step swings from.
    expect(css).toMatch(/svg\.poked \.leg-l, svg\.poked \.leg-r \{ transform-origin:50px 85px;/);
  });

  /**
   * The nod is the capture acknowledgement, and it is module-level on
   * purpose: the trigger lives in App.tsx, the wrapper exposes no ref, so
   * `mascotNotice` walks the element's own registry. A second capture inside
   * the first nod restarts it — the timer is re-armed, so the class outlives
   * the moment the first nod alone would have ended.
   */
  it("nods when a note lands, and a burst of captures restarts the nod", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { svg } = mount("idle");

    mascotNotice();
    expect(svg().classList.contains("noted")).toBe(true);

    vi.advanceTimersByTime(400);
    mascotNotice();
    // 800ms in: past the first nod's own end, inside the second's.
    vi.advanceTimersByTime(400);
    expect(svg().classList.contains("noted")).toBe(true);

    vi.advanceTimersByTime(300);
    expect(svg().classList.contains("noted")).toBe(false);
  });

  /**
   * The two one-shots score identically, so they must never be on at once —
   * each strips the other's class first. Newest wins in both directions,
   * which is the poke's own restart rule said across the pair.
   */
  it("answers only the newest gesture: a nod cancels a startle, and back", () => {
    stubReducedMotion(false);
    const { host, svg } = mount("idle");

    fireEvent.click(host);
    expect(svg().classList.contains("poked")).toBe(true);
    mascotNotice();
    expect(svg().classList.contains("poked")).toBe(false);
    expect(svg().classList.contains("noted")).toBe(true);

    fireEvent.click(host);
    expect(svg().classList.contains("noted")).toBe(false);
    expect(svg().classList.contains("poked")).toBe(true);
  });

  /**
   * Everything the startle's leg rule argues binds the nod too: each leg
   * named individually so the walk's four animations restart together in
   * phase, its own pivots restated because transform-origin is not in the
   * animation shorthand. And the nod's rules sit after the startle's, which
   * is the stated tiebreak between two one-shots of equal specificity —
   * never exercised, because the code strips the loser's class, but stated.
   *
   * jsdom runs no animation, so what is checked is the rule itself.
   */
  it("nods the legs too, with its own pivots, stated after the startle", () => {
    stubReducedMotion(false);
    const { host } = mount("working");
    const css = host.shadowRoot!.querySelector("style")!.textContent!;

    expect(css).toContain("svg.noted .leg-l, svg.noted .leg-r");
    expect(css).toContain("@keyframes notice-legs");
    expect(css).toMatch(/svg\.noted \.body \{ transform-origin:50px 75px;/);
    expect(css).toMatch(/svg\.noted \.leg-l, svg\.noted \.leg-r \{ transform-origin:50px 85px;/);
    expect(css.indexOf("svg.noted .body")).toBeGreaterThan(css.indexOf("svg.poked .body"));
  });

  /** A nod that cannot move is nothing, and the app never owes one. */
  it("does not nod under reduced motion", () => {
    stubReducedMotion(true);
    const { svg } = mount("idle");

    mascotNotice();
    expect(svg().classList.contains("noted")).toBe(false);
  });

  /**
   * Reduced motion has to stop the SMIL as well as the keyframes. The
   * stylesheet inside the shadow root silences the CSS animations, but the
   * `<animate>` driving each `feTurbulence` seed is beyond the reach of any
   * media query — and those two filters are the expensive part. The element
   * flags itself instead, which is what pauses both, and declines to startle.
   */
  /**
   * The speech bubble (2026-10-16): while one stands the calm face turns to
   * it, and asking — an undo — it rounds its mouth and lifts a question mark.
   * A busy or offline face keeps its own; the node is never replaced.
   */
  it("turns to its speech bubble, and asks with a question mark", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { container, rerender } = render(<Mascot state="idle" />);
    const host = container.querySelector(MASCOT_TAG)!;
    const svg = host.shadowRoot!.querySelector("svg")!;
    const eyeX = () => svg.querySelector(".face .eye")?.getAttribute("cx");
    expect(eyeX()).toBe("39");

    rerender(<Mascot state="idle" speaking="ask" />);
    vi.advanceTimersByTime(70);
    expect(container.querySelector(MASCOT_TAG)).toBe(host);
    expect(svg.classList.contains("speaking")).toBe(true);
    expect(eyeX()).toBe("45");
    expect(svg.querySelector(".extras .q")?.textContent).toBe("?");
    // No nod: the nod is a capture's receipt and nothing else's.
    expect(svg.classList.contains("noted")).toBe(false);

    rerender(<Mascot state="idle" speaking="say" />);
    vi.advanceTimersByTime(70);
    expect(eyeX()).toBe("45");
    expect(svg.querySelector(".extras .q")).toBeNull();

    rerender(<Mascot state="working" speaking="say" />);
    vi.advanceTimersByTime(70);
    expect(svg.querySelector(".face .dot")).not.toBeNull();

    rerender(<Mascot state="idle" />);
    vi.advanceTimersByTime(70);
    expect(svg.classList.contains("speaking")).toBe(false);
    expect(eyeX()).toBe("39");
  });

  it("is heard when poked even under reduced motion, without the startle", () => {
    stubReducedMotion(true);
    const onPoke = vi.fn();
    const { container } = render(<Mascot state="idle" onPoke={onPoke} />);
    const host = container.querySelector(MASCOT_TAG)!;
    fireEvent.click(host);
    expect(onPoke).toHaveBeenCalledTimes(1);
    expect(host.shadowRoot!.querySelector("svg")!.classList.contains("poked")).toBe(false);
  });

  it("holds still under reduced motion, and will not startle", () => {
    stubReducedMotion(true);
    const { host, svg } = mount("idle");

    expect(host.hasAttribute("hidden-tab")).toBe(true);
    fireEvent.click(host);
    expect(svg().classList.contains("poked")).toBe(false);
    // The drawing is all still there — a still pose, not a second drawing.
    expect(svg().querySelector("#boil")).toBeTruthy();
    expect(svg().querySelector("feDisplacementMap")).toBeTruthy();
  });

  /**
   * Only ever one creature on screen (2026-09-29). The header's instance is
   * `home`; any other is a visitor, and while one is connected the header's is
   * away — and it is the *same node* throughout, told by the element's own
   * registry and never re-rendered for it. Away means gone for every purpose:
   * no tab stop, out of the accessibility tree, inert, and deaf to a poke.
   */
  it("steps out of the header while another is drawn, and comes home after", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { container, rerender } = render(<Mascot state="idle" home />);
    const home = container.querySelector(MASCOT_TAG)!;
    const svg = home.shadowRoot!.querySelector("svg")!;
    expect(home.hasAttribute("home")).toBe(true);
    expect(home.hasAttribute("away")).toBe(false);

    rerender(
      <>
        <Mascot state="idle" home />
        <Mascot state="empty" />
      </>,
    );
    expect(container.querySelector(`${MASCOT_TAG}[home]`)).toBe(home);
    // At once — "the instant the new mascot appears".
    expect(home.hasAttribute("away")).toBe(true);
    expect(home.hasAttribute("tabindex")).toBe(false);
    expect(home.getAttribute("aria-hidden")).toBe("true");
    expect(home.hasAttribute("inert")).toBe(true);
    fireEvent.click(home);
    expect(svg.classList.contains("poked")).toBe(false);
    // The visitor is the one a keyboard finds now.
    const visitor = container.querySelector(`${MASCOT_TAG}:not([home])`)!;
    expect(visitor.getAttribute("tabindex")).toBe("0");
    expect(visitor.hasAttribute("away")).toBe(false);

    rerender(<Mascot state="idle" home />);
    // Held for the grace, so a board passing between two empty states does
    // not puff the header out and back in the middle of one gesture...
    expect(home.hasAttribute("away")).toBe(true);
    vi.advanceTimersByTime(200);
    // ...and then home, reachable again, and still the same node.
    expect(container.querySelector(MASCOT_TAG)).toBe(home);
    expect(home.hasAttribute("away")).toBe(false);
    expect(home.getAttribute("tabindex")).toBe("0");
    expect(home.hasAttribute("aria-hidden")).toBe(false);
    expect(home.hasAttribute("inert")).toBe(false);
    fireEvent.click(home);
    expect(svg.classList.contains("poked")).toBe(true);
  });

  /** A visitor replaced by another inside the grace never brings it home. */
  it("does not pop back and forth while one visitor gives way to the next", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { container, rerender } = render(
      <>
        <Mascot state="idle" home />
        <Mascot key="a" state="empty" />
      </>,
    );
    const home = container.querySelector(`${MASCOT_TAG}[home]`)!;
    const seen = new MutationObserver(() => {});
    seen.observe(home, { attributes: true, attributeFilter: ["away"] });

    // Swapped in one commit, and swapped with a gap under the grace.
    rerender(
      <>
        <Mascot state="idle" home />
        <Mascot key="b" state="empty" />
      </>,
    );
    rerender(<Mascot state="idle" home />);
    vi.advanceTimersByTime(100);
    rerender(
      <>
        <Mascot state="idle" home />
        <Mascot key="c" state="empty" />
      </>,
    );
    vi.advanceTimersByTime(1000);

    expect(home.hasAttribute("away")).toBe(true);
    expect(seen.takeRecords()).toHaveLength(0);
    seen.disconnect();
  });

  /**
   * The capture that asks for a nod is often the thing that sends the visitor
   * away — a first note on an empty Inbox. The header is away when it is
   * asked, so it keeps the request and nods on landing; asked long before it
   * comes home, it does not, because a receipt that late is for nothing.
   */
  it("keeps a nod asked of it while away, and plays it on coming home", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const both = (
      <>
        <Mascot state="idle" home />
        <Mascot state="empty" />
      </>
    );
    const { container, rerender } = render(both);
    const home = container.querySelector(`${MASCOT_TAG}[home]`)!;
    const svg = home.shadowRoot!.querySelector("svg")!;

    mascotNotice();
    expect(svg.classList.contains("noted")).toBe(false);
    rerender(<Mascot state="idle" home />);
    vi.advanceTimersByTime(200);
    expect(home.hasAttribute("away")).toBe(false);
    expect(svg.classList.contains("noted")).toBe(true);

    vi.advanceTimersByTime(1000);
    rerender(both);
    mascotNotice();
    vi.advanceTimersByTime(2000);
    rerender(<Mascot state="idle" home />);
    vi.advanceTimersByTime(200);
    expect(home.hasAttribute("away")).toBe(false);
    expect(svg.classList.contains("noted")).toBe(false);
  });

  /**
   * The smoke itself. jsdom animates nothing, so `animate` is stood in for and
   * what is checked is who is asked to move: the header's creature and its
   * cloud on the way out — and nothing on the visitor, which simply is there
   * (2026-10-12, the owner). Coming home, the header grows back out of a cloud
   * of its own. The header only comes to rest (and stops paying for its loops)
   * once its cloud has cleared. No two clouds are alike. Under reduced motion
   * none of it runs: the swap is simply made.
   */
  describe("the poof", () => {
    type Call = {
      el: Element;
      keyframes: Keyframe[];
      options: KeyframeAnimationOptions;
      cloud: { onfinish: (() => void) | null; cancel: () => void };
    };
    const calls: Call[] = [];
    const proto = Element.prototype as unknown as { animate?: unknown };

    function standInForAnimate() {
      calls.length = 0;
      proto.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
        const animation = { onfinish: null as (() => void) | null, cancel: vi.fn() };
        calls.push({ el: this, keyframes, options, cloud: animation });
        return animation;
      };
    }

    afterEach(() => {
      delete proto.animate;
      setPoofRandom();
    });

    function visitAfterBeingSeen() {
      vi.useFakeTimers();
      const { container, rerender } = render(<Mascot state="idle" home />);
      const home = container.querySelector(MASCOT_TAG)!;
      // Long enough on screen to be worth seeing leave (SEEN_MS).
      vi.advanceTimersByTime(400);
      rerender(
        <>
          <Mascot state="idle" home />
          <Mascot state="empty" />
        </>,
      );
      const visitor = container.querySelector(`${MASCOT_TAG}:not([home])`)!;
      return { home, visitor, rerender };
    }

    const inside = (host: Element) => calls.filter((c) => host.shadowRoot!.contains(c.el));
    const smokeOf = (made: Call[]) => made.filter((c) => c.el.classList.contains("smoke"));
    const puffsOf = (made: Call[]) => made.filter((c) => c.el.tagName.toLowerCase() === "circle");

    it("leaves the header in a cloud, and the visitor simply is there", () => {
      stubReducedMotion(false);
      standInForAnimate();
      const { home, visitor } = visitAfterBeingSeen();

      // Nothing on the sleeping one: no creature growing, no cloud.
      expect(inside(visitor)).toHaveLength(0);
      expect(visitor.shadowRoot!.querySelectorAll(".smoke circle")).toHaveLength(0);

      const leaving = inside(home);
      // The creature, every puff drawn twice, and the cloud turning and fading.
      const drawn = home.shadowRoot!.querySelectorAll(".smoke-fill").length;
      expect(drawn).toBeGreaterThanOrEqual(5);
      expect(drawn).toBeLessThanOrEqual(9);
      expect(home.shadowRoot!.querySelectorAll(".smoke-line")).toHaveLength(drawn);
      expect(leaving).toHaveLength(1 + 2 * drawn + 2);
      expect(puffsOf(leaving)).toHaveLength(2 * drawn);
      expect(smokeOf(leaving)).toHaveLength(2);
      // Leaving shrinks to nothing.
      const shrink = leaving.find((c) => c.el.classList.contains("creature"))!;
      expect(shrink.keyframes.at(-1)!.opacity).toBe(0);
      // A puff's outline and its fill move as one, or the outline shows through.
      for (const line of puffsOf(leaving).filter((c) => c.el.classList.contains("smoke-line"))) {
        const fill = puffsOf(leaving).find(
          (c) => c.el.classList.contains("smoke-fill") && c.el.getAttribute("data-puff") === line.el.getAttribute("data-puff"),
        )!;
        expect(fill.keyframes).toEqual(line.keyframes);
        expect(fill.options).toEqual(line.options);
      }

      expect(home.hasAttribute("away")).toBe(true);
      expect(home.hasAttribute("hidden-tab")).toBe(false);
      const fade = smokeOf(leaving).find((c) => "opacity" in c.keyframes[0])!;
      fade.cloud.onfinish!();
      expect(home.hasAttribute("hidden-tab")).toBe(true);
    });

    it("comes home out of a cloud of its own", () => {
      stubReducedMotion(false);
      standInForAnimate();
      const { home, rerender } = visitAfterBeingSeen();
      calls.length = 0;

      rerender(<Mascot state="idle" home />);
      vi.advanceTimersByTime(200);
      expect(home.hasAttribute("away")).toBe(false);
      const arriving = inside(home);
      const grow = arriving.find((c) => c.el.classList.contains("creature"))!;
      expect(grow.keyframes.at(-1)!.opacity).toBe(1);
      expect(smokeOf(arriving)).toHaveLength(2);
      expect(puffsOf(arriving).length).toBeGreaterThanOrEqual(10);
    });

    it("never draws the same cloud twice", () => {
      stubReducedMotion(false);
      standInForAnimate();
      setPoofRandom(seeded(7));
      const { home, rerender } = visitAfterBeingSeen();
      const first = inside(home).map((c) => [c.keyframes, c.options]);
      const firstShape = home.shadowRoot!.querySelector(".smoke")!.innerHTML;

      calls.length = 0;
      rerender(<Mascot state="idle" home />);
      vi.advanceTimersByTime(200);
      const second = inside(home).map((c) => [c.keyframes, c.options]);
      const secondShape = home.shadowRoot!.querySelector(".smoke")!.innerHTML;

      expect(secondShape).not.toBe(firstShape);
      // Leaving and arriving differ in the creature's half by design; the
      // cloud's own moves must differ too.
      expect(JSON.stringify(second.slice(1))).not.toBe(JSON.stringify(first.slice(1)));
    });

    it("makes the swap without any smoke under reduced motion", () => {
      stubReducedMotion(true);
      standInForAnimate();
      const { home, rerender } = visitAfterBeingSeen();

      expect(calls).toHaveLength(0);
      expect(home.hasAttribute("away")).toBe(true);
      rerender(<Mascot state="idle" home />);
      vi.advanceTimersByTime(200);
      expect(calls).toHaveLength(0);
      expect(home.hasAttribute("away")).toBe(false);
    });

    it("draws no smoke for a creature nobody had time to see", () => {
      stubReducedMotion(false);
      standInForAnimate();
      vi.useFakeTimers();
      const { container } = render(
        <>
          <Mascot state="idle" home />
          <Mascot state="empty" />
        </>,
      );
      expect(container.querySelector(`${MASCOT_TAG}[home]`)!.hasAttribute("away")).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  it("keeps its ids to itself, so two mascots never share one seed", () => {
    stubReducedMotion(false);
    const { container } = render(
      <>
        <Mascot state="idle" />
        <Mascot state="offline" />
      </>,
    );

    const hosts = [...container.querySelectorAll(MASCOT_TAG)];
    expect(hosts).toHaveLength(2);
    // A shadow root is its own id scope, so both can hold `#boil` without one
    // drawing boiling off the other's seed.
    for (const host of hosts) {
      expect(host.shadowRoot!.querySelector("#boil")).toBeTruthy();
      expect(host.shadowRoot!.querySelector("#tv")).toBeTruthy();
    }
  });
});
