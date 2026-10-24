// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetColdLight, lightUp } from "./coldLight";
import { COLD_LAMP_MS } from "./motion";

const proto = Element.prototype as unknown as { animate?: unknown };
const had = proto.animate;
let calls: { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }[] = [];

beforeEach(() => {
  calls = [];
  forgetColdLight();
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    f(0);
    return 0;
  });
  proto.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, opts });
    return {};
  };
  document.body.innerHTML =
    '<div role="tablist"><button class="board-tab" aria-selected="false"></button>' +
    '<button class="board-tab" id="lit" aria-selected="true"></button></div>';
});
afterEach(() => {
  proto.animate = had;
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-motion");
  document.body.innerHTML = "";
});

describe("the light comes on when you walk in", () => {
  it("raises the lit board's lamp (its ::before) from dark, once, and nothing else", () => {
    lightUp();
    expect(calls).toHaveLength(1);
    expect(calls[0].el.id).toBe("lit");
    expect(calls[0].opts.pseudoElement).toBe("::before");
    expect(calls[0].opts.duration).toBe(COLD_LAMP_MS);
    expect(calls[0].frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("is the session's one try: a second call does nothing", () => {
    lightUp();
    lightUp();
    expect(calls).toHaveLength(1);
  });

  it("does nothing under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    lightUp();
    expect(calls).toHaveLength(0);
  });

  it("gives up quietly when no board is lit", () => {
    document.body.innerHTML = "";
    lightUp();
    expect(calls).toHaveLength(0);
  });
});
