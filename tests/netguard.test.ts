import { describe, expect, it } from "vitest";
import {
  isPrivateAddress,
  parseIPv6,
  publicUrl,
  publicUrlShape,
  type Resolver,
} from "../supabase/functions/_shared/netguard";
import { TokenBucket } from "../supabase/functions/_shared/rateLimit";
import { pushEndpointOk, sendPush } from "../supabase/functions/_shared/webpush";

// The Supabase functions' address guard (audit 2026-10-10, SEC-3): the
// self-hosted server's rules (`server/test/units.test.ts` holds the same
// cases against `server/src/netguard.ts`), plus the resolver step, tested here
// with a stand-in for `Deno.resolveDns`.

/** A resolver that answers from a table, and throws for a family it lacks. */
function answers(table: Record<string, { A?: string[]; AAAA?: string[] }>): Resolver {
  return async (host, type) => {
    const list = table[host]?.[type];
    if (!list) throw new Error(`no ${type} record for ${host}`);
    return list;
  };
}

describe("addresses a function may reach", () => {
  it("refuses private and reserved IPv4", () => {
    for (const a of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["1.1.1.1", "93.184.215.14", "8.8.8.8"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("refuses IPv6 outside global unicast, and the special blocks inside it", () => {
    for (const a of ["::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "100::1", "2001:db8::1", "2001::1", "3fff::1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["2606:4700:4700::1111", "2a00:1450:4001:81d::200e"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("judges IPv4-mapped, NAT64 and 6to4 addresses by the IPv4 address inside, and refuses Teredo", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:1.1.1.1")).toBe(false);
    expect(isPrivateAddress("64:ff9b::10.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateAddress("64:ff9b::101:101")).toBe(false); // 1.1.1.1
    expect(isPrivateAddress("64:ff9b:1::1")).toBe(true); // local-use NAT64
    expect(isPrivateAddress("2002:c0a8:0101::1")).toBe(true); // 192.168.1.1
    expect(isPrivateAddress("2002:0101:0101::1")).toBe(false); // 1.1.1.1
    expect(isPrivateAddress("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true); // Teredo
  });

  it("parses the IPv6 spellings it meets, and refuses what it cannot read", () => {
    expect([...parseIPv6("::1")!]).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIPv6("::ffff:10.0.0.1")!.slice(12)).toEqual(new Uint8Array([10, 0, 0, 1]));
    expect(parseIPv6("fe80::1%eth0")).not.toBeNull();
    expect(parseIPv6("not an address")).toBeNull();
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(isPrivateAddress("garbage")).toBe(true);
  });

  it("refuses URL shapes before any lookup, other ports among them", () => {
    for (const bad of [
      "ftp://example.com/",
      "https://user:pw@example.com/",
      "http://localhost/",
      "http://localhost./",
      "http://x.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/",
      "http://anything.internal/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://[::1]/",
      "http://[2606:4700:4700::1111]/",
      "https://example.com:8443/",
      "http://example.com:22/",
      "https://example.com:6379/",
    ]) {
      expect(publicUrlShape(bad), bad).toBeNull();
    }
    for (const good of ["https://example.com/", "http://example.com:80/x", "https://example.com:443/x", "http://1.1.1.1/"]) {
      expect(publicUrlShape(good), good).not.toBeNull();
    }
  });
});

describe("a name, resolved", () => {
  it("is refused when a resolver answers the NAT64 spelling of the metadata address", async () => {
    const resolve = answers({ "sneaky.example": { A: ["93.184.215.14"], AAAA: ["64:ff9b::a9fe:a9fe"] } });
    expect(await publicUrl("https://sneaky.example/", resolve)).toBeNull();
  });

  it("is refused when any one of its addresses is private", async () => {
    expect(await publicUrl("https://two.example/", answers({ "two.example": { A: ["1.1.1.1", "10.0.0.1"] } }))).toBeNull();
    expect(await publicUrl("https://six.example/", answers({ "six.example": { AAAA: ["2002:7f00:0001::1"] } }))).toBeNull();
  });

  it("is refused when it resolves to nothing", async () => {
    expect(await publicUrl("https://nowhere.example/", answers({}))).toBeNull();
    expect(await publicUrl("https://empty.example/", answers({ "empty.example": { A: [], AAAA: [] } }))).toBeNull();
  });

  it("passes when every answer is public, in one family or both", async () => {
    const resolve = answers({
      "v4.example": { A: ["93.184.215.14"] },
      "both.example": { A: ["1.1.1.1"], AAAA: ["2606:4700:4700::1111"] },
    });
    expect((await publicUrl("https://v4.example/page", resolve))?.href).toBe("https://v4.example/page");
    expect(await publicUrl("https://both.example/", resolve)).not.toBeNull();
  });

  it("never asks the resolver about a URL whose shape is refused", async () => {
    let asked = 0;
    const resolve: Resolver = async () => {
      asked += 1;
      return ["1.1.1.1"];
    };
    expect(await publicUrl("https://example.com:8080/", resolve)).toBeNull();
    expect(await publicUrl("http://169.254.169.254/", resolve)).toBeNull();
    expect(asked).toBe(0);
  });
});

describe("the per-user preview limit", () => {
  it("grants a burst, then one more per refill, per user", () => {
    let now = 0;
    const bucket = new TokenBucket(3, 2_000, () => now);
    expect([bucket.take("a"), bucket.take("a"), bucket.take("a")]).toEqual([0, 0, 0]);
    expect(bucket.take("a")).toBe(2_000);
    expect(bucket.take("b")).toBe(0);
    now = 2_000;
    expect(bucket.take("a")).toBe(0);
    expect(bucket.take("a")).toBeGreaterThan(0);
  });
});

describe("where a push may be sent", () => {
  it("only to an https push service on the standard port", () => {
    expect(pushEndpointOk("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(pushEndpointOk("https://updates.push.services.mozilla.com:443/wpush/v2/x")).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/fcm/send/abc", "https://push.example:8443/x", "https://u:p@push.example/x", "ftp://push.example/", "not a url"]) {
      expect(pushEndpointOk(bad), bad).toBe(false);
    }
  });

  it("sends nothing to a plain-http endpoint, and says it is gone so it is retired", async () => {
    let called = 0;
    const transport = (async () => {
      called += 1;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const result = await sendPush(
      { endpoint: "http://push.example/abc", p256dh: "x", auth: "y" },
      { title: "t" },
      { publicKey: "x", privateKey: "y", subject: "mailto:me@example.com" },
      60,
      transport,
    );
    expect(called).toBe(0);
    expect(result).toMatchObject({ ok: false, gone: true });
  });
});
