// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { note } from "../test/fixtures";
import { ReminderPanel } from "./ReminderPanel";

afterEach(cleanup);

/** The custom time: a past one is refused, and the panel says so. */
describe("the reminder panel's custom time", () => {
  function panel() {
    const onSetReminder = vi.fn();
    render(
      <ReminderPanel
        note={note({ id: "r1" })}
        pushStatus="on"
        onSetReminder={onSetReminder}
        onClose={() => {}}
      />,
    );
    return { onSetReminder, field: screen.getByLabelText("Custom reminder time") };
  }

  it("says a time that has passed is refused, and sets nothing", () => {
    const { onSetReminder, field } = panel();
    fireEvent.change(field, { target: { value: "2026-01-01T09:00" } });
    expect(screen.getByText("That time has passed. Pick a later one.")).toBeTruthy();
    expect(onSetReminder).not.toHaveBeenCalled();
  });

  it("drops the line when a good time is given", () => {
    const { onSetReminder, field } = panel();
    fireEvent.change(field, { target: { value: "2026-01-01T09:00" } });
    fireEvent.change(field, { target: { value: "2099-01-01T09:00" } });
    expect(screen.queryByText("That time has passed. Pick a later one.")).toBeNull();
    expect(onSetReminder).toHaveBeenCalledTimes(1);
  });
});
