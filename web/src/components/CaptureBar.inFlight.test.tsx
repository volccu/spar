// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureBar } from "./CaptureBar";

afterEach(cleanup);

describe("capture with a file in flight", () => {
  it("a second Enter while the file is still being taken in does not also save the words alone", async () => {
    const onCapture = vi.fn();
    let finish: (made: boolean) => void = () => {};
    const onCaptureFiles = vi.fn(
      () => new Promise<boolean>((resolve) => { finish = resolve; }),
    );
    const { container } = render(
      <CaptureBar
        onCapture={onCapture}
        onCaptureFiles={onCaptureFiles}
        onDraw={vi.fn()}
        menuOpen={false}
        onMenu={vi.fn()}
        boards={[]}
        onCreateBoard={vi.fn()}
      />,
    );
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "receipt for the tyres" } });
    const picker = container.querySelector<HTMLInputElement>("input[type='file']")!;
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    fireEvent.change(picker);
    fireEvent.keyDown(field, { key: "Enter" }); // first Enter: file + words
    await act(async () => {});
    fireEvent.keyDown(field, { key: "Enter" }); // impatient second Enter, HEIC still converting
    await act(async () => { finish(true); });
    expect(onCaptureFiles).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });
});
