// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportScale, pictureName, renderCanvasPicture, savePicture, wrapLines, type ExportLook, type ExportScene } from "./canvasExport";

describe("pictureName", () => {
  it("falls back to Sketch", () => {
    expect(pictureName(null)).toBe("Sketch.png");
    expect(pictureName("")).toBe("Sketch.png");
    expect(pictureName("   ")).toBe("Sketch.png");
    expect(pictureName("???")).toBe("Sketch.png");
  });

  it("keeps an ordinary name, Finnish letters included", () => {
    expect(pictureName("Kesämökin pohja")).toBe("Kesämökin pohja.png");
  });

  it("drops what Windows and Android refuse", () => {
    expect(pictureName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j.png");
    expect(pictureName("line one\nline two")).toBe("line one line two.png");
  });

  it("does not end in a dot or a space", () => {
    expect(pictureName("plan.")).toBe("plan.png");
    expect(pictureName("plan . ")).toBe("plan.png");
  });

  it("stops at sixty characters before the extension", () => {
    const name = pictureName("x".repeat(100));
    expect(name).toBe(`${"x".repeat(60)}.png`);
    // Never cuts an emoji in half.
    expect(pictureName("😀".repeat(70))).toBe(`${"😀".repeat(60)}.png`);
  });
});

describe("exportScale", () => {
  it("keeps the asked scale while the picture is small", () => {
    expect(exportScale({ w: 800, h: 600 })).toBe(2);
    expect(exportScale({ w: 800, h: 600 }, 3)).toBe(3);
  });

  it("lowers it so the longest side is at most 8000 pixels", () => {
    expect(exportScale({ w: 6000, h: 1000 })).toBeCloseTo(8000 / 6000);
    expect(exportScale({ w: 500, h: 20000 })).toBeCloseTo(0.4);
    expect(Math.max(5000 * exportScale({ w: 5000, h: 100 }), 100)).toBeLessThanOrEqual(8000);
  });

  it("copes with an empty box", () => {
    expect(exportScale({ w: 0, h: 0 })).toBe(2);
  });
});

describe("wrapLines", () => {
  const measure = (s: string) => s.length * 10;

  it("wraps on words", () => {
    expect(wrapLines("one two three four", 90, measure)).toEqual(["one two", "three", "four"]);
  });

  it("keeps the writer's line breaks and blank lines", () => {
    expect(wrapLines("a\n\nb", 100, measure)).toEqual(["a", "", "b"]);
  });

  it("breaks a word wider than the line rather than overflowing", () => {
    expect(wrapLines("abcdefghij", 40, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("never loops on a line narrower than one letter", () => {
    expect(wrapLines("abc", 1, measure)).toEqual(["a", "b", "c"]);
  });
});

describe("renderCanvasPicture", () => {
  const scene: ExportScene = { box: { x: 0, y: 0, w: 100, h: 80 }, strokes: [], labels: [], pictures: [], notes: [] };
  const look: ExportLook = {
    paper: "rgb(20,19,18)",
    ink: "rgb(240,238,230)",
    rule: "rgb(80,78,74)",
    colour: (t) => t,
    font: "16px serif",
    lineHeight: 24,
    highlightOpacity: 0.35,
  };

  it("answers null where the browser cannot draw (no Path2D, as under jsdom)", async () => {
    expect(await renderCanvasPicture(scene, look)).toBeNull();
  });
});

describe("savePicture", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  const original = { share: Object.getOwnPropertyDescriptor(navigator, "share"), canShare: Object.getOwnPropertyDescriptor(navigator, "canShare") };

  function setNavigator(share: unknown, canShare: unknown) {
    Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true, writable: true });
  }

  let create: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;
  let clicked: { download: string; href: string }[];

  beforeEach(() => {
    vi.useFakeTimers();
    create = vi.fn(() => "blob:fake");
    revoke = vi.fn();
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const key of ["share", "canShare"] as const) {
      const d = original[key];
      if (d) Object.defineProperty(navigator, key, d);
      else delete (navigator as unknown as Record<string, unknown>)[key];
    }
  });

  it("shares the file by name when the phone can", async () => {
    const share = vi.fn(async () => {});
    setNavigator(share, vi.fn(() => true));
    expect(await savePicture(blob, "Plan.png")).toBe("shared");
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]).toBeInstanceOf(File);
    expect(arg.files[0].name).toBe("Plan.png");
    expect(arg.files[0].type).toBe("image/png");
    expect(create).not.toHaveBeenCalled();
  });

  it("says cancelled when the person backs out of the share sheet, and downloads nothing", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    setNavigator(vi.fn(async () => { throw abort; }), vi.fn(() => true));
    expect(await savePicture(blob, "Plan.png")).toBe("cancelled");
    expect(clicked).toHaveLength(0);
  });

  it("downloads when sharing files is not offered", async () => {
    setNavigator(vi.fn(), vi.fn(() => false));
    expect(await savePicture(blob, "Plan.png")).toBe("downloaded");
    expect(clicked).toEqual([{ download: "Plan.png", href: "blob:fake" }]);
  });

  it("downloads on a browser with no share at all", async () => {
    setNavigator(undefined, undefined);
    expect(await savePicture(blob, "Plan.png")).toBe("downloaded");
    expect(clicked[0].download).toBe("Plan.png");
  });

  it("downloads when the share fails for another reason", async () => {
    setNavigator(vi.fn(async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); }), vi.fn(() => true));
    expect(await savePicture(blob, "Plan.png")).toBe("downloaded");
    expect(clicked).toHaveLength(1);
  });

  it("lets the object address go afterwards, and leaves no link behind", async () => {
    setNavigator(undefined, undefined);
    await savePicture(blob, "Plan.png");
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
