import { describe, expect, it } from "vitest";
import * as subnet from "./subnet";

describe("CIDR parsing", () => {
  it("should parse an IP with a prefix", () => {
    const result = subnet.parseCidr("192.168.1.70/26")!;
    expect(subnet.intToIp(result.ip)).toBe("192.168.1.70");
    expect(result.prefix).toBe(26);
  });

  it("should leave the prefix empty when it is omitted", () => {
    expect(subnet.parseCidr("10.0.0.1")!.prefix).toBeNull();
  });

  it("should reject invalid addresses and prefixes", () => {
    expect(subnet.parseCidr("300.1.1.1/24")).toBeNull();
    expect(subnet.parseCidr("10.0.0/8")).toBeNull();
    expect(subnet.parseCidr("10.0.0.1/33")).toBeNull();
    expect(subnet.parseCidr("10.0.0.1/8/8")).toBeNull();
  });
});

describe("Subnet info", () => {
  it("should calculate a /26 subnet", () => {
    const info = subnet.subnetInfo(subnet.ipToInt("192.168.1.70"), 26);
    expect(subnet.intToIp(info.network)).toBe("192.168.1.64");
    expect(subnet.intToIp(info.broadcast)).toBe("192.168.1.127");
    expect(subnet.intToIp(info.mask)).toBe("255.255.255.192");
    expect(subnet.intToIp(info.wildcard)).toBe("0.0.0.63");
    expect(subnet.intToIp(info.firstHost)).toBe("192.168.1.65");
    expect(subnet.intToIp(info.lastHost)).toBe("192.168.1.126");
    expect(info.usableHosts).toBe(62);
  });

  it("should handle /0, /31 and /32", () => {
    expect(subnet.subnetInfo(subnet.ipToInt("8.8.8.8"), 0).usableHosts).toBe(2 ** 32 - 2);
    expect(subnet.subnetInfo(subnet.ipToInt("10.0.0.1"), 31).usableHosts).toBe(2);
    expect(subnet.subnetInfo(subnet.ipToInt("10.0.0.1"), 32).usableHosts).toBe(1);
  });
});

describe("Subnet layout", () => {
  it("should split a class C network into four /26 subnets", () => {
    const layout = subnet.subnetLayout(subnet.ipToInt("192.168.1.70"), 26, 24);
    expect(subnet.intToIp(layout.blockNetwork)).toBe("192.168.1.0");
    expect(layout.subnetCount).toBe(4);
    expect(layout.totalSubnets).toBe(4);
    expect(layout.cellCount).toBe(256);
    expect(layout.cellSize).toBe(1);
  });

  it("should only draw the 256 subnets around the IP in a large network", () => {
    const layout = subnet.subnetLayout(subnet.ipToInt("10.1.2.3"), 30, 8);
    expect(layout.totalSubnets).toBe(2 ** 22);
    expect(layout.subnetCount).toBe(256);
    expect(layout.blockPrefix).toBe(22);
    expect(subnet.intToIp(layout.blockNetwork)).toBe("10.1.0.0");
  });

  it("should treat a prefix shorter than the classful one as a single supernet", () => {
    const layout = subnet.subnetLayout(subnet.ipToInt("172.16.5.5"), 12, 16);
    expect(layout.subnetCount).toBe(1);
    expect(layout.cellSize).toBe(2 ** 20 / 256);
  });
});

describe("Tile layout", () => {
  it("should draw four /26 subnets of a /24 as 8x8 quadrants", () => {
    const cells = subnet.tileLayout(256, 4);
    // first address of each subnet is the top-left corner of its quadrant
    expect([0, 64, 128, 192].map(i => [cells[i].col, cells[i].row])).toEqual([[0, 0], [8, 0], [0, 8], [8, 8]]);
    // addresses run in reading order inside a quadrant
    expect([cells[1].col, cells[1].row]).toEqual([1, 0]);
    expect([cells[8].col, cells[8].row]).toEqual([0, 1]);
    expect([cells[255].gapCols, cells[255].gapRows]).toEqual([1, 1]);
  });

  it("should draw /29 subnets of a /24 as 4x2 tiles, four per row", () => {
    const cells = subnet.tileLayout(256, 32);
    expect([cells[8].col, cells[8].row]).toEqual([4, 0]);
    expect([cells[32].col, cells[32].row]).toEqual([0, 2]);
    expect(Math.max(...cells.map(cell => cell.col))).toBe(15);
    expect(Math.max(...cells.map(cell => cell.row))).toBe(15);
  });

  it("should handle a single cell", () => {
    expect(subnet.tileLayout(1, 1)).toEqual([{ col: 0, row: 0, gapCols: 0, gapRows: 0 }]);
  });
});

describe("VLSM", () => {
  it("should pick the smallest prefix that fits the hosts", () => {
    expect(subnet.prefixForHosts(1)).toBe(30);
    expect(subnet.prefixForHosts(2)).toBe(30);
    expect(subnet.prefixForHosts(3)).toBe(29);
    expect(subnet.prefixForHosts(62)).toBe(26);
    expect(subnet.prefixForHosts(63)).toBe(25);
  });

  it("should allocate largest first and leave the rest as aligned free blocks", () => {
    const plan = subnet.planVlsm(subnet.ipToInt("192.168.1.0"), 24, [
      { name: "Link 1", hosts: 2 },
      { name: "LAN A", hosts: 50 },
      { name: "Link 2", hosts: 2 },
      { name: "LAN B", hosts: 20 },
    ]);
    const cidrs = plan.blocks.map(block => `${block.name ?? "free"} ${subnet.intToIp(block.network)}/${block.prefix}`);
    expect(cidrs).toEqual([
      "LAN A 192.168.1.0/26",
      "LAN B 192.168.1.64/27",
      "Link 1 192.168.1.96/30",
      "Link 2 192.168.1.100/30",
      "free 192.168.1.104/29",
      "free 192.168.1.112/28",
      "free 192.168.1.128/25",
    ]);
    expect(plan.needed).toBe(104);
    expect(plan.fits).toBe(true);
  });

  it("should report when the requests do not fit", () => {
    const plan = subnet.planVlsm(subnet.ipToInt("192.168.1.0"), 26, [{ name: "LAN", hosts: 50 }, { name: "Link", hosts: 2 }]);
    expect(plan.fits).toBe(false);
    expect(plan.needed).toBe(68);
  });
});

describe("Nested layout", () => {
  it("should draw each block as its own rectangle with gaps between blocks", () => {
    // a /24 holding a /25 and two /26s: the /25 on top, the /26s side by side below it
    const cells = subnet.nestedLayout([128, 64, 64], 1);
    expect(cells).toHaveLength(256);
    expect(cells[0]).toEqual({ col: 0, row: 0, gapCols: 0, gapRows: 0 });
    expect(cells[128]).toEqual({ col: 0, row: 8, gapCols: 0, gapRows: 1 });
    expect(cells[192]).toEqual({ col: 8, row: 8, gapCols: 1, gapRows: 1 });
    // cells inside a block run in reading order: the /25 is 16 wide, the /26s 8 wide
    expect(cells[16]).toEqual({ col: 0, row: 1, gapCols: 0, gapRows: 0 });
    expect(cells[136]).toEqual({ col: 0, row: 9, gapCols: 0, gapRows: 1 });
  });

  it("should merge blocks smaller than a cell into one cell", () => {
    expect(subnet.nestedLayout([4, 4, 8], 8)).toHaveLength(2);
  });
});

describe("Special ranges", () => {
  const range = (ip: string) => subnet.specialRange(subnet.ipToInt(ip));

  it("should find the block an address is in", () => {
    expect(range("127.0.0.1")).toEqual({ name: "Loopback", cidr: "127.0.0.0/8" });
    expect(range("0.1.2.3")?.cidr).toBe("0.0.0.0/8");
    expect(range("10.200.0.1")?.cidr).toBe("10.0.0.0/8");
    expect(range("172.31.255.255")?.cidr).toBe("172.16.0.0/12");
    expect(range("192.168.1.70")?.cidr).toBe("192.168.0.0/16");
    expect(range("100.127.0.1")?.cidr).toBe("100.64.0.0/10");
    expect(range("169.254.10.10")?.name).toBe("Link-local (RFC 3927)");
    expect(range("198.51.100.7")?.cidr).toBe("198.51.100.0/24");
    expect(range("239.1.1.1")?.name).toBe("Multicast");
  });

  it("should prefer the most specific block", () => {
    expect(range("255.255.255.255")?.name).toBe("Limited broadcast");
    expect(range("255.255.255.254")?.name).toBe("Reserved");
  });

  it("should return null for public addresses", () => {
    expect(range("8.8.8.8")).toBeNull();
    expect(range("172.32.0.1")).toBeNull();
    expect(range("100.128.0.1")).toBeNull();
  });
});

describe("Range to CIDR", () => {
  const cidrs = (start: string, end: string) => subnet.rangeToCidrs(subnet.ipToInt(start), subnet.ipToInt(end)).map(block => `${subnet.intToIp(block.network)}/${block.prefix}`);

  it("should cover a range with the fewest aligned blocks", () => {
    expect(cidrs("192.168.1.10", "192.168.1.100")).toEqual([
      "192.168.1.10/31", "192.168.1.12/30", "192.168.1.16/28", "192.168.1.32/27", "192.168.1.64/27", "192.168.1.96/30", "192.168.1.100/32",
    ]);
    expect(cidrs("10.0.0.0", "10.0.0.255")).toEqual(["10.0.0.0/24"]);
    expect(cidrs("1.2.3.4", "1.2.3.4")).toEqual(["1.2.3.4/32"]);
  });

  it("should handle the whole address space", () => {
    expect(cidrs("0.0.0.0", "255.255.255.255")).toEqual(["0.0.0.0/0"]);
  });
});

describe("Summarization", () => {
  const blocks = (...texts: string[]) => texts.map(text => {
    const cidr = subnet.parseCidr(text)!;
    return { network: cidr.ip, prefix: cidr.prefix! };
  });
  const text = (list: { network: number; prefix: number }[]) => list.map(block => `${subnet.intToIp(block.network)}/${block.prefix}`);

  it("should merge adjacent blocks", () => {
    expect(text(subnet.summarize(blocks("10.0.0.0/24", "10.0.1.0/24")))).toEqual(["10.0.0.0/23"]);
    expect(text(subnet.summarize(blocks("10.0.3.0/24", "10.0.0.0/24", "10.0.2.0/24", "10.0.1.0/24")))).toEqual(["10.0.0.0/22"]);
  });

  it("should drop covered blocks and keep gaps", () => {
    expect(text(subnet.summarize(blocks("10.0.0.0/16", "10.0.5.0/24", "10.2.0.0/16")))).toEqual(["10.0.0.0/16", "10.2.0.0/16"]);
  });

  it("should not merge unaligned neighbours", () => {
    expect(text(subnet.summarize(blocks("10.0.1.0/24", "10.0.2.0/24")))).toEqual(["10.0.1.0/24", "10.0.2.0/24"]);
  });

  it("should find the smallest covering supernet", () => {
    expect(text([subnet.supernet(blocks("10.0.1.0/24", "10.0.2.0/24"))])).toEqual(["10.0.0.0/22"]);
    expect(text([subnet.supernet(blocks("192.168.1.0/24"))])).toEqual(["192.168.1.0/24"]);
    expect(text([subnet.supernet(blocks("1.0.0.0/8", "200.0.0.0/8"))])).toEqual(["0.0.0.0/0"]);
  });

  it("should check whether an address is in a block", () => {
    const [block] = blocks("10.0.0.0/12");
    expect(subnet.contains(block, subnet.ipToInt("10.15.255.255"))).toBe(true);
    expect(subnet.contains(block, subnet.ipToInt("10.16.0.0"))).toBe(false);
  });
});

describe("VLSM /31 links", () => {
  it("should give two-host links a /31 only when asked", () => {
    expect(subnet.prefixForHosts(2)).toBe(30);
    expect(subnet.prefixForHosts(2, true)).toBe(31);
    expect(subnet.prefixForHosts(1, true)).toBe(31);
    expect(subnet.prefixForHosts(3, true)).toBe(29);
  });

  it("should pack /31 links", () => {
    const plan = subnet.planVlsm(subnet.ipToInt("10.0.0.0"), 29, [{ name: "A", hosts: 2 }, { name: "B", hosts: 2 }], true);
    expect(plan.needed).toBe(4);
    expect(plan.blocks.map(block => block.prefix)).toEqual([31, 31, 30]);
  });
});
