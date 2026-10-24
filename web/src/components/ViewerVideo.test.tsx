// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ViewerVideo } from "./ViewerVideo";

afterEach(cleanup);

const poster = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP";

describe("ViewerVideo", () => {
  it("plays a direct stream in place, with controls, from the source and nowhere else", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "https://v.redd.it/x/DASH_720.mp4" }} poster={poster} title="A clip" autoplay />,
    );
    const el = container.querySelector("video")!;
    expect(el.getAttribute("src")).toBe("https://v.redd.it/x/DASH_720.mp4");
    expect(el.hasAttribute("controls")).toBe(true);
    expect(el.hasAttribute("playsinline")).toBe(true);
    expect(el.getAttribute("poster")).toBe(poster);
    expect(el.autoplay).toBe(true);
    // nothing is stored: no download affordance on the element
    expect(el.getAttribute("controlslist")).toContain("nodownload");
  });

  it("does not autoplay when asked not to — reduced motion", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "https://cdn.example.com/a.mp4" }} poster={poster} title="t" autoplay={false} />,
    );
    expect(container.querySelector("video")!.autoplay).toBe(false);
  });

  it("embeds YouTube through the privacy host in a sandboxed frame, autoplay only on request", () => {
    const { container, rerender } = render(
      <ViewerVideo video={{ kind: "youtube", src: "dQw4w9WgXcQ" }} poster={poster} title="A song" autoplay />,
    );
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&autoplay=1");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation");
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame.getAttribute("title")).toBe("A song");
    rerender(<ViewerVideo video={{ kind: "youtube", src: "dQw4w9WgXcQ" }} poster={poster} title="A song" autoplay={false} />);
    expect(container.querySelector("iframe")!.getAttribute("src")).not.toContain("autoplay");
  });

  it("shows the poster and says where to go when the source is not one we play", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "javascript:alert(1)" }} poster={poster} title="x" autoplay />,
    );
    expect(container.querySelector("video, iframe")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(poster);
    expect(screen.getByText(/open the site/i)).toBeTruthy();
  });

  it("never lets a hostile id or an unknown kind become a frame, whatever the entry says", () => {
    for (const video of [
      { kind: "youtube", src: 'dQw4w9WgXcQ"><script>' },
      { kind: "vimeo", src: "123/../456" },
      { kind: "flash", src: "https://evil.example/x.swf" },
      { kind: "file", src: "data:video/mp4;base64,AAAA" },
    ]) {
      const { container, unmount } = render(<ViewerVideo video={video as never} poster={poster} title="x" autoplay />);
      expect(container.querySelector("video, iframe, embed, object"), JSON.stringify(video)).toBeNull();
      expect(screen.getByText(/open the site/i)).toBeTruthy();
      unmount();
    }
  });

  it("draws no picture from a poster that is not a data picture", () => {
    for (const odd of ["javascript:alert(1)", "https://tracker.example/p.gif", ""]) {
      const { container, unmount } = render(
        <ViewerVideo video={{ kind: "file", src: "javascript:alert(1)" }} poster={odd} title="x" autoplay />,
      );
      expect(container.querySelector("img"), odd).toBeNull();
      expect(screen.getByText(/open the site/i)).toBeTruthy();
      unmount();
    }
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "https://cdn.example.com/a.mp4" }} poster="https://tracker.example/p.gif" title="x" autoplay />,
    );
    expect(container.querySelector("video")!.hasAttribute("poster")).toBe(false);
  });

  it("falls back to the poster when a stream will not play", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "https://v.redd.it/x/DASH_720.mp4" }} poster={poster} title="x" autoplay />,
    );
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(poster);
    expect(screen.getByText(/open the site/i)).toBeTruthy();
  });
});

// A Reddit stream is the video-only file, so it plays silent; one line says
// why, and nowhere else (audit 2026-10-10, UX-8).
describe("ViewerVideo on a silent stream", () => {
  it("says there is no sound under a Reddit video, and points to the site", () => {
    render(
      <ViewerVideo video={{ kind: "file", src: "https://v.redd.it/x/DASH_720.mp4" }} poster={poster} title="A clip" autoplay={false} />,
    );
    expect(screen.getByText("No sound here. Open the site to hear it.")).toBeTruthy();
  });

  it("says nothing of the kind under a video that carries its sound", () => {
    render(
      <ViewerVideo video={{ kind: "file", src: "https://cdn.example.com/a.mp4" }} poster={poster} title="t" autoplay={false} />,
    );
    expect(screen.queryByText(/No sound here/)).toBeNull();
  });
});

/** The box's markup, held exactly, so sharing its core with the note's own film changes nothing here. */
describe("ViewerVideo's box", () => {
  it("draws a playing film as the box, the player, and nothing else", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "https://cdn.example.com/a.mp4" }} poster={poster} title="t" autoplay={false} />,
    );
    const box = container.firstElementChild!;
    expect(box.className).toBe("viewer-video");
    expect([...box.attributes].map((a) => a.name)).toEqual(["class"]);
    expect([...box.children].map((c) => c.tagName)).toEqual(["VIDEO"]);
    expect(box.querySelector("video")!.getAttribute("controlslist")).toBe("nodownload noplaybackrate");
  });

  it("draws the fallback as the box, the poster and its words", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "javascript:alert(1)" }} poster={poster} title="x" autoplay />,
    );
    const box = container.firstElementChild!;
    expect(box.getAttribute("data-fallback")).toBe("true");
    expect([...box.children].map((c) => c.className)).toEqual(["viewer-poster", "viewer-video-note mono"]);
    expect(box.querySelector("img")!.getAttribute("alt")).toBe("x");
    expect(box.querySelector("p")!.textContent).toBe("Can't play here. Open the site.");
  });

  it("puts a silent stream's line under the player and marks the box for it", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "file", src: "https://v.redd.it/x/DASH_720.mp4" }} poster={poster} title="t" autoplay={false} />,
    );
    const box = container.firstElementChild!;
    expect(box.getAttribute("data-muted")).toBe("true");
    expect([...box.children].map((c) => c.tagName)).toEqual(["VIDEO", "P"]);
  });

  it("frames a YouTube video in the same box", () => {
    const { container } = render(
      <ViewerVideo video={{ kind: "youtube", src: "dQw4w9WgXcQ" }} poster={poster} title="A song" autoplay={false} />,
    );
    const box = container.firstElementChild!;
    expect(box.className).toBe("viewer-video");
    expect([...box.attributes].map((a) => a.name)).toEqual(["class"]);
    expect([...box.children].map((c) => c.tagName)).toEqual(["IFRAME"]);
  });
});
