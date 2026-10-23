import { describe, expect, it } from "vitest";
import { expandIpv6, formatIpv6, parseIpv6, prefixToMask6, specialRange6, subnetInfo6, subnetWindow6 } from "./ipv6";

const ip = (text: string) => parseIpv6(text)!.ip;

describe("IPv6 parsing", () => {
  it("should parse full, compressed and prefixed addresses", () => {
    expect(ip("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(0x20010db8000000000000000000000001n);
    expect(ip("2001:db8::1")).toBe(0x20010db8000000000000000000000001n);
    expect(ip("::")).toBe(0n);
    expect(ip("::1")).toBe(1n);
    expect(ip("fe80::")).toBe(0xfe80n << 112n);
    expect(parseIpv6("2001:db8::/32")).toEqual({ ip: 0x20010db8n << 96n, prefix: 32 });
    expect(parseIpv6("2001:db8::1")!.prefix).toBeNull();
  });

  it("should accept an embedded IPv4 address at the end", () => {
    expect(ip("::ffff:192.0.2.1")).toBe(0xffffc0000201n);
    expect(ip("64:ff9b::198.51.100.7")).toBe((0x64ff9bn << 96n) | 0xc6336407n);
  });

  it("should reject malformed addresses", () => {
    ["", ":", ":::", "1::2::3", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "12345::", "g::1", "1.2.3.4::", "::1/129", "::1/x", "::1/64/64", "1:2:3:4:5:6:7:8::"]
      .forEach(text => expect(parseIpv6(text), text).toBeNull());
  });
});

describe("IPv6 formatting", () => {
  it("should compress the longest run of zero groups (RFC 5952)", () => {
    expect(formatIpv6(ip("2001:0db8:0000:0000:0000:0000:0000:0001"))).toBe("2001:db8::1");
    expect(formatIpv6(0n)).toBe("::");
    expect(formatIpv6(1n)).toBe("::1");
    expect(formatIpv6(ip("2001:db8:0:0:1:0:0:1"))).toBe("2001:db8::1:0:0:1");
    expect(formatIpv6(ip("2001:db8:0:1:0:0:0:1"))).toBe("2001:db8:0:1::1");
    expect(formatIpv6(ip("2001:DB8::ABCD"))).toBe("2001:db8::abcd");
  });

  it("should not compress a single zero group", () => {
    expect(formatIpv6(ip("2001:db8:0:1:1:1:1:1"))).toBe("2001:db8:0:1:1:1:1:1");
  });

  it("should write IPv4-mapped addresses with a dotted tail", () => {
    expect(formatIpv6(ip("::ffff:c000:201"))).toBe("::ffff:192.0.2.1");
  });

  it("should expand every group to four digits", () => {
    expect(expandIpv6(ip("2001:db8::1"))).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
  });

  it("should round-trip", () => {
    ["2001:db8::", "fe80::1:2", "ff02::1", "2001:db8:85a3::8a2e:370:7334", "1::", "1:2:3:4:5:6:7:8"]
      .forEach(text => expect(formatIpv6(ip(text))).toBe(text));
  });
});

describe("IPv6 subnets", () => {
  it("should build masks", () => {
    expect(prefixToMask6(0)).toBe(0n);
    expect(prefixToMask6(128)).toBe((1n << 128n) - 1n);
    expect(prefixToMask6(64)).toBe(((1n << 64n) - 1n) << 64n);
  });

  it("should find the network, last address and size", () => {
    const info = subnetInfo6(ip("2001:db8:1:2:3:4:5:6"), 64);
    expect(formatIpv6(info.network)).toBe("2001:db8:1:2::");
    expect(formatIpv6(info.last)).toBe("2001:db8:1:2:ffff:ffff:ffff:ffff");
    expect(info.size).toBe(1n << 64n);
  });

  it("should list the 256 subnets around the address", () => {
    const slice = subnetWindow6(ip("2001:db8:0:1234::1"), 64, 48);
    expect(slice.totalSubnets).toBe(65536n);
    expect(slice.subnetCount).toBe(256);
    expect(slice.blockPrefix).toBe(56);
    expect(formatIpv6(slice.blockNetwork)).toBe("2001:db8:0:1200::");
    expect(slice.firstIndex).toBe(0x1200n);
  });

  it("should treat a prefix shorter than the parent as one supernet", () => {
    const slice = subnetWindow6(ip("2001:db8::1"), 32, 48);
    expect(slice.totalSubnets).toBe(1n);
    expect(slice.subnetCount).toBe(1);
  });
});

describe("IPv6 special ranges", () => {
  it("should find the block an address is in", () => {
    expect(specialRange6(ip("::1"))?.name).toBe("Loopback");
    expect(specialRange6(ip("::"))?.name).toBe("Unspecified");
    expect(specialRange6(ip("fe80::1"))?.cidr).toBe("fe80::/10");
    expect(specialRange6(ip("fd12:3456::1"))?.cidr).toBe("fc00::/7");
    expect(specialRange6(ip("ff02::1"))?.name).toBe("Multicast");
    expect(specialRange6(ip("2001:db8::1"))?.cidr).toBe("2001:db8::/32");
    expect(specialRange6(ip("2606:4700::1111"))?.name).toBe("Global unicast");
    expect(specialRange6(ip("::ffff:10.0.0.1"))?.name).toBe("IPv4-mapped");
  });

  it("should return null for unallocated space", () => {
    expect(specialRange6(ip("4000::1"))).toBeNull();
  });
});
