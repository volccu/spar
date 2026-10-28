// netguard.ts — which addresses the Supabase functions may reach on a user's
// behalf (audit 2026-10-10, SEC-3).
//
// The one copy of the address rules: the self-hosted server's guard
// (`server/src/netguard.ts`) imports the pure parts below and adds only what
// is its own. It replaced the older `publicUrl.ts` and closes what that one
// left open:
//
//   - an IPv6 address that *embeds* an IPv4 one is judged by the IPv4 inside —
//     IPv4-mapped and -compatible forms, NAT64 `64:ff9b::/96` (so
//     `64:ff9b::a9fe:a9fe` is 169.254.169.254, the cloud metadata address),
//     6to4 `2002::/16`; the NAT64 local-use prefix and Teredo are refused
//     outright, and only global unicast IPv6 (`2000::/3`, minus its special
//     blocks) is public at all;
//   - only ports 80 and 443 (or the scheme's own default) may be asked for, so
//     a public host cannot be used to knock on its own other services (the
//     functions' `publicUrlShape` alone; the server judges ports in
//     `pinnedFetch.ts` and `push.ts`, and keeps a shape check of its own);
//   - a name is resolved through both record families and refused if **any**
//     answer is private.
//
// Pure, with the resolver handed in, and free of imports, so the root suite
// tests it without Deno (`tests/netguard.test.ts`), `link-preview` hands it
// `Deno.resolveDns`, and the server's esbuild bundle carries it unchanged.
//
// What it cannot close: Deno's `fetch` resolves the name again on its own and
// offers no way to pin the connection to the address checked here (the
// self-hosted server's `pinnedFetch.ts` does exactly that, through Node's
// `lookup` hook). A name that answers a public address to the check and a
// private one to the fetch a moment later — DNS rebinding — therefore remains
// a residual risk on Supabase. The check is repeated before every request and
// every redirect, which narrows that window and does not shut it.

/** IPv4 as four octets, or null. Only the dotted-quad form (what DNS returns
 *  and what the URL parser normalises every other spelling to). */
export function v4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

export function isPrivateIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // this network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // IETF assignments and TEST-NET-1 (192.0.0/24, 192.0.2/24)
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** An IPv6 address as 16 bytes, or null. Handles `::`, a zone and a trailing dotted quad. */
export function parseIPv6(input: string): Uint8Array | null {
  let text = input.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // Deno has no `node:net`, so the shape is checked by hand and the parse
  // below does the rest. The server asks Node's `isIP` first as well, which
  // also refuses a dotted quad with a leading zero (`server/src/netguard.ts`).
  if (!text.includes(":") || !/^[\da-f:.]+$/.test(text)) return null;
  // A trailing dotted quad becomes the two hex groups it stands for.
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const quad = v4(last);
    if (!quad) return null;
    text = `${text.slice(0, lastColon + 1)}${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const back = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = (list: string[]) => list.map((h) => (/^[\da-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  let words: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - back.length;
    if (fill < 1) return null;
    words = [...groups(head), ...new Array<number>(fill).fill(0), ...groups(back)];
  } else {
    words = groups(head);
  }
  if (words.length !== 8 || words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return null;
  const bytes = new Uint8Array(16);
  words.forEach((w, i) => {
    bytes[i * 2] = w >> 8;
    bytes[i * 2 + 1] = w & 0xff;
  });
  return bytes;
}

function startsWith(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const mask = 0x80 >> (i & 7);
    const want = ((prefix[byte] ?? 0) & mask) !== 0;
    const have = (bytes[byte] & mask) !== 0;
    if (want !== have) return false;
  }
  return true;
}

export function isPrivateIPv6(bytes: Uint8Array): boolean {
  const embedded = (offset: number) => isPrivateIPv4([...bytes.subarray(offset, offset + 4)]);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, deprecated,
  // which includes :: and ::1): judged by the IPv4 address inside.
  if (startsWith(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return embedded(12);
  if (startsWith(bytes, [], 96)) return true;
  // NAT64, well-known prefix (RFC 6052): public only if what it maps to is.
  if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b], 96)) return embedded(12);
  // NAT64, local-use prefix (RFC 8215): a network's own translator, never public.
  if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48)) return true;
  // 6to4 (RFC 3056): the IPv4 address is bits 16–47.
  if (startsWith(bytes, [0x20, 0x02], 16)) return embedded(2);
  // Everything outside global unicast 2000::/3 is not the public internet:
  // ::/8, 100::/64 discard, fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast…
  if (!startsWith(bytes, [0x20], 3)) return true;
  // Special blocks inside 2000::/3.
  if (startsWith(bytes, [0x20, 0x01, 0x00, 0x00], 32)) return true; // Teredo: hides an IPv4 address
  if (startsWith(bytes, [0x20, 0x01, 0x00, 0x00], 23)) return true; // IETF protocol assignments
  if (startsWith(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return true; // documentation
  if (startsWith(bytes, [0x3f, 0xff], 20)) return true; // documentation (RFC 9637)
  return false;
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

/** Names that are never the public internet, whatever they resolve to. */
export const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);

/** The ports a fetch may name: the scheme's default (written as ""), 80 and 443. */
const PORTS = new Set(["", "80", "443"]);

/**
 * A URL a function may be asked to fetch, before any lookup: http(s), port 80
 * or 443, no credentials, no local or metadata names, no IPv6 literal at all,
 * no private IPv4 literal, no integer host. Null when refused.
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
  if (!PORTS.has(url.port)) return null;
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

/** `Deno.resolveDns`, narrowed to the two record families asked here. */
export type Resolver = (hostname: string, type: "A" | "AAAA") => Promise<string[]>;

/**
 * A URL that passed `publicUrlShape` **and** whose name resolves only to
 * public addresses, through both record families; null otherwise. A name
 * that resolves to nothing at all is refused too — there is nothing to judge.
 *
 * Asked before every request and every redirect. It cannot make the fetch use
 * the address it checked — see the head of this file.
 */
export async function publicUrl(raw: unknown, resolve: Resolver): Promise<URL | null> {
  const judged = await judgeUrl(raw, resolve);
  return judged instanceof URL ? judged : null;
}

/**
 * `publicUrl`, telling a refusal apart from a lookup that merely failed. A
 * resolver timing out or answering SERVFAIL says nothing about the page, and
 * answered as a refusal (400) it stamped the link "no preview" for good on the
 * client, which takes 400 as a verdict. `"lookup-failed"` is for the caller to
 * answer with a status the client asks again after.
 */
export async function judgeUrl(raw: unknown, resolve: Resolver): Promise<URL | null | "lookup-failed"> {
  const url = publicUrlShape(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  // A public IPv4 literal has nothing to resolve; the shape check judged it.
  if (v4(host)) return url;

  let resolved = false;
  let failed = false;
  for (const type of ["A", "AAAA"] as const) {
    let addresses: string[];
    try {
      addresses = await resolve(host, type);
    } catch (error) {
      // A host may legitimately have only one record family: Deno answers
      // `NotFound` for a name or family with no records. Anything else is the
      // lookup itself failing.
      if ((error as { name?: string } | null)?.name !== "NotFound") failed = true;
      continue;
    }
    if (addresses.length > 0) resolved = true;
    if (addresses.some((address) => isPrivateAddress(address))) return null;
  }
  if (resolved) return url;
  return failed ? "lookup-failed" : null;
}
