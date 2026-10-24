import { afterEach, describe, expect, it, vi } from "vitest";
import { askToKeep, resetAskedForTests, storageKept } from "./keepStorage";

function stubStorage(value: Partial<StorageManager> | undefined) {
  vi.stubGlobal("navigator", { ...navigator, storage: value });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetAskedForTests();
});

describe("askToKeep", () => {
  it("asks once per session, however many writes arrive", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => false, persist });
    await Promise.all([askToKeep(), askToKeep(), askToKeep()]);
    await askToKeep();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not ask when the browser already keeps the notes", async () => {
    const persist = vi.fn(async () => true);
    stubStorage({ persisted: async () => true, persist });
    expect(await askToKeep()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports a refusal as false", async () => {
    stubStorage({ persisted: async () => false, persist: async () => false });
    expect(await askToKeep()).toBe(false);
  });

  it("is null, never a throw, where the browser has no storage manager", async () => {
    stubStorage(undefined);
    expect(await askToKeep()).toBeNull();
    expect(await storageKept()).toBeNull();
  });

  it("is null, never a throw, when the browser throws", async () => {
    stubStorage({
      persisted: async () => {
        throw new Error("nope");
      },
      persist: async () => true,
    });
    expect(await askToKeep()).toBeNull();
  });
});
