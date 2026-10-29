// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { note } from "../test/fixtures";
import { ReminderPanel } from "./ReminderPanel";

afterEach(cleanup);

/** The picker: a day and a time, and nothing set until Set is pressed. */
describe("the reminder panel's date picker", () => {
  async function picker(n = note({ id: "r1" })) {
    const onSetReminder = vi.fn();
    const onSetRepeat = vi.fn();
    const onClose = vi.fn();
    render(
      <ReminderPanel
        note={n}
        pushStatus="on"
        onSetReminder={onSetReminder}
        onSetRepeat={onSetRepeat}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pick a date" }));
    // The picker is its own chunk, fetched when the panel opens.
    await screen.findByRole("group", { name: "Day" });
    return { onSetReminder, onSetRepeat, onClose };
  }

  const setRow = () => screen.getByRole("menuitem", { name: /^(Set for|Pick a day|That time)/ });

  it("asks for a day before it will set anything", async () => {
    await picker();
    expect(setRow().textContent).toContain("Pick a day");
    expect((setRow() as HTMLButtonElement).disabled).toBe(true);
  });

  it("sets the day and typed time picked, then closes", async () => {
    const { onSetReminder, onClose } = await picker();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: /^\w{3} 15 \w{3}$/ }));
    const time = screen.getByLabelText("Reminder time");
    fireEvent.change(time, { target: { value: "1430" } });
    fireEvent.blur(time);
    expect((time as HTMLInputElement).value).toBe("14:30");
    expect(setRow().textContent).toMatch(/^Set for .* 14:30$/);
    fireEvent.click(setRow());
    const at = new Date(onSetReminder.mock.calls[0][1]);
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    expect([at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([next.getMonth(), 15, 14, 30]);
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses a time today that has already passed", async () => {
    const { onSetReminder } = await picker();
    const today = document.querySelector<HTMLButtonElement>(".pick-day[data-today]")!;
    fireEvent.click(today);
    const time = screen.getByLabelText("Reminder time");
    fireEvent.change(time, { target: { value: "00:00" } });
    fireEvent.blur(time);
    expect(setRow().textContent).toContain("That time has passed");
    fireEvent.click(setRow());
    expect(onSetReminder).not.toHaveBeenCalled();
  });

  it("puts back a time that is not one", async () => {
    await picker();
    const time = screen.getByLabelText("Reminder time") as HTMLInputElement;
    fireEvent.change(time, { target: { value: "25:99" } });
    fireEvent.blur(time);
    expect(time.value).toBe("09:00");
  });

  it("steps the time a quarter of an hour", async () => {
    await picker();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect((screen.getByLabelText("Reminder time") as HTMLInputElement).value).toBe("09:15");
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect((screen.getByLabelText("Reminder time") as HTMLInputElement).value).toBe("08:45");
  });

  it("goes back to the times without setting anything", async () => {
    const { onSetReminder } = await picker();
    fireEvent.click(screen.getByRole("button", { name: "Back to reminder times" }));
    expect(screen.getByRole("menuitemradio", { name: "Pick a date" })).toBeTruthy();
    expect(onSetReminder).not.toHaveBeenCalled();
  });

  it("offers no month before this one", async () => {
    await picker();
    expect((screen.getByRole("button", { name: "Previous month" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/** Repeat: one row of answers, the one in force pressed. */
describe("the reminder panel's repeat row", () => {
  it("writes the rule picked, and Never takes it off", () => {
    const onSetRepeat = vi.fn();
    render(
      <ReminderPanel
        note={note({ id: "r2", reminder_at: new Date(Date.now() + 3_600_000).toISOString(), reminder_repeat: "daily" })}
        pushStatus="on"
        onSetReminder={() => {}}
        onSetRepeat={onSetRepeat}
        onClose={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "Repeat" });
    expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe("Day");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onSetRepeat).toHaveBeenLastCalledWith("r2", "weekly");
    fireEvent.click(screen.getByRole("button", { name: "Never" }));
    expect(onSetRepeat).toHaveBeenLastCalledWith("r2", null);
  });
});
