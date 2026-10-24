// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordSignIn } from "./PasswordSignIn";
import type { SignupState } from "../store/backend";

afterEach(cleanup);

/**
 * The spår server's sign-in: an address and a password, and a way to make an
 * account only where the server says one may be made. What is held here is
 * that the form never offers a door the server has shut, that it says who
 * opens it instead, and that the way out to this device alone is always there.
 */

function form(signup: SignupState | null, error: string | null = null) {
  const props = {
    signup,
    error,
    onSignIn: vi.fn(),
    onSignUp: vi.fn(),
    onSkip: vi.fn(),
  };
  render(<PasswordSignIn {...props} />);
  return props;
}

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}

describe("PasswordSignIn", () => {
  it("signs in with the address and password, and offers nothing more on a closed server", () => {
    const props = form({ mode: "closed", firstAccount: false });
    fill("  me@example.com ", "correct horse");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(props.onSignIn).toHaveBeenCalledWith("me@example.com", "correct horse");
    expect(props.onSignUp).not.toHaveBeenCalled();

    expect(screen.queryByRole("button", { name: /make/i })).toBeNull();
    expect(screen.getByText(/made by whoever runs this server/i)).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).autocomplete).toBe(
      "current-password",
    );
  });

  it("treats a server that has not answered yet as closed", () => {
    form(null);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /make/i })).toBeNull();
  });

  it("makes the first account on a new server, and offers nothing else", () => {
    const props = form({ mode: "closed", firstAccount: true });
    expect(screen.getByText(/no one has an account here yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    fill("owner@example.com", "long enough");
    fireEvent.click(screen.getByRole("button", { name: "Make account" }));
    expect(props.onSignUp).toHaveBeenCalledWith("owner@example.com", "long enough", undefined);
  });

  it("lets anyone make an account on an open server, and go back to signing in", () => {
    const props = form({ mode: "open", firstAccount: false });
    fireEvent.click(screen.getByRole("button", { name: "No account? Make one" }));
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).autocomplete).toBe(
      "new-password",
    );
    fill("new@example.com", "hunter22");
    fireEvent.click(screen.getByRole("button", { name: "Make account" }));
    expect(props.onSignUp).toHaveBeenCalledWith("new@example.com", "hunter22", undefined);

    fireEvent.click(screen.getByRole("button", { name: "Have an account? Sign in" }));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("says a request is out, and waits for it", () => {
    const props = {
      signup: { mode: "open", firstAccount: false } as SignupState,
      error: null,
      onSignIn: vi.fn(),
      onSignUp: vi.fn(),
      onSkip: vi.fn(),
    };
    const { rerender } = render(<PasswordSignIn {...props} busy />);
    expect((screen.getByRole("button", { name: "Signing in…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "No account? Make one" }));
    rerender(<PasswordSignIn {...props} busy />);
    expect((screen.getByRole("button", { name: "Making account…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("clears the old error when it switches between signing in and making an account", () => {
    const onSwitch = vi.fn();
    render(
      <PasswordSignIn
        signup={{ mode: "open", firstAccount: false }}
        error="Old words."
        onSignIn={vi.fn()}
        onSignUp={vi.fn()}
        onSkip={vi.fn()}
        onSwitch={onSwitch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "No account? Make one" }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("keeps the invite code from being capitalised or corrected", () => {
    form({ mode: "invite", firstAccount: false });
    fireEvent.click(screen.getByRole("button", { name: "Have an invite? Make an account" }));
    const field = screen.getByLabelText("Invite code");
    expect(field.getAttribute("autocapitalize")).toBe("none");
    expect(field.getAttribute("autocorrect")).toBe("off");
  });

  it("asks for the invite on an invite-only server", () => {
    const props = form({ mode: "invite", firstAccount: false });
    // Signing in needs no invite.
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Have an invite? Make an account" }));
    fill("friend@example.com", "hunter22");
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: " ABC-123 " } });
    fireEvent.click(screen.getByRole("button", { name: "Make account" }));
    expect(props.onSignUp).toHaveBeenCalledWith("friend@example.com", "hunter22", "ABC-123");
  });

  it("says what went wrong where a reader hears it, and always offers this device alone", () => {
    const props = form({ mode: "closed", firstAccount: false }, "This server cannot sign anyone in yet.");
    expect(screen.getByRole("alert").textContent).toBe("This server cannot sign anyone in yet.");
    fireEvent.click(screen.getByRole("button", { name: "Use on this device only" }));
    expect(props.onSkip).toHaveBeenCalled();
  });
});
