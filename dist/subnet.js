"use strict";
// IPv4 subnet math, shared by the page and the tests
// four dot-separated octets, each 0-255
const isValidIp = function (ip) {
    const octets = ip.split('.');
    return octets.length === 4 && octets.every(octet => /^\d{1,3}$/.test(octet) && parseInt(octet) <= 255);
};
const ipToInt = function (ip) {
    return ip.split('.').reduce((acc, octet) => acc * 256 + parseInt(octet), 0);
};
const intToIp = function (n) {
    return [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
};
const toBinary = function (n) {
    return n.toString(2).padStart(32, '0');
};
// "192.168.1.70" or "192.168.1.70/26"
const parseCidr = function (input) {
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
};
// default prefix of a class A/B/C network; D and E are not subnetted
const classfulPrefix = function (ipClass) {
    const prefixes = { A: 8, B: 16, C: 24 };
    return ipClass in prefixes ? prefixes[ipClass] : null;
};
const prefixToMask = function (prefix) {
    return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
};
const subnetInfo = function (ip, prefix) {
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
};
// The parent network split into /prefix subnets, laid out as a grid of up to 256 cells.
// When the parent holds more than 256 subnets, only the 256 around the IP are drawn.
const subnetLayout = function (ip, prefix, parentPrefix) {
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
};
// Grid position of each cell when every subnet is drawn as its own rectangular tile:
// tiles in reading order across a roughly square grid, cells in reading order inside each tile
const tileLayout = function (cellCount, subnetCount) {
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
};
// smallest subnet with room for the hosts plus its network and broadcast addresses
const prefixForHosts = function (hosts) {
    return 32 - Math.max(2, Math.ceil(Math.log2(hosts + 2)));
};
// largest aligned blocks covering the addresses from start up to (not including) end
const freeBlocks = function (start, end) {
    const blocks = [];
    while (start < end) {
        let size = 1;
        while (start % (size * 2) === 0 && start + size * 2 <= end) {
            size *= 2;
        }
        blocks.push({ name: null, hosts: 0, network: start, prefix: 32 - Math.log2(size) });
        start += size;
    }
    return blocks;
};
// VLSM: give each request the smallest subnet that fits, largest first so every subnet stays aligned
const planVlsm = function (network, prefix, requests) {
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
};
// Grid position of each cell when differently sized blocks (in address order, covering the whole range) are
// drawn as nested rectangles: a range is halved, top/bottom when square and left/right when wide, with a gap
// between the halves, until it lies inside one block; cells inside a block run in reading order.
const nestedLayout = function (sizes, cellSize) {
    const starts = sizes.map((_, i) => sizes.slice(0, i).reduce((sum, size) => sum + size, 0));
    const total = starts[starts.length - 1] + sizes[sizes.length - 1];
    const layout = function (start, size) {
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
            ? Object.assign(Object.assign({}, cell), { row: cell.row + first.rows, gapRows: cell.gapRows + first.gapRows + 1 }) : Object.assign(Object.assign({}, cell), { col: cell.col + first.cols, gapCols: cell.gapCols + first.gapCols + 1 }));
        return square
            ? { cells: [...first.cells, ...shifted], cols: Math.max(first.cols, second.cols), rows: first.rows + second.rows, gapCols: Math.max(first.gapCols, second.gapCols), gapRows: first.gapRows + second.gapRows + 1 }
            : { cells: [...first.cells, ...shifted], cols: first.cols + second.cols, rows: Math.max(first.rows, second.rows), gapCols: first.gapCols + second.gapCols + 1, gapRows: Math.max(first.gapRows, second.gapRows) };
    };
    return layout(0, total).cells;
};
if (typeof module !== 'undefined') {
    module.exports = { isValidIp, ipToInt, intToIp, toBinary, parseCidr, classfulPrefix, prefixToMask, subnetInfo, subnetLayout, tileLayout, prefixForHosts, planVlsm, nestedLayout };
}
