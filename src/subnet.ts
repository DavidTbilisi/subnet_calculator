// IPv4 subnet math, shared by the page and the tests

interface Cidr {
  ip: number;
  prefix: number | null;
}

interface SubnetInfo {
  network: number;
  broadcast: number;
  mask: number;
  wildcard: number;
  firstHost: number;
  lastHost: number;
  usableHosts: number;
}

interface SubnetLayout {
  blockPrefix: number;   // prefix of the block drawn in the grid
  blockNetwork: number;
  subnetCount: number;   // subnets inside the drawn block (at most 256)
  totalSubnets: number;  // subnets inside the whole parent network
  cellCount: number;     // grid cells (at most 256)
  cellSize: number;      // addresses per cell
}

interface GridPosition {
  col: number;
  row: number;
  gapCols: number;       // gaps between subnets to the left of the cell
  gapRows: number;       // gaps between subnets above the cell
}

interface VlsmRequest {
  name: string;
  hosts: number;
}

interface VlsmBlock {
  name: string | null;   // null for free space
  hosts: number;         // hosts needed; 0 for free space
  network: number;
  prefix: number;
}

interface VlsmPlan {
  blocks: VlsmBlock[];   // allocations then free space, in address order
  needed: number;        // addresses the allocations take
  fits: boolean;
}

// four dot-separated octets, each 0-255
const isValidIp = function(ip: string): boolean {
  const octets = ip.split('.');
  return octets.length === 4 && octets.every(octet => /^\d{1,3}$/.test(octet) && parseInt(octet) <= 255);
}

const ipToInt = function(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + parseInt(octet), 0);
}

const intToIp = function(n: number): string {
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
}

const toBinary = function(n: number): string {
  return n.toString(2).padStart(32, '0');
}

// "192.168.1.70" or "192.168.1.70/26"
const parseCidr = function(input: string): Cidr | null {
  const [ip, prefix, ...rest] = input.trim().split('/');

  if (rest.length > 0 || !isValidIp(ip)) {
    return null;
  }
  if (prefix === undefined) {
    return { ip: ipToInt(ip), prefix: null };
  }
  if (!/^\d{1,2}$/.test(prefix) || parseInt(prefix) > 32) {
    return null;
  }
  return { ip: ipToInt(ip), prefix: parseInt(prefix) };
}

// default prefix of a class A/B/C network; D and E are not subnetted
const classfulPrefix = function(ipClass: string): number | null {
  const prefixes: { [ipClass: string]: number } = { A: 8, B: 16, C: 24 };
  return ipClass in prefixes ? prefixes[ipClass] : null;
}

const prefixToMask = function(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

const subnetInfo = function(ip: number, prefix: number): SubnetInfo {
  const mask = prefixToMask(prefix);
  const network = (ip & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  const broadcast = network + size - 1;
  // /31 point-to-point links and /32 single hosts have no network/broadcast address (RFC 3021)
  const reservesEnds = prefix <= 30;

  return {
    network,
    broadcast,
    mask,
    wildcard: ~mask >>> 0,
    firstHost: reservesEnds ? network + 1 : network,
    lastHost: reservesEnds ? broadcast - 1 : broadcast,
    usableHosts: reservesEnds ? size - 2 : size,
  };
}

// The parent network split into /prefix subnets, laid out as a grid of up to 256 cells.
// When the parent holds more than 256 subnets, only the 256 around the IP are drawn.
const subnetLayout = function(ip: number, prefix: number, parentPrefix: number): SubnetLayout {
  const parent = Math.min(parentPrefix, prefix);
  const blockPrefix = Math.max(parent, prefix - 8);
  const blockSize = 2 ** (32 - blockPrefix);
  const cellCount = Math.min(blockSize, 256);

  return {
    blockPrefix,
    blockNetwork: subnetInfo(ip, blockPrefix).network,
    subnetCount: 2 ** (prefix - blockPrefix),
    totalSubnets: 2 ** (prefix - parent),
    cellCount,
    cellSize: blockSize / cellCount,
  };
}

// Grid position of each cell when every subnet is drawn as its own rectangular tile:
// tiles in reading order across a roughly square grid, cells in reading order inside each tile
const tileLayout = function(cellCount: number, subnetCount: number): GridPosition[] {
  const cellsPerTile = cellCount / subnetCount;
  const tileWidth = 2 ** Math.ceil(Math.log2(cellsPerTile) / 2);
  const tileHeight = cellsPerTile / tileWidth;
  const gridWidth = 2 ** Math.ceil(Math.log2(cellCount) / 2);
  const tilesPerRow = gridWidth / tileWidth;

  return Array.from({ length: cellCount }, (_, i) => {
    const tile = Math.floor(i / cellsPerTile);
    const offset = i % cellsPerTile;
    const tileCol = tile % tilesPerRow;
    const tileRow = Math.floor(tile / tilesPerRow);

    return {
      col: tileCol * tileWidth + offset % tileWidth,
      row: tileRow * tileHeight + Math.floor(offset / tileWidth),
      gapCols: tileCol,
      gapRows: tileRow,
    };
  });
}

// smallest subnet with room for the hosts plus its network and broadcast addresses
const prefixForHosts = function(hosts: number): number {
  return 32 - Math.max(2, Math.ceil(Math.log2(hosts + 2)));
}

// largest aligned blocks covering the addresses from start up to (not including) end
const freeBlocks = function(start: number, end: number): VlsmBlock[] {
  const blocks: VlsmBlock[] = [];
  while (start < end) {
    let size = 1;
    while (start % (size * 2) === 0 && start + size * 2 <= end) {
      size *= 2;
    }
    blocks.push({ name: null, hosts: 0, network: start, prefix: 32 - Math.log2(size) });
    start += size;
  }
  return blocks;
}

// VLSM: give each request the smallest subnet that fits, largest first so every subnet stays aligned
const planVlsm = function(network: number, prefix: number, requests: VlsmRequest[]): VlsmPlan {
  const end = network + 2 ** (32 - prefix);
  // sort is stable, so equal requests keep the order they were entered in
  const allocations = [...requests]
    .sort((a, b) => b.hosts - a.hosts)
    .map(request => ({ name: request.name, hosts: request.hosts, network: 0, prefix: prefixForHosts(request.hosts) }));

  let next = network;
  allocations.forEach(allocation => {
    allocation.network = next;
    next += 2 ** (32 - allocation.prefix);
  });

  const needed = next - network;
  const fits = next <= end;
  return { blocks: fits ? [...allocations, ...freeBlocks(next, end)] : allocations, needed, fits };
}

// Grid position of each cell when differently sized blocks (in address order, covering the whole range) are
// drawn as nested rectangles: a range is halved, top/bottom when square and left/right when wide, with a gap
// between the halves, until it lies inside one block; cells inside a block run in reading order.
const nestedLayout = function(sizes: number[], cellSize: number): GridPosition[] {
  const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((sum, size) => sum + size, 0));
  const total = starts[starts.length - 1] + sizes[sizes.length - 1];

  interface Region {
    cells: GridPosition[];
    cols: number;
    rows: number;
    gapCols: number;
    gapRows: number;
  }

  const layout = function(start: number, size: number): Region {
    const count = size / cellSize;
    let block = 0;
    while (block < starts.length - 1 && starts[block + 1] <= start) {
      block++;
    }

    if (count === 1 || start + size <= starts[block] + sizes[block]) {
      const width = 2 ** Math.ceil(Math.log2(count) / 2);
      const cells = Array.from({ length: count }, (_, i) => ({ col: i % width, row: Math.floor(i / width), gapCols: 0, gapRows: 0 }));
      return { cells, cols: width, rows: count / width, gapCols: 0, gapRows: 0 };
    }

    const first = layout(start, size / 2);
    const second = layout(start + size / 2, size / 2);
    const square = Math.log2(count) % 2 === 0;
    const shifted = second.cells.map(cell => square
      ? { ...cell, row: cell.row + first.rows, gapRows: cell.gapRows + first.gapRows + 1 }
      : { ...cell, col: cell.col + first.cols, gapCols: cell.gapCols + first.gapCols + 1 });

    return square
      ? { cells: [...first.cells, ...shifted], cols: Math.max(first.cols, second.cols), rows: first.rows + second.rows, gapCols: Math.max(first.gapCols, second.gapCols), gapRows: first.gapRows + second.gapRows + 1 }
      : { cells: [...first.cells, ...shifted], cols: first.cols + second.cols, rows: Math.max(first.rows, second.rows), gapCols: first.gapCols + second.gapCols + 1, gapRows: Math.max(first.gapRows, second.gapRows) };
  }

  return layout(0, total).cells;
}

if (typeof module !== 'undefined') {
  module.exports = { isValidIp, ipToInt, intToIp, toBinary, parseCidr, classfulPrefix, prefixToMask, subnetInfo, subnetLayout, tileLayout, prefixForHosts, planVlsm, nestedLayout };
}
