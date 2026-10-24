// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "./SignIn";

afterEach(cleanup);

/**
 * "Check your email" must not be a dead end. If the mail is slow, in spam, or
 * went to a subtly wrong address, the way out has to be on the screen — it
 * used to be reloading the page, which nobody should have to guess.
 */
describe("the sent screen has a way back", () => {
  function signIn(overrides: Partial<Parameters<typeof SignIn>[0]> = {}) {
    const props = {
      sent: false,
      error: null,
      onSignIn: vi.fn(),
      onSkip: vi.fn(),
      onBack: vi.fn(),
      ...overrides,
    };
    const view = render(<SignIn {...props} />);
    return { props, view };
  }

  it("offers a way back to the form once the link is sent", () => {
    const { props } = signIn({ sent: true });
    fireEvent.click(screen.getByRole("button", { name: /no email\? try again/i }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("says where the link went", () => {
    const { props, view } = signIn();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: " reader@example.com " },
    });
    view.rerender(<SignIn {...props} sent={true} />);
    expect(screen.getByText("Check your email. We sent a link to reader@example.com.")).toBeTruthy();
  });

  it("says a request is out, and waits for it", () => {
    const { props, view } = signIn({ busy: true });
    const send = screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    view.rerender(<SignIn {...props} sent busy onCode={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("requires the code", () => {
    render(<SignIn sent error={null} onSignIn={vi.fn()} onSkip={vi.fn()} onBack={vi.fn()} onCode={vi.fn()} />);
    expect((screen.getByLabelText("Type the code instead") as HTMLInputElement).required).toBe(true);
  });

  it("keeps the typed address through the round trip", () => {
    // The component stays mounted while `sent` flips, so the field's own
    // state is what carries the address back — assert that it actually does,
    // or "try another address" lands on an empty form.
    const { props, view } = signIn();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "reader@example.com" },
    });
    view.rerender(<SignIn {...props} sent={true} />);
    expect(screen.queryByLabelText("Email address")).toBeNull();
    view.rerender(<SignIn {...props} sent={false} />);
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe(
      "reader@example.com",
    );
  });

  it("says the link must be opened in this same browser", () => {
    // The magic link signs in whichever browser opens it, and an email app
    // will happily hand it to the wrong one. The one moment a warning helps
    // is while the person is on their way to the inbox.
    signIn({ sent: true });
    expect(screen.getByText(/this same browser/i)).toBeTruthy();
  });
});

/**
 * The email's code, typed instead of following its link (audit UX-11). The
 * link stays the first way; the code is for an app the link cannot reach — an
 * iPhone Home Screen install, whose storage is not Safari's.
 */
describe("the sent screen takes the code instead", () => {
  const base = { error: null, onSignIn: vi.fn(), onSkip: vi.fn(), onBack: vi.fn() };

  it("hands over the typed code, spaces and all taken out", () => {
    const onCode = vi.fn();
    render(<SignIn {...base} sent onCode={onCode} />);
    fireEvent.change(screen.getByLabelText("Type the code instead"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onCode).toHaveBeenCalledWith("123456");
  });

  it("asks nothing for an empty field", () => {
    const onCode = vi.fn();
    render(<SignIn {...base} sent onCode={onCode} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onCode).not.toHaveBeenCalled();
  });

  it("keeps the link's way, and offers the code only once the email is on its way", () => {
    const { rerender } = render(<SignIn {...base} sent={false} onCode={vi.fn()} />);
    expect(screen.queryByLabelText("Type the code instead")).toBeNull();
    rerender(<SignIn {...base} sent onCode={vi.fn()} />);
    expect(screen.getByText(/this same browser/i)).toBeTruthy();
    expect(screen.getByLabelText("Type the code instead")).toBeTruthy();
  });
});
