// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * One sign-in mail per tap (bughunt 2026-10-15): a double tap sent two, and
 * the second made the first link stop working.
 */

const sendLink = vi.fn(
  () => new Promise<{ error: null }>((resolve) => setTimeout(() => resolve({ error: null }), 20)),
);

vi.mock("./supabase", () => ({ syncConfigured: true }));
vi.mock("./backend", () => ({
  getBackend: async () => ({
    auth: { kind: "magic-link", sendLink },
    session: async () => null,
    onSessionChange: () => () => {},
  }),
}));

import { useAuth } from "./useAuth";

describe("sending a sign-in link", () => {
  it("sends one mail for a double tap", async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await Promise.all([result.current.signIn("a@example.com"), result.current.signIn("a@example.com")]);
    });
    await waitFor(() => expect(result.current.sent).toBe(true));
    expect(sendLink).toHaveBeenCalledTimes(1);
  });
});
