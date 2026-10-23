// IPv6 address math on 128-bit BigInts

import { intToIp, ipToInt, isValidIp } from './subnet';
import type { SpecialRange } from './subnet';

export interface Cidr6 {
  ip: bigint;
  prefix: number | null;
}

export interface SubnetInfo6 {
  network: bigint;
  last: bigint;
  mask: bigint;
  size: bigint;
}

// the run of subnets drawn in the table: at most 256 around the address
export interface SubnetWindow6 {
  blockPrefix: number;
  blockNetwork: bigint;
  subnetCount: number;
  totalSubnets: bigint;
  firstIndex: bigint;    // index of the first drawn subnet inside the parent
}

const allOnes = (1n << 128n) - 1n;

// eight groups, "::" for one run of zero groups, and optionally a trailing dotted IPv4 address
const parseAddress = function(text: string): bigint | null {
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }

  const groups = (half: string): string[] | null => {
    if (half === '') {
      return [];
    }
    const parts = half.split(':');
    const last = parts[parts.length - 1];
    if (last.includes('.')) {
      if (!isValidIp(last)) {
        return null;
      }
      const v4 = ipToInt(last);
      parts.splice(-1, 1, (v4 >>> 16).toString(16), (v4 & 0xffff).toString(16));
    }
    return parts.every(part => /^[0-9a-f]{1,4}$/i.test(part)) ? parts : null;
  };

  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  if (!head || !tail) {
    return null;
  }
  // an embedded IPv4 address may only end the address
  if (halves.length === 2 && halves[0].includes('.')) {
    return null;
  }

  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }
  return [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail]
    .reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group, 16)), 0n);
}

// "2001:db8::1" or "2001:db8::1/64"
export const parseIpv6 = function(input: string): Cidr6 | null {
  const [address, prefix, ...rest] = input.trim().split('/');
  const ip = rest.length === 0 ? parseAddress(address) : null;

  if (ip === null) {
    return null;
  }
  if (prefix === undefined) {
    return { ip, prefix: null };
  }
  if (!/^\d{1,3}$/.test(prefix) || parseInt(prefix) > 128) {
    return null;
  }
  return { ip, prefix: parseInt(prefix) };
}

const groupsOf = function(ip: bigint): number[] {
  return [7, 6, 5, 4, 3, 2, 1, 0].map(i => Number((ip >> BigInt(i * 16)) & 0xffffn));
}

// all eight groups, four digits each
export const expandIpv6 = function(ip: bigint): string {
  return groupsOf(ip).map(group => group.toString(16).padStart(4, '0')).join(':');
}

// RFC 5952 text: lowercase, no leading zeros, the longest run of two or more zero groups (leftmost on a tie) as "::",
// and IPv4-mapped addresses with a dotted tail
export const formatIpv6 = function(ip: bigint): string {
  if (ip >> 32n === 0xffffn) {
    return `::ffff:${intToIp(Number(ip & 0xffffffffn))}`;
  }

  const groups = groupsOf(ip);
  let best = { start: -1, length: 1 };
  for (let start = 0; start < 8; start++) {
    let length = 0;
    while (start + length < 8 && groups[start + length] === 0) {
      length++;
    }
    if (length > best.length) {
      best = { start, length };
    }
  }

  const hex = groups.map(group => group.toString(16));
  if (best.start < 0) {
    return hex.join(':');
  }
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.length).join(':')}`;
}

export const prefixToMask6 = function(prefix: number): bigint {
  return (allOnes << BigInt(128 - prefix)) & allOnes;
}

export const subnetInfo6 = function(ip: bigint, prefix: number): SubnetInfo6 {
  const mask = prefixToMask6(prefix);
  const network = ip & mask;
  const size = 1n << BigInt(128 - prefix);
  return { network, last: network + size - 1n, mask, size };
}

// the parent split into /prefix subnets; only the 256 around the address are listed
export const subnetWindow6 = function(ip: bigint, prefix: number, parentPrefix: number): SubnetWindow6 {
  const parent = Math.min(parentPrefix, prefix);
  const blockPrefix = Math.max(parent, prefix - 8);
  const blockNetwork = subnetInfo6(ip, blockPrefix).network;

  return {
    blockPrefix,
    blockNetwork,
    subnetCount: 2 ** (prefix - blockPrefix),
    totalSubnets: 1n << BigInt(prefix - parent),
    firstIndex: (blockNetwork - subnetInfo6(ip, parent).network) >> BigInt(128 - prefix),
  };
}

// special-purpose blocks (RFC 6890 and friends), most specific first
const specialRanges6: [string, number, string][] = [
  ['::', 128, 'Unspecified'],
  ['::1', 128, 'Loopback'],
  ['::ffff:0:0', 96, 'IPv4-mapped'],
  ['64:ff9b::', 96, 'NAT64 (RFC 6052)'],
  ['2001:db8::', 32, 'Documentation (RFC 3849)'],
  ['2002::', 16, '6to4 (RFC 3056)'],
  ['fe80::', 10, 'Link-local'],
  ['fc00::', 7, 'Unique local (RFC 4193)'],
  ['ff00::', 8, 'Multicast'],
  ['2000::', 3, 'Global unicast'],
];

// the special-purpose block an address is in, or null for space IANA has not allocated
export const specialRange6 = function(ip: bigint): SpecialRange | null {
  const match = specialRanges6.find(([network, prefix]) => (ip & prefixToMask6(prefix)) === parseAddress(network));
  return match ? { name: match[2], cidr: `${match[0]}/${match[1]}` } : null;
}
