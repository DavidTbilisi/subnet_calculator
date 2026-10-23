import { describe, expect, it } from "vitest";
import { decodePacket, examplePackets, headerGrid, headerLayouts, hexDump, parseHex } from "./headers";
import type { DecodedPacket } from "./headers";

const bytes = (hex: string) => parseHex(hex) as Uint8Array;
const value = (packet: DecodedPacket, layer: number, name: string) => packet.layers[layer].cells.find(cell => cell.name === name)?.value;

describe("Hex input", () => {
  it("should read hex streams, separated bytes and tcpdump lines", () => {
    expect(Array.from(bytes("4500003c"))).toEqual([0x45, 0x00, 0x00, 0x3c]);
    expect(Array.from(bytes("45 00 00 3C"))).toEqual([0x45, 0x00, 0x00, 0x3c]);
    expect(Array.from(bytes("45:00:00:3c"))).toEqual([0x45, 0x00, 0x00, 0x3c]);
    expect(Array.from(bytes("0x45, 0x00"))).toEqual([0x45, 0x00]);
    expect(Array.from(bytes("\t0x0000:  4500 003c\n\t0x0010:  c000 020a"))).toEqual([0x45, 0x00, 0x00, 0x3c, 0xc0, 0x00, 0x02, 0x0a]);
  });

  it("should explain bad input", () => {
    expect(parseHex("  ")).toMatch(/Paste/);
    expect(parseHex("45 0g")).toMatch(/Only hex digits/);
    expect(parseHex("450")).toMatch(/odd number/);
  });
});

describe("Packet decoding", () => {
  it("should decode a TCP SYN over IPv4", () => {
    const packet = decodePacket(bytes(examplePackets.syn.hex));
    expect(packet.layers.map(layer => layer.title)).toEqual(["IPv4 header", "TCP header"]);
    expect(packet.notes).toEqual([]);
    expect(value(packet, 0, "Source Address")).toBe("192.0.2.10");
    expect(value(packet, 0, "Protocol")).toBe("6 (TCP)");
    expect(value(packet, 0, "DF")).toBe("1");
    expect(value(packet, 0, "Header Checksum")).toBe("0x3224 ✓ correct");
    expect(value(packet, 1, "Destination Port")).toBe("443 (HTTPS)");
    expect(value(packet, 1, "Data Offset")).toBe("10 (40 bytes)");
    expect(value(packet, 1, "Checksum")).toBe("0xed41 ✓ correct");
    expect(value(packet, 1, "Options")).toBe("MSS 1460 · SACK permitted · Timestamps 2850093123, echo 0 · NOP · Window scale 7 (×128)");
    expect(packet.layers[1].cells.filter(cell => cell.set).map(cell => cell.name)).toEqual(["SYN"]);
    expect(packet.payload.length).toBe(0);
  });

  it("should decode a UDP datagram over IPv6", () => {
    const packet = decodePacket(bytes(examplePackets.dns.hex));
    expect(packet.layers.map(layer => layer.title)).toEqual(["IPv6 header", "UDP header"]);
    expect(value(packet, 0, "Source Address")).toBe("2001:db8::10");
    expect(value(packet, 0, "Flow Label")).toBe("0x5a3c1");
    expect(value(packet, 0, "Next Header")).toBe("17 (UDP)");
    expect(value(packet, 1, "Destination Port")).toBe("53 (DNS)");
    expect(value(packet, 1, "Checksum")).toBe("0x9af8 ✓ correct");
    expect(packet.payload.length).toBe(29);
  });

  it("should skip an Ethernet header and keep the payload", () => {
    const packet = decodePacket(bytes(examplePackets.http.hex));
    expect(packet.notes.map(note => note.text)).toEqual(["Skipped the 14-byte Ethernet header (EtherType 0x0800, IPv4)."]);
    expect(value(packet, 1, "Checksum")).toBe("0x2ce0 ✓ correct");
    expect(packet.layers[1].cells.filter(cell => cell.set).map(cell => cell.name)).toEqual(["ACK", "PSH"]);
    expect(new TextDecoder().decode(packet.payload)).toBe("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
  });

  it("should show the right checksum when one is wrong", () => {
    const broken = bytes(examplePackets.syn.hex);
    broken[8] = 63;   // TTL, without updating either checksum
    const packet = decodePacket(broken);
    expect(value(packet, 0, "Header Checksum")).toBe("0x3224 ✗ should be 0x3324");
    // the TTL is not in the TCP pseudo-header
    expect(value(packet, 1, "Checksum")).toBe("0xed41 ✓ correct");
  });

  it("should not check a truncated segment", () => {
    const packet = decodePacket(bytes(examplePackets.http.hex.slice(0, -20)));
    expect(packet.notes.some(note => note.warning && /truncated/.test(note.text))).toBe(true);
    expect(value(packet, 1, "Checksum")).toBe("0x2ce0 (not checked: the segment is incomplete)");
  });

  it("should decode from a chosen header", () => {
    const tcp = bytes(examplePackets.syn.hex).subarray(20);
    const packet = decodePacket(tcp, "tcp");
    expect(packet.layers.map(layer => layer.title)).toEqual(["TCP header"]);
    expect(value(packet, 0, "Checksum")).toBe("0xed41 (not checked: needs the IP header)");
  });

  it("should say when it cannot tell what the bytes are", () => {
    const packet = decodePacket(bytes("0102030405"));
    expect(packet.layers).toEqual([]);
    expect(packet.notes[0].warning).toBe(true);
  });
});

describe("Header grids", () => {
  it("should label every 32-bit row with its byte offset, including rows a long field covers", () => {
    const labels = (html: string) => Array.from(html.matchAll(/class="grid-row">([^<]*)</g), match => match[1]);
    expect(labels(headerGrid(headerLayouts.ipv6.fields))).toEqual(["0", "4", "8", "12", "16", "20", "24", "28", "32", "36", "40"]);
    expect(labels(headerGrid(headerLayouts.tcp.fields))).toEqual(["0", "4", "8", "12", "16", "20", "20+"]);
  });

  it("should fill each row with exactly 32 bits", () => {
    Object.values(headerLayouts).forEach(layout => {
      let row = 0;
      layout.fields.forEach(field => {
        row += field.bits;
        expect(row <= 32 || field.bits % 32 === 0).toBe(true);
        row %= 32;
      });
      expect(row).toBe(0);
    });
  });

  it("should dump bytes with their ASCII", () => {
    expect(hexDump(new TextEncoder().encode("GET /"))).toBe(`0000  47 45 54 20 2f${" ".repeat(33)}  GET /`);
  });
});
