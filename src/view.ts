// DOM-free view helpers: address descriptions, bit rows and the 3D grid cells

import { intToIp, subnetInfo, toBinary, tileLayout, nestedLayout } from './subnet';
import type { SubnetLayout, VlsmBlock } from './subnet';
import type { Cell } from './subnet3d';

// detect IP Class
export const detectIpClass = function(ip: string): string {
  const firstOctet = parseInt(ip.split('.')[0]);

  if (firstOctet >= 1 && firstOctet <= 126) {
    return 'A';
  } else if (firstOctet >= 128 && firstOctet <= 191) {
    return 'B';
  } else if (firstOctet >= 192 && firstOctet <= 223) {
    return 'C';
  } else if (firstOctet >= 224 && firstOctet <= 239) {
    return 'D';
  } else if (firstOctet >= 240 && firstOctet <= 255) {
    return 'E';
  } else {
    return 'Invalid IP';
  }
}

export const classTypes: { [ipClass: string]: string } = {
  A: 'Unicast',
  B: 'Unicast',
  C: 'Unicast',
  D: 'Multicast',
  E: 'Experimental',
};

// shown in the subnetting section until something is typed
export const exampleCidr = '192.168.1.70/26';
// VLSM network used when the terminal holds no class A/B/C address
export const exampleVlsmCidr = '192.168.1.0/24';

// 3D block colors; the bit strip and legend colors live in style.scss
export const blockColors = {
  ip: 0xffffff,
  subnet: 0xffbd2e,
  // three shades so neighbouring subnets differ across and down the power-of-two wide grid
  others: [0x2e3cff, 0x7d88ff, 0x1c2499],
  reserved: 0x555a5a,
};

// one color per VLSM subnet, cycling; free space is dark
export const vlsmColors = [0xffbd2e, 0x2ec4b6, 0xff6b6b, 0x7d88ff, 0xa3e635, 0xf472b6, 0x38bdf8, 0xfb923c];
export const freeColor = 0x2c3030;

export const cssColor = function(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export const escapeHtml = function(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

export const blockCidr = function(block: VlsmBlock): string {
  return `${intToIp(block.network)}/${block.prefix}`;
}

export const formatCount = function(n: number): string {
  return n.toLocaleString('en-US');
}

// terminal output for an address in a subnet
export const describeSubnet = function(ip: number, prefix: number): string {
  const info = subnetInfo(ip, prefix);
  const lines = [
    ['Address', `${intToIp(ip)}/${prefix}`],
    ['Netmask', intToIp(info.mask)],
    ['Wildcard', intToIp(info.wildcard)],
    ['Network', intToIp(info.network)],
    ['Broadcast', intToIp(info.broadcast)],
    ['Hosts', `${intToIp(info.firstHost)} - ${intToIp(info.lastHost)} (${formatCount(info.usableHosts)})`],
  ];
  return lines.map(([name, value]) => `${name.padEnd(11)}${value}`).join('\n');
}

// one row of 32 bits split into octets, each bit tagged network / subnet / host
export const bitRow = function(label: string, value: number, prefix: number, parentPrefix: number): string {
  const bits = toBinary(value);
  const role = (i: number): string => i < parentPrefix ? 'network' : i < prefix ? 'subnet' : 'host';
  const octets = [0, 8, 16, 24].map(start =>
    `<span class="octet">${[...bits.slice(start, start + 8)].map((bit, i) => `<span class="bit bit-${role(start + i)}">${bit}</span>`).join('')}</span>`);

  return `<div class="bit-row"><span class="bit-label">${label}</span>${octets.join('<span class="bit-dot">.</span>')}</div>`;
}

// grid cells for the drawn block: the IP, its subnet, the other subnets and their reserved addresses
export const subnetCells = function(ip: number, prefix: number, layout: SubnetLayout): Cell[] {
  const subnetSize = 2 ** (32 - prefix);
  const ipSubnet = Math.floor((ip - layout.blockNetwork) / subnetSize);
  const positions = tileLayout(layout.cellCount, layout.subnetCount);

  return Array.from({ length: layout.cellCount }, (_, i) => {
    const start = layout.blockNetwork + i * layout.cellSize;
    const end = start + layout.cellSize - 1;
    const subnet = Math.floor(i * layout.subnetCount / layout.cellCount);
    const subnetNetwork = layout.blockNetwork + subnet * subnetSize;
    const offset = start - subnetNetwork;
    const range = layout.cellSize === 1 ? intToIp(start) : `${intToIp(start)} - ${intToIp(end)}`;
    const label = `${range}\nin ${intToIp(subnetNetwork)}/${prefix}`;
    const placement = { group: subnet, position: positions[i] };

    if (ip >= start && ip <= end) {
      return { ...placement, color: blockColors.ip, height: 3.5, label: `${label}\n(your IP)` };
    }
    if (layout.cellSize === 1 && prefix <= 30 && (offset === 0 || offset === subnetSize - 1)) {
      return { ...placement, color: blockColors.reserved, height: 0.4, label: `${label}\n(${offset === 0 ? 'network' : 'broadcast'} address)` };
    }
    if (subnet === ipSubnet) {
      return { ...placement, color: blockColors.subnet, height: 2, label };
    }
    return { ...placement, color: blockColors.others[subnet % blockColors.others.length], height: 1, label };
  });
}

// grid cells for a VLSM plan: needed hosts tall, spare hosts short, free space flat
export const vlsmCells = function(blocks: VlsmBlock[]): Cell[] {
  const sizes = blocks.map(block => 2 ** (32 - block.prefix));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  // one cell per address, up to 1024 cells; in a larger network the smallest subnets share a cell
  const cellSize = Math.max(1, total / 1024);
  const network = blocks[0].network;

  return nestedLayout(sizes, cellSize).map((position, i) => {
    const start = network + i * cellSize;
    const end = start + cellSize - 1;
    const groups = sizes.map((_, g) => g).filter(g => blocks[g].network <= end && blocks[g].network + sizes[g] - 1 >= start);
    const group = groups[0];
    const block = blocks[group];
    const range = cellSize === 1 ? intToIp(start) : `${intToIp(start)} - ${intToIp(end)}`;
    const label = `${range}\n${groups.map(g => `${blocks[g].name ?? 'free'} ${blockCidr(blocks[g])}`).join('\n')}`;
    const offset = start - block.network;
    const placement = { group, position };

    if (block.name === null) {
      return { ...placement, color: freeColor, height: 0.15, label };
    }
    if (cellSize === 1 && (offset === 0 || offset === sizes[group] - 1)) {
      return { ...placement, color: blockColors.reserved, height: 0.4, label: `${label}\n(${offset === 0 ? 'network' : 'broadcast'} address)` };
    }
    // the offset of a host address is its host number, so anything past the hosts asked for is spare
    const color = vlsmColors[group % vlsmColors.length];
    return offset <= block.hosts
      ? { ...placement, color, height: 1.6, label }
      : { ...placement, color, height: 0.6, label: `${label}\n(spare)` };
  });
}
