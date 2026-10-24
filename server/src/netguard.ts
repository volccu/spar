/**
 * Which addresses the server may reach on a user's behalf — the protections of
 * docs/sync-contract.md §13. An IPv6 address that *embeds* a private IPv4 one
 * (NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-mapped and -compatible forms)
 * is private, and only global unicast IPv6 (`2000::/3`, minus its special
 * blocks) is public at all.
 *
 * The rules themselves are the Supabase functions' own file,
 * `supabase/functions/_shared/netguard.ts`, imported, so the two backends
 * cannot drift apart again. What stays here is the server's: Node's `isIP` in
 * front of the IPv6 parser, and a shape check without the functions' port
 * rule — `pinnedFetch` and the push subscription judge the port themselves.
 *
 * Used for link previews and for Web Push endpoints alike: both are addresses
 * a user hands the server and asks it to connect to.
 */
import { isIP } from "node:net";
import {
  BLOCKED_NAMES,
  isPrivateIPv4,
  isPrivateIPv6,
  parseIPv6 as parseIPv6Text,
  v4,
} from "../../supabase/functions/_shared/netguard";

/**
 * An IPv6 address as 16 bytes, or null. Handles `::`, a zone and a trailing
 * dotted quad. Node reads the address first: it refuses a dotted quad with a
 * leading zero (`::ffff:01.1.1.1`), which the shared parser alone would take
 * for 1.1.1.1.
 */
export function parseIPv6(input: string): Uint8Array | null {
  let text = input.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (isIP(text) !== 6) return null;
  return parseIPv6Text(text);
}

/** Whether an IP address (either family, any usual spelling) is not public. */
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  const quad = v4(bare);
  if (quad) return isPrivateIPv4(quad);
  const bytes = parseIPv6(bare);
  // Anything that is not recognisably an address is refused, not guessed at.
  return bytes === null ? true : isPrivateIPv6(bytes);
}

/**
 * A URL the server may be asked to fetch, before any lookup: http(s), no
 * credentials, no local or metadata names, no IPv6 literal at all, no private
 * IPv4 literal, no integer host. Null when refused.
 */
export function publicUrlShape(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return null;
  if (host.startsWith("[") || host.includes(":")) return null; // every IPv6 literal
  if (BLOCKED_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return null;
  }
  if (/^\d+$/.test(host) || /^0x[\da-f]+$/i.test(host)) return null;
  const quad = v4(host);
  if (quad && isPrivateIPv4(quad)) return null;
  // Any other all-numeric-and-dots spelling the parser left alone is suspect.
  if (!quad && /^[\d.]+$/.test(host)) return null;
  return url;
}
