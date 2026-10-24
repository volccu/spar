/**
 * A sign-up the instance will refuse costs it nothing (audit SEC-4): the
 * sign-up setting is read before the password is hashed, so a closed or
 * invite-only instance does not run 32 MiB of scrypt for anyone who asks.
 */
import { scrypt } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, startServer, type Running } from "./helpers";

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return { ...real, scrypt: vi.fn(real.scrypt) };
});

describe("a refused sign-up", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("is refused before any password is hashed on a closed instance", async () => {
    s = await startServer({ signup: "closed" });
    expect((await new Client(s.url).signUp()).status).toBe(201);
    const before = vi.mocked(scrypt).mock.calls.length;
    const refused = await new Client(s.url).signUp();
    expect(refused.body?.code).toBe("signup_closed");
    expect(vi.mocked(scrypt).mock.calls.length).toBe(before);
  });

  it("is refused before any password is hashed without a valid invite", async () => {
    s = await startServer({ signup: "invite" });
    expect((await new Client(s.url).signUp()).status).toBe(201);
    const before = vi.mocked(scrypt).mock.calls.length;
    expect((await new Client(s.url).signUp(undefined, undefined, "not a code")).body?.code).toBe("invite_required");
    expect(vi.mocked(scrypt).mock.calls.length).toBe(before);
    // And a real invite still hashes and lets the account in.
    const { code } = s.app.accounts.createInvite(7);
    expect((await new Client(s.url).signUp(undefined, undefined, code)).status).toBe(201);
    expect(vi.mocked(scrypt).mock.calls.length).toBeGreaterThan(before);
  });
});
