// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { takeLinkError } from "./linkError";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("takeLinkError", () => {
  it("says an expired link in plain words, and takes it out of the address", () => {
    window.history.replaceState(
      null,
      "",
      "/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(takeLinkError()).toBe("That sign-in link has expired or was already used. Send a new one.");
    expect(window.location.hash).toBe("");
    expect(takeLinkError()).toBe(null);
  });

  it("reads the refusal from the query too, keeping the rest of it", () => {
    window.history.replaceState(null, "", "/?do=capture&error=server_error&error_description=Oops");
    expect(takeLinkError()).toBe("That sign-in link did not work. Send a new one.");
    expect(window.location.search).toBe("?do=capture");
  });

  it("leaves a link that worked for the sign-in client", () => {
    window.history.replaceState(null, "", "/#access_token=abc&type=magiclink");
    expect(takeLinkError()).toBe(null);
    expect(window.location.hash).toBe("#access_token=abc&type=magiclink");
  });
});
