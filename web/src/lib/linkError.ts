/**
 * What a sign-in link that did not work says about itself (bughunt 2026-10-15).
 *
 * A link tapped after it expired, tapped twice, or opened in another browser
 * comes back to the app carrying the server's refusal in the address
 * (`#error=access_denied&error_code=otp_expired&error_description=…`). Nothing
 * read it, so the sign-in form came up blank, as if the tap had done nothing.
 *
 * Reads it once, in plain words, and takes it out of the address so a reload
 * does not say it again. A successful link (`#access_token=…`) is left alone
 * for the sign-in client to read.
 */
export function takeLinkError(): string | null {
  if (typeof window === "undefined") return null;
  const { hash, search, pathname } = window.location;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const query = new URLSearchParams(search);
  const from = params.has("error") || params.has("error_code") ? params : query;
  if (!from.has("error") && !from.has("error_code")) return null;
  const code = from.get("error_code") ?? "";
  const words = `${code} ${from.get("error_description") ?? ""}`;
  for (const key of ["error", "error_code", "error_description"]) query.delete(key);
  const rest = query.toString();
  window.history.replaceState(window.history.state, "", `${pathname}${rest ? `?${rest}` : ""}`);
  if (/expired|invalid|otp/i.test(words)) {
    return "That sign-in link has expired or was already used. Send a new one.";
  }
  return "That sign-in link did not work. Send a new one.";
}
