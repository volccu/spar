import { describe, expect, it } from "vitest";
import { DEVICE_RETRY_MS, devicesToSend, doneAfter } from "../supabase/functions/_shared/deliveries";

// A reminder is delivered per device (bughunt 2026-10-24, migration 0031):
// a device whose push failed is tried again, and the occurrence closes once
// every device has it.

const AT = Date.parse("2026-10-25T09:00:00Z");

describe("which devices a due reminder still owes", () => {
  it("sends to every device the first time", () => {
    expect(devicesToSend(["phone", "laptop"], new Set(), AT, AT + 60_000)).toEqual({ send: ["phone", "laptop"], done: false });
  });

  it("sends only to the device that has not taken it yet", () => {
    expect(devicesToSend(["phone", "laptop"], new Set(["phone"]), AT, AT + 120_000)).toEqual({ send: ["laptop"], done: false });
  });

  it("closes once every live device has it", () => {
    expect(devicesToSend(["phone"], new Set(["phone"]), AT, AT + 60_000)).toEqual({ send: [], done: true });
  });

  it("stops trying a device that keeps failing an hour after the time, while another device has it", () => {
    expect(devicesToSend(["phone", "laptop"], new Set(["phone"]), AT, AT + DEVICE_RETRY_MS + 1).done).toBe(true);
  });

  it("keeps trying for the whole grace while no device has it", () => {
    expect(devicesToSend(["phone"], new Set(), AT, AT + DEVICE_RETRY_MS + 1)).toEqual({ send: ["phone"], done: false });
  });
});

describe("whether a sweep closes an occurrence", () => {
  it("does when every device took it", () => {
    expect(doneAfter([{ ok: true }, { ok: true }], 0)).toBe(true);
  });
  it("does not while a device got no answer", () => {
    expect(doneAfter([{ ok: true }, { ok: false }], 0)).toBe(false);
  });
  it("does when the only failure is a device gone for good", () => {
    expect(doneAfter([{ ok: true }, { ok: false, gone: true }], 0)).toBe(true);
  });
  it("does not when nothing anywhere took it", () => {
    expect(doneAfter([{ ok: false, gone: true }], 0)).toBe(false);
  });
  it("does when the device left this time took it and an earlier one already had it", () => {
    expect(doneAfter([{ ok: true }], 1)).toBe(true);
  });
});
