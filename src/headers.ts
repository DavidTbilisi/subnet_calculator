// IPv4, IPv6, TCP and UDP header layouts, and a decoder for packets pasted as hex

import { intToIp } from './subnet';
import { formatIpv6 } from './ipv6';
import { escapeHtml } from './view';

export type HeaderKind = 'ipv4' | 'ipv6' | 'tcp' | 'udp';

// one cell of a header grid: a field, and in a decoded packet its value
export interface GridCell {
  name: string;
  bits: number;         // up to 32, or a multiple of 32 for fields spanning several rows
  about: string;        // shown on hover
  value?: string;
  set?: boolean;        // a one-bit flag that is set
  rowLabel?: string;    // replaces the byte offset at the start of a row
}

export interface HeaderLayout {
  name: string;
  about: string;        // HTML
  note: string;         // HTML
  fields: GridCell[];
}

export interface DecodedLayer {
  kind: HeaderKind;
  title: string;
  length: number;       // header bytes
  cells: GridCell[];
}

export interface DecodeNote {
  text: string;
  warning: boolean;
}

export interface DecodedPacket {
  layers: DecodedLayer[];
  notes: DecodeNote[];
  payload: Uint8Array;
}

const rfc = function(number: number, section = ''): string {
  return `<a target="_blank" rel="noopener" href="https://www.rfc-editor.org/rfc/rfc${number}${section}">RFC ${number}</a>`;
}

const ports: { [port: number]: string } = {
  20: 'FTP data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP server', 68: 'DHCP client',
  80: 'HTTP', 110: 'POP3', 123: 'NTP', 143: 'IMAP', 161: 'SNMP', 179: 'BGP', 443: 'HTTPS', 465: 'SMTPS', 514: 'syslog',
  587: 'SMTP submission', 853: 'DNS over TLS', 993: 'IMAPS', 995: 'POP3S', 1194: 'OpenVPN', 3306: 'MySQL', 3389: 'RDP',
  5353: 'mDNS', 5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP alternate', 8443: 'HTTPS alternate', 51820: 'WireGuard',
};

const protocols: { [number: number]: string } = {
  0: 'Hop-by-Hop Options', 1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 41: 'IPv6', 43: 'Routing', 44: 'Fragment',
  47: 'GRE', 50: 'ESP', 51: 'AH', 58: 'ICMPv6', 59: 'No Next Header', 60: 'Destination Options', 89: 'OSPF', 132: 'SCTP',
};

const ecnNames = ['Not-ECT', 'ECT(1)', 'ECT(0)', 'CE'];

// the standard DSCP names: default, class selectors CS1-7, assured forwarding AF11-43 and expedited forwarding
const dscpName = function(dscp: number): string | null {
  if (dscp === 0) {
    return 'default';
  }
  if (dscp === 46) {
    return 'EF';
  }
  if (dscp % 8 === 0) {
    return `CS${dscp / 8}`;
  }
  const drop = (dscp % 8) / 2;
  return dscp >= 10 && dscp <= 38 && dscp % 2 === 0 && drop >= 1 && drop <= 3 ? `AF${Math.floor(dscp / 8)}${drop}` : null;
}

const dscpText = function(dscp: number): string {
  const name = dscpName(dscp);
  return name ? `${dscp} ${name}` : String(dscp);
}

const withName = function(value: number, names: { [value: number]: string }): string {
  return value in names ? `${value} (${names[value]})` : String(value);
}

const hex16 = function(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`;
}

const tcpFlags: [string, string][] = [
  ['CWR', 'Congestion Window Reduced: the sender has reduced its sending rate after an ECE (RFC 3168)'],
  ['ECE', 'ECN-Echo: the receiver saw a congestion mark from the network (RFC 3168)'],
  ['URG', 'Urgent: the Urgent Pointer field is significant'],
  ['ACK', 'Acknowledgment: the Acknowledgment Number field is significant; set on every segment after the initial SYN'],
  ['PSH', 'Push: deliver the buffered data to the application without waiting for more'],
  ['RST', 'Reset: abort the connection immediately'],
  ['SYN', 'Synchronize: opens a connection and sets the initial sequence number'],
  ['FIN', 'Finish: the sender has no more data and is closing its side of the connection'],
];

const ipv4Flags: [string, string][] = [
  ['R', 'Reserved flag; must be zero'],
  ['DF', "Don't Fragment: drop the packet (and report it with ICMP) instead of fragmenting it"],
  ['MF', 'More Fragments: more fragments of the original packet follow'],
];

const field = function(name: string, bits: number, about: string, rowLabel?: string): GridCell {
  return rowLabel === undefined ? { name, bits, about } : { name, bits, about, rowLabel };
}

const portAbout = {
  source: 'Port of the sending application',
  destination: 'Port of the receiving application, such as 443 for HTTPS',
};

const fields = {
  ipv4: [
    field('Version', 4, 'IP version: 4'),
    field('IHL', 4, 'Internet Header Length in 32-bit words, from 5 (20 bytes) to 15 (60 bytes)'),
    field('DSCP', 6, 'Differentiated Services Code Point: the traffic class for quality of service, such as 46 (EF) for voice (RFC 2474)'),
    field('ECN', 2, 'Explicit Congestion Notification: Not-ECT, ECT(0) or ECT(1) when the endpoints support it, CE when a router marked congestion (RFC 3168)'),
    field('Total Length', 16, 'Length of the whole packet, header and data, in bytes'),
    field('Identification', 16, 'Identifies the fragments of one original packet'),
    ...ipv4Flags.map(([name, about]) => field(name, 1, about)),
    field('Fragment Offset', 13, 'Position of this fragment in the original packet, in units of 8 bytes'),
    field('TTL', 8, 'Time To Live: lowered by one at each router; the packet is dropped when it reaches zero'),
    field('Protocol', 8, 'The header that follows, such as 1 (ICMP), 6 (TCP) or 17 (UDP)'),
    field('Header Checksum', 16, "Ones' complement checksum of the header only; recomputed at every hop because the TTL changes"),
    field('Source Address', 32, 'Address of the sender'),
    field('Destination Address', 32, 'Address of the receiver'),
  ],
  ipv6: [
    field('Version', 4, 'IP version: 6'),
    field('Traffic Class', 8, 'DSCP (6 bits) and ECN (2 bits), as in the second byte of IPv4'),
    field('Flow Label', 20, 'Marks the packets of one flow so routers can keep them on the same path (RFC 6437)'),
    field('Payload Length', 16, 'Length of everything after this 40-byte header, extension headers included, in bytes'),
    field('Next Header', 8, 'The header that follows: an extension header, or the payload such as 6 (TCP), 17 (UDP) or 58 (ICMPv6)'),
    field('Hop Limit', 8, "Lowered by one at each router; the packet is dropped when it reaches zero, like IPv4's TTL"),
    field('Source Address', 128, 'Address of the sender'),
    field('Destination Address', 128, 'Address of the receiver'),
  ],
  tcp: [
    field('Source Port', 16, portAbout.source),
    field('Destination Port', 16, portAbout.destination),
    field('Sequence Number', 32, 'Number of the first data byte in this segment. With SYN set, the initial sequence number (ISN)'),
    field('Acknowledgment Number', 32, 'When ACK is set, the next sequence number the sender expects to receive'),
    field('Data Offset', 4, 'Header length in 32-bit words, from 5 (20 bytes) to 15 (60 bytes); the data starts after it'),
    field('Reserved', 4, 'Reserved for future use; must be zero'),
    ...tcpFlags.map(([name, about]) => field(name, 1, about)),
    field('Window Size', 16, 'Number of bytes the receiver is willing to accept, scaled by the Window Scale option (RFC 7323)'),
    field('Checksum', 16, "Ones' complement checksum over the header, the data and a pseudo-header of the IP addresses, protocol and length"),
    field('Urgent Pointer', 16, 'When URG is set, the offset from the sequence number to the end of the urgent data'),
  ],
  udp: [
    field('Source Port', 16, `${portAbout.source}; may be 0 when no reply is expected`),
    field('Destination Port', 16, portAbout.destination),
    field('Length', 16, 'Length of the header and data in bytes; at least 8'),
    field('Checksum', 16, "Ones' complement checksum over the header, the data and a pseudo-header of the IP addresses, protocol and length"),
  ],
};

const optionsAbout = {
  ipv4: 'Rarely used; present when IHL is above 5, padded with zeros to a multiple of 32 bits',
  tcp: 'Up to 40 bytes, such as Maximum Segment Size, Window Scale, SACK and Timestamps; padded with zeros to a multiple of 32 bits',
};

export const headerLayouts: { [kind in HeaderKind]: HeaderLayout } = {
  ipv4: {
    name: 'IPv4',
    about: `The Internet Protocol (${rfc(791, '#section-3.1')}) carries each packet from host to host across networks. Routers lower the TTL and recompute the header checksum at every hop. DSCP and ECN replaced the original Type of Service byte (${rfc(2474)}, ${rfc(3168)}).`,
    note: `Without options the header is 20 bytes; options can grow it to 60. Identification, the flags and Fragment Offset let a router split a packet that is too big for the next link, unless DF is set; Path MTU Discovery (${rfc(1191)}) relies on DF.`,
    fields: [...fields.ipv4, field('Options (if any, variable length)', 32, optionsAbout.ipv4), field('Data', 32, 'The payload, such as a TCP segment or UDP datagram; it starts at IHL × 4 bytes', '20+')],
  },
  ipv6: {
    name: 'IPv6',
    about: `IPv6 (${rfc(8200, '#section-3')}) has a fixed 40-byte header with 128-bit addresses. It has no header checksum, routers never fragment, and options moved to extension headers chained through Next Header.`,
    note: 'Common Next Header values are 6 (TCP), 17 (UDP), 58 (ICMPv6), and the extension headers 0 (Hop-by-Hop Options), 43 (Routing), 44 (Fragment) and 60 (Destination Options).',
    fields: [...fields.ipv6, field('Extension headers and payload', 32, 'Any extension headers, then the payload such as a TCP segment or UDP datagram')],
  },
  tcp: {
    name: 'TCP',
    about: `The Transmission Control Protocol (${rfc(9293, '#section-3.1')}, which replaced RFC 793 in 2022) gives applications reliable, ordered, error-checked delivery of a stream of bytes over IP. HTTP/1.1 and HTTP/2, TLS, SSH, SMTP and many other protocols run on it (HTTP/3 uses QUIC over UDP instead).`,
    note: `Without options the header is 20 bytes; options can grow it to 60. Common options are Maximum Segment Size (sent with SYN), Window Scale and Timestamps (${rfc(7323)}) and Selective Acknowledgment (${rfc(2018)}).`,
    fields: [...fields.tcp, field('Options (if any, variable length)', 32, optionsAbout.tcp), field('Data', 32, 'The payload; it starts at Data Offset × 4 bytes', '20+')],
  },
  udp: {
    name: 'UDP',
    about: `The User Datagram Protocol (${rfc(768)}) sends independent datagrams with no connection, ordering or retransmission, in exchange for an 8-byte header and no handshake. DNS, DHCP, NTP, SNMP, WireGuard and QUIC (HTTP/3) run on it.`,
    note: 'Length covers the header and the data. The checksum is optional over IPv4, where 0 means none, but required over IPv6.',
    fields: [...fields.udp, field('Data', 32, 'The payload, such as a DNS query')],
  },
};

// packets for the decoder's example buttons; the checksums are correct
export const examplePackets: { [name: string]: { label: string; hex: string } } = {
  syn: {
    label: 'TCP SYN over IPv4',
    hex: '4500003c1c46400040063224c000020ac6336414c93a01bb9a3f6c2100000000a002faf0ed410000020405b40402080aa9e0f8430000000001030307',
  },
  dns: {
    label: 'DNS query over UDP and IPv6',
    hex: '6005a3c10025114020010db800000000000000000000001020010db8000000000000000000000053cf09003500259af84f2a01000001000000000000076578616d706c6503636f6d00001c0001',
  },
  http: {
    label: 'HTTP request in an Ethernet frame',
    hex: '0200000000020200000000010800450000591c47400040063206c000020ac6336414c93a00509a3f6c223e1b77a5801801f62ce000000101080aa9e0f87c671f8398474554202f20485454502f312e310d0a486f73743a206578616d706c652e636f6d0d0a0d0a',
  },
};

// hex as a hex stream (Wireshark's "Copy as Hex Stream"), bytes separated by spaces, colons or commas,
// 0x-prefixed bytes, or tcpdump -x lines with their "0x0000:" offsets
export const parseHex = function(text: string): Uint8Array | string {
  const hex = text
    .split('\n')
    .map(line => line.replace(/^\s*0x[0-9a-f]+:\s/i, ''))
    .join(' ')
    .replace(/0x/gi, '')
    .replace(/[\s:,]/g, '');

  if (hex === '') {
    return 'Paste a packet as hex.';
  }
  if (!/^[0-9a-f]*$/i.test(hex)) {
    return 'Only hex digits, spaces, colons and commas are allowed.';
  }
  if (hex.length % 2 !== 0) {
    return 'The hex has an odd number of digits, so the last byte is incomplete.';
  }
  return Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16));
}

// the ones' complement sum used by the IPv4, TCP and UDP checksums
const onesSum = function(...parts: Uint8Array[]): number {
  let sum = 0;
  parts.forEach(part => {
    for (let i = 0; i < part.length; i += 2) {
      sum += (part[i] << 8) | (part[i + 1] ?? 0);
    }
  });
  while (sum > 0xffff) {
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  return sum;
}

// the checksum of the data, whose checksum field (at `field` in the last part) is taken as zero
const checksumOf = function(parts: Uint8Array[], field: number): number {
  const last = Uint8Array.from(parts[parts.length - 1]);
  last[field] = last[field + 1] = 0;
  return ~onesSum(...parts.slice(0, -1), last) & 0xffff;
}

// a checksum field's value and whether it matches the data, or why it was not checked
const checksumValue = function(stored: number, expected: number | string): string {
  if (typeof expected === 'string') {
    return `${hex16(stored)} (not checked: ${expected})`;
  }
  return stored === expected ? `${hex16(stored)} ✓ correct` : `${hex16(stored)} ✗ should be ${hex16(expected)}`;
}

// what a transport header needs from the IP header to check its checksum
interface PseudoHeader {
  family: 4 | 6;
  bytes: (length: number) => Uint8Array;
  complete: boolean;    // false for a fragment or a truncated packet
}

class Reader {
  constructor(private bytes: Uint8Array) {}

  get length(): number {
    return this.bytes.length;
  }

  u8(i: number): number {
    return this.bytes[i];
  }

  u16(i: number): number {
    return (this.bytes[i] << 8) | this.bytes[i + 1];
  }

  u32(i: number): number {
    return (this.u16(i) * 0x10000 + this.u16(i + 2)) >>> 0;
  }

  slice(start: number, end?: number): Uint8Array {
    return this.bytes.subarray(start, end);
  }
}

// a layout field with its decoded value
const cell = function(fieldList: GridCell[], name: string, value: string, set?: boolean): GridCell {
  const layoutField = fieldList.find(entry => entry.name === name)!;
  return set === undefined ? { ...layoutField, value } : { ...layoutField, value, set };
}

const flagCells = function(fieldList: GridCell[], flags: [string, string][], bits: number): GridCell[] {
  return flags.map(([name], i) => {
    const set = (bits >> (flags.length - 1 - i) & 1) === 1;
    return cell(fieldList, name, set ? '1' : '0', set);
  });
}

const optionsCell = function(about: string, bytes: Uint8Array, value: string): GridCell {
  return { name: 'Options', bits: bytes.length * 8, about, value };
}

const hexBytes = function(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' ');
}

const tcpOptions = function(bytes: Uint8Array): string {
  const options: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const kind = bytes[i];
    if (kind === 0) {
      options.push('End of options');
      break;
    }
    if (kind === 1) {
      options.push('NOP');
      i++;
      continue;
    }
    const length = bytes[i + 1];
    if (length === undefined || length < 2 || i + length > bytes.length) {
      options.push(`malformed option ${kind}`);
      break;
    }
    const data = new Reader(bytes.subarray(i + 2, i + length));
    if (kind === 2 && length === 4) {
      options.push(`MSS ${data.u16(0)}`);
    } else if (kind === 3 && length === 3) {
      options.push(`Window scale ${data.u8(0)} (×${2 ** data.u8(0)})`);
    } else if (kind === 4 && length === 2) {
      options.push('SACK permitted');
    } else if (kind === 5 && (length - 2) % 8 === 0) {
      const blocks = Array.from({ length: (length - 2) / 8 }, (_, b) => `${data.u32(b * 8)}-${data.u32(b * 8 + 4)}`);
      options.push(`SACK ${blocks.join(', ')}`);
    } else if (kind === 8 && length === 10) {
      options.push(`Timestamps ${data.u32(0)}, echo ${data.u32(4)}`);
    } else {
      options.push(`option ${kind} (${length} bytes)`);
    }
    i += length;
  }
  return options.join(' · ');
}

interface LayerResult {
  layer: DecodedLayer;
  next: { kind: HeaderKind; bytes: Uint8Array; pseudo: PseudoHeader } | null;
  payload: Uint8Array;
}

// the header after an IP header, if it is one the decoder knows
const transportKind = function(protocol: number): HeaderKind | null {
  return protocol === 6 ? 'tcp' : protocol === 17 ? 'udp' : null;
}

const decodeIpv4 = function(bytes: Uint8Array, notes: DecodeNote[]): LayerResult | null {
  const r = new Reader(bytes);
  if (r.length < 20) {
    notes.push({ text: `An IPv4 header needs at least 20 bytes; there are ${r.length}.`, warning: true });
    return null;
  }
  const version = r.u8(0) >> 4;
  const ihl = r.u8(0) & 0xf;
  const headerLength = ihl * 4;
  if (version !== 4 || ihl < 5 || headerLength > r.length) {
    notes.push({ text: version !== 4 ? `Version is ${version}, not 4: this is not an IPv4 header.` : `IHL ${ihl} gives a ${headerLength}-byte header, which does not fit.`, warning: true });
    return null;
  }

  const totalLength = r.u16(2);
  const flags = r.u8(6) >> 5;
  const fragmentOffset = r.u16(6) & 0x1fff;
  const protocol = r.u8(9);
  const checksum = r.u16(10);
  const header = r.slice(0, headerLength);
  const f = fields.ipv4;

  const cells = [
    cell(f, 'Version', String(version)),
    cell(f, 'IHL', `${ihl} (${headerLength} bytes)`),
    cell(f, 'DSCP', dscpText(r.u8(1) >> 2)),
    cell(f, 'ECN', ecnNames[r.u8(1) & 3]),
    cell(f, 'Total Length', `${totalLength} bytes`),
    cell(f, 'Identification', `${hex16(r.u16(4))} (${r.u16(4)})`),
    ...flagCells(f, ipv4Flags, flags),
    cell(f, 'Fragment Offset', fragmentOffset === 0 ? '0' : `${fragmentOffset} (byte ${fragmentOffset * 8})`),
    cell(f, 'TTL', String(r.u8(8))),
    cell(f, 'Protocol', withName(protocol, protocols)),
    cell(f, 'Header Checksum', checksumValue(checksum, checksumOf([header], 10))),
    cell(f, 'Source Address', intToIp(r.u32(12))),
    cell(f, 'Destination Address', intToIp(r.u32(16))),
  ];
  if (headerLength > 20) {
    cells.push(optionsCell(optionsAbout.ipv4, r.slice(20, headerLength), hexBytes(r.slice(20, headerLength))));
  }

  let end = totalLength;
  if (totalLength < headerLength) {
    notes.push({ text: `Total Length ${totalLength} is shorter than the header; using the bytes that were pasted.`, warning: true });
    end = r.length;
  } else if (totalLength > r.length) {
    notes.push({ text: `The packet is truncated: Total Length is ${totalLength} bytes, but ${r.length} were pasted.`, warning: true });
    end = r.length;
  } else if (totalLength < r.length) {
    notes.push({ text: `Ignored ${r.length - totalLength} bytes after the packet's Total Length, such as Ethernet padding.`, warning: false });
  }

  const layer = { kind: 'ipv4' as const, title: 'IPv4 header', length: headerLength, cells };
  const data = r.slice(headerLength, end);
  const kind = transportKind(protocol);
  if (fragmentOffset > 0) {
    notes.push({ text: 'This is a later fragment of a larger packet, so it carries no transport header.', warning: false });
    return { layer, next: null, payload: data };
  }
  if (kind === null) {
    notes.push({ text: `Protocol ${withName(protocol, protocols)} is not decoded.`, warning: false });
    return { layer, next: null, payload: data };
  }

  const pseudo: PseudoHeader = {
    family: 4,
    bytes: length => Uint8Array.from([...r.slice(12, 20), 0, protocol, length >> 8, length & 0xff]),
    complete: (flags & 1) === 0 && end === totalLength,
  };
  return { layer, next: { kind, bytes: data, pseudo }, payload: data };
}

const decodeIpv6 = function(bytes: Uint8Array, notes: DecodeNote[]): LayerResult | null {
  const r = new Reader(bytes);
  if (r.length < 40) {
    notes.push({ text: `An IPv6 header is 40 bytes; there are ${r.length}.`, warning: true });
    return null;
  }
  const version = r.u8(0) >> 4;
  if (version !== 6) {
    notes.push({ text: `Version is ${version}, not 6: this is not an IPv6 header.`, warning: true });
    return null;
  }

  const trafficClass = (r.u16(0) >> 4) & 0xff;
  const payloadLength = r.u16(4);
  const nextHeader = r.u8(6);
  const address = (offset: number) => formatIpv6(BigInt(`0x${hexBytes(r.slice(offset, offset + 16)).replace(/ /g, '')}`));
  const dscp = trafficClass >> 2;
  const f = fields.ipv6;

  const cells = [
    cell(f, 'Version', String(version)),
    cell(f, 'Traffic Class', `0x${trafficClass.toString(16).padStart(2, '0')} (DSCP ${dscpText(dscp)}, ${ecnNames[trafficClass & 3]})`),
    cell(f, 'Flow Label', `0x${(r.u32(0) & 0xfffff).toString(16).padStart(5, '0')}`),
    cell(f, 'Payload Length', `${payloadLength} bytes`),
    cell(f, 'Next Header', withName(nextHeader, protocols)),
    cell(f, 'Hop Limit', String(r.u8(7))),
    cell(f, 'Source Address', address(8)),
    cell(f, 'Destination Address', address(24)),
  ];

  let end = 40 + payloadLength;
  if (end > r.length) {
    notes.push({ text: `The packet is truncated: Payload Length is ${payloadLength} bytes, but ${r.length - 40} follow the header.`, warning: true });
    end = r.length;
  } else if (end < r.length) {
    notes.push({ text: `Ignored ${r.length - end} bytes after the packet's Payload Length, such as Ethernet padding.`, warning: false });
  }

  const layer = { kind: 'ipv6' as const, title: 'IPv6 header', length: 40, cells };
  const data = r.slice(40, end);
  const kind = transportKind(nextHeader);
  if (kind === null) {
    notes.push({ text: `Next Header ${withName(nextHeader, protocols)} is not decoded.`, warning: false });
    return { layer, next: null, payload: data };
  }

  const pseudo: PseudoHeader = {
    family: 6,
    bytes: length => Uint8Array.from([...r.slice(8, 40), length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff, 0, 0, 0, nextHeader]),
    complete: end === 40 + payloadLength,
  };
  return { layer, next: { kind, bytes: data, pseudo }, payload: data };
}

// a transport checksum is checked only when the whole segment and the IP header are there
const transportChecksum = function(segment: Uint8Array, field: number, pseudo: PseudoHeader | null): string {
  const stored = new Reader(segment).u16(field);
  if (!pseudo) {
    return checksumValue(stored, 'needs the IP header');
  }
  if (!pseudo.complete) {
    return checksumValue(stored, 'the segment is incomplete');
  }
  // a computed zero is sent as 0xffff, since zero means "no checksum" in UDP over IPv4
  return checksumValue(stored, checksumOf([pseudo.bytes(segment.length), segment], field) || 0xffff);
}

const port = function(value: number): string {
  return withName(value, ports);
}

const decodeTcp = function(bytes: Uint8Array, pseudo: PseudoHeader | null, notes: DecodeNote[]): LayerResult | null {
  const r = new Reader(bytes);
  if (r.length < 20) {
    notes.push({ text: `A TCP header needs at least 20 bytes; there are ${r.length}.`, warning: true });
    return null;
  }
  const dataOffset = r.u8(12) >> 4;
  const headerLength = dataOffset * 4;
  if (dataOffset < 5 || headerLength > r.length) {
    notes.push({ text: `Data Offset ${dataOffset} gives a ${headerLength}-byte header, which does not fit.`, warning: true });
    return null;
  }

  const flags = r.u8(13);
  const f = fields.tcp;
  const cells = [
    cell(f, 'Source Port', port(r.u16(0))),
    cell(f, 'Destination Port', port(r.u16(2))),
    cell(f, 'Sequence Number', String(r.u32(4))),
    cell(f, 'Acknowledgment Number', flags & 0x10 ? String(r.u32(8)) : `${r.u32(8)} (unused: ACK is not set)`),
    cell(f, 'Data Offset', `${dataOffset} (${headerLength} bytes)`),
    cell(f, 'Reserved', String(r.u8(12) & 0xf)),
    ...flagCells(f, tcpFlags, flags),
    cell(f, 'Window Size', String(r.u16(14))),
    cell(f, 'Checksum', transportChecksum(bytes, 16, pseudo)),
    cell(f, 'Urgent Pointer', String(r.u16(18))),
  ];
  if (headerLength > 20) {
    cells.push(optionsCell(optionsAbout.tcp, r.slice(20, headerLength), tcpOptions(r.slice(20, headerLength))));
  }
  return { layer: { kind: 'tcp', title: 'TCP header', length: headerLength, cells }, next: null, payload: r.slice(headerLength) };
}

const decodeUdp = function(bytes: Uint8Array, pseudo: PseudoHeader | null, notes: DecodeNote[]): LayerResult | null {
  const r = new Reader(bytes);
  if (r.length < 8) {
    notes.push({ text: `A UDP header is 8 bytes; there are ${r.length}.`, warning: true });
    return null;
  }
  const length = r.u16(4);
  const checksum = r.u16(6);
  if (length !== r.length) {
    notes.push({ text: `UDP Length is ${length} bytes, but the IP packet carries ${r.length}.`, warning: true });
  }

  const f = fields.udp;
  // over IPv4 a zero checksum means the sender did not compute one
  const unused = checksum === 0 && pseudo?.family === 4;
  const segment = r.slice(0, Math.min(length, r.length));
  const cells = [
    cell(f, 'Source Port', port(r.u16(0))),
    cell(f, 'Destination Port', port(r.u16(2))),
    cell(f, 'Length', `${length} bytes`),
    cell(f, 'Checksum', unused ? '0x0000 (none)' : transportChecksum(segment, 6, pseudo && { ...pseudo, complete: pseudo.complete && length === r.length })),
  ];
  return { layer: { kind: 'udp', title: 'UDP header', length: 8, cells }, next: null, payload: r.slice(8, Math.max(8, Math.min(length, r.length))) };
}

// what a pasted packet starts with: an Ethernet frame (with or without a VLAN tag), IPv4 or IPv6
const detectStart = function(bytes: Uint8Array, notes: DecodeNote[]): { kind: HeaderKind; offset: number } | null {
  const r = new Reader(bytes);
  const ethernet: { [type: number]: HeaderKind } = { 0x0800: 'ipv4', 0x86dd: 'ipv6' };
  if (r.length >= 14 && r.u16(12) in ethernet) {
    notes.push({ text: `Skipped the 14-byte Ethernet header (EtherType ${hex16(r.u16(12))}, ${headerLayouts[ethernet[r.u16(12)]].name}).`, warning: false });
    return { kind: ethernet[r.u16(12)], offset: 14 };
  }
  if (r.length >= 18 && r.u16(12) === 0x8100 && r.u16(16) in ethernet) {
    notes.push({ text: `Skipped the 18-byte Ethernet header with VLAN tag ${r.u16(14) & 0xfff} (EtherType ${hex16(r.u16(16))}).`, warning: false });
    return { kind: ethernet[r.u16(16)], offset: 18 };
  }
  if (r.u8(0) >> 4 === 4) {
    return { kind: 'ipv4', offset: 0 };
  }
  if (r.u8(0) >> 4 === 6) {
    return { kind: 'ipv6', offset: 0 };
  }
  notes.push({ text: 'These bytes do not start with an Ethernet, IPv4 or IPv6 header. Choose what they start with.', warning: true });
  return null;
}

export const decodePacket = function(bytes: Uint8Array, start: HeaderKind | 'auto' = 'auto'): DecodedPacket {
  const notes: DecodeNote[] = [];
  const layers: DecodedLayer[] = [];
  const first = start === 'auto' ? detectStart(bytes, notes) : { kind: start, offset: 0 };
  if (!first) {
    return { layers, notes, payload: new Uint8Array() };
  }

  let step: { kind: HeaderKind; bytes: Uint8Array; pseudo: PseudoHeader | null } | null = { kind: first.kind, bytes: bytes.subarray(first.offset), pseudo: null };
  let payload: Uint8Array = new Uint8Array();
  while (step) {
    const result: LayerResult | null = step.kind === 'ipv4' ? decodeIpv4(step.bytes, notes)
      : step.kind === 'ipv6' ? decodeIpv6(step.bytes, notes)
      : step.kind === 'tcp' ? decodeTcp(step.bytes, step.pseudo, notes)
      : decodeUdp(step.bytes, step.pseudo, notes);
    if (!result) {
      break;
    }
    layers.push(result.layer);
    payload = result.payload;
    step = result.next;
  }
  return { layers, notes, payload };
}

// bytes as hex with their printable ASCII, 16 per line
export const hexDump = function(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = bytes.subarray(i, i + 16);
    const ascii = Array.from(row, byte => byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.').join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hexBytes(row).padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

const rowLabel = function(text: string): string {
  return `<span class="grid-row">${escapeHtml(text)}</span>`;
}

// a grid of 32-bit rows: bit numbers across the top and byte offsets down the side
export const headerGrid = function(cells: GridCell[]): string {
  const columns = `<span class="grid-corner" title="Byte offset ↓ / bit ➝"></span>${Array.from({ length: 32 }, (_, i) => `<span class="grid-bit">${i}</span>`).join('')}`;
  let offset = 0;
  const body = cells.map(entry => {
    // a field longer than a row spans whole rows, and the labels of the rows it covers follow it
    const rows = Math.max(1, entry.bits / 32);
    const span = `grid-column: span ${Math.min(entry.bits, 32)};${rows > 1 ? ` grid-row: span ${rows};` : ''}`;
    const classes = `grid-field${entry.set ? ' set' : ''}${entry.bits <= 2 ? ' narrow' : ''}`;
    const value = entry.value === undefined ? '' : `<span class="field-value">${escapeHtml(entry.value)}</span>`;
    const title = entry.value === undefined ? entry.about : `${entry.name}: ${entry.value}\n${entry.about}`;
    const html = [
      offset % 32 === 0 ? rowLabel(entry.rowLabel ?? String(offset / 8)) : '',
      `<span class="${classes}" style="${span}" title="${escapeHtml(title)}"><span class="field-name">${escapeHtml(entry.name)}</span>${value}</span>`,
      ...Array.from({ length: rows - 1 }, (_, i) => rowLabel(String(offset / 8 + (i + 1) * 4))),
    ].join('');
    offset += entry.bits;
    return html;
  }).join('');
  return columns + body;
}
