// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSupported, pushState, enablePush, disablePush, refreshPush } from "./push";

/**
 * push.ts registers this device with the browser's own push service so a
 * reminder set here can actually ring. Every browser API it touches — the
 * service worker container, PushManager, Notification — is simply absent in
 * jsdom, so each test below installs just enough of a fake version of each to
 * drive the module through its states, and tears them back down afterwards
 * so no test's browser leaks into the next one.
 */

/** Whether the mocked backend thinks Supabase is configured at all. */
let mockSyncConfigured = true;
/** The signed-in user id, or null for signed out. */
let currentUserId: string | null = "user-1";
/** Rows the client tried to upsert into push_subscriptions, for inspection. */
let upsertedRows: Record<string, unknown>[] = [];
/** The onConflict options passed with each upsert. */
let upsertedOpts: Record<string, unknown>[] = [];
/** Endpoints the client asked the server to delete. */
let deletedEndpoints: string[] = [];

vi.mock("./supabase", () => {
  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: currentUserId ? { user: { id: currentUserId } } : null },
      }),
    },
    from() {
      return {
        async upsert(row: Record<string, unknown>, opts: Record<string, unknown>) {
          upsertedRows.push(row);
          upsertedOpts.push(opts);
          return { error: null };
        },
        delete() {
          return {
            async eq(_col: string, endpoint: string) {
              deletedEndpoints.push(endpoint);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return {
    getSupabase: async () => supabase,
    // A getter, not a plain value: `syncConfigured` is a live import binding
    // in push.ts, and a test flipping `mockSyncConfigured` needs that read to
    // pick up the new value without re-importing the module.
    get syncConfigured() {
      return mockSyncConfigured;
    },
  };
});

/** A push subscription shaped the way the browser hands one back. */
type FakeSubscription = {
  endpoint: string;
  toJSON: () => { keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
};

function subscription(endpoint = "https://push.example/device-1"): FakeSubscription {
  return {
    endpoint,
    toJSON: () => ({ keys: { p256dh: "p256dh-value", auth: "auth-value" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

type SubscribeOptions = { userVisibleOnly: boolean; applicationServerKey: Uint8Array };

/** A service worker registration, with just the pushManager corner push.ts touches. */
function registration(
  opts: { existing?: FakeSubscription; subscribeReturns?: FakeSubscription } = {},
) {
  // What each call to subscribe() was asked for, so a test can inspect the
  // options without leaning on vi.fn's own (differently-typed) call log.
  const subscribeCalls: SubscribeOptions[] = [];
  return {
    pushManager: {
      getSubscription: vi.fn(async () => opts.existing),
      subscribe: vi.fn(async (subscribeOpts: SubscribeOptions) => {
        subscribeCalls.push(subscribeOpts);
        return opts.subscribeReturns ?? subscription("https://push.example/new");
      }),
    },
    subscribeCalls,
  };
}

/** Installs `navigator.serviceWorker` with a fixed registration (or none at all). */
function installServiceWorker(
  reg: ReturnType<typeof registration> | undefined,
  opts: { readyRejects?: boolean } = {},
) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => reg),
      get ready() {
        return opts.readyRejects
          ? Promise.reject(new Error("service worker never activated"))
          : Promise.resolve(reg);
      },
    },
  });
}

function removeServiceWorker() {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
}

function installPushManager() {
  Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
}

function removePushManager() {
  delete (window as { PushManager?: unknown }).PushManager;
}

/** What `Notification.permission` currently reads as. */
let notificationPermission: NotificationPermission = "default";
/** What the next `Notification.requestPermission()` call resolves to. */
let requestPermissionResult: NotificationPermission = "granted";

function installNotification() {
  class FakeNotification {
    static requestPermission = vi.fn(async () => requestPermissionResult);
  }
  // `permission` is read-only on the real thing, so it is wired as a getter
  // over the mutable variable above rather than a plain assignable field.
  Object.defineProperty(FakeNotification, "permission", {
    configurable: true,
    get: () => notificationPermission,
  });
  Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
}

function removeNotification() {
  delete (window as { Notification?: unknown }).Notification;
}

/** Any well-formed base64url string will do; the fake PushManager never checks it. */
const TEST_VAPID_KEY = "BExampleVapidPublicKey_forTestsOnly-0123456789abcdef";

beforeEach(() => {
  // The key is an instance's own setting, read from the env on each call, so
  // the suite behaves the same with or without a web/.env on the machine.
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", TEST_VAPID_KEY);
  mockSyncConfigured = true;
  currentUserId = "user-1";
  upsertedRows = [];
  upsertedOpts = [];
  deletedEndpoints = [];
  notificationPermission = "default";
  requestPermissionResult = "granted";
  // A fully supported browser, asked nothing yet, is the baseline every test
  // starts from; each one narrows or replaces a piece of it.
  installServiceWorker(registration());
  installPushManager();
  installNotification();
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeServiceWorker();
  removePushManager();
  removeNotification();
});

describe("pushSupported", () => {
  it("is false with no service worker container", () => {
    removeServiceWorker();
    expect(pushSupported()).toBe(false);
  });

  it("is false with no PushManager", () => {
    removePushManager();
    expect(pushSupported()).toBe(false);
  });

  it("is false with no Notification", () => {
    removeNotification();
    expect(pushSupported()).toBe(false);
  });

  it("is false when there is no server to register with", () => {
    mockSyncConfigured = false;
    expect(pushSupported()).toBe(false);
  });

  it("is false when the build carries no signing key", () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
    expect(pushSupported()).toBe(false);
  });

  it("is true once everything the device needs is present", () => {
    expect(pushSupported()).toBe(true);
  });
});

describe("pushState", () => {
  it("is unavailable with no support", async () => {
    removeServiceWorker();
    expect(await pushState()).toBe("unavailable");
  });

  it("is denied once the user has refused, whatever the registration says", async () => {
    notificationPermission = "denied";
    expect(await pushState()).toBe("denied");
  });

  it("is on once a subscription already exists", async () => {
    notificationPermission = "granted";
    installServiceWorker(registration({ existing: subscription() }));
    expect(await pushState()).toBe("on");
  });

  it("is askable when permission is granted but nothing is subscribed yet", async () => {
    notificationPermission = "granted";
    expect(await pushState()).toBe("askable");
  });

  it("is askable when permission has simply not been asked for yet", async () => {
    notificationPermission = "default";
    expect(await pushState()).toBe("askable");
  });
});

describe("enablePush", () => {
  it("returns denied when the user refuses the permission prompt", async () => {
    requestPermissionResult = "denied";
    expect(await enablePush()).toBe("denied");
    expect(upsertedRows).toHaveLength(0);
  });

  it("stays askable when the prompt is merely dismissed", async () => {
    requestPermissionResult = "default";
    expect(await enablePush()).toBe("askable");
  });

  it("reuses an existing subscription rather than subscribing a second time", async () => {
    const existing = subscription("https://push.example/existing");
    const reg = registration({ existing });
    installServiceWorker(reg);

    expect(await enablePush()).toBe("on");
    // `existing ?? subscribe(...)` short-circuits — the browser never
    // gets asked to mint a subscription it already handed over.
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes with userVisibleOnly and a real signing key when there is nothing to reuse", async () => {
    const reg = registration();
    installServiceWorker(reg);

    await enablePush();

    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1);
    const call = reg.subscribeCalls[0];
    expect(call.userVisibleOnly).toBe(true);
    expect(call.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(call.applicationServerKey.length).toBeGreaterThan(0);
  });

  it("upserts a row carrying the subscription's own endpoint and keys on success", async () => {
    const sub = subscription("https://push.example/mine");
    installServiceWorker(registration({ subscribeReturns: sub }));

    await enablePush();

    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0]).toMatchObject({
      endpoint: "https://push.example/mine",
      p256dh: "p256dh-value",
      auth: "auth-value",
      failed_at: null,
    });
    expect(upsertedOpts[0]).toEqual({ onConflict: "endpoint" });
  });

  it("never stores an endpoint that is not https (audit SEC-3, migration 0029)", async () => {
    installServiceWorker(registration({ subscribeReturns: subscription("http://push.example/plain") }));

    expect(await enablePush()).toBe("askable");
    expect(upsertedRows).toHaveLength(0);
  });

  it("does not claim to be on when signed out, because no row was written", async () => {
    currentUserId = null;
    installServiceWorker(registration());

    // The browser will have handed over a subscription either way — but the
    // sweep sends to rows in push_subscriptions, so a device the upsert never
    // reached is a device that will never be told anything. Reporting "on"
    // here is the app promising a sound it cannot make, which is the fault
    // reminders were built to end. "askable" keeps it retryable.
    expect(await enablePush()).toBe("askable");
    expect(upsertedRows).toHaveLength(0);
  });
});

describe("disablePush", () => {
  it("unsubscribes and deletes the row keyed by that endpoint", async () => {
    const sub = subscription("https://push.example/leaving");
    installServiceWorker(registration({ existing: sub }));

    expect(await disablePush()).toBe("askable");
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(deletedEndpoints).toEqual(["https://push.example/leaving"]);
  });

  it("does nothing when there was no subscription to begin with", async () => {
    installServiceWorker(registration());
    expect(await disablePush()).toBe("askable");
    expect(deletedEndpoints).toHaveLength(0);
  });

  it("is unavailable with no support", async () => {
    removeServiceWorker();
    expect(await disablePush()).toBe("unavailable");
  });
});

describe("refreshPush", () => {
  it("does nothing when permission has not been granted", async () => {
    notificationPermission = "default";
    await expect(refreshPush()).resolves.toBeUndefined();
    expect(upsertedRows).toHaveLength(0);
  });

  /**
   * The one that matters most: refreshPush runs on every app startup, and a
   * push service having a bad day must never be the reason the app itself
   * fails to load.
   */
  it("swallows a rejection from navigator.serviceWorker.ready rather than throwing", async () => {
    notificationPermission = "granted";
    installServiceWorker(registration(), { readyRejects: true });

    await expect(refreshPush()).resolves.toBeUndefined();
    expect(upsertedRows).toHaveLength(0);
  });

  it("does nothing when the browser has no support at all", async () => {
    removeServiceWorker();
    await expect(refreshPush()).resolves.toBeUndefined();
  });

  it("re-stores the current subscription when granted and already subscribed", async () => {
    notificationPermission = "granted";
    const sub = subscription("https://push.example/refresh-me");
    installServiceWorker(registration({ existing: sub }));

    await refreshPush();

    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0]).toMatchObject({ endpoint: "https://push.example/refresh-me" });
  });

  it("replaces a subscription made under an old signing key, here and on the server", async () => {
    notificationPermission = "granted";
    const old = Object.assign(subscription("https://push.example/old-key"), {
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    });
    const reg = registration({ existing: old, subscribeReturns: subscription("https://push.example/new-key") });
    installServiceWorker(reg);

    await refreshPush();

    expect(old.unsubscribe).toHaveBeenCalled();
    expect(deletedEndpoints).toEqual(["https://push.example/old-key"]);
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0]).toMatchObject({ endpoint: "https://push.example/new-key" });
  });
});
